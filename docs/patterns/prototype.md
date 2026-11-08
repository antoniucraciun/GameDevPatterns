# Prototype

> Create new objects by cloning a configured example (prefabs, scenes, Blueprint defaults).

**Category:** Architecture & Structure

## Problem

A spawner needs to create goblins, but a goblin is not just a class. It is a specific combination of mesh, materials, colliders, components and tuned values, assembled by a designer. Writing code that builds that combination (add a renderer, set the material, add a health component, set health to 40) is fragile, and duplicates work the designer already did. Some variations exist only at runtime: an "elite" goblin buffed by the AI Director, or a monster a player customised in a creator. You need more of *that exact thing*, whatever it turned out to be.

## Solution

Create new objects by **copying an existing, fully configured one**: the **prototype**. The code that creates the copy does not need to know what the object contains.

Game engines use this pattern everywhere:

- **Stored prototypes.** Unity **prefabs**, Godot **scenes** (`PackedScene.instantiate()`) and Unreal **Blueprint classes** (spawned from their class defaults) are configured objects saved as assets, cloned with their components, values and children.
- **Prototypes of prototypes.** Unity **prefab variants**, Godot **inherited scenes** and Unreal **child Blueprints** override a few values of a parent ("Elite Goblin" from "Goblin") and inherit the rest.
- **Runtime clones.** Unity's `Instantiate(anyGameObject)`, Godot's `Node.duplicate()` and Unreal's `SpawnActor` with a `Template` actor clone an object that already exists in the game, including changes made during play.
- For **plain data**, a `Clone()` method copies configured objects. The critical question is how deep the copy goes.

## Example

Spawning copies of a runtime-modified prototype, such as "this wave's buffed enemy":

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class EliteWaveSpawner : MonoBehaviour
{
    [SerializeField] Enemy basePrefab;
    Enemy elitePrototype;                     // configured once, cloned many times

    public void PrepareEliteWave(float healthBonus, Material eliteMaterial)
    {
        // Build the prototype once, from the prefab, then customise it at runtime.
        elitePrototype = Instantiate(basePrefab, transform);
        elitePrototype.gameObject.SetActive(false);          // a template, not part of the game
        elitePrototype.MaxHealth *= 1f + healthBonus;
        elitePrototype.GetComponentInChildren<Renderer>().sharedMaterial = eliteMaterial;
        elitePrototype.gameObject.AddComponent<EliteAura>();
    }

    public Enemy SpawnElite(Vector3 position)
    {
        // Clone the configured prototype: every customisation comes along.
        var e = Instantiate(elitePrototype, position, Quaternion.identity);
        e.gameObject.SetActive(true);
        return e;
    }
}
```

```gdscript [Godot (GDScript)]
# elite_wave_spawner.gd
extends Node3D

@export var base_scene: PackedScene
var _elite_prototype: Enemy  # configured once, cloned many times; never added to the tree


func prepare_elite_wave(health_bonus: float, elite_material: Material) -> void:
	if _elite_prototype:
		_elite_prototype.free()
	# Build the prototype once, from the scene, then customise it at runtime.
	_elite_prototype = base_scene.instantiate()
	_elite_prototype.max_health *= 1.0 + health_bonus
	_elite_prototype.get_node("Mesh").material_override = elite_material
	_elite_prototype.add_child(EliteAura.new())


func spawn_elite(position: Vector3) -> Enemy:
	# Node.duplicate copies the node, its children, scripts and their *exported* property values,
	# so max_health must be an @export var for the bonus to carry over.
	var e: Enemy = _elite_prototype.duplicate()
	add_child(e)
	e.global_position = position
	return e


func _exit_tree() -> void:
	if _elite_prototype:
		_elite_prototype.free()  # nodes outside the tree must be freed by hand
```

```cpp [Unreal (C++)]
// EliteWaveSpawner.cpp: SpawnActor can copy every property from an existing actor through
// FActorSpawnParameters::Template, which is the Prototype pattern built into the engine.
void AEliteWaveSpawner::PrepareEliteWave(float HealthBonus, UMaterialInterface* EliteMaterial)
{
	if (ElitePrototype) ElitePrototype->Destroy();

	// Build the prototype once, from the base class, then customise it at runtime.
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	ElitePrototype = GetWorld()->SpawnActor<AEnemy>(BaseClass, FTransform::Identity, Params);
	ElitePrototype->SetActorHiddenInGame(true);              // a template, not part of the game
	ElitePrototype->SetActorEnableCollision(false);
	ElitePrototype->SetActorTickEnabled(false);
	ElitePrototype->MaxHealth *= 1.f + HealthBonus;
	ElitePrototype->GetMesh()->SetMaterial(0, EliteMaterial);
}

