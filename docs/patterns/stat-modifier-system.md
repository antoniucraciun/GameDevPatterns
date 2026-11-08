# Stat & Modifier System

> Compute final stats from a base value plus ordered flat, additive and multiplicative modifiers.

**Category:** Gameplay Systems

## Problem

A character's damage comes from a base value, a sword (+15), a ring (+10%), a rage buff (+25%) and a curse (×0.5). The bonuses are added and removed at different times, by different systems. If each system adds or subtracts directly from a `damage` field, removing them in a different order gives a different result. Percentage bonuses compound inconsistently, and one missed subtraction leaves the character permanently stronger. Nobody can answer "why is my damage 47?".

## Solution

Never mutate the stat. Store a **base value** and a list of **modifiers**. Each modifier has a value, a type, and a **source** (the item, buff or talent that applied it). The final value is always *derived* by applying the modifiers in a fixed order. A common order is:

1. **Flat:** `base + sum(flat)` (the sword's +15).
2. **Percent additive:** `× (1 + sum(percentAdd))`. The ring's +10% and rage's +25% give ×1.35. Bonuses from the same pool do not compound.
3. **Percent multiplicative:** `× each(percentMult)`. The curse's ×0.5 applies on its own.

Removing a modifier is just removing it from the list. Removing everything from one source, when an item is unequipped or a buff expires, is a single call. Because the result is always recalculated from scratch, the order in which modifiers were added and removed cannot change it.

## Example

The **core** is a stat with a base value, a list of sourced modifiers and a cached result. It needs no engine types, so it can be unit tested on its own. The **engine wiring** turns equipment into modifiers and removes them again by source.

### Core

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;

public enum ModType { Flat = 100, PercentAdd = 200, PercentMult = 300 }   // value = application order

public sealed class StatModifier
{
    public readonly float Value;
    public readonly ModType Type;
    public readonly object Source;   // the item, buff or talent that applied it

    public StatModifier(float value, ModType type, object source)
    {
        Value = value; Type = type; Source = source;
    }
}

public class Stat
{
    readonly List<StatModifier> modifiers = new();
    float baseValue;
    float cached;
    bool dirty = true;

    public event System.Action<Stat> Changed;

    public Stat(float baseValue) => this.baseValue = baseValue;

    public float BaseValue
    {
        get => baseValue;
        set { baseValue = value; MarkDirty(); }
    }

    public float Value
    {
        get
        {
            if (dirty) { cached = Calculate(); dirty = false; }
            return cached;
        }
    }

    public void Add(StatModifier mod) { modifiers.Add(mod); MarkDirty(); }

    public void RemoveAllFrom(object source)
    {
        if (modifiers.RemoveAll(m => m.Source == source) > 0) MarkDirty();
    }

    void MarkDirty() { dirty = true; Changed?.Invoke(this); }

    float Calculate()
    {
        float flat = 0f, percentAdd = 0f, mult = 1f;
        foreach (var m in modifiers)
        {
            switch (m.Type)
            {
                case ModType.Flat:        flat += m.Value; break;
                case ModType.PercentAdd:  percentAdd += m.Value; break;
                case ModType.PercentMult: mult *= 1f + m.Value; break;
            }
        }
        float result = (baseValue + flat) * (1f + percentAdd) * mult;
        return (float)System.Math.Round(result, 4);   // avoid 46.99999 from float drift
    }
}

// Usage:
//   var damage = new Stat(20f);
//   damage.Add(new StatModifier(15f,   ModType.Flat,        sword));
//   damage.Add(new StatModifier(0.10f, ModType.PercentAdd,  ring));
//   damage.Add(new StatModifier(0.25f, ModType.PercentAdd,  rageBuff));
//   damage.Add(new StatModifier(-0.5f, ModType.PercentMult, curse));   // 23.625
//   damage.RemoveAllFrom(curse);                                        // 47.25
```

```gdscript [Godot (GDScript)]
# stat_modifier.gd
class_name StatModifier
extends RefCounted

enum Type { FLAT, PERCENT_ADD, PERCENT_MULT }  # declaration order = application order

var value: float
var type: Type
var source: Object  # the item, buff or talent that applied it


func _init(p_value: float, p_type: Type, p_source: Object) -> void:
	value = p_value
	type = p_type
	source = p_source


# stat.gd
class_name Stat
extends RefCounted

signal changed(stat: Stat)

var base_value: float:
	set(v):
		base_value = v
		_mark_dirty()

var value: float:
	get:
		if _dirty:
			_cached = _calculate()
			_dirty = false
		return _cached

var _modifiers: Array[StatModifier] = []
var _cached := 0.0
var _dirty := true


func _init(p_base_value: float) -> void:
	base_value = p_base_value


func add(mod: StatModifier) -> void:
	_modifiers.append(mod)
	_mark_dirty()


func remove_all_from(source: Object) -> void:
	var removed := false
	for i in range(_modifiers.size() - 1, -1, -1):
		if _modifiers[i].source == source:
			_modifiers.remove_at(i)
			removed = true
	if removed:
		_mark_dirty()


func _mark_dirty() -> void:
	_dirty = true
	changed.emit(self)


func _calculate() -> float:
	var flat := 0.0
	var percent_add := 0.0
	var mult := 1.0
	for m in _modifiers:
		match m.type:
			StatModifier.Type.FLAT:
				flat += m.value
			StatModifier.Type.PERCENT_ADD:
				percent_add += m.value
			StatModifier.Type.PERCENT_MULT:
				mult *= 1.0 + m.value
	return snappedf((base_value + flat) * (1.0 + percent_add) * mult, 0.0001)  # avoid 46.99999


# Usage:
#   var damage := Stat.new(20.0)
#   damage.add(StatModifier.new(15.0, StatModifier.Type.FLAT, sword))
#   damage.add(StatModifier.new(0.10, StatModifier.Type.PERCENT_ADD, ring))
#   damage.add(StatModifier.new(0.25, StatModifier.Type.PERCENT_ADD, rage_buff))
#   damage.add(StatModifier.new(-0.5, StatModifier.Type.PERCENT_MULT, curse))  # 23.625
#   damage.remove_all_from(curse)                                               # 47.25
```

```cpp [Unreal (C++)]
// Stat.h: plain structs (USTRUCT only so Blueprints and the details panel can see them).
#pragma once

#include "CoreMinimal.h"
#include "Stat.generated.h"

UENUM(BlueprintType)
enum class EModType : uint8 { Flat, PercentAdd, PercentMult };   // declaration order = application order

USTRUCT(BlueprintType)
struct FStatModifier
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Stat") float Value = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Stat") EModType Type = EModType::Flat;
	TWeakObjectPtr<const UObject> Source;    // the item, buff or talent that applied it
};

