# Status Effects

> Timed buffs and debuffs with stacking, refresh and tick rules.

**Also known as:** Buffs/Debuffs · **Category:** Gameplay Systems

## Problem

Poison deals damage every second for 6 seconds. Haste gives +30% move speed for 10 seconds. A stun prevents acting. Then the questions start. What happens when poison is applied again while active: reset the timer, add the durations, or stack the damage? Can two players' poisons both tick? What removes "all debuffs"? Implemented as ad-hoc coroutines and boolean fields, every new effect adds special cases. Modifiers are left behind when an effect ends early, and nobody can show the player what is currently affecting them.

## Solution

Separate **what an effect is** from **an effect currently applied**:

- **`StatusEffectDefinition`** (a [Type Object](./type-object)): name, icon, duration, tick interval, stacking policy, max stacks, stat modifiers, per-tick action, and tags such as `Debuff` or `Stun`.
- **`ActiveEffect`**: one application on one target, with its remaining time, stack count, next tick time and source.
- **`StatusEffectContainer`** on each target: applies new effects according to the stacking policy, ticks them, and removes expired ones, which undoes their modifiers.

Make the **stacking policy** an explicit choice per definition:

| Policy | Re-applying while active… | Typical use |
| --- | --- | --- |
| **Refresh** | Resets the remaining duration | Slows, most buffs |
| **Extend** | Adds the new duration to the remaining one | Fire that burns longer |
| **Stack intensity** | Adds a stack (up to a maximum) and refreshes duration | Bleed, poison that gets worse |
| **Independent** | Creates a separate instance, one per source | DoTs from different players |
| **Ignore** | Does nothing | Immunity windows, unique effects |

## Example

Effect definitions are data assets; a container on each character holds the active instances, applies the stacking policy, ticks damage and adds stat modifiers that it removes again when the effect ends. Health is from the [Health / Damageable](./health-component) page, and the stats from the [Stat & Modifier System](./stat-modifier-system).

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public enum StackPolicy { Refresh, Extend, StackIntensity, Independent, Ignore }

[CreateAssetMenu(menuName = "Effects/Status Effect")]
public class StatusEffectDefinition : ScriptableObject
{
    public string displayName;
    public Sprite icon;
    public float duration = 5f;
    public float tickInterval = 1f;             // 0 = no ticking
    public StackPolicy stacking = StackPolicy.Refresh;
    public int maxStacks = 1;
    public string[] tags;                       // e.g. "Debuff", "Stun", "Poison"

    [Header("Per tick (multiplied by stacks)")]
    public int damagePerTick;

    [Header("While active (multiplied by stacks)")]
    public float moveSpeedPercent;              // e.g. -0.3 for a 30% slow

    public bool HasTag(string tag) => Array.IndexOf(tags, tag) >= 0;
}

public class ActiveEffect
{
    public readonly StatusEffectDefinition Definition;
    public readonly object Source;              // who applied it: used by Independent stacking
    public float Remaining;
    public int Stacks = 1;
    public float NextTick;

    public ActiveEffect(StatusEffectDefinition def, object source)
    {
        Definition = def; Source = source;
        Remaining = def.duration;
        NextTick = def.tickInterval;
    }
}

public class StatusEffectContainer : MonoBehaviour
{
    readonly List<ActiveEffect> active = new();
    Health health;                              // something that can take damage
    CharacterStats stats;                       // see the Stat & Modifier System pattern

    public IReadOnlyList<ActiveEffect> Active => active;
    public event Action Changed;                // UI icons, VFX

    public void Init(Health health, CharacterStats stats) { this.health = health; this.stats = stats; }

    public bool HasTag(string tag) => active.Exists(e => e.Definition.HasTag(tag));

    public void Apply(StatusEffectDefinition def, object source)
    {
        var existing = def.stacking == StackPolicy.Independent
            ? active.Find(e => e.Definition == def && e.Source == source)
            : active.Find(e => e.Definition == def);

        if (existing == null)
        {
            var effect = new ActiveEffect(def, source);
            active.Add(effect);
            ApplyModifiers(effect);
        }
        else
        {
            switch (def.stacking)
            {
                case StackPolicy.Refresh:
                case StackPolicy.Independent:          // same source re-applies: refresh its instance
                    existing.Remaining = def.duration;
                    break;
                case StackPolicy.Extend:
                    existing.Remaining += def.duration;
                    break;
                case StackPolicy.StackIntensity:
                    existing.Stacks = Mathf.Min(existing.Stacks + 1, def.maxStacks);
                    existing.Remaining = def.duration;
                    ApplyModifiers(existing);           // re-apply with the new stack count
                    break;
                case StackPolicy.Ignore:
                    return;
            }
        }
        Changed?.Invoke();
    }

