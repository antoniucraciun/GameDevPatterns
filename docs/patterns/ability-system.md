# Ability System

> Data-driven abilities with costs, cooldowns, targeting and effects.

**Category:** Gameplay Systems

## Problem

The first abilities are each a method: `CastFireball()`, `CastHeal()`, `Dash()`. Each one repeats the same checks (enough mana? off cooldown? not stunned? target in range?) slightly differently, and slightly wrong in different ways. Enemies cannot reuse the player's abilities, the UI cannot show why a button is greyed out, and every new spell needs a programmer, even "Fireball, but ice, with a slow".

## Solution

Split an ability into **data** and a **runner**:

- **`AbilityDefinition`** (a [Type Object](./type-object)): name, icon, cost, cooldown, range, targeting mode, tags that block it (`Stun`, `Silence`), and an ordered list of **effects**.
- **Effects** are small, reusable, composable pieces: *deal damage*, *heal*, *apply status effect*, *knock back*, *spawn projectile*. "Ice bolt" is *damage + apply Slow*, assembled by a designer from existing parts.
- **`AbilityRunner`** on any character (player or AI): owns cooldowns and resources, runs **one** shared validation path, pays the cost, starts the cooldown, and executes the effects with a context describing caster and target.

Validation returns a **reason** rather than a bare `false`, so the UI can say "Not enough mana" and the AI can choose something else.

```
TryActivate(ability, target)
  ├─ CanActivate? ── OnCooldown / NotEnoughMana / Blocked(Stun) / OutOfRange / InvalidTarget
  ├─ pay cost, start cooldown
  └─ foreach effect: effect.Apply(context)   ── Damage, ApplyStatus, Heal, …
```

## Pseudocode

```text
AbilityDefinition:          // data, made by designers
    mana_cost, cooldown, range
    targeting               // self, enemy or ally
    blocked_by_tags         // e.g. stun, silence
    effects                 // ordered list: damage, heal, apply status…

AbilityRunner:              // on every character, player or AI
    mana, team
    ready_at[ability]       // the time each ability comes off cooldown

    can_activate(ability, target):       // the one shared check
        if now < ready_at[ability]: return OnCooldown
        if mana < ability.mana_cost: return NotEnoughMana
        if this character has any of ability.blocked_by_tags: return Blocked
        if ability.targeting is self: target ← this runner
        if target is missing, or on the wrong team for the targeting:
            return InvalidTarget
        if distance to target > ability.range: return OutOfRange
        return Success

    try_activate(ability, target):
        result ← can_activate(ability, target)
        if result is not Success: return result   // the UI shows it, the AI picks again
        if ability.targeting is self: target ← this runner
        mana ← mana - ability.mana_cost
        ready_at[ability] ← now + ability.cooldown
        context ← (caster: this runner, target, ability)
        for each effect in ability.effects:
            effect.apply(context)       // e.g. damage 20, then apply Slow
        announce activated(ability, target)      // animation, VFX, audio
        return Success
```

## Example

### Definitions and effects

An ability is data: cost, cooldown, range, targeting, the tags that block it, and a list of effects. Health is from the [Health / Damageable](./health-component) page, and status effects from [Status Effects](./status-effects).

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public enum Targeting { Self, Enemy, Ally }
public enum ActivationResult { Success, OnCooldown, NotEnoughMana, Blocked, OutOfRange, InvalidTarget }

public struct AbilityContext
{
    public AbilityRunner Caster;
    public AbilityRunner Target;
    public AbilityDefinition Ability;
}

[Serializable]
public abstract class AbilityEffect
{
    public abstract void Apply(in AbilityContext ctx);
}

[Serializable]
public class DamageEffect : AbilityEffect
{
    public int amount = 10;
    public override void Apply(in AbilityContext ctx) =>
        ctx.Target.Health.TakeDamage(new DamageInfo { Amount = amount, Type = DamageType.Physical, Source = ctx.Caster.gameObject });
}