USTRUCT(BlueprintType)
struct FStat
{
	GENERATED_BODY()

	FStat() = default;
	explicit FStat(float InBaseValue) : BaseValue(InBaseValue) {}

	float GetValue() const;
	float GetBaseValue() const { return BaseValue; }
	void SetBaseValue(float NewValue) { BaseValue = NewValue; bDirty = true; }

	void Add(const FStatModifier& Mod) { Modifiers.Add(Mod); bDirty = true; }
	void RemoveAllFrom(const UObject* Source);
	// No change event on a struct: the component that owns the stats broadcasts one.

private:
	UPROPERTY(EditAnywhere, Category = "Stat") float BaseValue = 0.f;
	UPROPERTY() TArray<FStatModifier> Modifiers;
	mutable float Cached = 0.f;
	mutable bool bDirty = true;
};

// Stat.cpp
#include "Stat.h"

void FStat::RemoveAllFrom(const UObject* Source)
{
	if (Modifiers.RemoveAll([Source](const FStatModifier& M) { return M.Source == Source; }) > 0) bDirty = true;
}

float FStat::GetValue() const
{
	if (bDirty)
	{
		float Flat = 0.f, PercentAdd = 0.f, Mult = 1.f;
		for (const FStatModifier& M : Modifiers)
		{
			switch (M.Type)
			{
			case EModType::Flat:        Flat += M.Value; break;
			case EModType::PercentAdd:  PercentAdd += M.Value; break;
			case EModType::PercentMult: Mult *= 1.f + M.Value; break;
			}
		}
		const float Result = (BaseValue + Flat) * (1.f + PercentAdd) * Mult;
		Cached = FMath::RoundToFloat(Result * 10000.f) / 10000.f;   // avoid 46.99999 from float drift
		bDirty = false;
	}
	return Cached;
}

