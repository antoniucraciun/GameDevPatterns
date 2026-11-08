# Damage Pipeline

> Run a damage event through ordered stages: mitigation, crits, shields, reactions.

**Category:** Gameplay Systems

## Problem

Damage rules accumulate: critical hits, armour, fire resistance, a shield that absorbs damage first, an "immune to poison" buff, a curse that doubles damage taken, lifesteal, thorns, and "the first hit after stealth deals triple". Each rule is implemented where someone happened to need it, some in the weapon, some in `Health`, some in a buff. The order is accidental, so armour sometimes applies before the crit multiplier and sometimes after, and players see inconsistent numbers. Nobody can explain why a hit dealt 37 damage.

## Solution

Treat every hit as a **`DamageInfo` flowing through an ordered list of stages**. Each stage can **modify** the damage, **cancel** it, or **react** to it, and stages run in a fixed, documented order:

| Order | Stage | Example |
| --- | --- | --- |
| 100 | **Attacker modifiers** | Strength scaling, "+20% fire damage", crit roll |
| 200 | **Immunity** | Invulnerable, immune to poison: cancel |
| 300 | **Resistances** | Fire resistance 30% |
| 400 | **Armour** | Flat or percentage reduction of physical damage |
| 500 | **Damage-taken modifiers** | Curse: +50% damage taken |
| 600 | **Shields** | Absorb up to the shield's remaining amount |
| 700 | **Apply to health** | `Health.TakeDamage` |
| 800 | **Reactions** | Lifesteal, thorns, on-hit status effects, combo counters |

Stages come from many places: the attacker's buffs, the target's equipment, global rules. Each registers with an order number, so adding a new rule never requires editing the others. Every stage can also write a line to a **breakdown**, so tooltips, combat logs and debugging can show exactly how 100 became 37.

## Pseudocode

```text
DamageContext:              // one hit on its way through
    info                    // a copy of the damage: amount, type, source, critical
    target
    cancelled ← false
    breakdown ← empty list  // "100 physical", "armour 50 → 66.7", …

Stage:
    order                   // 100 crit … 700 apply to health, 800 thorns
    process(context)        // may change, cancel or react to the hit

DamagePipeline:             // one per character
    stages ← empty list, kept sorted by order

    add(stage):
        add stage to stages; sort stages by order

    run(info, target):
        context ← new DamageContext(copy of info, target)
        add "amount type from source" to context.breakdown
        for each stage in stages:
            if context.cancelled: stop     // immunity, or a shield ate it all
            stage.process(context)
        return context      // the breakdown explains the final number

// A few stages:
Armour (400):   if physical: amount ← amount × 100 / (100 + armour)
Shield (600):   absorbed ← min(shield, amount)
                shield ← shield - absorbed; amount ← amount - absorbed
                if amount ≤ 0: cancelled ← true
ApplyToHealth (700): target's health takes amount
Thorns (800):   if type is not true damage:     // never reflect a reflection
                    deal amount × reflect as true damage back to the source
```

## Example

The pipeline is a sorted list of stages that each read and change one damage context. `DamageInfo`, `Health` and `IDamageable` are from the [Health / Damageable](./health-component) page; armour comes from the [Stat & Modifier System](./stat-modifier-system) and immunity tags from [Status Effects](./status-effects).

### The pipeline

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public class DamageContext
{
    public DamageInfo Info;                   // from the Health / Damageable page
    public GameObject Target;
    public bool Cancelled;
    public readonly List<string> Breakdown = new();

    public void Log(string line) => Breakdown.Add(line);
}

public interface IDamageStage
{
    int Order { get; }
    void Process(DamageContext ctx);
}

public class DamagePipeline
{
    readonly List<IDamageStage> stages = new();

    public void Add(IDamageStage stage)
    {
        stages.Add(stage);
        stages.Sort((a, b) => a.Order.CompareTo(b.Order));    // stable order regardless of registration time
    }

    public void Remove(IDamageStage stage) => stages.Remove(stage);

    public DamageContext Run(DamageInfo info, GameObject target)
    {
        var ctx = new DamageContext { Info = info, Target = target };
        ctx.Log($"{info.Amount:0.#} {info.Type} from {(info.Source ? info.Source.name : "unknown")}");
        foreach (var stage in stages)
        {
            if (ctx.Cancelled) break;
            stage.Process(ctx);
        }
        return ctx;
    }
}
```

```gdscript [Godot (GDScript)]
# damage_context.gd
class_name DamageContext
extends RefCounted

