# Factory

> Centralise object creation so callers ask for "an enemy" rather than constructing one.

**Category:** Architecture & Structure

## Problem

Creating an enemy properly takes more than `Instantiate(prefab)`. The prefab must be looked up, an instance taken from a pool, stats applied from its [type](./type-object), services injected, it must be registered with the AI director and the minimap, and it must be scaled for difficulty. The spawner, the boss's summon ability, the debug console and the tutorial each do this slightly differently, and each forgets a different step. Changing how enemies are created means finding every place that creates them.

## Solution

Put creation in **one object whose job is creating things**: a factory. Callers say *what* they want ("a goblin at this position"), and the factory decides *how*: which prefab, pooled or new, which dependencies, which registrations.

Common variations:

| Variation | Idea | Game example |
| --- | --- | --- |
| **Factory method** | A method that returns a new object, often chosen by a key or type | `EnemyFactory.Create("goblin", pos)` |
| **Registry factory** | A map from IDs to creation recipes, filled from data | Spawn anything by ID from a spreadsheet or the debug console |
| **Abstract factory** | An interface for creating *families* of related objects, with one implementation per family | `IUiFactory` with "fantasy" and "sci-fi" skins, or "console" and "mobile" layouts |

## Example

A registry factory that combines [Type Object](./type-object), [Object Pool](./object-pool) and [Dependency Injection](./dependency-injection) behind one call:

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Pool;

public interface IEnemyFactory
{
    Enemy Create(string typeId, Vector3 position);
    void Despawn(Enemy enemy);
}

public class EnemyFactory : IEnemyFactory
{
    readonly Dictionary<string, EnemyType> types = new();
    readonly Dictionary<EnemyType, ObjectPool<Enemy>> pools = new();
    readonly IAnalytics analytics;                   // dependencies the enemies need
    readonly DifficultySettings difficulty;
    readonly Transform parent;

    public EnemyFactory(IEnumerable<EnemyType> allTypes, IAnalytics analytics,
                        DifficultySettings difficulty, Transform parent)
    {
        foreach (var t in allTypes) types[t.name] = t;
        this.analytics = analytics; this.difficulty = difficulty; this.parent = parent;
    }

    public Enemy Create(string typeId, Vector3 position)
    {
        if (!types.TryGetValue(typeId, out var type))
        {
            Debug.LogError($"Unknown enemy type '{typeId}'");
            return null;
        }

        var enemy = PoolFor(type).Get();
        enemy.transform.SetPositionAndRotation(position, Quaternion.identity);
        enemy.Init(type, difficulty.HealthMultiplier);              // stats from data, scaled
        enemy.Construct(analytics);                                  // inject dependencies
        EnemyRegistry.Add(enemy);                                    // minimap, director, quests
        return enemy;
    }

    public void Despawn(Enemy enemy)
    {
        EnemyRegistry.Remove(enemy);
        PoolFor(enemy.Type).Release(enemy);
    }

    ObjectPool<Enemy> PoolFor(EnemyType type)
    {
        if (pools.TryGetValue(type, out var pool)) return pool;
        pool = new ObjectPool<Enemy>(
            () => Object.Instantiate(type.Prefab, parent).GetComponent<Enemy>(),
            e => e.gameObject.SetActive(true),
            e => e.gameObject.SetActive(false),
            e => Object.Destroy(e.gameObject));
        pools[type] = pool;
        return pool;
    }
}

// Every caller creates enemies the same way:
//   factory.Create("goblin", spawnPoint.position);        // wave spawner
//   factory.Create("skeleton", boss.transform.position);  // boss summon
//   factory.Create(args[0], player.position + Vector3.forward * 3);   // debug console
```

```gdscript [Godot (GDScript)]
# enemy_factory.gd
class_name EnemyFactory
extends RefCounted

var _types := {}       # StringName -> EnemyType
var _pools := {}       # EnemyType -> Array[Enemy] of inactive enemies
var _analytics         # dependencies the enemies need
var _difficulty: DifficultySettings
var _parent: Node3D