[Serializable]
public class HealEffect : AbilityEffect
{
    public int amount = 10;
    public override void Apply(in AbilityContext ctx) => ctx.Target.Health.Heal(amount);
}

[Serializable]
public class ApplyStatusEffect : AbilityEffect
{
    public StatusEffectDefinition effect;
    public override void Apply(in AbilityContext ctx) => ctx.Target.Effects.Apply(effect, ctx.Caster);
}

[CreateAssetMenu(menuName = "Abilities/Ability")]
public class AbilityDefinition : ScriptableObject
{
    public string displayName;
    public Sprite icon;
    public int manaCost;
    public float cooldown = 1f;
    public float range = 10f;
    public Targeting targeting = Targeting.Enemy;
    public string[] blockedByTags = { "Stun", "Silence" };

    // Polymorphic list: each element can be any AbilityEffect subclass.
    [SerializeReference] public List<AbilityEffect> effects = new();
}
```

```gdscript [Godot (GDScript)]
# ability_effect.gd: the base class. Effects are Resources, so the inspector's "New ..." menu
# can add any subclass to an ability's list without extra editor code.
class_name AbilityEffect
extends Resource


func apply(_ctx: AbilityContext) -> void:
	pass


# ability_context.gd
class_name AbilityContext
extends RefCounted

var caster: AbilityRunner
var target: AbilityRunner
var ability: AbilityDefinition


# damage_effect.gd
class_name DamageEffect
extends AbilityEffect

@export var amount := 10.0


func apply(ctx: AbilityContext) -> void:
	ctx.target.health.take_damage(DamageInfo.new(amount, DamageInfo.Type.PHYSICAL, ctx.caster.get_parent()))


# heal_effect.gd
class_name HealEffect
extends AbilityEffect

@export var amount := 10.0


func apply(ctx: AbilityContext) -> void:
	ctx.target.health.heal(amount)


# apply_status_effect.gd
class_name ApplyStatusEffect
extends AbilityEffect

@export var effect: StatusEffectDefinition


func apply(ctx: AbilityContext) -> void:
	ctx.target.effects.apply(effect, ctx.caster)


# ability_definition.gd: one .tres per ability.
class_name AbilityDefinition
extends Resource

enum Targeting { SELF, ENEMY, ALLY }

@export var display_name := ""
@export var icon: Texture2D
@export var mana_cost := 0.0
@export var cooldown := 1.0
@export var ability_range := 10.0  # not "range": that's a built-in function
@export var targeting := Targeting.ENEMY
@export var blocked_by_tags: Array[StringName] = [&"stun", &"silence"]
@export var effects: Array[AbilityEffect] = []
```

```cpp [Unreal (C++)]
// The Gameplay Ability System is Unreal's built-in version of this pattern. An ability is a
// UGameplayAbility class (usually a Blueprint subclass of a C++ base); cost and cooldown are Gameplay Effects:
//   CostGameplayEffectClass      GE_IceBolt_Cost: Instant, Mana Add -15
//   CooldownGameplayEffectClass  GE_IceBolt_Cooldown: Has Duration 2 s, grants tag Cooldown.IceBolt
//   Ability Triggers             Gameplay Event Ability.IceBolt (so callers can pass a target)
//
// GA_IceBolt.h
#pragma once

#include "CoreMinimal.h"
#include "Abilities/GameplayAbility.h"
#include "GA_IceBolt.generated.h"

UCLASS()
class UGA_IceBolt : public UGameplayAbility
{
	GENERATED_BODY()

public:
	UGA_IceBolt();

	virtual void ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo,
		const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData) override;

protected:
	UPROPERTY(EditDefaultsOnly, Category = "Ability") TArray<TSubclassOf<UGameplayEffect>> EffectsOnTarget;   // GE_Damage20, GE_Slow
	UPROPERTY(EditDefaultsOnly, Category = "Ability") float Range = 1000.f;
};