    public void RemoveWhere(Predicate<ActiveEffect> match)   // e.g. cleanse: e => e.Definition.HasTag("Debuff")
    {
        for (int i = active.Count - 1; i >= 0; i--)
            if (match(active[i])) Remove(i);
        Changed?.Invoke();
    }

    void Update()
    {
        float dt = Time.deltaTime;
        bool changed = false;

        for (int i = active.Count - 1; i >= 0; i--)
        {
            var e = active[i];
            var def = e.Definition;

            if (def.tickInterval > 0f)
            {
                e.NextTick -= dt;
                while (e.NextTick <= 0f && e.Remaining > 0f)    // catch up after long frames
                {
                    health.TakeDamage(def.damagePerTick * e.Stacks);
                    e.NextTick += def.tickInterval;
                }
            }

            if ((e.Remaining -= dt) <= 0f) { Remove(i); changed = true; }
        }

        if (changed) Changed?.Invoke();
    }

    void ApplyModifiers(ActiveEffect e)
    {
        stats[StatType.MoveSpeed].RemoveAllFrom(e);            // the effect instance is the source
        if (e.Definition.moveSpeedPercent != 0f)
            stats[StatType.MoveSpeed].Add(new StatModifier(
                e.Definition.moveSpeedPercent * e.Stacks, ModType.PercentAdd, e, e.Definition.displayName));
    }

    void Remove(int index)
    {
        var e = active[index];
        stats[StatType.MoveSpeed].RemoveAllFrom(e);            // nothing is left behind
        active.RemoveAt(index);
    }
}

// Elsewhere: gameplay checks tags instead of bespoke booleans.
// if (target.Effects.HasTag("Stun")) return;   // can't act
```

```gdscript [Godot (GDScript)]
# status_effect_definition.gd: one .tres per effect (poison.tres, slow.tres...).
class_name StatusEffectDefinition
extends Resource

enum StackPolicy { REFRESH, EXTEND, STACK_INTENSITY, INDEPENDENT, IGNORE }

@export var display_name := ""
@export var icon: Texture2D
@export var duration := 5.0
@export var tick_interval := 1.0  # 0 = no ticking
@export var stacking := StackPolicy.REFRESH
@export var max_stacks := 1
@export var tags: Array[StringName] = []  # e.g. &"debuff", &"stun", &"poison"

@export_group("Per tick (multiplied by stacks)")
@export var damage_per_tick := 0.0
@export var damage_type := DamageInfo.Type.POISON

@export_group("While active (multiplied by stacks)")
@export var move_speed_percent := 0.0  # e.g. -0.3 for a 30% slow


func has_tag(tag: StringName) -> bool:
	return tag in tags


# active_effect.gd
class_name ActiveEffect
extends RefCounted

var definition: StatusEffectDefinition
var source: Object  # who applied it: used by INDEPENDENT stacking
var remaining: float
var stacks := 1
var next_tick: float


func _init(def: StatusEffectDefinition, p_source: Object) -> void:
	definition = def
	source = p_source
	remaining = def.duration
	next_tick = def.tick_interval


# status_effects.gd: a child node named StatusEffects.
class_name StatusEffects
extends Node

signal changed  # UI icons, VFX

@export var health: Health
@export var stats: CharacterStats  # see the Stat & Modifier System pattern

var active: Array[ActiveEffect] = []


func has_tag(tag: StringName) -> bool:
	return active.any(func(e: ActiveEffect) -> bool: return e.definition.has_tag(tag))


func apply(def: StatusEffectDefinition, source: Object) -> void:
	var independent := def.stacking == StatusEffectDefinition.StackPolicy.INDEPENDENT
	var existing: ActiveEffect = null
	for e in active:
		if e.definition == def and (not independent or e.source == source):
			existing = e
			break

	if existing == null:
		var effect := ActiveEffect.new(def, source)
		active.append(effect)
		_apply_modifiers(effect)
	else:
		match def.stacking:
			StatusEffectDefinition.StackPolicy.REFRESH, StatusEffectDefinition.StackPolicy.INDEPENDENT:
				existing.remaining = def.duration  # same source re-applies: refresh its instance
			StatusEffectDefinition.StackPolicy.EXTEND:
				existing.remaining += def.duration
			StatusEffectDefinition.StackPolicy.STACK_INTENSITY:
				existing.stacks = mini(existing.stacks + 1, def.max_stacks)
				existing.remaining = def.duration
				_apply_modifiers(existing)  # re-apply with the new stack count
			StatusEffectDefinition.StackPolicy.IGNORE:
				return
	changed.emit()