func _init(all_types: Array[EnemyType], analytics, difficulty: DifficultySettings, parent: Node3D) -> void:
	for t in all_types:
		_types[StringName(t.resource_path.get_file().get_basename())] = t
	_analytics = analytics
	_difficulty = difficulty
	_parent = parent


func create(type_id: StringName, position: Vector3) -> Enemy:
	var type: EnemyType = _types.get(type_id)
	if type == null:
		push_error("Unknown enemy type '%s'" % type_id)
		return null

	var pool: Array = _pools.get_or_add(type, [])
	var enemy: Enemy = pool.pop_back() if not pool.is_empty() else type.get_scene().instantiate()
	enemy.init(type, _difficulty.health_multiplier)   # stats from data, scaled
	enemy.construct(_analytics)                        # inject dependencies
	if enemy.get_parent() == null:
		_parent.add_child(enemy)
	enemy.global_position = position
	enemy.process_mode = Node.PROCESS_MODE_INHERIT
	enemy.show()
	EnemyRegistry.add(enemy)                           # minimap, director, quests
	return enemy


func despawn(enemy: Enemy) -> void:
	EnemyRegistry.remove(enemy)
	enemy.hide()
	enemy.process_mode = Node.PROCESS_MODE_DISABLED   # parked in the pool, still in the tree
	_pools[enemy.type].append(enemy)

# Every caller creates enemies the same way:
#   factory.create(&"goblin", spawn_point.global_position)
#   factory.create(StringName(args[0]), player.global_position + Vector3.FORWARD * 3)
```

```cpp [Unreal (C++)]
// EnemyFactorySubsystem.h: one per world, so every caller goes through the same factory.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "EnemyFactorySubsystem.generated.h"

class UEnemyType;
class AEnemy;

USTRUCT()
struct FEnemyPool
{
	GENERATED_BODY()
	UPROPERTY() TArray<TObjectPtr<AEnemy>> Enemies;   // UPROPERTY: keeps pooled actors alive for the GC
};

UCLASS()
class UEnemyFactorySubsystem : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	void Configure(const TArray<UEnemyType*>& AllTypes, TSharedRef<IAnalytics> InAnalytics, float InHealthMultiplier)
	{
		for (UEnemyType* Type : AllTypes) Types.Add(Type->GetFName(), Type);
		Analytics = InAnalytics;
		HealthMultiplier = InHealthMultiplier;
	}

	AEnemy* Create(FName TypeId, const FVector& Location)
	{
		UEnemyType* Type = Types.FindRef(TypeId);
		if (!Type)
		{
			UE_LOG(LogTemp, Error, TEXT("Unknown enemy type '%s'"), *TypeId.ToString());
			return nullptr;
		}

		TArray<TObjectPtr<AEnemy>>& Pool = Pools.FindOrAdd(TypeId).Enemies;
		AEnemy* Enemy = Pool.Num() > 0 ? Pool.Pop().Get()
			: GetWorld()->SpawnActorDeferred<AEnemy>(Type->GetEnemyClass(), FTransform(Location));
		Enemy->Init(Type, HealthMultiplier);                 // stats from data, scaled
		Enemy->Construct(Analytics);                          // inject dependencies
		if (!Enemy->HasActorBegunPlay()) Enemy->FinishSpawning(FTransform(Location));
		Enemy->SetActorLocation(Location);
		Enemy->SetActorHiddenInGame(false);
		Enemy->SetActorEnableCollision(true);
		Enemy->SetActorTickEnabled(true);
		return Enemy;
	}

	void Despawn(AEnemy* Enemy)
	{
		Enemy->SetActorHiddenInGame(true);
		Enemy->SetActorEnableCollision(false);
		Enemy->SetActorTickEnabled(false);
		Pools.FindOrAdd(Enemy->Type->GetFName()).Enemies.Add(Enemy);
	}

