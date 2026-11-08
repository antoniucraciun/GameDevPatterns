# Entity Component System

> Entities are IDs, components are plain data, systems hold all the logic.

**Also known as:** ECS, DOTS (Unity), Mass (Unreal) · **Category:** Architecture & Structure

## Problem

The [Component](./component) pattern with engine objects (GameObjects, nodes, actors) works well for hundreds of objects, and struggles with tens of thousands. Each object is a heap object with its own transform. Each component has its own per-frame update called through the engine, with its data scattered across memory. Logic and data are mixed in the same class, so a "move everything" pass jumps between unrelated objects and misses the CPU cache constantly. Spreading the work across CPU cores safely is close to impossible.

## Solution

Separate the three concerns completely:

| Part | What it is |
| --- | --- |
| **Entity** | Just an ID. It has no data and no behaviour of its own. |
| **Component** | Plain data attached to an entity: `Position`, `Velocity`, `Health`. No methods with game logic. |
| **System** | Logic that runs over *every entity with a given set of components*, such as "for all entities with Position and Velocity, move them". |

Behind the scenes, an ECS stores components of entities with the same set of components (an **archetype**) together in contiguous **chunks**. A system iterating Position and Velocity streams through tightly packed arrays, which is [Data Locality](./data-locality) by construction. Because systems declare which components they read and write, the scheduler can run independent systems and chunks **in parallel** across cores.

Adding behaviour means adding a component, such as a `Burning` tag, so the burn system picks the entity up. Removing it stops the behaviour. There is no class hierarchy at all.

## Pseudocode

What an ECS framework does underneath, for the projectiles in the Example.

```text
// Entities are IDs. Components are plain data, stored per archetype:
// one table per set of component types, one packed column per type.
Archetype:
    component types       // e.g. {Position, Velocity, Lifetime}
    columns[type]         // one entry per row; split into fixed-size chunks
    entities              // which entity owns each row

World:
    archetypes
    location[entity]      // (archetype, row) where that entity's data lives

query(required types):    // every row of every archetype that has them all
    for each archetype a whose types include all required types:
        for each row of a:
            yield the entity and its components at that row

// Systems hold all the logic. Systems that don't write the same columns,
// and different chunks of one system, can run on different cores.
MoveSystem(dt):
    for each (position, velocity) in query(Position, Velocity):
        position ← position + velocity × dt   // streams down two packed arrays

LifetimeSystem(dt):
    for each (entity, lifetime) in query(Lifetime):
        lifetime ← lifetime - dt
        if lifetime ≤ 0:
            record "destroy entity" in commands   // never change tables mid-loop

end of frame:
    for each recorded destroy:
        move the archetype's last row into the freed row   // keeps columns dense
        update location[] of the entity that moved
```

## Example

Projectiles that move and expire, with all the logic in systems that run over plain data. Unity and Unreal ship ECS frameworks; Godot doesn't, so its version applies the same data-oriented idea by hand.

::: code-group

```csharp [Unity (C#)]
// Unity's Entities package (DOTS, 1.x): components are structs, systems are ISystem structs
// compiled with Burst, and GameObjects in a subscene are converted to entities by bakers.
using Unity.Burst;
using Unity.Entities;
using Unity.Mathematics;
using Unity.Transforms;
using UnityEngine;

// ── Components: plain data ──
public struct Velocity : IComponentData { public float3 Value; }
public struct Lifetime : IComponentData { public float Remaining; }

// ── Authoring: designers set values on a normal GameObject; a baker converts it to an entity ──
public class ProjectileAuthoring : MonoBehaviour
{
    public float speed = 20f;
    public float lifetime = 3f;

    class Baker : Baker<ProjectileAuthoring>
    {
        public override void Bake(ProjectileAuthoring a)
        {
            var entity = GetEntity(TransformUsageFlags.Dynamic);
            AddComponent(entity, new Velocity { Value = new float3(0f, 0f, a.speed) });
            AddComponent(entity, new Lifetime { Remaining = a.lifetime });
        }
    }
}

// ── Systems: all the logic, over all matching entities ──
[BurstCompile]
public partial struct MoveSystem : ISystem
{
    [BurstCompile]
    public void OnUpdate(ref SystemState state)
    {
        float dt = SystemAPI.Time.DeltaTime;
        foreach (var (transform, velocity) in SystemAPI.Query<RefRW<LocalTransform>, RefRO<Velocity>>())
            transform.ValueRW.Position += velocity.ValueRO.Value * dt;
    }
}

// The same kind of logic as a parallel job, split across worker threads automatically.
[BurstCompile]
public partial struct LifetimeJob : IJobEntity
{
    public float Dt;
    public EntityCommandBuffer.ParallelWriter Ecb;

    void Execute([ChunkIndexInQuery] int chunkIndex, Entity entity, ref Lifetime lifetime)
    {
        lifetime.Remaining -= Dt;
        if (lifetime.Remaining <= 0f)
            Ecb.DestroyEntity(chunkIndex, entity);   // structural changes are deferred, not done mid-iteration
    }
}

[BurstCompile]
public partial struct LifetimeSystem : ISystem
{
    [BurstCompile]
    public void OnUpdate(ref SystemState state)
    {
        var ecb = SystemAPI.GetSingleton<EndSimulationEntityCommandBufferSystem.Singleton>()
                           .CreateCommandBuffer(state.WorldUnmanaged);
        new LifetimeJob { Dt = SystemAPI.Time.DeltaTime, Ecb = ecb.AsParallelWriter() }.ScheduleParallel();
    }
}
```