var info: DamageInfo  # a copy (see run()): stages change it freely
var target: Node
var cancelled := false
var breakdown := PackedStringArray()


func note(line: String) -> void:  # not "log": that's a built-in function
	breakdown.append(line)


# damage_stage.gd: stages are Resources, so they can be added and tuned in the inspector.
class_name DamageStage
extends Resource


func get_order() -> int:
	return 0


func process(_ctx: DamageContext) -> void:
	pass


# damage_pipeline.gd
class_name DamagePipeline
extends RefCounted

var _stages: Array[DamageStage] = []


func add(stage: DamageStage) -> void:
	_stages.append(stage)
	_stages.sort_custom(func(a: DamageStage, b: DamageStage) -> bool: return a.get_order() < b.get_order())


func remove(stage: DamageStage) -> void:
	_stages.erase(stage)


func run(info: DamageInfo, target: Node) -> DamageContext:
	var ctx := DamageContext.new()
	ctx.info = info.with_amount(info.amount)  # never edit the caller's object
	ctx.target = target
	var source_name: String = info.source.name if is_instance_valid(info.source) else "unknown"
	ctx.note("%.1f %s from %s" % [info.amount, DamageInfo.Type.keys()[info.type], source_name])
	for stage in _stages:
		if ctx.cancelled:
			break
		stage.process(ctx)
	return ctx
```

```cpp [Unreal (C++)]
// DamageStage.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/DamageType.h"
#include "DamageStage.generated.h"

UCLASS() class UPhysicalDamageType : public UDamageType { GENERATED_BODY() };
UCLASS() class UTrueDamageType : public UDamageType { GENERATED_BODY() };   // ignores resistances, never reflected

USTRUCT(BlueprintType)
struct FDamageContext
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadWrite, Category = "Damage") float Amount = 0.f;
	UPROPERTY(BlueprintReadWrite, Category = "Damage") TSubclassOf<UDamageType> DamageType;
	UPROPERTY(BlueprintReadWrite, Category = "Damage") TObjectPtr<AActor> Causer = nullptr;
	UPROPERTY(BlueprintReadWrite, Category = "Damage") TObjectPtr<AActor> Target = nullptr;
	UPROPERTY(BlueprintReadWrite, Category = "Damage") bool bCritical = false;
	UPROPERTY(BlueprintReadWrite, Category = "Damage") bool bCancelled = false;
	UPROPERTY(BlueprintReadOnly, Category = "Damage") TArray<FString> Breakdown;

	void Log(const FString& Line) { Breakdown.Add(Line); }
	template <class T> bool IsOfType() const { return DamageType && DamageType->IsChildOf<T>(); }
};

// Stages are instanced sub-objects: designers add them to a character's pipeline in the
// details panel, and each character gets its own copy (so a shield stage keeps its own state).
UCLASS(Abstract, EditInlineNew, DefaultToInstanced, CollapseCategories)
class UDamageStage : public UObject
{
	GENERATED_BODY()

public:
	virtual int32 GetOrder() const { return 0; }
	virtual void Process(FDamageContext& Ctx) {}
};

// DamagePipelineComponent.h
UCLASS(ClassGroup = (Gameplay), meta = (BlueprintSpawnableComponent))
class UDamagePipelineComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, Category = "Damage") void AddStage(UDamageStage* Stage);
	UFUNCTION(BlueprintCallable, Category = "Damage") void RemoveStage(UDamageStage* Stage) { Stages.Remove(Stage); }
	FDamageContext Run(FDamageContext Ctx);

protected:
	virtual void BeginPlay() override;

private:
	void SortStages();

	UPROPERTY(EditAnywhere, Instanced, Category = "Damage") TArray<TObjectPtr<UDamageStage>> Stages;
};

// DamagePipelineComponent.cpp
#include "DamagePipelineComponent.h"
#include "Algo/Sort.h"

void UDamagePipelineComponent::BeginPlay()
{
	Super::BeginPlay();
	SortStages();
}

void UDamagePipelineComponent::AddStage(UDamageStage* Stage)
{
	Stages.Add(Stage);
	SortStages();
}

