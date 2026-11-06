# Time Slicing

> Spread expensive work over several frames to stay within the frame budget.

**Also known as:** Amortization, Frame Budgeting · **Category:** Game Loop & Timing

## Problem

At 60 FPS, a frame has 16.6 ms for *everything*. Regenerating the navmesh for a destroyed building takes 40 ms. Recalculating paths for 200 units takes 25 ms. Updating the AI of 500 enemies costs 8 ms every frame, even though most of them are far away and nobody would notice if they thought less often. Doing any of this in one frame causes a visible hitch. Doing it every frame wastes budget that rendering and gameplay need.

## Solution

Accept that **not everything must happen this frame**, and divide work deliberately:

| Technique | How it works | Use for |
| --- | --- | --- |
| **Work queue with a time budget** | Process queued jobs until N milliseconds are used, then continue next frame | Path requests, procedural generation, loading, rebuilding data structures |
| **Round-robin updates** | Update 1/N of the agents each frame, each with a larger `dt` | AI thinking, perception checks, far-away simulation |
| **Fixed item count per frame** | Process at most K items per frame | Simple cases where items have similar cost |
| **Incremental algorithms** | Algorithms that can pause and resume, such as an A* search that expands 500 nodes per frame | Very large single tasks |

The cost of time slicing is **latency**. Results arrive a few frames later, so systems must be designed to tolerate it: show a "thinking" state, use the old path until the new one arrives.

## Example (Unity C#)

A frame-budgeted work queue:

```csharp
using System;
using System.Collections.Generic;
using System.Diagnostics;
using UnityEngine;

public class FrameBudget : MonoBehaviour
{
    public static FrameBudget Instance { get; private set; }

    [SerializeField] float budgetMs = 2f;                   // time this system may use per frame

    readonly Queue<Action> work = new();
    readonly Stopwatch watch = new();

    public int Pending => work.Count;

    void Awake() => Instance = this;

    public void Enqueue(Action job) => work.Enqueue(job);

    void Update()
    {
        watch.Restart();
        while (work.Count > 0 && watch.Elapsed.TotalMilliseconds < budgetMs)
            work.Dequeue().Invoke();                        // at least one job runs, even if it overruns
    }
}

// 200 units request paths; they are computed over several frames instead of one.
// foreach (var unit in selected)
//     FrameBudget.Instance.Enqueue(() => unit.SetPath(pathfinder.FindPath(unit.Cell, goal)));
```

Round-robin updates for many agents:

```csharp
public interface ISlicedUpdate { void SlicedUpdate(float dt); }

public class RoundRobinUpdater : MonoBehaviour
{
    [SerializeField] int slices = 4;                         // each agent updates every 4th frame

    readonly List<ISlicedUpdate> agents = new();
    readonly List<float> lastUpdate = new();
    int frame;

    public void Register(ISlicedUpdate agent) { agents.Add(agent); lastUpdate.Add(Time.time); }

    void Update()
    {
        int slice = frame++ % slices;
        for (int i = slice; i < agents.Count; i += slices)
        {
            float dt = Time.time - lastUpdate[i];            // the real time since this agent last updated
            lastUpdate[i] = Time.time;
            agents[i].SlicedUpdate(dt);
        }
    }
}
```

Each agent receives the actual time since its last update, so timers and movement stay correct even though it updates less often. Combine this with [Level of Detail](./level-of-detail): nearby agents every frame, distant agents every 4th or 8th frame.

## When to use

- Any task that occasionally takes longer than a few milliseconds: generation, pathfinding batches, navmesh rebuilds, serialisation, large searches.
- Many agents whose updates do not need to happen every frame.
- Mobile and VR, where frame budgets are tight and hitches are very noticeable.

## When not to use

- Work that fits comfortably in the frame budget. Measure in the Profiler first; slicing adds state, latency and bugs.
- Results that must be ready this frame, such as hit detection or player input.
- Heavy work that can run in parallel. The [Job System](./job-system) or a background thread is usually better than spreading it across main-thread frames.

## Pitfalls

- **One job bigger than the budget.** A single 40 ms job still causes a 40 ms frame. Split large tasks into incremental steps, or move them to worker threads with the [Job System](./job-system).
- **Unbounded queues.** If work arrives faster than the budget processes it, latency grows without limit. Monitor the queue length, merge duplicate requests, and drop stale ones.
- **Stale results.** A path computed for a unit that has since died, or for a goal that has moved, is wasted or wrong. Check that results are still relevant when they arrive.
- **Wrong `dt`.** Agents updated every 4th frame must use their own elapsed time, not `Time.deltaTime`, or they move four times too slowly.
- **Synchronised spikes.** If every agent's "expensive check every 2 seconds" starts on the same frame, they all run together. Stagger start times, as round-robin does.

## Related

- [Coroutines](./coroutines) — a convenient way to write sliced work that yields between chunks.
- [Job System](./job-system) — move work to other cores instead of spreading it over time.
- [Level of Detail](./level-of-detail) — decide which agents deserve frequent updates.
- [A* Pathfinding](./a-star) and [Perception System](./perception-system) — common candidates for slicing.