// Usage: FStat Damage(20.f); then Add an FStatModifier per bonus, with Source set to the item or buff,
// and RemoveAllFrom(Curse) when the curse ends.
```

:::

With a sword (+15 flat), a ring (+10%), a rage buff (+25%) and a curse (×0.5), damage is (20 + 15) × 1.35 × 0.5 = 23.625. Removing everything from the curse gives 47.25, whenever the curse was applied.

### Engine wiring

Equipment is data: each item lists its modifiers, and the item itself is the source, so unequipping removes exactly what it added.

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public enum StatType { Damage, Armour, MoveSpeed }

[Serializable]
public struct ItemModifier
{
    public StatType stat;
    public float value;
    public ModType type;
}

[CreateAssetMenu(menuName = "Items/Equipment")]
public class EquipmentItem : ScriptableObject
{
    public ItemModifier[] modifiers;
}

public class CharacterStats : MonoBehaviour
{
    [SerializeField] float baseDamage = 20f, baseArmour = 0f, baseMoveSpeed = 5f;
    readonly Dictionary<StatType, Stat> stats = new();

    public Stat this[StatType type] => stats[type];

    void Awake()
    {
        stats[StatType.Damage] = new Stat(baseDamage);
        stats[StatType.Armour] = new Stat(baseArmour);
        stats[StatType.MoveSpeed] = new Stat(baseMoveSpeed);
    }

    // The asset is the source. If the same asset can be equipped twice (two identical rings),
    // use a per-item instance object as the source instead.
    public void Equip(EquipmentItem item)
    {
        foreach (var m in item.modifiers)
            stats[m.stat].Add(new StatModifier(m.value, m.type, item));
    }

    public void Unequip(EquipmentItem item)
    {
        foreach (var stat in stats.Values) stat.RemoveAllFrom(item);
    }
}

// HUD: characterStats[StatType.Damage].Changed += s => damageLabel.text = s.Value.ToString("0.#");
```

```gdscript [Godot (GDScript)]
# item_modifier.gd
class_name ItemModifier
extends Resource

@export var stat: StringName = &"damage"
@export var value := 0.0
@export var type := StatModifier.Type.FLAT


# equipment_item.gd: one .tres per item, made in the inspector.
class_name EquipmentItem
extends Resource

@export var display_name := ""
@export var modifiers: Array[ItemModifier] = []


# character_stats.gd: a child node of the character.
class_name CharacterStats
extends Node

@export var base_values := {&"damage": 20.0, &"armour": 0.0, &"move_speed": 5.0}

var _stats := {}  # StringName -> Stat


func _ready() -> void:
	for id in base_values:
		_stats[id] = Stat.new(base_values[id])


func get_stat(id: StringName) -> Stat:
	return _stats[id]


# The resource is the source. Resources loaded from one path are shared, so two copies of the
# same ring are one source: duplicate() the item when it is picked up if that matters.
func equip(item: EquipmentItem) -> void:
	for m in item.modifiers:
		_stats[m.stat].add(StatModifier.new(m.value, m.type, item))


func unequip(item: EquipmentItem) -> void:
	for stat in _stats.values():
		stat.remove_all_from(item)

# HUD: stats.get_stat(&"damage").changed.connect(func(s: Stat) -> void: label.text = "%.1f" % s.value)
```