void UDamagePipelineComponent::SortStages()
{
	Algo::SortBy(Stages, [](const UDamageStage* Stage) { return Stage ? Stage->GetOrder() : MAX_int32; });
}

FDamageContext UDamagePipelineComponent::Run(FDamageContext Ctx)
{
	Ctx.Target = GetOwner();
	Ctx.Log(FString::Printf(TEXT("%.1f %s from %s"), Ctx.Amount, *GetNameSafe(Ctx.DamageType.Get()), *GetNameSafe(Ctx.Causer.Get())));
	for (UDamageStage* Stage : Stages)
	{
		if (Ctx.bCancelled) break;
		if (Stage) Stage->Process(Ctx);
	}
	return Ctx;
}
```

:::

### Typical stages

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public class CritStage : IDamageStage
{
    public int Order => 100;
    readonly float chance, multiplier;
    public CritStage(float chance, float multiplier) { this.chance = chance; this.multiplier = multiplier; }

    public void Process(DamageContext ctx)
    {
        if (Random.value >= chance) return;
        ctx.Info.Amount *= multiplier;
        ctx.Info.IsCritical = true;
        ctx.Log($"crit ×{multiplier} → {ctx.Info.Amount:0.#}");
    }
}

public class ImmunityStage : IDamageStage
{
    public int Order => 200;
    readonly StatusEffectContainer effects;               // from the Status Effects page
    public ImmunityStage(StatusEffectContainer effects) => this.effects = effects;

    public void Process(DamageContext ctx)
    {
        if (effects.HasTag("Invulnerable") || (ctx.Info.Type == DamageType.Poison && effects.HasTag("PoisonImmune")))
        {
            ctx.Cancelled = true;
            ctx.Log("immune");
        }
    }
}

public class ResistanceStage : IDamageStage
{
    public int Order => 300;
    readonly Dictionary<DamageType, float> resist;        // 0.3 = 30% less
    public ResistanceStage(Dictionary<DamageType, float> resist) => this.resist = resist;

    public void Process(DamageContext ctx)
    {
        if (ctx.Info.Type == DamageType.True || !resist.TryGetValue(ctx.Info.Type, out var r)) return;
        ctx.Info.Amount *= 1f - Mathf.Clamp(r, -1f, 0.9f);      // cap at 90%; negative = weakness
        ctx.Log($"{r:P0} {ctx.Info.Type} resist → {ctx.Info.Amount:0.#}");
    }
}

public class ArmourStage : IDamageStage
{
    public int Order => 400;
    readonly Stat armour;                                  // from the Stat & Modifier System page
    public ArmourStage(Stat armour) => this.armour = armour;

    public void Process(DamageContext ctx)
    {
        if (ctx.Info.Type != DamageType.Physical) return;
        float factor = 100f / (100f + armour.Value);       // diminishing returns: 100 armour = half damage
        ctx.Info.Amount *= factor;
        ctx.Log($"armour {armour.Value:0} → {ctx.Info.Amount:0.#}");
    }
}

public class ShieldStage : IDamageStage
{
    public int Order => 600;
    public float Shield;

    public void Process(DamageContext ctx)
    {
        float absorbed = Mathf.Min(Shield, ctx.Info.Amount);
        if (absorbed <= 0f) return;
        Shield -= absorbed;
        ctx.Info.Amount -= absorbed;
        ctx.Log($"shield absorbed {absorbed:0.#} → {ctx.Info.Amount:0.#}");
        if (ctx.Info.Amount <= 0f) ctx.Cancelled = true;
    }
}

public class ApplyToHealthStage : IDamageStage
{
    public int Order => 700;
    readonly Health health;
    public ApplyToHealthStage(Health health) => this.health = health;
    public void Process(DamageContext ctx) => health.TakeDamage(ctx.Info);
}

public class ThornsStage : IDamageStage
{
    public int Order => 800;
    readonly float reflect;
    public ThornsStage(float reflect) => this.reflect = reflect;

    public void Process(DamageContext ctx)
    {
        if (ctx.Info.Type == DamageType.True) return;      // reflected damage is True damage: never reflect it again
        if (ctx.Info.Source == null || !ctx.Info.Source.TryGetComponent(out IDamageable attacker)) return;
        attacker.TakeDamage(new DamageInfo { Amount = ctx.Info.Amount * reflect, Type = DamageType.True, Source = ctx.Target });
    }
}
```