// GA_IceBolt.cpp
#include "GA_IceBolt.h"
#include "AbilitySystemGlobals.h"
#include "AbilitySystemComponent.h"

UGA_IceBolt::UGA_IceBolt()
{
	InstancingPolicy = EGameplayAbilityInstancingPolicy::InstancedPerActor;
	// Checked by GAS before activation, like blockedByTags.
	ActivationBlockedTags.AddTag(FGameplayTag::RequestGameplayTag(TEXT("Effect.Stun")));
	ActivationBlockedTags.AddTag(FGameplayTag::RequestGameplayTag(TEXT("Effect.Silence")));
}

void UGA_IceBolt::ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo,
	const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData)
{
	const AActor* Target = TriggerEventData ? TriggerEventData->Target : nullptr;
	UAbilitySystemComponent* TargetASC = UAbilitySystemGlobals::GetAbilitySystemComponentFromActor(Target);
	const AActor* Avatar = GetAvatarActorFromActorInfo();

	const bool bValid = TargetASC && FVector::Dist(Avatar->GetActorLocation(), Target->GetActorLocation()) <= Range;
	if (!bValid || !CommitAbility(Handle, ActorInfo, ActivationInfo))   // Commit pays the cost and starts the cooldown
	{
		EndAbility(Handle, ActorInfo, ActivationInfo, true, true);
		return;
	}

	for (const TSubclassOf<UGameplayEffect>& Effect : EffectsOnTarget)
	{
		const FGameplayEffectSpecHandle Spec = MakeOutgoingGameplayEffectSpec(Effect, GetAbilityLevel());
		GetAbilitySystemComponentFromActorInfo()->ApplyGameplayEffectSpecToTarget(*Spec.Data.Get(), TargetASC);
	}
	EndAbility(Handle, ActorInfo, ActivationInfo, true, false);
}
```

:::

`[SerializeReference]` stores a list of *different* effect classes in one Unity asset. The default inspector shows existing entries but has no "add element of type…" menu, so add a small custom editor, or a property drawer with a type dropdown, for designers.

### The runner: one validation path for players and AI

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public class AbilityRunner : MonoBehaviour
{
    [SerializeField] int maxMana = 100;
    [SerializeField] float manaRegenPerSecond = 5f;
    [SerializeField] int team;

    public Health Health { get; private set; }
    public StatusEffectContainer Effects { get; private set; }
    public float Mana { get; private set; }

    readonly Dictionary<AbilityDefinition, float> readyAt = new();   // cooldowns per ability

    public event Action<AbilityDefinition, AbilityRunner> Activated;  // animation, VFX, audio, UI

    void Awake()
    {
        Health = GetComponent<Health>();
        Effects = GetComponent<StatusEffectContainer>();
        Mana = maxMana;
    }

    void Update() => Mana = Mathf.Min(maxMana, Mana + manaRegenPerSecond * Time.deltaTime);

    public float CooldownRemaining(AbilityDefinition a) =>
        readyAt.TryGetValue(a, out var t) ? Mathf.Max(0f, t - Time.time) : 0f;

    public ActivationResult CanActivate(AbilityDefinition a, AbilityRunner target)
    {
        if (CooldownRemaining(a) > 0f) return ActivationResult.OnCooldown;
        if (Mana < a.manaCost) return ActivationResult.NotEnoughMana;
        foreach (var tag in a.blockedByTags)
            if (Effects.HasTag(tag)) return ActivationResult.Blocked;

        target = a.targeting == Targeting.Self ? this : target;
        if (target == null) return ActivationResult.InvalidTarget;
        if (a.targeting == Targeting.Enemy && target.team == team) return ActivationResult.InvalidTarget;
        if (a.targeting == Targeting.Ally && target.team != team) return ActivationResult.InvalidTarget;
        if (Vector3.Distance(transform.position, target.transform.position) > a.range) return ActivationResult.OutOfRange;

        return ActivationResult.Success;
    }

    public ActivationResult TryActivate(AbilityDefinition a, AbilityRunner target)
    {
        var result = CanActivate(a, target);
        if (result != ActivationResult.Success) return result;

        if (a.targeting == Targeting.Self) target = this;
        Mana -= a.manaCost;
        readyAt[a] = Time.time + a.cooldown;

        var ctx = new AbilityContext { Caster = this, Target = target, Ability = a };
        foreach (var effect in a.effects)
            effect.Apply(ctx);

        Activated?.Invoke(a, target);
        return ActivationResult.Success;
    }
}

// Player input and AI use exactly the same entry point:
//   var result = runner.TryActivate(iceBolt, currentTarget);
//   if (result == ActivationResult.NotEnoughMana) ui.Flash("Not enough mana");
```

