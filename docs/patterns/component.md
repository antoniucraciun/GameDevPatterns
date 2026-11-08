# Component

> Build entities from small, independent pieces of behaviour instead of deep inheritance.

**Category:** Architecture & Structure

## Problem

Inheritance hierarchies for game objects collapse under real requirements. You start with `Enemy → FlyingEnemy` and `Enemy → ShootingEnemy`. Then design asks for a flying enemy that shoots, a turret that shoots but is not an enemy, and a destructible crate that has health but no AI. Every new combination forces you to duplicate code or bolt features onto a bloated base class.

## Solution

An entity becomes a thin container. Each capability (movement, health, shooting, rendering) is a separate **component** that does one job. You build a new kind of entity by choosing which components to attach. Components can find their siblings on the same entity when they need to cooperate. Prefer interfaces or events for that, so components do not depend on concrete sibling types.

## Pseudocode

```text
// The entity is only a container; each component does one job.
Entity:
    components             // the parts attached to it

Health is a component:
    max
    current ← max
    died                   // an event other components can listen to

    take_damage(amount):
        if current ≤ 0: return              // already dead
        current ← max(0, current - amount)
        if current = 0: raise died

DropLootOnDeath is a component:
    loot
    on start:
        health ← the Health on the same entity
        when health.died: spawn loot at the entity's position

DestroyOnDeath is a component:
    on start:
        health ← the Health on the same entity
        when health.died: destroy the entity

// New kinds of entity are new combinations, not new classes.
crate ← Entity with Health, DropLootOnDeath, DestroyOnDeath
enemy ← Entity with Health, DropLootOnDeath, DestroyOnDeath, Patrol, Shooter
```

## Example

Each engine's object model is this pattern: an entity is a container, and behaviour comes from small, focused components attached to it.

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class Health : MonoBehaviour
{
    [SerializeField] int max = 100;
    public int Current { get; private set; }
    public event System.Action Died;

    void Awake() => Current = max;

    public void TakeDamage(int amount)
    {
        if (Current <= 0) return;
        Current = Mathf.Max(0, Current - amount);
        if (Current == 0) Died?.Invoke();
    }
}

public class DropLootOnDeath : MonoBehaviour
{
    [SerializeField] GameObject lootPrefab;

    void Awake() => GetComponent<Health>().Died += () =>
        Instantiate(lootPrefab, transform.position, Quaternion.identity);
}

[RequireComponent(typeof(Health))]
public class DestroyOnDeath : MonoBehaviour
{
    void Awake() => GetComponent<Health>().Died += () => Destroy(gameObject);
}
```

```gdscript [Godot (GDScript)]
# health.gd: a child node of the entity.
class_name Health
extends Node

signal died

@export var max_health := 100
var current: int


func _ready() -> void:
	current = max_health


func take_damage(amount: int) -> void:
	if current <= 0:
		return
	current = maxi(0, current - amount)
	if current == 0:
		died.emit()


# drop_loot_on_death.gd: another child node, wired to its sibling Health in the inspector.
extends Node

@export var health: Health
@export var loot_scene: PackedScene


func _ready() -> void:
	health.died.connect(_on_died)


func _on_died() -> void:
	var loot: Node3D = loot_scene.instantiate()
	get_tree().current_scene.add_child(loot)
	loot.global_position = (owner as Node3D).global_position


# destroy_on_death.gd
extends Node

@export var health: Health


func _ready() -> void:
	health.died.connect(owner.queue_free)  # owner = the root of the entity's scene
```

```cpp [Unreal (C++)]
// HealthComponent.h
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "HealthComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnDied);

UCLASS(ClassGroup = (Gameplay), meta = (BlueprintSpawnableComponent))
class UHealthComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Health") int32 Max = 100;
	UPROPERTY(BlueprintReadOnly, Category = "Health") int32 Current = 0;
	UPROPERTY(BlueprintAssignable, Category = "Health") FOnDied OnDied;

	UFUNCTION(BlueprintCallable, Category = "Health")
	void ApplyDamage(int32 Amount)
	{
		if (Current <= 0) return;
		Current = FMath::Max(0, Current - Amount);
		if (Current == 0) OnDied.Broadcast();
	}