# e.g. cleanse: remove_where(func(e: ActiveEffect) -> bool: return e.definition.has_tag(&"debuff"))
func remove_where(predicate: Callable) -> void:
	for i in range(active.size() - 1, -1, -1):
		if predicate.call(active[i]):
			_remove(i)
	changed.emit()


func _process(delta: float) -> void:
	var any_removed := false
	for i in range(active.size() - 1, -1, -1):
		var e := active[i]
		var def := e.definition
		if def.tick_interval > 0.0:
			e.next_tick -= delta
			while e.next_tick <= 0.0 and e.remaining > 0.0:  # catch up after long frames
				health.take_damage(DamageInfo.new(def.damage_per_tick * e.stacks, def.damage_type))
				e.next_tick += def.tick_interval
		e.remaining -= delta
		if e.remaining <= 0.0:
			_remove(i)
			any_removed = true
	if any_removed:
		changed.emit()


func _apply_modifiers(e: ActiveEffect) -> void:
	var speed := stats.get_stat(&"move_speed")
	speed.remove_all_from(e)  # the effect instance is the source
	if e.definition.move_speed_percent != 0.0:
		speed.add(StatModifier.new(e.definition.move_speed_percent * e.stacks, StatModifier.Type.PERCENT_ADD, e))


func _remove(index: int) -> void:
	stats.get_stat(&"move_speed").remove_all_from(active[index])  # nothing is left behind
	active.remove_at(index)

# Elsewhere: gameplay checks tags instead of bespoke booleans.
# if target.get_node("StatusEffects").has_tag(&"stun"): return  # can't act
```

```cpp [Unreal (C++)]
// With the Gameplay Ability System, a status effect is a Gameplay Effect asset, set up in the editor.
// GE_Poison (Blueprint subclass of UGameplayEffect):
//   Duration Policy  Has Duration, 5 s
//   Period           1 s                       ticks the modifiers / executions every second
//   Modifiers        Health, Add, -4           (or a damage execution: see the Damage Pipeline page)
//   Stacking         Aggregate by Target, Stack Limit Count 5, Stack Duration Refresh: on successful application
//   Components       Grant Tags to Target Actor: Effect.Debuff, Effect.Poison   (UE 5.3+; before: Granted Tags)
// GE_Slow: Has Duration 3 s, Modifiers MoveSpeed Multiply 0.7, no period; the modifier is removed with it.
//
// StatusEffectComponent.h: a thin wrapper so gameplay code doesn't talk to GAS directly.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "GameplayEffectTypes.h"
#include "StatusEffectComponent.generated.h"

class UAbilitySystemComponent;
class UGameplayEffect;

UCLASS(ClassGroup = (Gameplay), meta = (BlueprintSpawnableComponent))
class UStatusEffectComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	// Source: who applied it. Its ASC applies the effect, so Aggregate by Source stacking and credit work.
	UFUNCTION(BlueprintCallable, Category = "Effects")
	FActiveGameplayEffectHandle Apply(TSubclassOf<UGameplayEffect> Effect, AActor* Source);

	UFUNCTION(BlueprintCallable, Category = "Effects")
	int32 RemoveWithTags(FGameplayTagContainer Tags);          // cleanse: Effect.Debuff

	UFUNCTION(BlueprintPure, Category = "Effects")
	bool HasTag(FGameplayTag Tag) const;

	DECLARE_MULTICAST_DELEGATE(FOnEffectsChanged);
	FOnEffectsChanged OnChanged;                                // UI icons, VFX

protected:
	virtual void BeginPlay() override;

private:
	UAbilitySystemComponent* GetASC() const;
};

// StatusEffectComponent.cpp
#include "StatusEffectComponent.h"
#include "AbilitySystemGlobals.h"
#include "AbilitySystemComponent.h"

UAbilitySystemComponent* UStatusEffectComponent::GetASC() const
{
	return UAbilitySystemGlobals::GetAbilitySystemComponentFromActor(GetOwner());
}

