# Job System

> Split work into small independent jobs that run in parallel across cores.

**Category:** Performance & Memory

## Problem

Modern CPUs have 6–16 cores, but gameplay code runs on one: the main thread. Updating 10,000 boids, sampling noise for terrain, or raycasting for 500 agents uses one core at 100% while the others idle, and the frame takes too long. Writing your own threads is risky. Race conditions, locks and crashes appear only on some machines, and Unity's API is not thread-safe.

## Solution

Describe work as **jobs**: small structs that process plain data (no references to managed objects), with declared inputs and outputs. A **scheduler** runs them on worker threads, splits large jobs into batches across cores, and orders dependent jobs.

- **Data in native containers** (`NativeArray<T>`, `NativeList<T>`) that live outside the garbage-collected heap and can be safely shared with worker threads.
- **Safety checks** (in the editor) detect two jobs writing the same data, or the main thread reading data a job is still writing. Race conditions become clear errors instead of rare crashes.
- **Dependencies:** `jobB.Schedule(jobA)` runs B after A, without blocking the main thread.
- **Burst** compiles jobs to highly optimised native code with SIMD, often 10–50× faster than the same C# on the main thread.

The pattern of use: **schedule early, do other work, complete late**. Start jobs at the beginning of the frame, and wait for their results only when you need them.

## Example (Unity C#)

Moving 10,000 objects in parallel with Burst. Transforms are accessed through `TransformAccessArray`, which jobs are allowed to write:

```csharp
using Unity.Burst;
using Unity.Collections;
using Unity.Jobs;
using Unity.Mathematics;
using UnityEngine;
using UnityEngine.Jobs;

public class SwarmMover : MonoBehaviour
{
    [SerializeField] Transform prefab;
    [SerializeField] int count = 10000;

    TransformAccessArray transforms;
    NativeArray<float3> velocities;
    JobHandle handle;

    void Start()
    {
        var all = new Transform[count];
        velocities = new NativeArray<float3>(count, Allocator.Persistent);
        for (int i = 0; i < count; i++)
        {
            all[i] = Instantiate(prefab, UnityEngine.Random.insideUnitSphere * 50f, Quaternion.identity);
            velocities[i] = (float3)UnityEngine.Random.onUnitSphere * 5f;
        }
        transforms = new TransformAccessArray(all);
    }

    [BurstCompile]
    struct MoveJob : IJobParallelForTransform
    {
        public NativeArray<float3> Velocities;
        public float Dt;
        public float BoundsRadius;

        public void Execute(int i, TransformAccess t)
        {
            float3 p = t.position;
            float3 v = Velocities[i];
            if (math.length(p) > BoundsRadius) v = -math.normalize(p) * math.length(v);   // bounce back inward
            Velocities[i] = v;
            t.position = p + v * Dt;
        }
    }

    void Update()
    {
        // Schedule early: workers start immediately while the main thread does other things.
        handle = new MoveJob { Velocities = velocities, Dt = Time.deltaTime, BoundsRadius = 50f }
            .Schedule(transforms);
    }

    void LateUpdate() => handle.Complete();   // complete late: results are needed before rendering

    void OnDestroy()
    {
        handle.Complete();                    // never dispose data a job is still using
        transforms.Dispose();
        velocities.Dispose();
    }
}
```

A pure-data job, for when no transforms are involved, with a dependency chain:

```csharp
[BurstCompile]
struct NoiseJob : IJobParallelFor
{
    [WriteOnly] public NativeArray<float> Heights;
    public int Width;
    public float Scale;

    public void Execute(int i)
    {
        int x = i % Width, y = i / Width;
        Heights[i] = noise.snoise(new float2(x, y) / Scale) * 0.5f + 0.5f;
    }
}

[BurstCompile]
struct NormaliseJob : IJob
{
    public NativeArray<float> Heights;
    public void Execute()
    {
        float max = 0f;
        for (int i = 0; i < Heights.Length; i++) max = math.max(max, Heights[i]);
        for (int i = 0; i < Heights.Length; i++) Heights[i] /= max;
    }
}

// var heights = new NativeArray<float>(512 * 512, Allocator.TempJob);
// var a = new NoiseJob { Heights = heights, Width = 512, Scale = 64f }.Schedule(heights.Length, 256);
// var b = new NormaliseJob { Heights = heights }.Schedule(a);       // runs after a, off the main thread
// ... later: b.Complete(); copy into the terrain; heights.Dispose();
```

## When to use

- The same operation applied to thousands of elements: movement, flocking, noise, mesh generation, visibility, pathfinding batches.
- Heavy computations that can run in the background while the main thread continues: procedural generation, navigation data, simulations.
- Hot loops where Burst's speed matters even on one thread.

## Pitfalls

- **Completing immediately.** `Schedule(...).Complete()` on the same line blocks the main thread until the job finishes. You get Burst's speed, but no parallelism with the main thread. Leave time between scheduling and completing.
- **Leaking native memory.** Native containers are not garbage collected. Every `Allocator.Persistent` or `TempJob` allocation needs a `Dispose`, and the editor reports leaks.
- **Managed data in jobs.** Jobs cannot use classes, strings, `List<T>` or UnityEngine objects (except through special types like `TransformAccess`). Copy what you need into native containers first.
- **Copying costs.** Copying 10,000 positions into a `NativeArray` and back each frame can cost more than the job saves. Keep data in native containers permanently, as in [Data Locality](./data-locality).
- **Batch size.** Tiny batches (`Schedule(n, 1)`) add scheduling overhead. Huge ones leave cores idle. Start around 32–256 for cheap per-element work.
- **Determinism.** Parallel jobs that combine results in a variable order break determinism. Write results to fixed indices, never "whoever finishes first".

## Related

- [Data Locality](./data-locality) — jobs work on contiguous native data.
- [Entity Component System](./entity-component-system) — systems schedule jobs over component chunks.
- [Time Slicing](./time-slicing) — spreads work over time; jobs spread it over cores.
- [Batching](./batching) — `RaycastCommand` and similar batched queries run as jobs.
- [Flocking](./flocking) and [Noise-Based Generation](./noise-generation) — natural candidates for jobs.
