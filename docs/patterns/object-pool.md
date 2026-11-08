# Object Pool

> Reuse objects from a fixed pool instead of allocating and destroying them.

**Category:** Performance & Memory

## Problem

A bullet-hell game fires hundreds of projectiles per second. Each spawn allocates memory and runs initialisation, and each destroy frees it again or leaves garbage for the collector. The result is CPU spikes, allocator or garbage-collector overhead and memory fragmentation, all visible as hitches during the most intense moments of play.

## Solution

Create objects ahead of time, or on first demand, and keep inactive ones in a pool. **Get** takes an inactive object from the pool and activates it, creating a new one only if the pool is empty. **Release** deactivates the object and returns it to the pool instead of destroying it. Each object must fully reset its state when reused.

## Example

Before pooling, confirm that spawning is the cost: look for `Instantiate` and GC spikes in the Unity Profiler, node-count and frame-time spikes in Godot's profiler and Monitors, or `SpawnActor` time in Unreal Insights.

A projectile pool. Unity ships a generic pool in `UnityEngine.Pool`; Godot and Unreal have no general-purpose node or actor pool, so those tabs write a small one.

::: code-group

```csharp [Unity (C#)]
using UnityEngine;
using UnityEngine.Pool;

public class Projectile : MonoBehaviour
{
    public IObjectPool<Projectile> Pool { get; set; }
    Vector3 velocity;
    float lifetime;

    public void Launch(Vector3 position, Vector3 velocity)
    {
        transform.position = position;
        this.velocity = velocity;
        lifetime = 3f;                       // reset ALL per-use state here
    }

    void Update()
    {
        transform.position += velocity * Time.deltaTime;
        if ((lifetime -= Time.deltaTime) <= 0f)
            Pool.Release(this);              // return instead of Destroy
    }
}

public class Gun : MonoBehaviour
{
    [SerializeField] Projectile prefab;
    IObjectPool<Projectile> pool;

    void Awake()
    {
        pool = new ObjectPool<Projectile>(
            createFunc:      () => { var p = Instantiate(prefab); p.Pool = pool; return p; },
            actionOnGet:     p => p.gameObject.SetActive(true),
            actionOnRelease: p => p.gameObject.SetActive(false),
            actionOnDestroy: p => Destroy(p.gameObject),
            collectionCheck: Application.isEditor,   // catches double-release while developing
            defaultCapacity: 64,
            maxSize:         512);
    }

    public void Fire(Vector3 dir) => pool.Get().Launch(transform.position, dir * 30f);
}
```

```gdscript [Godot (GDScript)]
# node_pool.gd: pooled nodes stay in the tree. Hiding them and disabling processing is much
# cheaper than remove_child()/add_child(), which re-runs enter/exit-tree work every time.
class_name NodePool
extends Node

@export var scene: PackedScene
@export var prewarm := 64
@export var max_size := 512

var _free: Array[Node3D] = []


func _ready() -> void:
	for i in prewarm:
		_free.append(_create())


func acquire() -> Node3D:
	var node: Node3D = _free.pop_back() if not _free.is_empty() else _create()
	node.process_mode = Node.PROCESS_MODE_INHERIT
	node.show()
	return node


func release(node: Node3D) -> void:
	assert(not _free.has(node), "Released twice")  # debug builds only
	if _free.size() >= max_size:
		node.queue_free()
		return
	_deactivate(node)
	_free.append(node)


func _create() -> Node3D:
	var node := scene.instantiate() as Node3D
	add_child(node)  # NodePool is a plain Node, so children keep their own world position
	_deactivate(node)
	return node


func _deactivate(node: Node3D) -> void:
	node.hide()
	node.process_mode = Node.PROCESS_MODE_DISABLED  # no _process/_physics_process callbacks


# projectile.gd
class_name Projectile
extends Area3D

var pool: NodePool
var _velocity := Vector3.ZERO
var _lifetime := 0.0


func launch(pos: Vector3, velocity: Vector3) -> void:
	global_position = pos
	_velocity = velocity
	_lifetime = 3.0  # reset ALL per-use state here


func _physics_process(delta: float) -> void:
	global_position += _velocity * delta
	_lifetime -= delta
	if _lifetime <= 0.0:
		pool.release(self)  # return instead of queue_free()


# gun.gd
extends Node3D

@export var pool: NodePool


func fire(dir: Vector3) -> void:
	var p := pool.acquire() as Projectile
	p.pool = pool
	p.launch(global_position, dir * 30.0)
```