```gdscript [Godot (GDScript)]
# crit_stage.gd
class_name CritStage
extends DamageStage

@export var chance := 0.1
@export var multiplier := 2.0


func get_order() -> int:
	return 100


func process(ctx: DamageContext) -> void:
	if randf() >= chance:
		return
	ctx.info.amount *= multiplier
	ctx.info.is_critical = true
	ctx.note("crit ×%.1f → %.1f" % [multiplier, ctx.info.amount])


# immunity_stage.gd: reads tags from the target's StatusEffects node (Status Effects page).
class_name ImmunityStage
extends DamageStage


func get_order() -> int:
	return 200


func process(ctx: DamageContext) -> void:
	var effects := ctx.target.get_node_or_null("StatusEffects") as StatusEffects
	if effects == null:
		return
	var poison := ctx.info.type == DamageInfo.Type.POISON
	if effects.has_tag(&"invulnerable") or (poison and effects.has_tag(&"poison_immune")):
		ctx.cancelled = true
		ctx.note("immune")


# resistance_stage.gd
class_name ResistanceStage
extends DamageStage

@export var resist := {}  # DamageInfo.Type -> 0.3 = 30% less; negative = weakness


func get_order() -> int:
	return 300


func process(ctx: DamageContext) -> void:
	if ctx.info.type == DamageInfo.Type.TRUE_DAMAGE or not resist.has(ctx.info.type):
		return
	var r: float = resist[ctx.info.type]
	ctx.info.amount *= 1.0 - clampf(r, -1.0, 0.9)  # cap at 90%
	ctx.note("%d%% resist → %.1f" % [roundi(r * 100.0), ctx.info.amount])


# armour_stage.gd: reads the target's armour Stat (Stat & Modifier System page).
class_name ArmourStage
extends DamageStage


func get_order() -> int:
	return 400


func process(ctx: DamageContext) -> void:
	if ctx.info.type != DamageInfo.Type.PHYSICAL:
		return
	var stats := ctx.target.get_node_or_null("CharacterStats") as CharacterStats
	var armour: float = stats.get_stat(&"armour").value if stats else 0.0
	ctx.info.amount *= 100.0 / (100.0 + armour)  # diminishing returns: 100 armour = half damage
	ctx.note("armour %d → %.1f" % [roundi(armour), ctx.info.amount])


# shield_stage.gd
class_name ShieldStage
extends DamageStage

@export var shield := 0.0


func get_order() -> int:
	return 600


func process(ctx: DamageContext) -> void:
	var absorbed := minf(shield, ctx.info.amount)
	if absorbed <= 0.0:
		return
	shield -= absorbed
	ctx.info.amount -= absorbed
	ctx.note("shield absorbed %.1f → %.1f" % [absorbed, ctx.info.amount])
	if ctx.info.amount <= 0.0:
		ctx.cancelled = true


# apply_to_health_stage.gd: added in code by the receiver, always last but thorns.
class_name ApplyToHealthStage
extends DamageStage

var health: Health


func _init(p_health: Health = null) -> void:
	health = p_health


func get_order() -> int:
	return 700


func process(ctx: DamageContext) -> void:
	health.take_damage(ctx.info)


# thorns_stage.gd
class_name ThornsStage
extends DamageStage

@export var reflect := 0.2


func get_order() -> int:
	return 800


func process(ctx: DamageContext) -> void:
	# Reflected damage is TRUE_DAMAGE: never reflect it again.
	if ctx.info.type == DamageInfo.Type.TRUE_DAMAGE or not is_instance_valid(ctx.info.source):
		return
	var attacker := ctx.info.source.get_node_or_null("DamageReceiver") as DamageReceiver
	if attacker:
		attacker.take_damage(DamageInfo.new(ctx.info.amount * reflect, DamageInfo.Type.TRUE_DAMAGE, ctx.target))
```

