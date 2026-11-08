# Dirty Flag

> Defer expensive recalculation until a result is actually needed.

**Category:** Performance & Memory

## Problem

A character's final stats depend on base values, equipment, buffs and talents. Recomputing them every frame wastes work, because they change only a few times a minute. Recomputing them on every change is also wasteful: equipping a full gear set triggers ten recalculations when only the last one matters.

## Solution

Store the derived value in a cache, together with a boolean **dirty flag**. Whenever an input changes, set the flag; do not recompute. When someone reads the derived value, recompute it only if the flag is set, then clear the flag. Many changes between reads collapse into one recalculation, and if nothing reads the value, nothing is computed.

## Pseudocode

```text
CharacterStats:
    base_damage
    modifiers          // each is flat (+value) or percent (+value × 100%)
    cached_damage      // the derived value, valid only while not dirty
    dirty ← true       // nothing computed yet

    // Every input change only raises the flag.
    set_base_damage(value):
        base_damage ← value
        dirty ← true
    add_modifier(m):
        add m to modifiers
        dirty ← true
    remove_modifier(m):
        remove m from modifiers
        dirty ← true

    // The read recomputes at most once per batch of changes.
    damage():
        if dirty:
            cached_damage ← recalculate()
            dirty ← false
        return cached_damage

    recalculate():
        flat ← 0, percent ← 0
        for each modifier m:
            if m is flat: flat ← flat + m.value
            else:         percent ← percent + m.value
        return (base_damage + flat) × (1 + percent)
```

## Example

Damage derived from a base value and a list of modifiers. Setters only raise the flag; the getter recomputes at most once per batch of changes. This is plain logic, so each tab is engine-independent apart from the language:

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;

public enum ModType { Flat, Percent }
public readonly struct StatModifier
{
    public readonly ModType Type;
    public readonly float Value;
    public StatModifier(ModType type, float value) { Type = type; Value = value; }
}

public class CharacterStats
{
    readonly List<StatModifier> modifiers = new();
    float baseDamage = 10f;

    float cachedDamage;
    bool dirty = true;

    public float BaseDamage
    {
        get => baseDamage;
        set { baseDamage = value; dirty = true; }
    }

    public void AddModifier(StatModifier m)    { modifiers.Add(m); dirty = true; }
    public void RemoveModifier(StatModifier m) { modifiers.Remove(m); dirty = true; }

    public float Damage
    {
        get
        {
            if (dirty)
            {
                cachedDamage = Recalculate();
                dirty = false;
            }
            return cachedDamage;
        }
    }

    float Recalculate()
    {
        float flat = 0f, percent = 0f;
        foreach (var m in modifiers)
        {
            if (m.Type == ModType.Flat) flat += m.Value;
            else percent += m.Value;
        }
        return (baseDamage + flat) * (1f + percent);
    }
}
```

```gdscript [Godot (GDScript)]
# stat_modifier.gd: modifiers are Resources, so items can carry them as assets.
class_name StatModifier
extends Resource

enum Type { FLAT, PERCENT }

@export var type := Type.FLAT
@export var value := 0.0


# character_stats.gd
class_name CharacterStats
extends RefCounted

var base_damage := 10.0:
	set(v):
		base_damage = v
		_dirty = true

var damage: float:
	get:
		if _dirty:
			_cached_damage = _recalculate()
			_dirty = false
		return _cached_damage

var _modifiers: Array[StatModifier] = []
var _cached_damage := 0.0
var _dirty := true


func add_modifier(m: StatModifier) -> void:
	_modifiers.append(m)
	_dirty = true


func remove_modifier(m: StatModifier) -> void:
	_modifiers.erase(m)
	_dirty = true


func _recalculate() -> float:
	var flat := 0.0
	var percent := 0.0
	for m in _modifiers:
		if m.type == StatModifier.Type.FLAT:
			flat += m.value
		else:
			percent += m.value
	return (base_damage + flat) * (1.0 + percent)
```

```cpp [Unreal (C++)]
// CharacterStats.h: plain C++, no UObject needed.
#pragma once

#include "CoreMinimal.h"

enum class EModType : uint8 { Flat, Percent };

struct FStatModifier
{
	EModType Type = EModType::Flat;
	float Value = 0.f;

	bool operator==(const FStatModifier& Other) const { return Type == Other.Type && Value == Other.Value; }
};

class FCharacterStats
{
public:
	float GetBaseDamage() const { return BaseDamage; }
	void SetBaseDamage(float Value) { BaseDamage = Value; bDirty = true; }

	void AddModifier(const FStatModifier& M)    { Modifiers.Add(M); bDirty = true; }
	void RemoveModifier(const FStatModifier& M) { Modifiers.RemoveSingle(M); bDirty = true; }

	float GetDamage() const
	{
		if (bDirty)
		{
			CachedDamage = Recalculate();
			bDirty = false;
		}
		return CachedDamage;
	}

private:
	float Recalculate() const
	{
		float Flat = 0.f, Percent = 0.f;
		for (const FStatModifier& M : Modifiers)
		{
			if (M.Type == EModType::Flat) Flat += M.Value;
			else Percent += M.Value;
		}
		return (BaseDamage + Flat) * (1.f + Percent);
	}

	TArray<FStatModifier> Modifiers;
	float BaseDamage = 10.f;

	mutable float CachedDamage = 0.f;   // a cache, so the const getter may update it
	mutable bool bDirty = true;
};
```

:::

**Engine notes**

- **Unity:** the engine uses this pattern internally. Transform world matrices are recomputed only when a parent changes, and UI layout is rebuilt only for elements marked dirty (`LayoutRebuilder.MarkLayoutForRebuild`).
- **Godot:** the same goes for global transforms and `Control` layout. `queue_redraw()` is a dirty flag for `_draw()`: call it as often as you like and the node redraws once. Because `StatModifier` is a shared Resource, editing a modifier's `value` after adding it does not raise the flag; connect to the Resource's `changed` signal (and call `emit_changed()` in its setters) if modifiers can change in place.
- **Unreal:** `MarkRenderStateDirty()` on a component works the same way: the render state is rebuilt once at the end of the frame, however often it is called. In C++, `mutable` keeps the getter `const` while it updates the cache.

## When to use

- A derived value is expensive to compute, its inputs change less often than it is read, or many changes happen between reads.
- Hierarchies such as transforms, UI layout and navigation meshes, where a change in one node invalidates its descendants.

## When not to use

- Values that are cheap to compute. Recomputing every time is simpler and never stale.
- Values that change every frame anyway. The flag is always set, so it saves nothing.
- When many places change the inputs. Forgetting to set the flag in one of them leaves stale data that is hard to track down.

## Pitfalls

- **Forgetting to set the flag** on one of the input paths gives you stale results that are hard to track down. Route every mutation through one place.
- **Unpredictable cost.** The recomputation happens on whatever read comes first, which may be in a hot loop. Sometimes it is better to recompute at a known time, such as end of frame.
- **Not worth it for cheap calculations.** The flag and the branch can cost more than recomputing.

## Related

- [Stat & Modifier System](./stat-modifier-system) — the classic consumer of this pattern.
- [Memoization / Caching](./memoization) — caches by input values rather than with an invalidation flag.
- [Observer](./observer) — can be used to mark dependants dirty.
