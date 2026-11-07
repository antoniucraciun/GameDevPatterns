# Utility AI

> Score every possible action with response curves and pick the best one.

**Category:** AI & Decision Making

## Problem

A survival NPC must eat, sleep, flee danger, fight, gather wood and socialise. With a [behavior tree](./behavior-tree) or [state machine](./state), priorities are fixed: "flee beats eat" always. Real decisions are trade-offs. A *slightly* hungry NPC near a threat should flee, but a *starving* one might grab the food first. Expressing every combination as conditions and priorities explodes, and the behaviour still looks rigid and predictable.

## Solution

Give every candidate action a **score** between 0 and 1, computed from the current situation, and pick the highest (or pick randomly among the top few).

Each action's score is built from **considerations**. Each consideration:

1. reads one **input** from the world or blackboard, normalised to 0..1: hunger, distance to threat, own health, time of day.
2. maps it through a **response curve**: linear, quadratic, logistic or inverse. "Hunger matters little until it is high" is an exponential curve, while "threat matters a lot when close" is an inverse curve.
3. returns a value from 0 to 1.

The action's score is the **product** of its considerations, so any single consideration at 0 vetoes the action (no food nearby means eating scores 0). Multiplying many values below 1 drags scores down for actions with more considerations, so apply a **compensation factor**.

```
Eat   = curve(hunger) × curve(food nearby) × curve(1 − threat)
Flee  = curve(threat) × curve(1 − own health)
Sleep = curve(tiredness) × curve(is night) × curve(1 − threat)
```

Designers tune behaviour by editing curves rather than adding rules.

## Example

Considerations and actions as data assets, each consideration shaping one input with a curve the designer edits visually: `AnimationCurve` in Unity, `Curve` in Godot, `FRuntimeFloatCurve` in Unreal.

### Considerations and actions

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public enum UtilityInput { Hunger, Tiredness, Threat, Health, FoodNearby, IsNight }

public class AgentContext                      // inputs, each normalised to 0..1
{
    readonly Dictionary<UtilityInput, float> values = new();
    public float this[UtilityInput i] { get => values.TryGetValue(i, out var v) ? v : 0f; set => values[i] = Mathf.Clamp01(value); }
}

[Serializable]
public class Consideration
{
    public UtilityInput input;
    public AnimationCurve curve = AnimationCurve.Linear(0f, 0f, 1f, 1f);   // edit visually in the inspector

    public float Score(AgentContext ctx) => Mathf.Clamp01(curve.Evaluate(ctx[input]));
}

[CreateAssetMenu(menuName = "AI/Utility Action")]
public class UtilityAction : ScriptableObject
{
    public string actionName;
    [Range(0f, 2f)] public float weight = 1f;          // designer bias, e.g. 1.2 for "prefers this"
    public List<Consideration> considerations = new();

    public float Score(AgentContext ctx)
    {
        if (considerations.Count == 0) return 0f;
        float score = 1f;
        foreach (var c in considerations)
        {
            score *= c.Score(ctx);
            if (score <= 0f) return 0f;                // early out: vetoed
        }

        // Compensation: undo the penalty for having many considerations.
        float modification = 1f - 1f / considerations.Count;
        score += (1f - score) * modification * score;
        return score * weight;
    }
}
```

```gdscript [Godot (GDScript)]
# agent_context.gd: inputs, each normalised to 0..1.
class_name AgentContext
extends RefCounted

enum Factor { HUNGER, TIREDNESS, THREAT, HEALTH, FOOD_NEARBY, IS_NIGHT }

var _values := PackedFloat32Array()


func _init() -> void:
	_values.resize(Factor.size())
	_values.fill(0.0)


func get_value(factor: Factor) -> float:
	return _values[factor]


func set_value(factor: Factor, value: float) -> void:
	_values[factor] = clampf(value, 0.0, 1.0)


# consideration.gd
class_name Consideration
extends Resource

@export var factor: AgentContext.Factor
@export var curve: Curve  # edit visually in the inspector; empty means linear


func score(ctx: AgentContext) -> float:
	var x := ctx.get_value(factor)
	return clampf(curve.sample(x) if curve else x, 0.0, 1.0)


# utility_action.gd: create one .tres per action in the FileSystem dock.
class_name UtilityAction
extends Resource

@export var action_name: String
@export_range(0.0, 2.0) var weight := 1.0  # designer bias, e.g. 1.2 for "prefers this"
@export var considerations: Array[Consideration] = []


func score(ctx: AgentContext) -> float:
	if considerations.is_empty():
		return 0.0
	var result := 1.0
	for c: Consideration in considerations:
		result *= c.score(ctx)
		if result <= 0.0:
			return 0.0  # early out: vetoed

	# Compensation: undo the penalty for having many considerations.
	var modification := 1.0 - 1.0 / considerations.size()
	result += (1.0 - result) * modification * result
	return result * weight
```

```cpp [Unreal (C++)]
// UtilityAction.h
#pragma once

