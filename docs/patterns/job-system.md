# Job System

> Split work into small independent jobs that run in parallel across cores.

**Category:** Performance & Memory

## Problem

Modern CPUs have 6–16 cores, but gameplay code runs on one: the main thread. Updating 10,000 boids, sampling noise for terrain, or raycasting for 500 agents uses one core at 100% while the others idle, and the frame takes too long. Writing your own threads is risky. Race conditions, locks and crashes appear only on some machines, and most engine APIs are not thread-safe: Unity's API, Godot's scene tree and Unreal's UObjects may only be used from the main (game) thread.

## Solution

Describe work as **jobs**: small structs that process plain data (no references to managed objects), with declared inputs and outputs. A **scheduler** runs them on worker threads, splits large jobs into batches across cores, and orders dependent jobs.

Each engine has one. Unity's **C# Job System** is the fullest version:

- **Data in native containers** (`NativeArray<T>`, `NativeList<T>`) that live outside the garbage-collected heap and can be safely shared with worker threads.
- **Safety checks** (in the editor) detect two jobs writing the same data, or the main thread reading data a job is still writing. Race conditions become clear errors instead of rare crashes.
- **Dependencies:** `jobB.Schedule(jobA)` runs B after A, without blocking the main thread.
- **Burst** compiles jobs to highly optimised native code with SIMD, often 10–50× faster than the same C# on the main thread.

Godot has `WorkerThreadPool` (4.0+) for tasks and group tasks, and Unreal has `ParallelFor` and `UE::Tasks` (5.0+) with prerequisites. Neither has Burst or Unity's safety checks, so keeping job data separate is up to you.

The pattern of use: **schedule early, do other work, complete late**. Start jobs at the beginning of the frame, and wait for their results only when you need them.

## Example

Profile before and after: the Unity Profiler's Timeline view shows jobs on the worker threads, Godot's profiler shows the main thread's frame time, and Unreal Insights shows tasks per thread. A job that finishes but makes the main thread wait has not helped.

Moving 10,000 objects in parallel. Unity writes transforms from Burst jobs through `TransformAccessArray`. Godot and Unreal can't touch scene objects from worker threads, so their tabs update plain arrays in parallel and copy the results into an instanced mesh on the main thread:

::: code-group

```csharp [Unity (C#)]
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

```gdscript [Godot (GDScript)]
# swarm_mover.gd: workers update packed arrays; the main thread copies them into a MultiMesh.
# Each frame first finishes last frame's task, then starts this frame's, so the work overlaps
# with everything else the main thread does (at the cost of one frame of latency).
extends MultiMeshInstance3D

@export var mesh: Mesh
@export var count := 10000
@export var bounds_radius := 50.0

var _positions := PackedVector3Array()
var _velocities := PackedVector3Array()
var _dt := 0.0
var _task := -1


func _ready() -> void:
	_positions.resize(count)
	_velocities.resize(count)
	for i in count:
		_positions[i] = _random_direction() * randf() * bounds_radius
		_velocities[i] = _random_direction() * 5.0
	multimesh = MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.mesh = mesh
	multimesh.instance_count = count


func _process(delta: float) -> void:
	if _task != -1:
		WorkerThreadPool.wait_for_group_task_completion(_task)
		for i in count:
			multimesh.set_instance_transform(i, Transform3D(Basis(), _positions[i]))
	_dt = delta
	# Calls _move(i) for every i, spread over the worker threads.
	_task = WorkerThreadPool.add_group_task(_move, count)


func _move(i: int) -> void:  # runs on worker threads: touch only this element's data
	var p := _positions[i]
	var v := _velocities[i]
	if p.length() > bounds_radius:
		v = -p.normalized() * v.length()  # bounce back inward
	_velocities[i] = v
	_positions[i] = p + v * _dt


func _exit_tree() -> void:
	if _task != -1:
		WorkerThreadPool.wait_for_group_task_completion(_task)  # never free data a task still uses


