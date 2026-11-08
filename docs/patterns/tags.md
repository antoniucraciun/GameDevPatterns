# Gameplay Tags

> Hierarchical tags (State.Stunned, Damage.Fire) for queries instead of booleans.

**Category:** Gameplay Systems

## Problem

A character class grows booleans: `isStunned`, `isSilenced`, `isBurning`, `isInvulnerable`, `isInCutscene`. Each new effect needs a new field and code that checks it. "Can this character act?" becomes `!isStunned && !isFrozen && !isSleeping && !isInCutscene`, repeated and inconsistent across the codebase. Two effects that both stun the character overwrite each other's flag, so ending one un-stuns the character while the other is still active. String tags fix the field explosion, but `"Stunned"` versus `"Stun"` typos fail silently.

## Solution

Give objects a **tag container**, and define tags as a **hierarchy**:

```
State
├── State.Debuff
│   ├── State.Debuff.Stun
│   ├── State.Debuff.Silence
│   └── State.Debuff.Burning
└── State.Invulnerable
Damage
├── Damage.Fire
└── Damage.Ice
```

- **Hierarchical matching.** Asking "has `State.Debuff`?" is true if the container holds *any* debuff. "Cleanse all debuffs" and "immune to all debuffs" become one query.
- **Reference counting.** The container counts each tag. Two stuns add the tag twice, and the character stays stunned until *both* have been removed.
- **Queries.** *Has any of*, *has all of*, *has none of*. An ability can declare "blocked by `State.Debuff.Stun` or `State.Debuff.Silence`, requires `State.Grounded`".
- **Typo-proof tags.** Tags are assets (or interned constants) picked from a list in the inspector, not free strings.

Unreal Engine's Gameplay Ability System popularised this approach. The pattern works in any engine.

## Example

### Tags, a counted container and requirements

Tags are hierarchical (`Effect.Debuff.Stun` is a kind of `Effect.Debuff`), counted (two sources holding Stun keep it until both remove it), and queried with reusable requirements.

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

// Tags as ScriptableObject assets, so they are typo-proof, selectable in the inspector, and know their parent.
[CreateAssetMenu(menuName = "Tags/Gameplay Tag")]
public class GameplayTag : ScriptableObject
{
    [SerializeField] GameplayTag parent;
    public GameplayTag Parent => parent;

    // True if this tag is `other` or a descendant of it: Stun.IsA(Debuff) == true.
    public bool IsA(GameplayTag other)
    {
        for (var t = this; t != null; t = t.parent)
            if (t == other) return true;
        return false;
    }

    public string FullName => parent ? $"{parent.FullName}.{name}" : name;
}

public class TagContainer
{
    readonly Dictionary<GameplayTag, int> counts = new();
    public event Action<GameplayTag, bool> Changed;          // (tag, nowPresent)

    public void Add(GameplayTag tag)
    {
        counts.TryGetValue(tag, out int c);
        counts[tag] = c + 1;
        if (c == 0) Changed?.Invoke(tag, true);              // only the first source raises "added"
    }

    public void Remove(GameplayTag tag)
    {
        if (!counts.TryGetValue(tag, out int c)) return;
        if (c <= 1) { counts.Remove(tag); Changed?.Invoke(tag, false); }
        else counts[tag] = c - 1;                            // another source still holds it
    }

    // Hierarchical: Has(Debuff) is true while Stun is present.
    public bool Has(GameplayTag query)
    {
        foreach (var tag in counts.Keys)
            if (tag.IsA(query)) return true;
        return false;
    }

    public bool HasAny(IEnumerable<GameplayTag> tags) { foreach (var t in tags) if (Has(t)) return true; return false; }
    public bool HasAll(IEnumerable<GameplayTag> tags) { foreach (var t in tags) if (!Has(t)) return false; return true; }

    public void RemoveAllUnder(GameplayTag root)              // "cleanse all debuffs"
    {
        var toRemove = new List<GameplayTag>();
        foreach (var tag in counts.Keys) if (tag.IsA(root)) toRemove.Add(tag);
        foreach (var tag in toRemove) { counts.Remove(tag); Changed?.Invoke(tag, false); }
    }
}

// A reusable requirement, editable in the inspector.
[Serializable]
public class TagRequirement
{
    public List<GameplayTag> requireAll = new();
    public List<GameplayTag> blockedByAny = new();

    public bool IsMetBy(TagContainer tags) => tags.HasAll(requireAll) && !tags.HasAny(blockedByAny);
}
```

```gdscript [Godot (GDScript)]
# tags.gd: tags are dotted StringNames. Keep the names in one constants script (autoload or
# class_name) so code can't misspell them.
class_name Tags

const DEBUFF := &"Effect.Debuff"
const STUN := &"Effect.Debuff.Stun"
const FROZEN := &"State.Frozen"
const CUTSCENE := &"State.Cutscene"


# tag_container.gd
class_name TagContainer
extends RefCounted

signal changed(tag: StringName, present: bool)

var _counts := {}  # StringName -> int


# True if tag is query or a descendant of it: is_a(&"Effect.Debuff.Stun", &"Effect.Debuff") == true.
static func is_a(tag: StringName, query: StringName) -> bool:
	return tag == query or String(tag).begins_with(String(query) + ".")