private:
	UPROPERTY() TMap<FName, TObjectPtr<UEnemyType>> Types;
	UPROPERTY() TMap<FName, FEnemyPool> Pools;   // keyed by type id
	TSharedPtr<IAnalytics> Analytics;
	float HealthMultiplier = 1.f;
};

// Every caller creates enemies the same way:
//   GetWorld()->GetSubsystem<UEnemyFactorySubsystem>()->Create("Goblin", SpawnPoint->GetActorLocation());
```

:::

An abstract factory for a family of related objects, chosen once at startup:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public interface IUiFactory
{
    Button CreateButton(string label, Transform parent);
    Panel CreatePanel(Transform parent);
}

// MobileUiFactory makes large touch targets; DesktopUiFactory makes compact, hover-enabled ones.
// The bootstrapper registers the right one; menus never check the platform themselves.
```

```gdscript [Godot (GDScript)]
# ui_factory.gd: base class; MobileUiFactory and DesktopUiFactory override both methods.
class_name UiFactory
extends RefCounted

func create_button(_label: String, _parent: Control) -> Button:
	return null

func create_panel(_parent: Control) -> PanelContainer:
	return null

# The boot autoload picks one:
#   var ui: UiFactory = MobileUiFactory.new() if OS.has_feature("mobile") else DesktopUiFactory.new()
```

```cpp [Unreal (C++)]
// UiFactory.h: MobileUiFactory makes large touch targets; DesktopUiFactory compact, hover-enabled ones.
class IUiFactory
{
public:
	virtual ~IUiFactory() = default;
	virtual UButton* CreateButton(const FText& Label, UPanelWidget* Parent) = 0;
	virtual UPanelWidget* CreatePanel(UPanelWidget* Parent) = 0;
};

// The game instance picks one at startup:
//   UiFactory = PLATFORM_ANDROID || PLATFORM_IOS ? MakeShared<FMobileUiFactory>() : MakeShared<FDesktopUiFactory>();
```

:::

Callers depend on the factory interface, so tests can pass a fake factory that records what was created.

**Engine notes**

- **Unity:** `UnityEngine.Pool.ObjectPool<T>` (2021.1+) provides the pooling.
- **Godot:** pooled nodes stay in the tree but are hidden and disabled with `process_mode`, which is cheaper than removing and re-adding them.
- **Unreal:** `SpawnActorDeferred` lets the factory configure and inject before `BeginPlay`. In Unreal, `TObjectPtr` members must be `UPROPERTY` (as above) so the garbage collector keeps pooled actors alive.

## When to use

- Creation involves more than `new` or `Instantiate`: pooling, data lookup, injection, registration.
- Many places create the same kinds of objects.
- Objects are chosen by ID from data, the network or the console.
- Families of objects must be swapped together (platforms, themes, difficulty sets).

## When not to use

- Creation that is just `new` or `Instantiate` with no extra steps. A factory class adds a layer with nothing in it.
- A single place that creates the object. Keep the creation code there until a second caller appears.
- When the "factory" would be a giant `switch` on a type ID that grows with every new kind. Use [Type Object](./type-object) or a registry instead.

## Pitfalls

- **Factories for trivial objects.** A factory that wraps a single `new Vector3(...)` is ceremony. Introduce one when creation has real steps.
- **God factories.** One factory that creates enemies, items, UI and effects grows huge. Use one factory per family of objects.
- **Destruction not going through the factory.** If creation registers and pools, destruction must unregister and release. Pair `Create` with `Despawn` in the same class, and make it the only way to remove objects.
- **Stringly-typed IDs.** A typo in `"gobiln"` fails at runtime. Validate IDs at load time, or prefer references to type assets in serialised data.

## Related

- [Type Object](./type-object) — what the factory reads to configure each object.
- [Object Pool](./object-pool) — where the factory gets instances from.
- [Dependency Injection](./dependency-injection) — the factory passes dependencies to runtime-created objects.
- [Prototype](./prototype) and [Builder](./builder) — other ways to create objects.
- [Spawner / Wave System](./spawner) — a typical caller.