func _random_direction() -> Vector3:
	return Vector3(randf_range(-1.0, 1.0), randf_range(-1.0, 1.0), randf_range(-1.0, 1.0)).normalized()
```

```cpp [Unreal (C++)]
// Swarm.h: UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> Instances;
//          TArray<FVector> Positions, Velocities;  TArray<FTransform> Transforms;
//          UE::Tasks::FTask MoveTask;  float BoundsRadius = 5000.f;

// Swarm.cpp
#include "Swarm.h"
#include "Async/ParallelFor.h"
#include "Tasks/Task.h"
#include "Components/InstancedStaticMeshComponent.h"

void ASwarm::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// Finish last frame's task and apply it, then launch this frame's: the work overlaps with
	// the rest of the game thread's frame, at the cost of one frame of latency.
	if (MoveTask.IsValid())
	{
		MoveTask.Wait();
		for (int32 i = 0; i < Positions.Num(); ++i) Transforms[i].SetLocation(Positions[i]);
		Instances->BatchUpdateInstancesTransforms(0, Transforms, /*bWorldSpace*/ false, /*bMarkRenderStateDirty*/ true);
	}

	MoveTask = UE::Tasks::Launch(UE_SOURCE_LOCATION, [this, DeltaSeconds]
	{
		ParallelFor(Positions.Num(), [this, DeltaSeconds](int32 i)
		{
			FVector P = Positions[i];
			FVector V = Velocities[i];
			if (P.Size() > BoundsRadius) V = -P.GetSafeNormal() * V.Size();   // bounce back inward
			Velocities[i] = V;
			Positions[i] = P + V * DeltaSeconds;
		});
	});
}