protected:
	virtual void BeginPlay() override { Super::BeginPlay(); Current = Max; }
};

// DropLootOnDeathComponent.h
UCLASS(ClassGroup = (Gameplay), meta = (BlueprintSpawnableComponent))
class UDropLootOnDeathComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Loot") TSubclassOf<AActor> LootClass;

protected:
	virtual void BeginPlay() override
	{
		Super::BeginPlay();
		if (UHealthComponent* Health = GetOwner()->FindComponentByClass<UHealthComponent>())
			Health->OnDied.AddDynamic(this, &UDropLootOnDeathComponent::HandleDied);
	}

private:
	UFUNCTION() void HandleDied()
	{
		GetWorld()->SpawnActor<AActor>(LootClass, GetOwner()->GetActorTransform());
	}
};

// DestroyOnDeathComponent.h
UCLASS(ClassGroup = (Gameplay), meta = (BlueprintSpawnableComponent))
class UDestroyOnDeathComponent : public UActorComponent
{
	GENERATED_BODY()

protected:
	virtual void BeginPlay() override
	{
		Super::BeginPlay();
		if (UHealthComponent* Health = GetOwner()->FindComponentByClass<UHealthComponent>())
			Health->OnDied.AddDynamic(this, &UDestroyOnDeathComponent::HandleDied);
	}

private:
	UFUNCTION() void HandleDied() { GetOwner()->Destroy(); }
};
```

:::

A crate is `Health + DropLootOnDeath + DestroyOnDeath`. An enemy reuses the same three components and adds `Patrol` and `Shooter`. You never have to choose a base class.

**Engine notes**

- **Unity:** `[RequireComponent]` adds dependencies automatically when a component is added in the editor; `TryGetComponent` avoids allocations when a component may be missing.
- **Godot:** the "components" are child nodes. Wire siblings with `@export` (as above) or `%UniqueName` references rather than fragile `get_node("../Health")` paths. Godot's own nodes (`Area3D`, `AnimationPlayer`, `NavigationAgent3D`) are composed the same way.
- **Unreal:** use `UActorComponent` for logic only and `USceneComponent` when it needs a transform. Each component class needs its own header (with its own `.generated.h`); they are shown together here for brevity.

## When to use

- Entities that mix and match capabilities.
- Teams where designers assemble objects in the editor from existing parts.

## When not to use

- Tiny games or prototypes with a handful of entity types. A plain class per type can be easier to read than many small components.
- Splitting an object into components that always appear together and talk to each other constantly. Keep them as one class until you genuinely need to mix them separately.
- Very large numbers of similar objects where performance matters. Use [Entity Component System](./entity-component-system).

## Pitfalls

- **Hidden coupling between components.** Looking up concrete sibling components everywhere (`GetComponent<Concrete>()`, `get_node()`, `FindComponentByClass`) recreates the coupling you were escaping. Depend on interfaces such as `IDamageable`, or use events.
- **Too fine-grained.** Thirty one-line components on an object are hard to follow. A component should be a meaningful capability.
- **Initialisation order.** Do not read sibling state while the sibling may still be initialising. In Unity, cache references in `Awake` and read values in `Start`. In Godot, a parent's `_ready` runs after its children's. In Unreal, all of an actor's components are initialised before `BeginPlay`, so read siblings there.
- **Per-object overhead.** With tens of thousands of objects, consider an [Entity Component System](./entity-component-system) instead.

## Related

- [Update Method](./update-method) — components usually update themselves.
- [Observer](./observer) — the cleanest way for components to cooperate.
- [Health / Damageable Interface](./health-component) — the `Health` component above, developed fully.
- [Entity Component System](./entity-component-system) — the data-oriented evolution of this idea.