```cpp [Unreal (C++)]
// PooledActor.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Subsystems/WorldSubsystem.h"
#include "PooledActor.generated.h"

UCLASS(Abstract)
class APooledActor : public AActor
{
	GENERATED_BODY()

public:
	virtual void OnAcquired() {}       // reset ALL per-use state here
	virtual void OnReleased() {}
	void ReturnToPool();               // instead of Destroy()
};

USTRUCT()
struct FActorPoolBucket
{
	GENERATED_BODY()

	UPROPERTY()
	TArray<TObjectPtr<APooledActor>> Free;
};

UCLASS()
class UActorPoolSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	APooledActor* Acquire(TSubclassOf<APooledActor> Class, const FTransform& Transform);
	void Release(APooledActor* Actor);

private:
	UPROPERTY()
	TMap<TObjectPtr<UClass>, FActorPoolBucket> Pools;   // one free list per class

	static void SetActive(APooledActor* Actor, bool bActive);
};

// PooledActor.cpp
#include "PooledActor.h"
#include "Engine/World.h"

void APooledActor::ReturnToPool()
{
	GetWorld()->GetSubsystem<UActorPoolSubsystem>()->Release(this);
}

APooledActor* UActorPoolSubsystem::Acquire(TSubclassOf<APooledActor> Class, const FTransform& Transform)
{
	FActorPoolBucket& Bucket = Pools.FindOrAdd(Class.Get());
	APooledActor* Actor = nullptr;
	while (!IsValid(Actor) && Bucket.Free.Num() > 0)
		Actor = Bucket.Free.Pop();         // skip actors destroyed behind the pool's back

	if (IsValid(Actor))
	{
		Actor->SetActorTransform(Transform, false, nullptr, ETeleportType::ResetPhysics);
	}
	else
	{
		FActorSpawnParameters Params;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		Actor = GetWorld()->SpawnActor<APooledActor>(Class, Transform, Params);
	}

	SetActive(Actor, true);
	Actor->OnAcquired();
	return Actor;
}

void UActorPoolSubsystem::Release(APooledActor* Actor)
{
	if (!IsValid(Actor)) return;
	FActorPoolBucket& Bucket = Pools.FindOrAdd(Actor->GetClass());
	if (!ensureMsgf(!Bucket.Free.Contains(Actor), TEXT("%s released twice"), *Actor->GetName())) return;

	Actor->OnReleased();
	SetActive(Actor, false);
	Bucket.Free.Add(Actor);
}

void UActorPoolSubsystem::SetActive(APooledActor* Actor, bool bActive)
{
	Actor->SetActorHiddenInGame(!bActive);
	Actor->SetActorEnableCollision(bActive);
	Actor->SetActorTickEnabled(bActive);   // actor tick only: deactivate ticking components yourself
}

// Projectile.h
UCLASS()
class AProjectile : public APooledActor
{
	GENERATED_BODY()

public:
	AProjectile()
	{
		PrimaryActorTick.bCanEverTick = true;
		Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
		RootComponent = Mesh;
	}

	void Launch(const FVector& InVelocity) { Velocity = InVelocity; }
	virtual void OnAcquired() override { Lifetime = 3.f; Velocity = FVector::ZeroVector; }

	virtual void Tick(float DeltaSeconds) override
	{
		Super::Tick(DeltaSeconds);
		AddActorWorldOffset(Velocity * DeltaSeconds);
		if ((Lifetime -= DeltaSeconds) <= 0.f) ReturnToPool();
	}

private:
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> Mesh;

	FVector Velocity = FVector::ZeroVector;
	float Lifetime = 0.f;
};

// Gun.cpp: UPROPERTY(EditDefaultsOnly) TSubclassOf<AProjectile> ProjectileClass;
void AGun::Fire(const FVector& Dir)
{
	UActorPoolSubsystem* Pool = GetWorld()->GetSubsystem<UActorPoolSubsystem>();
	if (AProjectile* P = Cast<AProjectile>(Pool->Acquire(ProjectileClass, GetActorTransform())))
		P->Launch(Dir * 3000.f);           // Unreal units are centimetres
}
```

:::

**Engine notes**

- **Unity:** `UnityEngine.Pool` (2021.1+) also provides `ListPool<T>`, `DictionaryPool<K,V>` and `GenericPool<T>`, which avoid allocating temporary collections every frame. `SetActive(false)` fires `OnDisable`, so components can reset themselves there.
- **Godot:** there is no built-in node pool. A disabled physics body follows its `disable_mode` (by default it is removed from the physics space, so it stops colliding); an `Area3D` that is only hidden still detects overlaps unless its processing is disabled too. For particles, reuse a `GPUParticles3D` with `restart()` instead of instancing a new one per effect.
- **Unreal:** there is no general actor pool. `SetActorTickEnabled` doesn't stop component ticks, timers or a `UProjectileMovementComponent`, so stop those in `OnReleased`. Niagara has its own component pooling: pass `ENCPoolMethod::AutoRelease` to `UNiagaraFunctionLibrary::SpawnSystemAtLocation`. Pooled actors in a streamed level are destroyed with it, which is why `Acquire` skips invalid entries.

## When to use

- Objects created and destroyed frequently: projectiles, particles, hit effects, damage numbers, audio sources, enemies in waves.
- Platforms where allocation or garbage collection spikes are noticeable, such as mobile, VR and consoles.

## When not to use

- Objects created once per level load or rarely, such as level geometry, the player or managers. Pooling them only adds reset bugs.
- Small, plain data objects. Allocating them is cheap in every engine's language; pool only when a profiler shows allocation spikes.
- Objects with complex state that is hard to reset. A stale field from a previous use causes subtle bugs; measure before pooling.

## Pitfalls

- **Stale state.** A reused enemy still has last life's status effects, or a trail renderer still shows its old path. Reset everything in `Get` or `Launch`, including trail effects and physics velocities.
- **Double release** puts the same object in the pool twice, so two systems end up controlling it. Keep `collectionCheck` on in development.
- **Holding references to released objects.** A homing missile still targeting an enemy that was released and respawned elsewhere. Use generation counters or clear references on release.
- **Oversized pools** waste memory. Profile and set `maxSize`.

## Related

- [Flyweight](./flyweight) — shares immutable data. A pool reuses mutable instances.
- [Arena Allocator](./arena-allocator) — the same idea applied to raw memory.