```gdscript [Godot (GDScript)]
# ability_runner.gd: a Node3D child of the character, next to its Health and StatusEffects.
class_name AbilityRunner
extends Node3D

signal activated(ability: AbilityDefinition, target: AbilityRunner)  # animation, VFX, audio, UI

enum Result { SUCCESS, ON_COOLDOWN, NOT_ENOUGH_MANA, BLOCKED, OUT_OF_RANGE, INVALID_TARGET }

@export var max_mana := 100.0
@export var mana_regen_per_second := 5.0
@export var team := 0
@export var health: Health
@export var effects: StatusEffects

var mana := 0.0
var _clock := 0.0  # game time: pauses with the tree and follows Engine.time_scale
var _ready_at := {}  # AbilityDefinition -> _clock value


func _ready() -> void:
	mana = max_mana


func _process(delta: float) -> void:
	_clock += delta
	mana = minf(max_mana, mana + mana_regen_per_second * delta)


func cooldown_remaining(a: AbilityDefinition) -> float:
	return maxf(0.0, _ready_at.get(a, 0.0) - _clock)


func can_activate(a: AbilityDefinition, target: AbilityRunner) -> Result:
	if cooldown_remaining(a) > 0.0:
		return Result.ON_COOLDOWN
	if mana < a.mana_cost:
		return Result.NOT_ENOUGH_MANA
	for tag in a.blocked_by_tags:
		if effects.has_tag(tag):
			return Result.BLOCKED

	if a.targeting == AbilityDefinition.Targeting.SELF:
		target = self
	if target == null:
		return Result.INVALID_TARGET
	if a.targeting == AbilityDefinition.Targeting.ENEMY and target.team == team:
		return Result.INVALID_TARGET
	if a.targeting == AbilityDefinition.Targeting.ALLY and target.team != team:
		return Result.INVALID_TARGET
	if global_position.distance_to(target.global_position) > a.ability_range:
		return Result.OUT_OF_RANGE
	return Result.SUCCESS


func try_activate(a: AbilityDefinition, target: AbilityRunner) -> Result:
	var result := can_activate(a, target)
	if result != Result.SUCCESS:
		return result

	if a.targeting == AbilityDefinition.Targeting.SELF:
		target = self
	mana -= a.mana_cost
	_ready_at[a] = _clock + a.cooldown

	var ctx := AbilityContext.new()
	ctx.caster = self
	ctx.target = target
	ctx.ability = a
	for effect in a.effects:
		effect.apply(ctx)

	activated.emit(a, target)
	return Result.SUCCESS

# Player input and AI use exactly the same entry point:
#   if runner.try_activate(ice_bolt, current_target) == AbilityRunner.Result.NOT_ENOUGH_MANA:
#       hud.flash("Not enough mana")
```

