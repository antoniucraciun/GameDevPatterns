# Entity Component System

> Entities are IDs, components are plain data, systems hold all the logic.

**Also known as:** ECS, DOTS · **Category:** Architecture & Structure

## Problem

The [Component](./component) pattern with MonoBehaviours works well for hundreds of objects, and struggles with tens of thousands. Each GameObject is a heap object with a Transform. Each component has its own `Update` called through the engine, with its data scattered across memory. Logic and data are mixed in the same class, so a "move everything" pass jumps between unrelated objects and misses the CPU cache constantly. Spreading the work across CPU cores safely is close to impossible.

## Solution

Separate the three concerns completely:

| Part | What it is |
| --- | --- |
| **Entity** | Just an ID. It has no data and no behaviour of its own. |
| **Component** | Plain data attached to an entity: `Position`, `Velocity`, `Health`. No methods with game logic. |
| **System** | Logic that runs over *every entity with a given set of components*, such as "for all entities with Position and Velocity, move them". |

Behind the scenes, an ECS stores components of entities with the same set of components (an **archetype**) together in contiguous **chunks**. A system iterating Position and Velocity streams through tightly packed arrays, which is [Data Locality](./data-locality) by construction. Because systems declare which components they read and write, the scheduler can run independent systems and chunks **in parallel** across cores.

Adding behaviour means adding a component, such as a `Burning` tag, so the burn system picks the entity up. Removing it stops the behaviour. There is no class hierarchy at all.

## Example (Unity C#)

Unity's **Entities** package (DOTS, 1.x). Components are structs, systems are `ISystem` structs compiled with Burst, and GameObjects are converted to entities by **bakers**.

```csharp
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

Projectiles placed in a **subscene** are baked into entities. Tens of thousands of them move and expire with no MonoBehaviour `Update`, no garbage collection and work spread across all cores.

## When to use

- Very large numbers of similar things: projectiles, crowds, units, boids, particles with gameplay, simulation-heavy games.
- Simulation where performance and multi-core scaling matter more than the convenience of GameObjects.
- Deterministic or networked simulations. Netcode for Entities and Unity Physics are built on it.

## Pitfalls

- **Different mental model.** No inheritance, no methods on data, no references between objects (entities refer to each other by `Entity` IDs). The learning curve is real.
- **Structural changes are expensive.** Adding or removing components moves an entity to another archetype's chunk. Doing that for thousands of entities per frame is slow. Use enableable components, or batch the changes in command buffers.
- **Tooling and ecosystem.** Animation, UI, audio and many asset-store packages are GameObject-based. Most real projects are **hybrid**, with ECS for the heavy simulation and GameObjects for the rest.
- **Overkill for small games.** For a few hundred objects, MonoBehaviours with good habits (pooling, fewer `Update` calls) are simpler and fast enough.
- **Managed data.** Strings, lists and class references do not fit in unmanaged components or Burst. Use `FixedString`, `DynamicBuffer` and blob assets.

## Related

- [Component](./component) — the object-oriented version of composition.
- [Data Locality](./data-locality) — why ECS memory layout is fast.
- [Update Method](./update-method) — what systems replace.
- [Bullet-Hell Projectiles](../recipes/bullet-hell-projectiles) — the same goals reached by hand, without ECS.
- [Job System](./job-system) — the parallel execution ECS systems build on.
