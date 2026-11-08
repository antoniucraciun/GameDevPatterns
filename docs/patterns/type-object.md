# Type Object

> Define new "kinds" of things as data instances rather than as subclasses.

**Category:** Architecture & Structure

## Problem

The game has goblins, orcs and trolls, so you write `Goblin : Enemy`, `Orc : Enemy` and `Troll : Enemy`. Then design wants 60 enemy kinds, plus variants: "Goblin Archer", "Elite Orc", "Frost Troll". Each one becomes a class that differs from the others only in numbers and a few flags. Every new kind needs a programmer, a recompile and a code review. Designers cannot experiment, and the class hierarchy grows sideways forever.

## Solution

Split one class into two:

- A **type object** (`EnemyType`) describes a *kind*: its name, health, speed, attacks, loot and visual template (prefab, scene or Blueprint). Each kind is an **instance** of this class, created as data such as an asset or a row in a spreadsheet.
- The **typed object** (`Enemy`) is an individual in the world. It holds a reference to its type plus its own state: current health and position.

New kinds become new data, not new code. Type objects can also **inherit from other type objects**. An "Elite Orc" names "Orc" as its parent and overrides only what differs, so values flow down without a class hierarchy.

This differs from [Flyweight](./flyweight), even though the structure looks alike. Flyweight is about *sharing memory*. Type Object is about *defining kinds as data*. In practice, a type object is usually a flyweight too.

## Pseudocode

```text
// The kind: one data instance per kind of enemy, not one class.
EnemyType:
    parent                 // another EnemyType, or none
    display_name, max_health, move_speed, template, loot
                           // "unset" (0 or none) means "inherit"

    resolve(field):        // walk up the parent chain until a value is set
        if this.field is set: return this.field
        if parent exists:     return parent.resolve(field)
        return the default for field

    spawn(position):       // the type creates its typed objects
        enemy ← new instance of resolve(template) at position
        enemy.init(this)
        return enemy

// The individual: a reference to its kind, plus its own state.
Enemy:
    type
    health

    init(t):
        type ← t
        health ← t.resolve(max_health)
        name ← t.resolve(display_name)

    take_damage(amount):
        health ← health - amount
        if health ≤ 0:
            drop loot from type.resolve(loot)
            destroy this

// New kinds are new data. An Elite Orc overrides one value, inherits the rest.
orc       ← EnemyType(max_health 40, with its speed, template and loot)
elite_orc ← EnemyType(parent orc, max_health 120)
elite_orc.spawn(position)    // 120 health; the orc's speed, template and loot
```

## Example

Enemy kinds as data assets, with inheritance between kinds, and an individual enemy that holds its kind plus its own state.

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

[CreateAssetMenu(menuName = "Enemies/Enemy Type")]
public class EnemyType : ScriptableObject
{
    [Tooltip("Values left at their 'unset' default are inherited from the parent.")]
    [SerializeField] EnemyType parent;

    [SerializeField] string displayName;
    [SerializeField] int maxHealth;          // 0 = inherit
    [SerializeField] float moveSpeed;        // 0 = inherit
    [SerializeField] int contactDamage;      // 0 = inherit
    [SerializeField] GameObject prefab;      // null = inherit
    [SerializeField] LootTable loot;         // null = inherit

    // Resolved values: walk up the parent chain until a value is set.
    public string DisplayName => !string.IsNullOrEmpty(displayName) ? displayName : parent ? parent.DisplayName : name;
    public int MaxHealth      => maxHealth > 0 ? maxHealth : parent ? parent.MaxHealth : 1;
    public float MoveSpeed    => moveSpeed > 0f ? moveSpeed : parent ? parent.MoveSpeed : 1f;
    public int ContactDamage  => contactDamage > 0 ? contactDamage : parent ? parent.ContactDamage : 0;
    public GameObject Prefab  => prefab ? prefab : parent ? parent.Prefab : null;
    public LootTable Loot     => loot ? loot : parent ? parent.Loot : null;