func add(tag: StringName) -> void:
	var c: int = _counts.get(tag, 0)
	_counts[tag] = c + 1
	if c == 0:
		changed.emit(tag, true)  # only the first source raises "added"


func remove(tag: StringName) -> void:
	if not _counts.has(tag):
		return
	if _counts[tag] <= 1:
		_counts.erase(tag)
		changed.emit(tag, false)
	else:
		_counts[tag] -= 1  # another source still holds it


# Hierarchical: has_tag(Tags.DEBUFF) is true while STUN is present.
func has_tag(query: StringName) -> bool:
	for tag in _counts:
		if is_a(tag, query):
			return true
	return false


func has_any(tags: Array[StringName]) -> bool:
	return tags.any(has_tag)


func has_all(tags: Array[StringName]) -> bool:
	return tags.all(has_tag)


func remove_all_under(root: StringName) -> void:  # "cleanse all debuffs"
	for tag in _counts.keys():  # keys() is a copy, so erasing while looping is safe
		if is_a(tag, root):
			_counts.erase(tag)
			changed.emit(tag, false)


# tag_requirement.gd: a reusable requirement, editable in the inspector.
class_name TagRequirement
extends Resource

@export var require_all: Array[StringName] = []
@export var blocked_by_any: Array[StringName] = []


func is_met_by(tags: TagContainer) -> bool:
	return tags.has_all(require_all) and not tags.has_any(blocked_by_any)
```

```cpp [Unreal (C++)]
// Gameplay Tags are built into the engine (GameplayTags module), no GAS needed. Tags are registered in
// Project Settings → Gameplay Tags, or natively in C++ so code can't misspell them:
// GameTags.h
#pragma once

#include "NativeGameplayTags.h"

UE_DECLARE_GAMEPLAY_TAG_EXTERN(TAG_Effect_Debuff);
UE_DECLARE_GAMEPLAY_TAG_EXTERN(TAG_Effect_Debuff_Stun);

// GameTags.cpp
UE_DEFINE_GAMEPLAY_TAG(TAG_Effect_Debuff, "Effect.Debuff");
UE_DEFINE_GAMEPLAY_TAG_COMMENT(TAG_Effect_Debuff_Stun, "Effect.Debuff.Stun", "Can't move or act");

// TagComponent.h: FGameplayTagContainer already does hierarchical queries; this adds counting.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "GameplayTagContainer.h"
#include "GameplayTagAssetInterface.h"
#include "TagComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnTagChanged, FGameplayTag, Tag, bool, bPresent);

UCLASS(ClassGroup = (Gameplay), meta = (BlueprintSpawnableComponent))
class UTagComponent : public UActorComponent, public IGameplayTagAssetInterface
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, Category = "Tags") void AddTag(FGameplayTag Tag);
	UFUNCTION(BlueprintCallable, Category = "Tags") void RemoveTag(FGameplayTag Tag);
	UFUNCTION(BlueprintCallable, Category = "Tags") void RemoveAllUnder(FGameplayTag Root);   // "cleanse all debuffs"

	// The interface adds HasMatchingGameplayTag, HasAllMatchingGameplayTags and HasAnyMatchingGameplayTags.
	virtual void GetOwnedGameplayTags(FGameplayTagContainer& TagContainer) const override { TagContainer = Tags; }

	UPROPERTY(BlueprintAssignable) FOnTagChanged OnTagChanged;                               // (tag, now present)

private:
	TMap<FGameplayTag, int32> Counts;               // how many sources hold each tag
	FGameplayTagContainer Tags;                     // tags with a count above 0, for fast hierarchical queries
};

// A reusable requirement, editable in the details panel.
USTRUCT(BlueprintType)
struct FTagRequirement
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Tags") FGameplayTagContainer RequireAll;
	UPROPERTY(EditAnywhere, Category = "Tags") FGameplayTagContainer BlockedByAny;

	bool IsMetBy(const IGameplayTagAssetInterface& Tags) const
	{
		return Tags.HasAllMatchingGameplayTags(RequireAll) && !Tags.HasAnyMatchingGameplayTags(BlockedByAny);
	}
};

// TagComponent.cpp
#include "TagComponent.h"

void UTagComponent::AddTag(FGameplayTag Tag)
{
	int32& Count = Counts.FindOrAdd(Tag);
	if (Count++ > 0) return;                        // only the first source raises "added"
	Tags.AddTag(Tag);
	OnTagChanged.Broadcast(Tag, true);
}

void UTagComponent::RemoveTag(FGameplayTag Tag)
{
	int32* Count = Counts.Find(Tag);
	if (!Count || --*Count > 0) return;             // another source still holds it
	Counts.Remove(Tag);
	Tags.RemoveTag(Tag);
	OnTagChanged.Broadcast(Tag, false);
}