```gdscript [Godot (GDScript)]
# projectile_system.gd: Godot has no built-in ECS, but the core idea carries over.
# "Components" are parallel packed arrays (one entry per projectile), the "system" is one loop
# over them, and a MultiMeshInstance3D draws every projectile in a single call, with no node each.
# Assign a MultiMesh (transform format 3D, a mesh) to this node in the inspector.
extends MultiMeshInstance3D

@export var capacity := 10000

var _positions := PackedVector3Array()
var _velocities := PackedVector3Array()
var _lifetimes := PackedFloat32Array()


func _ready() -> void:
	multimesh.instance_count = capacity
	multimesh.visible_instance_count = 0


func spawn(position: Vector3, velocity: Vector3, lifetime := 3.0) -> void:
	if _positions.size() >= capacity:
		return
	_positions.append(position)
	_velocities.append(velocity)
	_lifetimes.append(lifetime)


func _physics_process(delta: float) -> void:
	var i := 0
	while i < _positions.size():
		_lifetimes[i] -= delta
		if _lifetimes[i] <= 0.0:
			_remove(i)  # swap-remove: keeps the arrays dense, don't advance i
			continue
		_positions[i] += _velocities[i] * delta
		multimesh.set_instance_transform(i, Transform3D(Basis.IDENTITY, _positions[i]))
		i += 1
	multimesh.visible_instance_count = _positions.size()


func _remove(i: int) -> void:
	var last := _positions.size() - 1
	_positions[i] = _positions[last]
	_velocities[i] = _velocities[last]
	_lifetimes[i] = _lifetimes[last]
	_positions.resize(last)
	_velocities.resize(last)
	_lifetimes.resize(last)
```

```cpp [Unreal (C++)]
// ProjectileMass.h: Unreal's ECS is **Mass Entity** (MassEntity / MassGameplay plugins).
// Fragments are data, processors are the systems, and entities are created from Mass
// Entity Config assets that list their fragments and traits.
// (Mass APIs shift between 5.x versions; this follows the 5.4-5.5 shape.)
#pragma once

#include "CoreMinimal.h"
#include "MassEntityTypes.h"
#include "MassProcessor.h"
#include "MassCommonFragments.h"
#include "MassExecutionContext.h"
#include "ProjectileMass.generated.h"

// ── Fragments: plain data ──
USTRUCT() struct FVelocityFragment : public FMassFragment
{
	GENERATED_BODY()
	FVector Value = FVector::ZeroVector;
};

USTRUCT() struct FLifetimeFragment : public FMassFragment
{
	GENERATED_BODY()
	float Remaining = 3.f;
};

// ── Processors: all the logic, over all entities with matching fragments ──
UCLASS()
class UProjectileMoveProcessor : public UMassProcessor
{
	GENERATED_BODY()

public:
	UProjectileMoveProcessor() : EntityQuery(*this)
	{
		ExecutionFlags = int32(EProcessorExecutionFlags::All);
		ProcessingPhase = EMassProcessingPhase::PrePhysics;
	}

protected:
	virtual void ConfigureQueries() override
	{
		EntityQuery.AddRequirement<FTransformFragment>(EMassFragmentAccess::ReadWrite);
		EntityQuery.AddRequirement<FVelocityFragment>(EMassFragmentAccess::ReadOnly);
	}

	virtual void Execute(FMassEntityManager& EntityManager, FMassExecutionContext& Context) override
	{
		EntityQuery.ForEachEntityChunk(EntityManager, Context, [](FMassExecutionContext& Chunk)
		{
			const float Dt = Chunk.GetDeltaTimeSeconds();
			const TArrayView<FTransformFragment> Transforms = Chunk.GetMutableFragmentView<FTransformFragment>();
			const TConstArrayView<FVelocityFragment> Velocities = Chunk.GetFragmentView<FVelocityFragment>();
			for (int32 I = 0; I < Chunk.GetNumEntities(); ++I)
				Transforms[I].GetMutableTransform().AddToTranslation(Velocities[I].Value * Dt);
		});
	}

private:
	FMassEntityQuery EntityQuery;
};

UCLASS()
class UProjectileLifetimeProcessor : public UMassProcessor
{
	GENERATED_BODY()

public:
	UProjectileLifetimeProcessor() : EntityQuery(*this) { ExecutionFlags = int32(EProcessorExecutionFlags::All); }

protected:
	virtual void ConfigureQueries() override
	{
		EntityQuery.AddRequirement<FLifetimeFragment>(EMassFragmentAccess::ReadWrite);
	}

	virtual void Execute(FMassEntityManager& EntityManager, FMassExecutionContext& Context) override
	{
		EntityQuery.ForEachEntityChunk(EntityManager, Context, [](FMassExecutionContext& Chunk)
		{
			const float Dt = Chunk.GetDeltaTimeSeconds();
			const TArrayView<FLifetimeFragment> Lifetimes = Chunk.GetMutableFragmentView<FLifetimeFragment>();
			TArray<FMassEntityHandle> Expired;
			for (int32 I = 0; I < Chunk.GetNumEntities(); ++I)
				if ((Lifetimes[I].Remaining -= Dt) <= 0.f) Expired.Add(Chunk.GetEntity(I));
			// Structural changes are deferred, not done mid-iteration.
			if (Expired.Num() > 0) Chunk.Defer().DestroyEntities(Expired);
		});
	}

private:
	FMassEntityQuery EntityQuery;
};
```