```cpp [Unreal (C++)]
// DamageStages.h: armour and immunity read the target's GAS attributes and tags
// (Stat & Modifier System and Status Effects pages). Applying to health is not a stage here:
// the actor passes the final amount on to Super::TakeDamage (see below).
#pragma once

#include "DamageStage.h"
#include "AbilitySystemGlobals.h"
#include "AbilitySystemComponent.h"
#include "CharacterAttributeSet.h"
#include "Kismet/GameplayStatics.h"
#include "DamageStages.generated.h"

UCLASS(meta = (DisplayName = "Crit"))
class UCritStage : public UDamageStage
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Crit") float Chance = 0.1f;
	UPROPERTY(EditAnywhere, Category = "Crit") float Multiplier = 2.f;

	virtual int32 GetOrder() const override { return 100; }
	virtual void Process(FDamageContext& Ctx) override
	{
		if (FMath::FRand() >= Chance) return;
		Ctx.Amount *= Multiplier;
		Ctx.bCritical = true;
		Ctx.Log(FString::Printf(TEXT("crit x%.1f -> %.1f"), Multiplier, Ctx.Amount));
	}
};

UCLASS(meta = (DisplayName = "Immunity"))
class UImmunityStage : public UDamageStage
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Immunity") FGameplayTag InvulnerableTag;                          // State.Invulnerable
	UPROPERTY(EditAnywhere, Category = "Immunity") TMap<TSubclassOf<UDamageType>, FGameplayTag> TypeImmunity; // Poison -> State.PoisonImmune

	virtual int32 GetOrder() const override { return 200; }
	virtual void Process(FDamageContext& Ctx) override
	{
		const UAbilitySystemComponent* ASC = UAbilitySystemGlobals::GetAbilitySystemComponentFromActor(Ctx.Target);
		if (!ASC) return;
		const FGameplayTag* TypeTag = TypeImmunity.Find(Ctx.DamageType);
		if (ASC->HasMatchingGameplayTag(InvulnerableTag) || (TypeTag && ASC->HasMatchingGameplayTag(*TypeTag)))
		{
			Ctx.bCancelled = true;
			Ctx.Log(TEXT("immune"));
		}
	}
};

UCLASS(meta = (DisplayName = "Resistance"))
class UResistanceStage : public UDamageStage
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Resistance") TMap<TSubclassOf<UDamageType>, float> Resist;   // 0.3 = 30% less

	virtual int32 GetOrder() const override { return 300; }
	virtual void Process(FDamageContext& Ctx) override
	{
		const float* R = Resist.Find(Ctx.DamageType);
		if (Ctx.IsOfType<UTrueDamageType>() || !R) return;
		Ctx.Amount *= 1.f - FMath::Clamp(*R, -1.f, 0.9f);                // cap at 90%; negative = weakness
		Ctx.Log(FString::Printf(TEXT("%.0f%% resist -> %.1f"), *R * 100.f, Ctx.Amount));
	}
};

UCLASS(meta = (DisplayName = "Armour"))
class UArmourStage : public UDamageStage
{
	GENERATED_BODY()

public:
	virtual int32 GetOrder() const override { return 400; }
	virtual void Process(FDamageContext& Ctx) override
	{
		if (!Ctx.IsOfType<UPhysicalDamageType>()) return;
		const UAbilitySystemComponent* ASC = UAbilitySystemGlobals::GetAbilitySystemComponentFromActor(Ctx.Target);
		const float Armour = ASC ? ASC->GetNumericAttribute(UCharacterAttributeSet::GetArmourAttribute()) : 0.f;
		Ctx.Amount *= 100.f / (100.f + FMath::Max(Armour, 0.f));         // 100 armour = half damage
		Ctx.Log(FString::Printf(TEXT("armour %.0f -> %.1f"), Armour, Ctx.Amount));
	}
};

UCLASS(meta = (DisplayName = "Shield"))
class UShieldStage : public UDamageStage
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Shield") float Shield = 0.f;

	virtual int32 GetOrder() const override { return 600; }
	virtual void Process(FDamageContext& Ctx) override
	{
		const float Absorbed = FMath::Min(Shield, Ctx.Amount);
		if (Absorbed <= 0.f) return;
		Shield -= Absorbed;
		Ctx.Amount -= Absorbed;
		Ctx.Log(FString::Printf(TEXT("shield absorbed %.1f -> %.1f"), Absorbed, Ctx.Amount));
		if (Ctx.Amount <= 0.f) Ctx.bCancelled = true;
	}
};

UCLASS(meta = (DisplayName = "Thorns"))
class UThornsStage : public UDamageStage
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Thorns") float Reflect = 0.2f;

	virtual int32 GetOrder() const override { return 800; }
	virtual void Process(FDamageContext& Ctx) override
	{
		if (Ctx.IsOfType<UTrueDamageType>() || !Ctx.Causer) return;   // reflected damage is never reflected again
		// The causer is the weapon or projectile; its instigator is the attacker.
		AActor* Attacker = Ctx.Causer->GetInstigator() ? Ctx.Causer->GetInstigator() : Ctx.Causer.Get();
		UGameplayStatics::ApplyDamage(Attacker, Ctx.Amount * Reflect, nullptr, Ctx.Target, UTrueDamageType::StaticClass());
	}
};
```