```cpp [Unreal (C++)]
// CharacterAttributeSet.h: with the Gameplay Ability System, each stat is an attribute
// and GAS runs the modifier maths. Needs the GameplayAbilities, GameplayTags and GameplayTasks modules.
#pragma once

#include "CoreMinimal.h"
#include "AttributeSet.h"
#include "AbilitySystemComponent.h"
#include "CharacterAttributeSet.generated.h"

#define ATTRIBUTE_ACCESSORS(ClassName, PropertyName) \
	GAMEPLAYATTRIBUTE_PROPERTY_GETTER(ClassName, PropertyName) \
	GAMEPLAYATTRIBUTE_VALUE_GETTER(PropertyName) \
	GAMEPLAYATTRIBUTE_VALUE_SETTER(PropertyName) \
	GAMEPLAYATTRIBUTE_VALUE_INITTER(PropertyName)

UCLASS()
class UCharacterAttributeSet : public UAttributeSet
{
	GENERATED_BODY()

public:
	UPROPERTY(BlueprintReadOnly, Category = "Stats") FGameplayAttributeData Damage;
	ATTRIBUTE_ACCESSORS(UCharacterAttributeSet, Damage)

	UPROPERTY(BlueprintReadOnly, Category = "Stats") FGameplayAttributeData Armour;
	ATTRIBUTE_ACCESSORS(UCharacterAttributeSet, Armour)

	UPROPERTY(BlueprintReadOnly, Category = "Stats") FGameplayAttributeData MoveSpeed;
	ATTRIBUTE_ACCESSORS(UCharacterAttributeSet, MoveSpeed)
};

// ItemDefinition.h: an item's modifiers live in an Infinite-duration Gameplay Effect,
// e.g. GE_Sword with Modifiers: Damage Add 15.
UCLASS()
class UItemDefinition : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditDefaultsOnly, Category = "Item") TSubclassOf<UGameplayEffect> StatEffect;
};

// EquipmentComponent.h
UCLASS(ClassGroup = (Gameplay), meta = (BlueprintSpawnableComponent))
class UEquipmentComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, Category = "Equipment") void Equip(UItemDefinition* Item);
	UFUNCTION(BlueprintCallable, Category = "Equipment") void Unequip(UItemDefinition* Item);

private:
	// The effect handle plays the role of the source: removing it removes exactly what the item added.
	UPROPERTY() TMap<TObjectPtr<UItemDefinition>, FActiveGameplayEffectHandle> Equipped;
};

// EquipmentComponent.cpp
#include "EquipmentComponent.h"
#include "AbilitySystemGlobals.h"
#include "AbilitySystemComponent.h"

void UEquipmentComponent::Equip(UItemDefinition* Item)
{
	UAbilitySystemComponent* ASC = UAbilitySystemGlobals::GetAbilitySystemComponentFromActor(GetOwner());
	if (!ASC || !Item || !Item->StatEffect || Equipped.Contains(Item)) return;

	FGameplayEffectContextHandle Context = ASC->MakeEffectContext();
	Context.AddSourceObject(Item);                               // shows up in tooltips and the GAS debugger
	const FGameplayEffectSpecHandle Spec = ASC->MakeOutgoingSpec(Item->StatEffect, 1.f, Context);
	Equipped.Add(Item, ASC->ApplyGameplayEffectSpecToSelf(*Spec.Data.Get()));
}

void UEquipmentComponent::Unequip(UItemDefinition* Item)
{
	UAbilitySystemComponent* ASC = UAbilitySystemGlobals::GetAbilitySystemComponentFromActor(GetOwner());
	FActiveGameplayEffectHandle Handle;
	if (ASC && Equipped.RemoveAndCopyValue(Item, Handle)) ASC->RemoveActiveGameplayEffect(Handle);
}

// HUD: ASC->GetGameplayAttributeValueChangeDelegate(UCharacterAttributeSet::GetDamageAttribute())
//          .AddUObject(this, &UStatsWidget::OnDamageChanged);   // void OnDamageChanged(const FOnAttributeChangeData&)
```

:::

**Engine notes**

- **Unity:** there is no built-in stat system. The core is plain C#, so it runs in Edit Mode tests; `object Source` compares by reference, which is why a ScriptableObject asset or a buff instance works as a source.
- **Godot:** no built-in stat system either. `snappedf` does the rounding. Resources make good sources because they compare by identity, but resources loaded from the same path are one shared instance (see the comment in `equip`).
- **Unreal:** in a GAS project, attributes and Gameplay Effects *are* this pattern. GAS evaluates each attribute as `((Base + Add) × Multiply) / Divide`, and Multiply modifiers on one attribute are summed as bonuses (two ×1.1 give ×1.2, like `PercentAdd`), so a separate multiplicative pool like `PercentMult` needs a Modifier Magnitude Calculation or an execution. Without GAS, the lighter option is the core `FStat` above, kept in a `UActorComponent` with a `TMap<FName, FStat>` and a change delegate.

## When to use

- RPGs, roguelikes, ARPGs and survival games: anywhere equipment, buffs, talents and auras affect numbers.
- When the design needs to show players a breakdown of where a number comes from.

## When not to use

- Games where stats are only changed by levelling up. Plain numbers are simpler.
- A few temporary bonuses. A field like `speedMultiplier` is enough.
- When there's no plan to show players how a value is built up. The breakdown is half the reason for the system.

## Pitfalls

- **Undocumented stacking rules.** Designers must know whether two +10% bonuses make +20% or +21%. Pick the rules, write them down, and show them in tooltips.
- **Removing by value instead of by source.** Two items that both give +5 become indistinguishable. Always tag modifiers with their source.
- **Clamping too early.** Clamp the *final* value, such as minimum 0 or maximum 75% resistance, not intermediate sums.
- **Stats that depend on other stats**, such as "+1% crit per 10 agility". Recompute the dependent stat when its input fires `Changed`, and watch for cycles.

## Related

- [Dirty Flag](./dirty-flag) — avoids recalculating on every read.
- [Observer](./observer) — the `Changed` event lets UI and dependent stats update.
- [Flyweight](./flyweight) — shared definitions describe which modifiers an item grants.