AEnemy* AEliteWaveSpawner::SpawnElite(const FVector& Location)
{
	// Clone the configured prototype: its property values come along.
	FActorSpawnParameters Params;
	Params.Template = ElitePrototype;
	AEnemy* Enemy = GetWorld()->SpawnActor<AEnemy>(BaseClass, FTransform(Location), Params);
	Enemy->SetActorHiddenInGame(false);
	Enemy->SetActorEnableCollision(true);
	Enemy->SetActorTickEnabled(true);
	return Enemy;
}
```

:::

Plain data prototypes, with an explicit deep copy:

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;

public class CharacterLoadout
{
    public string ClassName;
    public int Level;
    public List<string> Items = new();
    public Dictionary<string, int> Skills = new();

    // Deep copy: the clone gets its own lists, so editing it never changes the prototype.
    public CharacterLoadout Clone() => new()
    {
        ClassName = ClassName,
        Level = Level,
        Items = new List<string>(Items),
        Skills = new Dictionary<string, int>(Skills),
    };
}

// Templates the player can start from, cloned and then customised:
//   var warrior = presets["Warrior"].Clone();
//   warrior.Items.Add("lucky_charm");          // presets["Warrior"] is unchanged
```

```gdscript [Godot (GDScript)]
# character_loadout.gd
class_name CharacterLoadout
extends Resource

@export var class_title := ""
@export var level := 1
@export var items: Array[String] = []
@export var skills: Dictionary = {}

# Templates the player can start from, cloned and then customised:
#   var warrior: CharacterLoadout = presets["Warrior"].duplicate(true)  # true = deep
#   warrior.items.append("lucky_charm")                                  # the preset is unchanged
```

```cpp [Unreal (C++)]
// CharacterLoadout.h: a USTRUCT is copied by value, and TArray / TMap members copy their
// contents, so a plain assignment is already a deep copy of this data.
#pragma once

#include "CoreMinimal.h"
#include "CharacterLoadout.generated.h"

USTRUCT(BlueprintType)
struct FCharacterLoadout
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere) FName ClassName;
	UPROPERTY(EditAnywhere) int32 Level = 1;
	UPROPERTY(EditAnywhere) TArray<FName> Items;
	UPROPERTY(EditAnywhere) TMap<FName, int32> Skills;
};

// Templates the player can start from, cloned and then customised:
//   FCharacterLoadout Warrior = Presets.FindChecked("Warrior");   // a copy
//   Warrior.Items.Add("LuckyCharm");                              // the preset is unchanged
```

:::

**Engine notes**

- **Unity:** `MemberwiseClone()` makes a **shallow** copy: value fields are copied, but reference fields (lists, dictionaries, other objects) are *shared* between the original and the clone. That is the most common prototype bug.
- **Godot:** `Resource.duplicate()` is shallow by default; pass `true` to also duplicate sub-resources, arrays and dictionaries. `Node.duplicate()` copies stored (exported) properties only, so state kept in plain `var`s is not cloned.
- **Unreal:** `Template` copies `UPROPERTY` values, so runtime changes to non-`UPROPERTY` members don't carry over, and the template must be the same class as the actor being spawned. The shallow-copy trap applies to `UObject*` members: copying a struct copies the pointer, not the object; duplicate owned objects with `DuplicateObject`.

## When to use

- Spawning configured objects whose setup lives in data or the editor (prefabs, scenes, Blueprints and their variants).
- Variations created at runtime that you then need many copies of: buffed enemies, player-customised units, procedurally assembled objects.
- Templates and presets: starting loadouts, character presets, level chunks.

## When not to use

- The engine's own templates already cover most uses: Unity prefabs and variants, Godot scenes and inherited scenes, Unreal Blueprints and child Blueprints. Don't build a separate cloning system on top unless you clone runtime-modified objects.
- Objects with references to scene objects or external resources. Shallow copies share them and deep copies are hard to get right; use a [Factory](./factory) or [Builder](./builder) that sets them up explicitly.
- Simple objects with no setup. `new` or the engine's spawn call is clearer.

## Pitfalls

- **Shallow copies.** Cloned objects that share a list with the prototype change each other. Write explicit deep-copy methods for data that contains collections or references.
- **Runtime prototypes in the scene.** A template object left active in the scene takes part in the game (it moves, it counts as an enemy). Deactivate it or keep it out of the scene tree, and keep it outside the scene's gameplay registries.
- **Cloning unwanted state.** Cloning a live object copies its *current* state: half-played animations, damage taken, running timers. Clone from clean templates, not from objects in use.
- **Expensive clones.** Instantiating complex templates causes hitches. Combine prototypes with an [Object Pool](./object-pool).
- **Deep variant chains.** Variant of variant of variant becomes hard to reason about ("where does this value come from?"). Keep chains shallow.

## Related

- [Type Object](./type-object) — defines kinds as data, and often references a prototype prefab, scene or Blueprint.
- [Factory](./factory) — decides *which* prototype to clone, and does the setup around it.
- [Object Pool](./object-pool) — reuses clones instead of creating new ones.
- [Memento](./memento) — a copy of state for restoring, rather than for creating new objects.
- [Flyweight](./flyweight) — shares data between instances instead of copying it.