void UStatusEffectComponent::BeginPlay()
{
	Super::BeginPlay();
	if (UAbilitySystemComponent* ASC = GetASC())
	{
		ASC->OnActiveGameplayEffectAddedDelegateToSelf.AddWeakLambda(this,
			[this](UAbilitySystemComponent*, const FGameplayEffectSpec&, FActiveGameplayEffectHandle) { OnChanged.Broadcast(); });
		ASC->OnAnyGameplayEffectRemovedDelegate().AddWeakLambda(this,
			[this](const FActiveGameplayEffect&) { OnChanged.Broadcast(); });
	}
}

FActiveGameplayEffectHandle UStatusEffectComponent::Apply(TSubclassOf<UGameplayEffect> Effect, AActor* Source)
{
	UAbilitySystemComponent* Target = GetASC();
	UAbilitySystemComponent* Applier = UAbilitySystemGlobals::GetAbilitySystemComponentFromActor(Source);
	if (!Applier) Applier = Target;                             // environment hazards apply to themselves
	if (!Target || !Effect) return FActiveGameplayEffectHandle();

	FGameplayEffectContextHandle Context = Applier->MakeEffectContext();
	Context.AddSourceObject(Source);
	const FGameplayEffectSpecHandle Spec = Applier->MakeOutgoingSpec(Effect, 1.f, Context);
	return Applier->ApplyGameplayEffectSpecToTarget(*Spec.Data.Get(), Target);
}

int32 UStatusEffectComponent::RemoveWithTags(FGameplayTagContainer Tags)
{
	UAbilitySystemComponent* ASC = GetASC();
	return ASC ? ASC->RemoveActiveEffectsWithGrantedTags(Tags) : 0;
}

bool UStatusEffectComponent::HasTag(FGameplayTag Tag) const
{
	const UAbilitySystemComponent* ASC = GetASC();
	return ASC && ASC->HasMatchingGameplayTag(Tag);
}

// Elsewhere: gameplay checks tags instead of bespoke booleans.
// if (Effects->HasTag(FGameplayTag::RequestGameplayTag(TEXT("Effect.Stun")))) return;   // can't act
```

:::

`CharacterStats`, `StatModifier` and `ModType` in the Unity tab are from the [RPG Character Sheet](../recipes/rpg-character-sheet) recipe, with a `MoveSpeed` entry added to `StatType`.

**Engine notes**

- **Unity:** no built-in status effects. The definitions are ScriptableObjects, so they are shared: everything per-instance (remaining time, stacks) lives in `ActiveEffect`, never on the asset.
- **Godot:** no built-in either. `StatusEffectDefinition` resources are shared the same way, so the same rule applies. `_process` stops while the tree is paused, which is usually what you want for effect timers.
- **Unreal:** Gameplay Effects cover duration, periodic ticks, stacking (by source or by target, stack limit, refresh or keep duration), granted tags, immunity and cleansing by tag. Of the policies here, Refresh, StackIntensity (modifiers are multiplied by the stack count) and Independent (no stacking, or Aggregate by Source) map directly; Extend has no direct setting and needs custom code. For a small game without GAS, a component like the Unity and Godot tabs is lighter and easier to debug.

## When to use

- Any game with buffs, debuffs, damage-over-time, crowd control, auras or temporary power-ups.
- When designers need to create effects without code, and players need to see what affects them.

## When not to use

- A single temporary effect, such as an invincibility timer after being hit. A timer field is enough.
- Effects that only change numbers. A [Stat & Modifier System](./stat-modifier-system) entry with a duration may be all you need.

## Pitfalls

- **Leftover modifiers.** Every path that ends an effect (expiry, cleanse, death, removal of the target) must remove its modifiers. Funnel all of them through one `Remove` method, and tag modifiers with the effect instance as source.
- **Ticks tied to frame rate.** Decrementing by `deltaTime` without a catch-up loop loses ticks on long frames, and ticking in `Update` makes long poisons frame-rate dependent. Use the accumulator above, or tick on a fixed step.
- **Undefined stacking.** "What happens on re-apply?" must be decided per effect and visible to designers, not left to whatever the code happens to do.
- **Effects outliving their source.** An aura should end when its caster dies. Store the source, and remove its effects when the source goes away.
- **Order-dependent interactions.** Rules like "frozen + fire = shatter" belong in one explicit interaction step, not scattered across `Apply` calls.

## Related

- [Stat & Modifier System](./stat-modifier-system) — effects contribute modifiers tagged with themselves as source.
- [Type Object](./type-object) — effect definitions are kinds defined as data.
- [Ability System](./ability-system) — abilities apply effects to targets.
- [Observer](./observer) — `Changed` drives the buff bar and VFX.
- [Gameplay Tags](./tags) — hierarchical tags such as `Debuff.Poison` make queries like "remove all debuffs" simple.