```cpp [Unreal (C++)]
// HeroCharacter.cpp: the Ability System Component is the runner. Abilities are granted once (on the
// server); players and AI then activate them through the same call, and GAS checks cooldown, cost,
// blocking tags and CanActivateAbility before ActivateAbility runs.
#include "AbilitySystemComponent.h"
#include "AbilitySystemBlueprintLibrary.h"

void AHeroCharacter::BeginPlay()
{
	Super::BeginPlay();
	if (HasAuthority())
		for (const TSubclassOf<UGameplayAbility>& Ability : StartingAbilities)    // UPROPERTY(EditDefaultsOnly)
			AbilitySystem->GiveAbility(FGameplayAbilitySpec(Ability, 1));

	AbilitySystem->AbilityFailedCallbacks.AddUObject(this, &AHeroCharacter::OnAbilityFailed);
}

// Player input and AI use exactly the same entry point.
void AHeroCharacter::CastAt(FGameplayTag AbilityEvent, AActor* Target)     // e.g. Ability.IceBolt
{
	FGameplayEventData Payload;
	Payload.Instigator = this;
	Payload.Target = Target;
	UAbilitySystemBlueprintLibrary::SendGameplayEventToActor(this, AbilityEvent, Payload);
}

// Failure reasons arrive as tags (cooldown, cost, blocked...), whose names are set in the
// Ability System Globals settings.
void AHeroCharacter::OnAbilityFailed(const UGameplayAbility* Ability, const FGameplayTagContainer& Reasons)
{
	if (Reasons.HasTag(FGameplayTag::RequestGameplayTag(TEXT("Activation.Fail.Cost"))))
		Hud->Flash(TEXT("Not enough mana"));
}
```

:::

An "Ice Bolt" is now `mana cost 15, cooldown 2, effects: [Damage 20, Apply Status Effect: Slow]`, created entirely in the editor.

**Engine notes**

- **Unity:** `[SerializeReference]` needs Unity 2019.3 or later; see the note above about the missing "add element" menu.
- **Godot:** typed `Array[AbilityEffect]` exports let the inspector create any subclass in place, which is the main reason effects are Resources rather than plain objects. Don't name a property `range` (a built-in function).
- **Unreal:** the **Gameplay Ability System** (the GameplayAbilities plugin) handles granting, activation, costs, cooldowns, blocking and cancelling by tag, prediction and replication. It has a steep learning curve; for a small single-player game, a `UActorComponent` runner with `UPrimaryDataAsset` ability definitions, built like the Unity and Godot tabs, is lighter. The blocked tags can also be set on the ability Blueprint's **Activation Blocked Tags** field instead of in the constructor.

## When to use

- RPGs, MOBAs, ARPGs, roguelikes and any game with more than a handful of active skills.
- Abilities shared between players and AI, or between many character types.
- Designers need to create and tune abilities without code.

## When not to use

- Games with a few fixed actions, such as jump and shoot. Code them directly.
- Abilities that are all unique and code-heavy. A data-driven framework adds little; keep them as small classes.
- Building a full framework before the design is known. Start with a few abilities in code and extract the system once patterns repeat.

## Pitfalls

- **Instant effects only.** Real abilities have cast times, channels, projectiles that hit later, and animation events that decide *when* damage lands. Model activation as a small state machine (casting → executing → recovering), and let effects run on events such as "projectile hit" rather than immediately.
- **Validation in several places.** If the UI and AI check "can I cast?" with their own logic, they drift apart. Everything calls `CanActivate`.
- **Effects that know too much.** An effect reaching for scene-wide lookups or singletons is hard to reuse. Pass everything it needs through the context.
- **Networked games.** Activation must be validated on the server, while the client predicts the cooldown and animation. See [Client-Side Prediction](./client-side-prediction).
- **Cooldowns keyed by asset.** Two different "Fireball" assets with the same name have independent cooldowns. If they should share one, key cooldowns by an explicit cooldown group.

## Related

- [Type Object](./type-object) — ability definitions are kinds defined as data.
- [Status Effects](./status-effects) — the most common thing abilities apply.
- [Command](./command) — an activation request is a natural command, for queuing, replays and networking.
- [Stat & Modifier System](./stat-modifier-system) — costs, damage and cooldowns can scale with stats.
- [State](./state) — cast, channel and recovery phases.