void UTagComponent::RemoveAllUnder(FGameplayTag Root)
{
	TArray<FGameplayTag> ToRemove;
	for (const TPair<FGameplayTag, int32>& Pair : Counts)
		if (Pair.Key.MatchesTag(Root)) ToRemove.Add(Pair.Key);   // Effect.Debuff.Stun matches Effect.Debuff
	for (const FGameplayTag& Tag : ToRemove)
	{
		Counts.Remove(Tag);
		Tags.RemoveTag(Tag);
		OnTagChanged.Broadcast(Tag, false);
	}
}
```

:::

### Using tags instead of booleans

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class Character : MonoBehaviour
{
    public readonly TagContainer Tags = new();
    [SerializeField] GameplayTag stunTag, debuffTag;
    [SerializeField] TagRequirement canAct;                  // e.g. blockedByAny: [Stun, Frozen, Sleep, Cutscene]

    public bool CanAct => canAct.IsMetBy(Tags);

    public void Cleanse() => Tags.RemoveAllUnder(debuffTag);
}

// A status effect adds its tag on apply and removes it on expiry.
// Two overlapping stuns keep the character stunned until both expire, thanks to counting.
```

```gdscript [Godot (GDScript)]
# character.gd
extends CharacterBody3D

@export var act_requirement: TagRequirement  # e.g. blocked_by_any: Effect.Debuff.Stun, State.Frozen, State.Cutscene

var tags := TagContainer.new()


func can_act() -> bool:
	return act_requirement.is_met_by(tags)


func cleanse() -> void:
	tags.remove_all_under(Tags.DEBUFF)

# A status effect adds its tag on apply and removes it on expiry.
# Two overlapping stuns keep the character stunned until both expire, thanks to counting.
```

```cpp [Unreal (C++)]
// MyCharacter.h (excerpt)
UPROPERTY(VisibleAnywhere, Category = "Tags") TObjectPtr<UTagComponent> Tags;
UPROPERTY(EditAnywhere, Category = "Tags") FTagRequirement CanActRequirement;   // BlockedByAny: Effect.Debuff.Stun, State.Frozen...

bool CanAct() const { return CanActRequirement.IsMetBy(*Tags); }
void Cleanse() { Tags->RemoveAllUnder(TAG_Effect_Debuff); }

// A status effect adds its tag on apply and removes it on expiry.
// Two overlapping stuns keep the character stunned until both expire, thanks to counting.
```

:::

Matching walks up the parent chain (or compares name prefixes) for each held tag, which is fine for a few dozen tags per object. For heavy use, cache each tag's ancestors in a set, or assign tags integer IDs and bitmasks at startup. Unreal's `FGameplayTagContainer` already stores parent tags for fast queries.

**Engine notes**

- **Unity:** the built-in `GameObject.tag` holds one flat string per object, which is why this page builds its own. Tag assets compare by reference, so renaming a tag asset never breaks data that points at it.
- **Godot:** **groups** (`add_to_group`, `is_in_group`, `get_tree().get_nodes_in_group`) are the built-in flat tags, and node **metadata** (`set_meta` / `has_meta`) works for one-off markers. Neither is hierarchical or counted, hence the container above. Renaming a dotted tag means a find-and-replace, so keep the constants in one script.
- **Unreal:** **Gameplay Tags** are built in: hierarchical `FGameplayTag`, `FGameplayTagContainer` with `HasTag` / `HasAll` / `HasAny`, `FGameplayTagQuery` for complex expressions, editor pickers, and redirects for renamed tags. Implementing `IGameplayTagAssetInterface` on actors lets generic code query any actor. With GAS, the Ability System Component already counts tags (loose tags and tags granted by effects), so the counting component is only needed without it.

## When to use

- Status effects, abilities, AI conditions, damage types, factions and interaction rules: anywhere "does this thing have property X?" is asked across systems.
- Data-driven designs, where designers express requirements and immunities without code.

## When not to use

- A few boolean properties. Bools or an enum are type-safe and easier to find.
- Data that needs values, not just presence. A tag says *has fire resistance*, not *how much*; use stats.
- Tags as strings typed by hand everywhere. Typos fail silently; use a registry or constants.

## Pitfalls

- **Tags as a dumping ground.** Hundreds of tags with no structure are as bad as hundreds of booleans. Design the hierarchy, and review new tags.
- **Unbalanced add/remove.** Every `Add` needs exactly one `Remove` from the same source. Tie them to an owner (an effect instance), and remove everything an owner added when it ends.
- **`RemoveAllUnder` versus counting.** Cleansing ignores counts and removes tags that other sources still hold. Either cleanse the *sources* (remove the effects, which remove their tags), or accept that cleansing overrides everything.
- **Renaming string tags.** If you use strings for simplicity, a rename silently breaks data. Asset-based tags survive renames, because references are by asset.
- **Tags instead of data.** Tags answer yes/no questions. "How stunned?" or "stun remaining" belong in the effect, not in more tags.

## Related

- [Status Effects](./status-effects) — the main source of tags.
- [Ability System](./ability-system) — requirements and blocks expressed as tag queries.
- [Damage Pipeline](./damage-pipeline) — immunities and damage types as tags.
- [Type Object](./type-object) and [ScriptableObject Architecture](./scriptable-object-architecture) — tags as assets.
- [Blackboard](./blackboard) — key-value facts, where tags are yes/no facts.