:::

Tens of thousands of projectiles move and expire with no per-object update call, data laid out contiguously, and (in Unity and Unreal) work spread across all cores.

**Engine notes**

- **Unity:** projectiles placed in a **subscene** are baked into entities. Entities Graphics renders them; GameObjects and entities can coexist in one project.
- **Godot:** for physics without nodes, use `PhysicsServer3D` bodies directly; for rendering without nodes, `RenderingServer` instances or `MultiMesh` as above. Community ECS add-ons exist, but the server APIs are the built-in path to "many things, no nodes".
- **Unreal:** Mass is used by City Sample crowds and traffic. Entities are rendered through **Mass Representation** (instanced static meshes or full actors when close). For a few hundred objects, plain actors with ticking turned off are simpler.

## When to use

- Very large numbers of similar things: projectiles, crowds, units, boids, particles with gameplay, simulation-heavy games.
- Simulation where performance and multi-core scaling matter more than the convenience of engine objects.
- Deterministic or networked simulations, where plain data is easy to copy, hash and roll back.

## When not to use

- Games with a few hundred interesting objects. Engine objects with [Component](./component) are simpler, better supported by tools and fast enough.
- Gameplay that is mostly unique, hand-authored objects (a puzzle game, a narrative adventure) rather than many similar ones.
- Teams new to data-oriented design on a deadline. Try [Data Locality](./data-locality) or the [Job System](./job-system) on the hot path first.

## Pitfalls

- **Different mental model.** No inheritance, no methods on data, no references between objects (entities refer to each other by `Entity` IDs). The learning curve is real.
- **Structural changes are expensive.** Adding or removing components moves an entity to another archetype's chunk. Doing that for thousands of entities per frame is slow. Use enableable components, or batch the changes in command buffers.
- **Tooling and ecosystem.** Animation, UI, audio and most plugins are built on the engine's regular objects. Most real projects are **hybrid**, with ECS for the heavy simulation and regular objects for the rest: Unity's Entities alongside GameObjects, Unreal's Mass alongside actors, Godot's server APIs alongside nodes.
- **Overkill for small games.** For a few hundred objects, regular engine objects with good habits (pooling, fewer per-object updates) are simpler and fast enough.
- **Managed data (Unity).** Strings, lists and class references do not fit in unmanaged components or Burst. Use `FixedString`, `DynamicBuffer` and blob assets.

## Related

- [Component](./component) — the object-oriented version of composition.
- [Data Locality](./data-locality) — why ECS memory layout is fast.
- [Update Method](./update-method) — what systems replace.
- [Bullet-Hell Projectiles](../recipes/bullet-hell-projectiles) — the same goals reached by hand, without ECS.
- [Job System](./job-system) — the parallel execution ECS systems build on.