    // The type object can create its typed objects.
    public Enemy Spawn(Vector3 position)
    {
        var go = Instantiate(Prefab, position, Quaternion.identity);
        var enemy = go.GetComponent<Enemy>();
        enemy.Init(this);
        return enemy;
    }

    void OnValidate()   // catch inheritance cycles in the editor
    {
        for (var p = parent; p != null; p = p.parent)
            if (p == this) { Debug.LogError($"{name}: parent chain loops back to itself", this); parent = null; break; }
    }
}

public class Enemy : MonoBehaviour
{
    public EnemyType Type { get; private set; }   // the kind
    int health;                                   // the individual's own state

    public void Init(EnemyType type)
    {
        Type = type;
        health = type.MaxHealth;
        name = type.DisplayName;
    }

    void Update() { /* move at Type.MoveSpeed toward the player */ }

    public void TakeDamage(int amount)
    {
        if ((health -= amount) > 0) return;
        // Drop from Type.Loot, raise a "killed" event with Type for achievements, then:
        Destroy(gameObject);
    }
}
```

```gdscript [Godot (GDScript)]
# enemy_type.gd: one .tres per kind of enemy.
class_name EnemyType
extends Resource

@export var parent: EnemyType  # values left at their "unset" default are inherited

@export var display_name := ""
@export var max_health := 0      # 0 = inherit
@export var move_speed := 0.0    # 0 = inherit
@export var contact_damage := 0  # 0 = inherit
@export var scene: PackedScene   # null = inherit
@export var loot: LootTable      # null = inherit


# Resolved values: walk up the parent chain until a value is set.
func get_display_name() -> String:
	return display_name if display_name != "" else (parent.get_display_name() if parent else resource_path.get_file().get_basename())

func get_max_health() -> int:
	return max_health if max_health > 0 else (parent.get_max_health() if parent else 1)

func get_move_speed() -> float:
	return move_speed if move_speed > 0.0 else (parent.get_move_speed() if parent else 1.0)

func get_scene() -> PackedScene:
	return scene if scene else (parent.get_scene() if parent else null)

func get_loot() -> LootTable:
	return loot if loot else (parent.get_loot() if parent else null)


# The type object can create its typed objects.
func spawn(parent_node: Node, position: Vector3) -> Enemy:
	var enemy: Enemy = get_scene().instantiate()
	enemy.init(self)
	parent_node.add_child(enemy)
	enemy.global_position = position
	return enemy


# enemy.gd
class_name Enemy
extends CharacterBody3D

var type: EnemyType  # the kind
var _health: int     # the individual's own state


func init(enemy_type: EnemyType) -> void:
	type = enemy_type
	_health = type.get_max_health()
	name = type.get_display_name()


func take_damage(amount: int) -> void:
	_health -= amount
	if _health > 0:
		return
	# Drop from type.get_loot(), emit a "killed" signal with type for achievements, then:
	queue_free()
```

```cpp [Unreal (C++)]
// EnemyType.h: one Primary Data Asset per kind (Asset Manager can find and load them by type).
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "EnemyType.generated.h"

UCLASS(BlueprintType)
class UEnemyType : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	// Values left at their "unset" default are inherited from the parent.
	UPROPERTY(EditAnywhere, Category = "Type") TObjectPtr<UEnemyType> Parent;

	UPROPERTY(EditAnywhere, Category = "Type") FText DisplayName;
	UPROPERTY(EditAnywhere, Category = "Type") int32 MaxHealth = 0;          // 0 = inherit
	UPROPERTY(EditAnywhere, Category = "Type") float MoveSpeed = 0.f;        // 0 = inherit
	UPROPERTY(EditAnywhere, Category = "Type") TSubclassOf<class AEnemy> EnemyClass;   // null = inherit

	// Resolved values: walk up the parent chain until a value is set.
	FText GetDisplayName() const { return !DisplayName.IsEmpty() ? DisplayName : Parent ? Parent->GetDisplayName() : FText::FromString(GetName()); }
	int32 GetMaxHealth() const { return MaxHealth > 0 ? MaxHealth : Parent ? Parent->GetMaxHealth() : 1; }
	float GetMoveSpeed() const { return MoveSpeed > 0.f ? MoveSpeed : Parent ? Parent->GetMoveSpeed() : 100.f; }
	TSubclassOf<AEnemy> GetEnemyClass() const { return EnemyClass ? EnemyClass : Parent ? Parent->GetEnemyClass() : nullptr; }

