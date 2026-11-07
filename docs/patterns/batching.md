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

## Example

Batched line-of-sight checks: 500 agents check whether they can see the player. Unity submits all rays as one scheduled job; Unreal queues them as async traces that run together on worker threads; Godot has no batched raycast API, so its tab runs them in one tight loop with a reused query and spreads them across frames.

::: code-group

```csharp [Unity (C#)]
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
            CanSeePlayer[i] = results[i].collider == null;
    }

    void OnDestroy()
    {
        handle.Complete();
        commands.Dispose();
        results.Dispose();
    }
}
```

```gdscript [Godot (GDScript)]
# batched_line_of_sight.gd: one reused query object, a fixed budget of rays per physics frame,
# and agents processed round-robin so the cost stays flat however many there are.
extends Node3D

@export var player: Node3D
@export var agents: Array[Node3D] = []  # e.g. 500 enemies
@export_flags_3d_physics var occluders := 1
@export var rays_per_frame := 128

var can_see_player: Array[bool] = []
var _query := PhysicsRayQueryParameters3D.new()
var _next := 0


func _ready() -> void:
	can_see_player.resize(agents.size())
	_query.collision_mask = occluders


func _physics_process(_delta: float) -> void:
	if agents.is_empty():
		return
	var space := get_world_3d().direct_space_state
	var target := player.global_position + Vector3.UP
	for _n in mini(rays_per_frame, agents.size()):
		var i := _next
		_next = (_next + 1) % agents.size()
		_query.from = agents[i].global_position + Vector3.UP * 1.6
		_query.to = target
		can_see_player[i] = space.intersect_ray(_query).is_empty()  # no occluder hit: can see
```

```cpp [Unreal (C++)]
// LineOfSightManager.h: UPROPERTY(EditAnywhere) TObjectPtr<AActor> Player;
//                       UPROPERTY(EditAnywhere) TArray<TObjectPtr<AActor>> Agents;   // e.g. 500 enemies
//                       TArray<bool> CanSeePlayer;  FTraceDelegate TraceDelegate;

// LineOfSightManager.cpp
#include "LineOfSightManager.h"
#include "Engine/World.h"

void ALineOfSightManager::BeginPlay()
{
	Super::BeginPlay();
	TraceDelegate.BindUObject(this, &ALineOfSightManager::OnTraceDone);
	CanSeePlayer.Init(false, Agents.Num());
}

void ALineOfSightManager::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// 1. Queue every trace. Async traces run together on worker threads during the frame;
	//    the results arrive at the start of the next frame.
	const FVector Target = Player->GetActorLocation() + FVector(0.f, 0.f, 100.f);
	for (int32 i = 0; i < Agents.Num(); ++i)
	{
		FCollisionQueryParams Params(SCENE_QUERY_STAT(LineOfSight), false, Agents[i]);
		Params.AddIgnoredActor(Player);
		const FVector Eye = Agents[i]->GetActorLocation() + FVector(0.f, 0.f, 160.f);
		GetWorld()->AsyncLineTraceByChannel(EAsyncTraceType::Single, Eye, Target, ECC_Visibility,
			Params, FCollisionResponseParams::DefaultResponseParam, &TraceDelegate, /*UserData*/ i);
	}
}

// 2. Read results: no blocking hit means the agent can see the player.
void ALineOfSightManager::OnTraceDone(const FTraceHandle& Handle, FTraceDatum& Data)
{
	const int32 i = int32(Data.UserData);
	if (CanSeePlayer.IsValidIndex(i))
		CanSeePlayer[i] = !Data.OutHits.ContainsByPredicate([](const FHitResult& Hit) { return Hit.bBlockingHit; });
}
```

:::

Draw-call batching for objects that never move: merge them once at load time instead of drawing each one separately.

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

// For level chunks spawned at runtime. Scene objects marked Static are batched at build time.
public class LevelChunk : MonoBehaviour
{
    void Start() => StaticBatchingUtility.Combine(gameObject);   // children must not move afterwards
}
```

```gdscript [Godot (GDScript)]
# rock_scatter.gd: replaces MeshInstance3D children that share a mesh with one MultiMesh each.
extends Node3D


func _ready() -> void:
	var by_mesh := {}  # Mesh -> Array of Transform3D
	for child in get_children():
		var mi := child as MeshInstance3D
		if mi == null or mi.mesh == null:
			continue
		if not by_mesh.has(mi.mesh):
			by_mesh[mi.mesh] = []
		by_mesh[mi.mesh].append(mi.transform)
		mi.queue_free()

	for mesh in by_mesh:
		var transforms: Array = by_mesh[mesh]
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = mesh
		mm.instance_count = transforms.size()
		for i in transforms.size():
			mm.set_instance_transform(i, transforms[i])
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		add_child(mmi)
```

```cpp [Unreal (C++)]
// RockScatter.cpp: replaces static mesh components that share a mesh with one HISM each.
#include "RockScatter.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"

void ARockScatter::BeginPlay()
{
	Super::BeginPlay();

	TInlineComponentArray<UStaticMeshComponent*> Meshes;
	GetComponents(Meshes);

	TMap<UStaticMesh*, UHierarchicalInstancedStaticMeshComponent*> ByMesh;
	for (UStaticMeshComponent* Component : Meshes)
	{
		if (Component == GetRootComponent() || Component->IsA<UInstancedStaticMeshComponent>()) continue;
		UStaticMesh* Mesh = Component->GetStaticMesh();
		if (!Mesh) continue;

		UHierarchicalInstancedStaticMeshComponent*& Hism = ByMesh.FindOrAdd(Mesh);
		if (!Hism)
		{
			Hism = NewObject<UHierarchicalInstancedStaticMeshComponent>(this);
			Hism->SetStaticMesh(Mesh);
			Hism->SetupAttachment(GetRootComponent());
			Hism->RegisterComponent();
			AddInstanceComponent(Hism);
		}
		Hism->AddInstance(Component->GetComponentTransform(), /*bWorldSpace*/ true);
		Component->DestroyComponent();
	}
}
```

:::

**Engine notes**

- **Unity:** `QueryParameters` and this `RaycastCommand` constructor are Unity 2022.2+. Results are read one frame stage later (`LateUpdate`): fine for line of sight, maybe not for bullets that must resolve instantly. To see whether rendering batching works, open the **Frame Debugger** (Window → Analysis), which shows each draw call and *why* two objects were not batched together. The SRP Batcher and, in Unity 6, the GPU Resident Drawer batch many objects without code.
- **Godot:** there is no batched raycast API; the time-sliced loop above is the usual answer. The 2D renderer batches canvas items automatically; in 3D, `MultiMeshInstance3D` is the tool, and the Monitors tab (**Rendering → Total Draw Calls**) shows the effect. The example keys by mesh only, so children with different material overrides would lose them.
- **Unreal:** async traces (`AsyncLineTraceByChannel`, `AsyncSweepByChannel`) are Unreal's batched queries, with results one frame later. For rendering, ISM and HISM components, **Merge Actors** in the editor, and Nanite (which batches by material) reduce draw calls; `stat RHI` and Unreal Insights show the counts.

## When to use

- Many similar objects with the same mesh and material: vegetation, debris, crowds, projectiles.
- Many queries of the same kind per frame: line-of-sight checks, ground checks, sensors.
- Any I/O or network operation with per-call overhead.

## When not to use

- A few objects. Draw calls and per-call overhead don't matter yet.
- Objects with many unique materials or meshes. They can't batch; fix the content first.
- When the SRP Batcher or GPU instancing already does it automatically. Check the Frame Debugger before batching by hand.

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