:::

Each character owns its pipeline, and the damage entry point routes through it:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class DamageReceiver : MonoBehaviour, IDamageable
{
    public DamagePipeline Pipeline { get; } = new();
    Health health;

    public bool IsAlive => health.IsAlive;

    void Awake()
    {
        health = GetComponent<Health>();
        Pipeline.Add(new ApplyToHealthStage(health));
        // Equipment, buffs and passives add and remove their own stages at runtime.
    }

    public void TakeDamage(DamageInfo info)
    {
        var result = Pipeline.Run(info, gameObject);
        if (Debug.isDebugBuild) Debug.Log(string.Join("\n  ", result.Breakdown));
    }
}
```

```gdscript [Godot (GDScript)]
# damage_receiver.gd: a child node named DamageReceiver; hurtboxes and weapons call take_damage on it.
class_name DamageReceiver
extends Node

@export var health: Health
@export var stages: Array[DamageStage] = []  # Crit, Resistance, Armour, Shield... set up in the inspector

var pipeline := DamagePipeline.new()


func _ready() -> void:
	# Resources are shared between instances; stages with state (Shield) need one copy per character.
	for stage in stages:
		pipeline.add(stage.duplicate())
	pipeline.add(ApplyToHealthStage.new(health))
	# Equipment, buffs and passives add and remove their own stages at runtime.


func take_damage(info: DamageInfo) -> void:
	var result := pipeline.run(info, get_parent())
	if OS.is_debug_build():
		print("\n  ".join(result.breakdown))
```

```cpp [Unreal (C++)]
// EnemyCharacter.cpp: engine damage (ApplyDamage, ApplyPointDamage) arrives in TakeDamage. Only the
// pipeline's result reaches Super::TakeDamage, which fires OnTakeAnyDamage for the Health component.
float AEnemyCharacter::TakeDamage(float Damage, const FDamageEvent& DamageEvent, AController* EventInstigator, AActor* DamageCauser)
{
	FDamageContext Ctx;
	Ctx.Amount = Damage;
	Ctx.DamageType = DamageEvent.DamageTypeClass;
	Ctx.Causer = DamageCauser;
	Ctx = DamagePipeline->Run(Ctx);                     // UPROPERTY() UDamagePipelineComponent* DamagePipeline
	UE_LOG(LogTemp, Verbose, TEXT("%s"), *FString::Join(Ctx.Breakdown, TEXT("\n  ")));

	if (Ctx.bCancelled || Ctx.Amount <= 0.f) return 0.f;
	return Super::TakeDamage(Ctx.Amount, DamageEvent, EventInstigator, DamageCauser);
}

// With the Gameplay Ability System, the same steps usually live in one execution calculation,
// run by the damage Gameplay Effect. It writes to a meta attribute (IncomingDamage) that the
// attribute set's PostGameplayEffectExecute subtracts from Health.
UCLASS()
class UDamageExecution : public UGameplayEffectExecutionCalculation
{
	GENERATED_BODY()

public:
	UDamageExecution();
	virtual void Execute_Implementation(const FGameplayEffectCustomExecutionParameters& Params,
		FGameplayEffectCustomExecutionOutput& Out) const override;
};

// DamageExecution.cpp
#include "GameplayEffectExecutionCalculation.h"

struct FDamageCaptures
{
	DECLARE_ATTRIBUTE_CAPTUREDEF(Armour);
	FDamageCaptures() { DEFINE_ATTRIBUTE_CAPTUREDEF(UCharacterAttributeSet, Armour, Target, false); }
};

