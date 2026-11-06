# Data Locality

> Lay data out contiguously in the order it is processed to keep the CPU cache warm.

**Also known as:** Structure of Arrays, Data-Oriented Design · **Category:** Performance & Memory

## Problem

You profile a loop that updates 10,000 particles. The math per particle is trivial, yet the loop is slow. The cause is memory, not arithmetic. Each particle is a separate object somewhere on the heap, so the CPU follows a pointer to a random address, waits roughly 100+ cycles for main memory, uses 8 bytes of the 64-byte cache line it fetched, and repeats. A modern CPU can do hundreds of operations in the time one cache miss takes.

## Solution

Arrange data so that **what you process together sits together in memory, in the order you process it**. The CPU fetches memory in cache lines (typically 64 bytes) and prefetches ahead when access is sequential. Contiguous data means every byte fetched is used, and the next line is already on its way.

Techniques, roughly from simplest to most involved:

| Technique | Idea |
| --- | --- |
| **Arrays of structs instead of arrays of objects** | `Particle[]` with `struct Particle` stores values inline. `List<ParticleObject>` stores pointers to scattered objects. |
| **Keep it dense** | Live elements packed in `[0, count)`, removed by swap-remove, so loops never skip dead entries. |
| **Hot/cold splitting** | Move rarely used fields (name, debug info, spawn data) out of the struct the hot loop iterates. |
| **Structure of Arrays (SoA)** | Separate arrays per field (`positions[]`, `velocities[]`), so a loop that needs only positions touches only positions. Ideal for SIMD. |
| **Sort by access** | Process items grouped by type or material, so branches are predictable and shared data stays cached. |

## Example (Unity C#)

**Before:** one object per particle, scattered on the heap, with fields the update loop never reads:

```csharp
class ParticleObject                    // reference type: each instance lives somewhere on the heap
{
    public Vector3 Position, Velocity;
    public float Life;
    public string DebugName;            // cold data dragged into the cache with the hot data
    public Color StartColor, EndColor;
}

List<ParticleObject> particles;         // a list of pointers

void Tick(float dt)
{
    foreach (var p in particles)        // each p: pointer chase, likely cache miss
    {
        p.Velocity += Physics.gravity * dt;
        p.Position += p.Velocity * dt;
        p.Life -= dt;
    }
}
```

**After:** structure of arrays. Each array is contiguous and dense, and the hot loop reads only what it needs:

```csharp
public class ParticleSystemSoA
{
    // Hot data, one contiguous array per field.
    readonly Vector3[] position;
    readonly Vector3[] velocity;
    readonly float[] life;

    // Cold data, read only when spawning or rendering.
    readonly Color[] startColor, endColor;

    int count;

    public ParticleSystemSoA(int capacity)
    {
        position = new Vector3[capacity];
        velocity = new Vector3[capacity];
        life = new float[capacity];
        startColor = new Color[capacity];
        endColor = new Color[capacity];
    }

    public void Tick(float dt)
    {
        Vector3 g = Physics.gravity * dt;

        for (int i = 0; i < count; i++)        // sequential: the prefetcher keeps up
        {
            velocity[i] += g;
            position[i] += velocity[i] * dt;
            life[i] -= dt;
        }

        for (int i = 0; i < count; i++)        // remove dead particles, keeping arrays dense
        {
            if (life[i] > 0f) continue;
            int last = --count;
            position[i] = position[last];
            velocity[i] = velocity[last];
            life[i] = life[last];
            startColor[i] = startColor[last];
            endColor[i] = endColor[last];
            i--;
        }
    }
}
```

In Unity, the next steps are `NativeArray<T>` with the Job System and Burst, which vectorises loops like this automatically. Unity's ECS (Entities) stores components in contiguous chunks by design, so this pattern is built in.

## When to use

- Hot loops over many similar items: particles, bullets, crowds, boids, pathfinding nodes, animation bones.
- When the profiler shows a loop dominated by memory access rather than computation.

## Pitfalls

- **Premature optimisation.** For a few hundred items, the difference is rarely measurable. Profile first. Data-oriented code is harder to read and change.
- **Large structs in arrays.** Copying a 200-byte struct by value is expensive, and a hot loop over it wastes cache on cold fields. Split hot and cold data, and access elements with `ref`.
- **SoA bookkeeping.** Every array must be added, removed and swapped together. Wrap them in one class so they cannot drift apart.
- **Pointer-rich designs undo the gains.** A struct that holds a reference to a class instance puts the pointer chase back. Use indices into other arrays instead.

## Related

- [Object Pool](./object-pool) — the dense, preallocated array is a pool.
- [Flyweight](./flyweight) — moving shared data out of each element keeps elements small.
- [Spatial Partition](./spatial-partition) — grids built as flat arrays stay cache-friendly.
- [Entity Component System](./entity-component-system) and Job System — the large-scale applications of this pattern.