void ASwarm::EndPlay(const EEndPlayReason::Type Reason)
{
	if (MoveTask.IsValid()) MoveTask.Wait();             // never free data a task still uses
	Super::EndPlay(Reason);
}
```

:::

A pure-data job with a dependency chain: generate noise in parallel, then normalise once it's done, all off the main thread.

::: code-group

```csharp [Unity (C#)]
using Unity.Burst;
using Unity.Collections;
using Unity.Jobs;
using Unity.Mathematics;

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

```gdscript [Godot (GDScript)]
# heightmap_builder.gd: one long job on a dedicated Thread; the "dependency" is just order.
extends Node

signal finished(heights: PackedFloat32Array)

var _thread := Thread.new()


func build(width: int, scale: float) -> void:
	_thread.start(_generate.bind(width, scale))


func _generate(width: int, scale: float) -> void:  # runs on the thread
	var noise := FastNoiseLite.new()  # its own instance, not shared with the main thread
	noise.frequency = 1.0 / scale
	var heights := PackedFloat32Array()
	heights.resize(width * width)
	for y in width:
		for x in width:
			heights[y * width + x] = noise.get_noise_2d(x, y) * 0.5 + 0.5

	var top := 0.0  # then normalise
	for h in heights:
		top = maxf(top, h)
	for i in heights.size():
		heights[i] /= top

	_done.call_deferred(heights)  # back to the main thread


func _done(heights: PackedFloat32Array) -> void:
	_thread.wait_to_finish()  # always join a finished Thread
	finished.emit(heights)
```

```cpp [Unreal (C++)]
// UE::Tasks (UE 5.0+): a task can name prerequisites, and its body can use ParallelFor.
#include "Async/ParallelFor.h"
#include "Tasks/Task.h"

UE::Tasks::FTask BuildHeightmap(TSharedRef<TArray<float>> Heights, int32 Width, float Scale)
{
	Heights->SetNumUninitialized(Width * Width);

	UE::Tasks::FTask Noise = UE::Tasks::Launch(UE_SOURCE_LOCATION, [Heights, Width, Scale]
	{
		ParallelFor(Heights->Num(), [&H = *Heights, Width, Scale](int32 i)
		{
			const FVector2D P(i % Width, i / Width);
			H[i] = FMath::PerlinNoise2D(P / Scale) * 0.5f + 0.5f;
		});
	});

	return UE::Tasks::Launch(UE_SOURCE_LOCATION, [Heights]
	{
		float Max = 0.f;
		for (float H : *Heights) Max = FMath::Max(Max, H);
		for (float& H : *Heights) H /= Max;
	}, UE::Tasks::Prerequisites(Noise));                // runs after Noise, off the game thread
}

// Later: Task.Wait() (or check Task.IsCompleted() each frame), then copy into the landscape
// on the game thread.
```

:::

**Engine notes**

- **Unity:** the safety system throws if two scheduled jobs write the same `NativeArray` without a dependency between them, and Burst compiles job code to vectorised native code. `TransformAccessArray` parallelises by transform hierarchy root, so objects under one parent run on one thread.
- **Godot:** `WorkerThreadPool` (Godot 4.0+) runs tasks and group tasks on a shared pool; `Thread` is for one long-running job. The scene tree is not thread-safe, so worker code should only touch its own data and hand results back with `call_deferred()`. GDScript runs slower than Burst or C++, so for heavy maths move the loop body into C# or a GDExtension.
- **Unreal:** `ParallelFor` splits a loop across the task system's workers; `UE::Tasks` (5.0+) adds prerequisites and nested tasks; the older task graph (`FFunctionGraphTask`, `AsyncTask(ENamedThreads::GameThread, …)`) is still common for jumping back to the game thread. UObjects and actors must only be modified on the game thread.

## When to use

- The same operation applied to thousands of elements: movement, flocking, noise, mesh generation, visibility, pathfinding batches.
- Heavy computations that can run in the background while the main thread continues: procedural generation, navigation data, simulations.
- Hot loops where compiled native speed matters even on one thread: Burst in Unity, C# or GDExtension instead of GDScript in Godot. Unreal C++ is already native.

## When not to use

- Small workloads. Scheduling jobs has overhead; a plain loop over a few hundred items is often faster.
- Code that needs scene objects or most engine APIs (GameObjects, nodes, UObjects), which are main-thread only. Unity jobs also take only unmanaged data.
- Before profiling. Jobs add complexity; use them on proven hot loops.

## Pitfalls

- **Completing immediately.** Waiting right after scheduling (Unity's `Schedule(...).Complete()` on one line, Godot's `wait_for_task_completion` straight after `add_task`, waiting on an Unreal task as soon as it is launched) blocks the main thread until the job finishes. The work may run faster, but not in parallel with the main thread. Leave time between scheduling and completing.
- **Leaking native memory (Unity).** Native containers are not garbage collected. Every `Allocator.Persistent` or `TempJob` allocation needs a `Dispose`, and the editor reports leaks.
- **Managed data in jobs.** Jobs cannot use classes, strings, `List<T>` or UnityEngine objects (except through special types like `TransformAccess`). Copy what you need into native containers first.
- **Copying costs.** Copying 10,000 positions into the job's own buffers (a `NativeArray`, a packed array) and back each frame can cost more than the job saves. Keep data in native containers permanently, as in [Data Locality](./data-locality).
- **Batch size.** Tiny batches (`Schedule(n, 1)`) add scheduling overhead. Huge ones leave cores idle. Start around 32–256 for cheap per-element work.
- **Determinism.** Parallel jobs that combine results in a variable order break determinism. Write results to fixed indices, never "whoever finishes first".

## Related

- [Data Locality](./data-locality) — jobs work on contiguous native data.
- [Entity Component System](./entity-component-system) — systems schedule jobs over component chunks.
- [Time Slicing](./time-slicing) — spreads work over time; jobs spread it over cores.
- [Batching](./batching) — `RaycastCommand` and similar batched queries run as jobs.
- [Flocking](./flocking) and [Noise-Based Generation](./noise-generation) — natural candidates for jobs.
