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

## Pseudocode

```text
// Before: a list of pointers to particle objects scattered on the heap.
// Each step of the loop jumps to a new address and drags in cold fields.
for each pointer p in particles:
    p.velocity ← p.velocity + gravity × dt
    p.position ← p.position + p.velocity × dt
    p.life ← p.life - dt

// After: structure of arrays, all sized to capacity up front.
ParticlesSoA:
    position[capacity], velocity[capacity], life[capacity]  // hot: read every tick
    start_color[capacity], end_color[capacity]              // cold: spawn and render only
    count        // live particles are always packed in 0 .. count-1

    tick(dt):
        g ← gravity × dt
        for i from 0 to count-1:          // walks memory in order: few misses
            velocity[i] ← velocity[i] + g
            position[i] ← position[i] + velocity[i] × dt
            life[i] ← life[i] - dt

        i ← 0
        while i < count:                  // remove dead ones, keep it dense
            if life[i] > 0:
                i ← i + 1
            else:
                count ← count - 1
                copy slot count into slot i in EVERY array   // swap-remove
                // don't advance i: slot i now holds a particle not checked yet
```

## Example

Measure before and after: the Unity Profiler (or a `Stopwatch` around the loop), Godot's profiler, or Unreal Insights with a `TRACE_CPUPROFILER_EVENT_SCOPE` around the update. Layout changes that don't show up in a measurement aren't worth their complexity.

**Before:** one object per particle, scattered on the heap, with fields the update loop never reads:

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

class ParticleObject                    // reference type: each instance lives somewhere on the heap
{
    public Vector3 Position, Velocity;
    public float Life;
    public string DebugName;            // cold data dragged into the cache with the hot data
    public Color StartColor, EndColor;
}

class ParticlesAoS
{
    List<ParticleObject> particles = new();   // a list of pointers

    void Tick(float dt)
    {
        foreach (var p in particles)    // each p: pointer chase, likely cache miss
        {
            p.Velocity += Physics.gravity * dt;
            p.Position += p.Velocity * dt;
            p.Life -= dt;
        }
    }
}
```

```gdscript [Godot (GDScript)]
# particles_aos.gd
extends RefCounted

const GRAVITY := Vector3(0.0, -9.8, 0.0)


class ParticleObject:  # each instance is a separate heap object
	var position: Vector3
	var velocity: Vector3
	var life: float
	var debug_name: String  # cold data next to the hot data
	var start_color: Color
	var end_color: Color


var particles: Array[ParticleObject] = []  # an array of references


func tick(dt: float) -> void:
	for p in particles:  # each p: a pointer chase plus a property lookup
		p.velocity += GRAVITY * dt
		p.position += p.velocity * dt
		p.life -= dt
```

```cpp [Unreal (C++)]
// ParticlesAoS.h
struct FParticleObject                 // each one allocated separately
{
	FVector Position, Velocity;
	float Life = 0.f;
	FString DebugName;                 // cold data dragged into the cache with the hot data
	FLinearColor StartColor, EndColor;
};

class FParticlesAoS
{
public:
	void Tick(float Dt, const FVector& Gravity)
	{
		for (const TUniquePtr<FParticleObject>& P : Particles)   // pointer chase, likely cache miss
		{
			P->Velocity += Gravity * Dt;
			P->Position += P->Velocity * Dt;
			P->Life -= Dt;
		}
	}

private:
	TArray<TUniquePtr<FParticleObject>> Particles;               // an array of pointers
};
```

:::

**After:** structure of arrays. Each array is contiguous and dense, and the hot loop reads only what it needs:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

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

```gdscript [Godot (GDScript)]
# particles_soa.gd: packed arrays store their elements contiguously, unboxed.
class_name ParticlesSoA
extends RefCounted

const GRAVITY := Vector3(0.0, -9.8, 0.0)

# Hot data, one contiguous array per field.
var _position := PackedVector3Array()
var _velocity := PackedVector3Array()
var _life := PackedFloat32Array()

# Cold data, read only when spawning or rendering.
var _start_color := PackedColorArray()
var _end_color := PackedColorArray()

var _count := 0


func _init(capacity: int) -> void:
	_position.resize(capacity)
	_velocity.resize(capacity)
	_life.resize(capacity)
	_start_color.resize(capacity)
	_end_color.resize(capacity)