#if WITH_EDITOR
	virtual EDataValidationResult IsDataValid(class FDataValidationContext& Context) const override;   // catch parent cycles
#endif
};

// Enemy.h
UCLASS()
class AEnemy : public ACharacter
{
	GENERATED_BODY()

public:
	void Init(const UEnemyType* InType)
	{
		Type = InType;
		Health = Type->GetMaxHealth();
		GetCharacterMovement()->MaxWalkSpeed = Type->GetMoveSpeed();
	}

	UPROPERTY(VisibleAnywhere, Category = "Enemy") TObjectPtr<const UEnemyType> Type;   // the kind

private:
	int32 Health = 0;                                                                  // the individual's own state
};

// Spawning a typed object: deferred, so Init runs before BeginPlay.
//   AEnemy* Enemy = World->SpawnActorDeferred<AEnemy>(Type->GetEnemyClass(), Transform);
//   Enemy->Init(Type);
//   Enemy->FinishSpawning(Transform);
```

:::

Designers now create an Orc asset with max health 40, then an Elite Orc with the Orc as parent and max health 120. Everything else, including the prefab or scene, speed and loot, is inherited. No code changes.

Behaviour can be data too. Give the type a reference to a behaviour asset (a behaviour tree or an AI profile) or a list of abilities, and kinds can differ in *what they do*, not just their numbers.

**Engine notes**

- **Unity:** `OnValidate` runs in the editor whenever the asset changes, which is the right place to catch inheritance cycles.
- **Godot:** typed `@export` fields make the inspector only accept the right resource type. To catch parent cycles in the editor, make the script `@tool` and check the chain in the `parent` setter, or validate all `.tres` files from an `EditorScript`.
- **Unreal:** `UPrimaryDataAsset` lets the **Asset Manager** list and async-load all enemy types by type name. `IsDataValid` hooks into **Data Validation** to flag bad assets before they ship.

## When to use

- Many kinds of a thing that differ mostly in data: enemies, items, weapons, spells, buildings, tiles.
- Designers need to add and tune kinds without programmers.
- Kinds are loaded from external data (spreadsheets, mods, live-ops updates).

## When not to use

- A few kinds that differ in behaviour, not data. Use subclasses or [Strategy](./strategy).
- Two or three kinds that never change. An editor field on the template is enough.
- Kinds that need truly unique logic for each type. Data can't express it, so you end up with a scripting system; consider [Subclass Sandbox](./subclass-sandbox) instead.

## Pitfalls

- **Behaviour that really differs.** If a kind needs genuinely unique logic, numbers are not enough. Combine Type Object with composable behaviour ([strategy](./strategy) objects, ability lists) rather than adding `if (type.isTroll)` flags.
- **"Unset" sentinels.** Using `0` to mean "inherit" makes "0 damage" impossible to express. Use explicit override toggles, or nullable fields with a custom inspector, when that matters.
- **Deep inheritance chains.** "Where does this value come from?" gets hard to answer after three levels. Keep chains shallow, and consider an inspector that shows resolved values.
- **Mutating types at runtime.** Changing `type.maxHealth` affects every enemy of that kind, and edits the asset in the editor. Per-instance changes belong on the instance.

## Related

- [Flyweight](./flyweight) — type objects are typically shared flyweights.
- [Prototype](./prototype) — create kinds by cloning configured examples, as prefab variants, inherited scenes and child Blueprints do.
- [Ability System](./ability-system) and [Status Effects](./status-effects) — both define their kinds with this pattern.
- [Weighted Random & Loot Tables](./weighted-random) — referenced by types for drops.