#include "CoreMinimal.h"
#include "Curves/CurveFloat.h"
#include "Engine/DataAsset.h"
#include "UtilityAction.generated.h"

UENUM(BlueprintType)
enum class EUtilityInput : uint8 { Hunger, Tiredness, Threat, Health, FoodNearby, IsNight, Count UMETA(Hidden) };

// Inputs, each normalised to 0..1. Plain C++: it is rebuilt from game state, never saved or edited.
struct FAgentContext
{
	float Get(EUtilityInput Input) const { return Values[static_cast<int32>(Input)]; }
	void Set(EUtilityInput Input, float Value) { Values[static_cast<int32>(Input)] = FMath::Clamp(Value, 0.f, 1.f); }

private:
	float Values[static_cast<int32>(EUtilityInput::Count)] = {};
};

USTRUCT(BlueprintType)
struct FUtilityConsideration
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Utility")
	EUtilityInput Input = EUtilityInput::Hunger;

	UPROPERTY(EditAnywhere, Category = "Utility")
	FRuntimeFloatCurve Curve;                   // edit visually in the details panel; empty means linear

	float Score(const FAgentContext& Ctx) const;
};

UCLASS(BlueprintType)
class UUtilityAction : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Utility", meta = (ClampMin = "0", ClampMax = "2"))
	float Weight = 1.f;                         // designer bias, e.g. 1.2 for "prefers this"

	UPROPERTY(EditAnywhere, Category = "Utility")
	TArray<FUtilityConsideration> Considerations;

	float Score(const FAgentContext& Ctx) const;
};

// UtilityAction.cpp
#include "UtilityAction.h"

float FUtilityConsideration::Score(const FAgentContext& Ctx) const
{
	const float X = Ctx.Get(Input);
	const FRichCurve* Rich = Curve.GetRichCurveConst();
	const float Y = Rich && Rich->GetNumKeys() > 0 ? Rich->Eval(X) : X;
	return FMath::Clamp(Y, 0.f, 1.f);
}

float UUtilityAction::Score(const FAgentContext& Ctx) const
{
	if (Considerations.Num() == 0) return 0.f;
	float Result = 1.f;
	for (const FUtilityConsideration& C : Considerations)
	{
		Result *= C.Score(Ctx);
		if (Result <= 0.f) return 0.f;          // early out: vetoed
	}

	// Compensation: undo the penalty for having many considerations.
	const float Modification = 1.f - 1.f / Considerations.Num();
	Result += (1.f - Result) * Modification * Result;
	return Result * Weight;
}
```

:::

### The reasoner

It picks the best action on a fixed interval, with hysteresis so the agent does not flip between near-equal options:

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public class UtilityReasoner : MonoBehaviour
{
    [SerializeField] List<UtilityAction> actions;
    [SerializeField] float decisionInterval = 0.25f;
    [SerializeField] float commitmentBonus = 0.1f;     // stickiness for the current action

    public UtilityAction Current { get; private set; }
    public readonly AgentContext Context = new();
    public event Action<UtilityAction> Decided;

    float nextDecision;

    void Update()
    {
        if (Time.time < nextDecision) return;
        nextDecision = Time.time + decisionInterval;

        UtilityAction best = null;
        float bestScore = 0f;
        foreach (var a in actions)
        {
            float s = a.Score(Context);
            if (a == Current) s += commitmentBonus;    // hysteresis
            if (s > bestScore) { best = a; bestScore = s; }
        }

        if (best != Current)
        {
            Current = best;
            Decided?.Invoke(best);                     // start the matching behaviour (move, eat, sleep…)
        }
    }
}

// Each frame (or from perception), keep the inputs current:
// reasoner.Context[UtilityInput.Hunger] = needs.Hunger / 100f;
// reasoner.Context[UtilityInput.Threat] = 1f - Mathf.Clamp01(distanceToNearestEnemy / 20f);
```

```gdscript [Godot (GDScript)]
# utility_reasoner.gd
class_name UtilityReasoner
extends Node

signal decided(action: UtilityAction)  # start the matching behaviour (move, eat, sleep…)

@export var actions: Array[UtilityAction] = []
@export var decision_interval := 0.25
@export var commitment_bonus := 0.1  # stickiness for the current action

var current: UtilityAction
var context := AgentContext.new()
var _time_to_decide := 0.0


func _process(delta: float) -> void:
	_time_to_decide -= delta
	if _time_to_decide > 0.0:
		return
	_time_to_decide = decision_interval

	var best: UtilityAction = null
	var best_score := 0.0
	for a: UtilityAction in actions:
		var s := a.score(context)
		if a == current:
			s += commitment_bonus  # hysteresis
		if s > best_score:
			best = a
			best_score = s

	if best != current:
		current = best
		decided.emit(best)

# Each frame (or from perception), keep the inputs current:
# reasoner.context.set_value(AgentContext.Factor.HUNGER, needs.hunger / 100.0)
# reasoner.context.set_value(AgentContext.Factor.THREAT, 1.0 - clampf(distance_to_enemy / 20.0, 0.0, 1.0))
```

