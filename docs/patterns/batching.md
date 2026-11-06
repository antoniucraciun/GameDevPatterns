# Batching

> Group many small operations (draw calls, raycasts, writes) into one larger one.

**Category:** Performance & Memory

## Problem

Each small operation has a fixed overhead that has nothing to do with the work itself. Drawing one rock costs a draw call: the CPU sets up state, validates and submits to the GPU, and 3,000 rocks cost 3,000 of those even though each is tiny. 500 agents each calling `Physics.Raycast` pay the per-call cost 500 times, on the main thread, one after another. Writing a save file one line at a time, sending one network packet per event, rebuilding a UI canvas for each changed label: the pattern repeats everywhere. The overhead, not the work, becomes the bottleneck.

## Solution

**Collect similar operations and submit them together**, so the fixed cost is paid once per batch rather than once per item.

In rendering, Unity provides several kinds of batching:

| Technique | What it batches | Requirements |
| --- | --- | --- |
| **SRP Batcher** (URP/HDRP) | Reduces the CPU cost of draw calls that share a shader variant | Compatible shaders. On by default. |
| **GPU instancing** | Many copies of the same mesh and material in one draw call | Same mesh and material, with instancing enabled. Per-instance data via properties. |
| **Static batching** | Combines static meshes sharing a material into large buffers | Objects marked *Batching Static*. Uses more memory. |
| **`Graphics.RenderMeshInstanced`** | Your own instanced drawing from code | You provide the matrices (see [Flyweight](./flyweight)). |

Outside rendering, the same idea applies:

- **Physics queries:** `RaycastCommand`, `SpherecastCommand` and `OverlapSphereCommand` run thousands of queries as one job across worker threads.
- **Network:** collect messages for a tick and send one packet. See [Interest Management](./interest-management).
- **UI:** change many values, then rebuild once (Canvas rebuilds happen once per frame, so avoid forcing them manually).
- **Saves, logs and analytics:** buffer writes and flush in one operation.

## Example (Unity C#)

Batched raycasts: 500 agents check line of sight to the player with one scheduled job, instead of 500 sequential calls.

```csharp
using Unity.Collections;
using Unity.Jobs;
using UnityEngine;

public class BatchedLineOfSight : MonoBehaviour
{
    [SerializeField] Transform player;
    [SerializeField] Transform[] agents;              // e.g. 500 enemies
    [SerializeField] LayerMask occluders;

    NativeArray<RaycastCommand> commands;
    NativeArray<RaycastHit> results;
    JobHandle handle;
    bool scheduled;

    public bool[] CanSeePlayer { get; private set; }

    void Start()
    {
        commands = new NativeArray<RaycastCommand>(agents.Length, Allocator.Persistent);
        results = new NativeArray<RaycastHit>(agents.Length, Allocator.Persistent);   // 1 hit per ray
        CanSeePlayer = new bool[agents.Length];
    }

    void Update()
    {
        // 1. Build all queries.
        var query = new QueryParameters(occluders);
        Vector3 target = player.position + Vector3.up;
        for (int i = 0; i < agents.Length; i++)
        {
            Vector3 eye = agents[i].position + Vector3.up * 1.6f;
            Vector3 dir = target - eye;
            commands[i] = new RaycastCommand(eye, dir.normalized, query, dir.magnitude);
        }

        // 2. Submit them as one batch, spread across worker threads.
        handle = RaycastCommand.ScheduleBatch(commands, results, minCommandsPerJob: 32, maxHits: 1);
        scheduled = true;
    }

    void LateUpdate()
    {
        if (!scheduled) return;
        handle.Complete();                              // other work ran in between
        scheduled = false;

        // 3. Read results: no occluder hit means the agent can see the player.
        for (int i = 0; i < results.Length; i++)
            CanSeePlayer[i] = results[i].colliderInstanceID == 0;
    }

    void OnDestroy()
    {
        handle.Complete();
        commands.Dispose();
        results.Dispose();
    }
}
```

`QueryParameters` and this `RaycastCommand` constructor are Unity 2022.2+. Results are read one frame stage later (`LateUpdate`). For line-of-sight that is fine. For bullets that must resolve instantly, it may not be.

To see whether rendering batching is working, check the **Frame Debugger** (Window → Analysis), which shows each draw call and *why* two objects were not batched together.

## When to use

- Many similar objects with the same mesh and material: vegetation, debris, crowds, projectiles.
- Many queries of the same kind per frame: line-of-sight checks, ground checks, sensors.
- Any I/O or network operation with per-call overhead.

## Pitfalls

- **Breaking batches unknowingly.** Accessing `renderer.material` instead of `sharedMaterial` creates a unique material and breaks instancing and batching for that object. Use `MaterialPropertyBlock` or instanced properties for per-object variation.
- **Static batching memory.** Combined meshes are stored per instance, so 1,000 copies of a rock become 1,000 copies of its vertices. Prefer GPU instancing for many identical objects.
- **Latency.** Batched results arrive later: after the job completes, or after the next network tick. Make sure the system can tolerate that.
- **Batch too large.** Combining an entire level into one mesh defeats culling, because everything is drawn even when only part is visible. Batch by area.
- **Measuring the wrong thing.** Fewer draw calls do not always mean faster. GPU-bound games may see no improvement. Profile CPU and GPU separately.

## Related

- [Flyweight](./flyweight) — shared meshes and materials make instancing possible.
- [Job System](./job-system) — batched queries run as jobs.
- [Culling](./culling) — batching and culling must be balanced against each other.
- [Bullet-Hell Projectiles](../recipes/bullet-hell-projectiles) — instanced rendering of thousands of bullets.
- [Event Queue](./event-queue) — batching applied to messages and audio.
