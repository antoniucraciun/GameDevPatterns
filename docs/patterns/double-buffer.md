# Double Buffer

> Keep a current and a next state so readers never see a half-written update.

**Category:** Game Loop & Timing

## Problem

A cellular simulation (Game of Life, fire spreading, fluid on a grid) updates each cell from its neighbours. If you update the grid in place, cell 5 reads cell 4 *after* cell 4 has already changed this tick, but cell 3 reads cell 4 *before*. The result depends on iteration order, and patterns drift in one direction. The same bug appears whenever objects read each other's state during one update, such as boids reading neighbours' velocities or AI reading other agents' decisions. It also appears at a larger scale when a renderer reads a framebuffer that is still being drawn, which causes tearing.

## Solution

Keep **two buffers**:

- **Current** is read-only during the tick. Everyone reads from it.
- **Next** is write-only during the tick. Everyone writes to it.

At the end of the tick, **swap** them. Swapping exchanges two references, not the data, so it is O(1). Every update in a tick then sees the same consistent snapshot of the previous tick, and iteration order no longer matters.

## Example (Unity C#)

A fire-spread grid, where order independence matters:

```csharp
public class FireGrid
{
    readonly int width, height;
    float[] current;    // heat this tick: read only
    float[] next;       // heat next tick: write only

    public FireGrid(int width, int height)
    {
        this.width = width; this.height = height;
        current = new float[width * height];
        next = new float[width * height];
    }

    public float this[int x, int y] => current[y * width + x];

    public void Ignite(int x, int y) => current[y * width + x] = 1f;

    public void Tick(float spread, float cooling)
    {
        for (int y = 0; y < height; y++)
        for (int x = 0; x < width; x++)
        {
            int i = y * width + x;
            float neighbours = Read(x - 1, y) + Read(x + 1, y) + Read(x, y - 1) + Read(x, y + 1);
            next[i] = Mathf.Clamp01(current[i] + neighbours * spread - cooling);
        }

        (current, next) = (next, current);   // swap references: O(1), no copying
    }

    float Read(int x, int y) =>
        x < 0 || y < 0 || x >= width || y >= height ? 0f : current[y * width + x];
}
```

The same pattern for objects that read each other's state. Agents read the *published* state of their neighbours, and publish their own new state only after everyone has updated:

```csharp
public struct AgentState { public Vector2 Position, Velocity; }

public class Agent
{
    public AgentState Current;   // what others see this tick
    public AgentState Next;      // what this agent computes

    public void Swap() => Current = Next;
}

// Update phase: everyone reads Current, writes Next.
foreach (var a in agents) a.Next = ComputeSteering(a, neighbours);   // reads n.Current only
// Publish phase:
foreach (var a in agents) a.Swap();
```

The GPU does this at the largest scale. The front buffer is displayed while the back buffer is drawn, and they are swapped at vsync.

## When to use

- State updated incrementally while other code reads it during the same step: cellular automata, grid simulations, physics-like interactions between many objects.
- Producer/consumer handoff between threads, such as a simulation thread writing state that the render thread reads.
- Interpolated rendering: keeping the previous and current simulation state, as in [Fixed Timestep](./fixed-timestep).

## Pitfalls

- **Writing to `current` during the tick** silently brings the bug back. Make the read and write paths obvious, or enforce them with read-only views.
- **Forgetting cells that do not change.** Every cell of `next` must be written each tick, or it keeps the value from two ticks ago. Copy unchanged values explicitly.
- **Double the memory.** Large grids or per-object state cost twice as much. For sparse updates, a list of pending changes applied at the end of the tick can be cheaper.
- **One tick of latency.** Effects become visible to others one tick later. Usually invisible, but it matters for tightly coupled systems such as chains of triggers.

## Related

- [Game Loop](./game-loop) and [Update Method](./update-method) — double buffering removes update-order dependencies between objects.
- [Fixed Timestep](./fixed-timestep) — keeps previous and current states for interpolation.
- [Determinism](./determinism) — order-independent updates are much easier to make deterministic.
- [Cellular Automata](./cellular-automata) — the classic use case.