func tick(dt: float) -> void:
	var g := GRAVITY * dt
	for i in _count:
		_velocity[i] += g
		_position[i] += _velocity[i] * dt
		_life[i] -= dt

	var j := 0
	while j < _count:  # remove dead particles, keeping arrays dense
		if _life[j] > 0.0:
			j += 1
			continue
		_count -= 1
		_position[j] = _position[_count]
		_velocity[j] = _velocity[_count]
		_life[j] = _life[_count]
		_start_color[j] = _start_color[_count]
		_end_color[j] = _end_color[_count]
```

```cpp [Unreal (C++)]
// ParticlesSoA.h
class FParticlesSoA
{
public:
	explicit FParticlesSoA(int32 Capacity)
	{
		Position.SetNumZeroed(Capacity);
		Velocity.SetNumZeroed(Capacity);
		Life.SetNumZeroed(Capacity);
		StartColor.SetNumZeroed(Capacity);
		EndColor.SetNumZeroed(Capacity);
	}

	void Tick(float Dt, const FVector& Gravity)
	{
		const FVector G = Gravity * Dt;
		for (int32 i = 0; i < Count; ++i)          // sequential: the prefetcher keeps up
		{
			Velocity[i] += G;
			Position[i] += Velocity[i] * Dt;
			Life[i] -= Dt;
		}

		for (int32 i = 0; i < Count; )             // remove dead particles, keeping arrays dense
		{
			if (Life[i] > 0.f) { ++i; continue; }
			const int32 Last = --Count;
			Position[i] = Position[Last];
			Velocity[i] = Velocity[Last];
			Life[i] = Life[Last];
			StartColor[i] = StartColor[Last];
			EndColor[i] = EndColor[Last];
		}
	}

private:
	// Hot data, one contiguous array per field.
	TArray<FVector> Position;
	TArray<FVector> Velocity;
	TArray<float> Life;

	// Cold data, read only when spawning or rendering.
	TArray<FLinearColor> StartColor;
	TArray<FLinearColor> EndColor;

	int32 Count = 0;
};
```

:::

**Engine notes**

- **Unity:** the next steps are `NativeArray<T>` with the [Job System](./job-system) and Burst, which vectorises loops like this automatically. Unity's ECS (Entities) stores components in contiguous chunks by design, so this pattern is built in.
- **Godot:** in GDScript, interpreter overhead per line dwarfs cache effects, so the SoA version is mainly a memory win. The speed win comes from handing whole packed arrays to the engine in one call (for example `MultiMesh.buffer`, a `PackedFloat32Array`), from moving the loop to C# or a GDExtension in C++, or from `GPUParticles3D`, which simulates on the GPU.
- **Unreal:** a `TArray` of structs is already contiguous, so `TArray<FParticle>` (array of structs) is often good enough; split into SoA when the loop reads only a few fields. **Mass** (the MassEntity plugin) stores fragments in archetype chunks, the engine's built-in version of this layout. `ParallelFor` splits loops like this across cores.

## When to use

- Hot loops over many similar items: particles, bullets, crowds, boids, pathfinding nodes, animation bones.
- When the profiler shows a loop dominated by memory access rather than computation.

## When not to use

- Code that isn't a hot path in a profiler. Restructuring data for cache efficiency makes code harder to read.
- Objects with very different data and behaviour. Packing them into parallel arrays fights the design.
- When the bottleneck is GPU, I/O or the algorithm itself. Better memory layout won't help.

## Pitfalls

- **Premature optimisation.** For a few hundred items, the difference is rarely measurable. Profile first. Data-oriented code is harder to read and change.
- **Large structs in arrays.** Copying a 200-byte struct by value is expensive, and a hot loop over it wastes cache on cold fields. Split hot and cold data, and access elements with `ref`.
- **SoA bookkeeping.** Every array must be added, removed and swapped together. Wrap them in one class so they cannot drift apart.
- **Pointer-rich designs undo the gains.** A struct that holds a reference to a class instance puts the pointer chase back. Use indices into other arrays instead.

## Related

- [Object Pool](./object-pool) — the dense, preallocated array is a pool.
- [Flyweight](./flyweight) — moving shared data out of each element keeps elements small.
- [Spatial Partition](./spatial-partition) — grids built as flat arrays stay cache-friendly.
- [Entity Component System](./entity-component-system) and [Job System](./job-system) — the large-scale applications of this pattern.