static const FDamageCaptures& Captures()
{
	static FDamageCaptures Instance;
	return Instance;
}

UDamageExecution::UDamageExecution()
{
	RelevantAttributesToCapture.Add(Captures().ArmourDef);
}

void UDamageExecution::Execute_Implementation(const FGameplayEffectCustomExecutionParameters& Params,
	FGameplayEffectCustomExecutionOutput& Out) const
{
	const FGameplayEffectSpec& Spec = Params.GetOwningSpec();
	FAggregatorEvaluateParameters Eval;
	Eval.SourceTags = Spec.CapturedSourceTags.GetAggregatedTags();
	Eval.TargetTags = Spec.CapturedTargetTags.GetAggregatedTags();

	if (Eval.TargetTags && Eval.TargetTags->HasTag(FGameplayTag::RequestGameplayTag(TEXT("State.Invulnerable")))) return;

	float Damage = Spec.GetSetByCallerMagnitude(FGameplayTag::RequestGameplayTag(TEXT("Data.Damage")), false, 0.f);
	float Armour = 0.f;
	Params.AttemptCalculateCapturedAttributeMagnitude(Captures().ArmourDef, Eval, Armour);
	Damage *= 100.f / (100.f + FMath::Max(Armour, 0.f));

	if (Damage > 0.f)
		Out.AddOutputModifier(FGameplayModifierEvaluatedData(
			UCharacterAttributeSet::GetIncomingDamageAttribute(), EGameplayModOp::Additive, Damage));
}
```

:::

Attacker-side stages (crit, damage bonuses) can live in a second pipeline on the attacker that runs before the target's, or be applied when the damage info is created.

**Engine notes**

- **Unity:** `IDamageStage` objects are plain C# classes created in code. To let designers assemble pipelines in the inspector, store them in a `[SerializeReference]` list (as the [Ability System](./ability-system) page does for effects).
- **Godot:** stages as `Resource`s can be added and tuned right in the inspector, but resources are shared between every instance of a scene, so stateful stages must be `duplicate()`d per character (or marked **Local to Scene**). `Array.sort_custom` is not stable, so give stages distinct orders.
- **Unreal:** `AActor::TakeDamage` is the built-in entry point, and overriding it is the usual place for a pipeline. In a GAS project, execution calculations (`UGameplayEffectExecutionCalculation`) are the idiomatic pipeline: they capture source and target attributes and tags, and several executions or effects can run in sequence. The `IncomingDamage` meta attribute in the sketch has to be added to the attribute set from the Stat & Modifier System page.

## When to use

- RPGs, ARPGs, MOBAs, roguelikes and any game with resistances, armour, shields or on-hit effects.
- When combat numbers must be explainable to players (tooltips, combat logs) or to designers (balance).

## When not to use

- Games where damage is a fixed amount with no armour, resistances or on-hit effects. `health -= damage` is fine.
- Arcade games with one-hit kills.
- Building many stages before the design calls for them. Add a stage when a rule needs it.

## Pitfalls

- **Ambiguous ordering.** "Armour before or after crit?" changes the numbers a lot. Choose the order once, document it next to the stage orders, and test it.
- **Reaction loops.** Thorns reflecting thorns reflecting thorns. Mark reflected damage (a flag, or `DamageType.True` that reaction stages ignore), and never let reactions trigger reactions of the same kind.
- **Stages that outlive their source.** An unequipped shield that never removes its stage keeps absorbing damage. Remove stages in the same place they are added, keyed by source, as with stat modifiers.
- **Randomness in many stages.** Crits rolled in two places double-dip. Keep each random roll in exactly one stage.
- **Cost.** A list sort on every `Add` is fine when stages change rarely. For effects added every frame, insert in place instead of sorting.

## Related

- [Health / Damageable Interface](./health-component) — the entry point and the final stage.
- [Stat & Modifier System](./stat-modifier-system) — armour, resistances and damage bonuses are stats.
- [Status Effects](./status-effects) — buffs and debuffs add and remove stages, and reactions apply effects.
- [Gameplay Tags](./tags) — immunities and conditions expressed as tags.
- [Chain of Responsibility](./chain-of-responsibility) — the classic pattern behind passing a request along ordered handlers.