```cpp [Unreal (C++)]
// UtilityReasonerComponent.h
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "UtilityAction.h"
#include "UtilityReasonerComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnUtilityDecided, UUtilityAction*, Action);

UCLASS(ClassGroup = (AI), meta = (BlueprintSpawnableComponent))
class UUtilityReasonerComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UPROPERTY(BlueprintAssignable, Category = "Utility")
	FOnUtilityDecided OnDecided;                // start the matching behaviour (move, eat, sleep…)

	FAgentContext Context;                      // owners write inputs here, e.g. from perception

	UUtilityAction* GetCurrent() const { return Current; }

protected:
	UPROPERTY(EditAnywhere, Category = "Utility")
	TArray<TObjectPtr<UUtilityAction>> Actions;

	UPROPERTY(EditAnywhere, Category = "Utility")
	float DecisionInterval = 0.25f;

	UPROPERTY(EditAnywhere, Category = "Utility")
	float CommitmentBonus = 0.1f;               // stickiness for the current action

	virtual void BeginPlay() override;

private:
	void Decide();

	UPROPERTY()
	TObjectPtr<UUtilityAction> Current;

	FTimerHandle DecisionTimer;
};

// UtilityReasonerComponent.cpp
#include "UtilityReasonerComponent.h"
#include "TimerManager.h"

void UUtilityReasonerComponent::BeginPlay()
{
	Super::BeginPlay();
	// A looping timer instead of TickComponent: deciding four times a second is plenty.
	GetWorld()->GetTimerManager().SetTimer(DecisionTimer, this, &UUtilityReasonerComponent::Decide,
		DecisionInterval, /*bLoop=*/true);
}

void UUtilityReasonerComponent::Decide()
{
	UUtilityAction* Best = nullptr;
	float BestScore = 0.f;
	for (UUtilityAction* Action : Actions)
	{
		if (!Action) continue;
		float Score = Action->Score(Context);
		if (Action == Current) Score += CommitmentBonus;   // hysteresis
		if (Score > BestScore) { Best = Action; BestScore = Score; }
	}

	if (Best != Current)
	{
		Current = Best;
		OnDecided.Broadcast(Best);
	}
}
```

:::

In a debug view, show every action's score per decision. Utility AI is only tunable if you can see *why* it chose what it did.

**Engine notes**

- **Unity:** `AnimationCurve` gives designers a curve editor for free, and `ScriptableObject` actions can be shared between agent types.
- **Godot:** `Curve.sample()` is the Godot 4 name (it was `interpolate()` in Godot 3). Resources loaded from the same file are shared, so keep per-agent state in the reasoner, not in the action.
- **Unreal:** the **Environment Query System** is built-in utility scoring for *positions and actors*: it generates candidates (points around the agent, cover spots, pickups), scores each with weighted tests such as distance, line of sight and pathfinding cost, and returns the best. Use it for "where" questions and a reasoner like this one for "what" questions. `FRuntimeFloatCurve` can also point at a shared `UCurveFloat` asset instead of an inline curve.

## When to use

- Agents with many competing needs: life sims, survival games, colony sims, RPG companions.
- Combat AI choosing between abilities, targets and positions, where the best choice depends on many factors.
- Behaviour that should feel organic and context-sensitive rather than scripted.

## When not to use

- Behaviour with clear, fixed priorities ("always flee below 20% health"). A [Behavior Tree](./behavior-tree) states that directly.
- Small decision sets. Tuning response curves for three options is more work than writing three `if` statements.
- When designers need to know exactly why the AI did something. Utility scores are hard to reason about without good debug tools.

## Pitfalls

- **Opaque decisions.** "Why did it do that?" is hard to answer from numbers. Build a score inspector early.
- **Dithering.** Two actions with close scores alternate every decision. Add a commitment bonus for the current action, minimum durations, or cooldowns.
- **Curve tuning explosion.** Dozens of actions × several considerations is a lot of curves. Share consideration presets, and keep inputs well normalised so curves transfer between actions.
- **Unnormalised inputs.** Feeding raw distances (0–200) into curves expecting 0..1 breaks everything. Normalise every input explicitly, with a documented range.
- **Utility for everything.** Simple, rule-like logic (reload when empty) is clearer as a condition. Use utility where trade-offs exist, and combine it with [Behavior Trees](./behavior-tree) or [State](./state) for execution.

## Related

- [Behavior Tree](./behavior-tree) — fixed priorities. Utility can choose *which subtree* to run.
- [Blackboard](./blackboard) and [Perception System](./perception-system) — where inputs come from.
- [Strategy](./strategy) — each chosen action is often a strategy object that does the work.
- [Goal-Oriented Action Planning](./goap) — plans *sequences* of actions, where utility scores single choices.
- [AI Director](./director-ai) — utility-style scoring applied to pacing a whole game.
