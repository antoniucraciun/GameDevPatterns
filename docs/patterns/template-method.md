# Template Method

> A base class fixes the steps of an algorithm and lets subclasses fill some in.

**Category:** Behavioral & Communication

## Problem

In a turn-based tactics game, every unit's turn follows the same rules: tick status effects, skip the turn if stunned, regenerate action points, choose an action, perform it, trigger end-of-turn effects, and tell the turn manager it is done. The knight, the archer and the AI-controlled goblin differ only in *how they choose and perform* their action. When each class writes its whole turn itself, the shared rules are copied, and then drift. One forgets to tick poison, another lets stunned units act. A rule change ("regenerate AP *before* status effects") must be made in every class.

## Solution

Put the **fixed sequence of steps** in one method of the base class: the **template method**. Make it non-overridable. The steps that vary are **abstract** (every subclass must provide them) or **virtual hooks** (optional, with default behaviour).

- The **invariant parts** (order, bookkeeping, rules) are written once, and cannot be broken by subclasses.
- **Subclasses only fill in the gaps.**
- The base class calls the subclass, not the other way round ("don't call us, we'll call you").

## Pseudocode

```text
TurnTaker:
    max_action_points ← 2
    action_points
    effects                 // the unit's status effects

    // The template method: fixed for every unit, never overridden.
    take_turn():
        effects.tick_turn()                 // 1. damage over time, durations
        if not is_alive(): return
        if effects has "stun":              // 2. stunned units skip
            on_turn_skipped()
            return
        action_points ← max_action_points   // 3. regenerate AP
        on_turn_started()
        while action_points > 0:
            action ← wait for choose_action()  // 4. varies
            if action is none: stop            //    end the turn early
            wait for perform(action)           // 5. varies
            action_points ← action_points - action.cost
        on_turn_ended()                     // 6.

    // Steps every subclass must provide.
    choose_action() → action, or none   // may wait for the player
    perform(action)                     // may wait for animations
    is_alive()

    // Hooks a subclass may override; empty by default.
    on_turn_started(), on_turn_ended()
    on_turn_skipped(): log "stunned, skips the turn"

GoblinAI is a TurnTaker:
    choose_action():
        target ← nearest enemy; if none: return none
        if target in melee range: return attack(target)
        return move toward(target)

PlayerKnight is a TurnTaker:
    choose_action(): wait for the action the player picks in the UI
    on_turn_started(): focus the camera on this unit
```

## Example

A turn-based game where every unit's turn follows the same rules, while choosing and performing actions differ per unit. Choosing can wait for the player, so the template method is asynchronous: a coroutine in Unity, `await` in Godot, and completion callbacks in Unreal.

### The template

::: code-group

```csharp [Unity (C#)]
using System.Collections;
using UnityEngine;

public abstract class TurnTaker : MonoBehaviour
{
    [SerializeField] int maxActionPoints = 2;
    public int ActionPoints { get; protected set; }
    public StatusEffectContainer Effects { get; private set; }

    void Awake() => Effects = GetComponent<StatusEffectContainer>();

    // The template method: the order of a turn is fixed here, for every unit.
    // (Not virtual: subclasses cannot reorder or skip the rules.)
    public IEnumerator TakeTurn()
    {
        Effects.TickTurn();                                  // 1. damage over time, durations
        if (!IsAlive) yield break;

        if (Effects.HasTag("Stun"))                          // 2. shared rule: stunned units skip
        {
            OnTurnSkipped();
            yield break;
        }

        ActionPoints = maxActionPoints;                      // 3. shared rule: regenerate AP
        OnTurnStarted();                                     //    hook (optional)

        while (ActionPoints > 0)
        {
            var action = ChooseAction();                     // 4. varies: player input, AI, ...
            if (action == null) break;                       //    null = end turn early
            yield return Perform(action);                    // 5. varies: animations, effects
            ActionPoints -= action.Cost;
        }

        OnTurnEnded();                                       // 6. hook (optional)
    }

    // ── Steps subclasses must provide ──
    protected abstract TurnAction ChooseAction();
    protected abstract IEnumerator Perform(TurnAction action);

    // ── Hooks subclasses may override ──
    protected virtual void OnTurnStarted() { }
    protected virtual void OnTurnEnded() { }
    protected virtual void OnTurnSkipped() => Debug.Log($"{name} is stunned and skips the turn");

    protected abstract bool IsAlive { get; }
}
```

```gdscript [Godot (GDScript)]
# turn_taker.gd (@abstract needs Godot 4.5+)
@abstract
class_name TurnTaker
extends Node2D

@export var max_action_points := 2
var action_points := 0

@onready var effects: StatusEffects = $StatusEffects


# The template method: the order of a turn is fixed here, for every unit.
# Subclasses implement the steps and hooks, never take_turn. Callers: await unit.take_turn()
func take_turn() -> void:
	effects.tick_turn()                    # 1. damage over time, durations
	if not _is_alive():
		return

	if effects.has_tag(&"stun"):           # 2. shared rule: stunned units skip
		_on_turn_skipped()
		return

	action_points = max_action_points      # 3. shared rule: regenerate AP
	_on_turn_started()                     #    hook (optional)

	while action_points > 0:
		var action: TurnAction = await _choose_action()  # 4. varies: player input, AI, ...
		if action == null:                                #    null = end turn early
			break
		await _perform(action)                            # 5. varies: animations, effects
		action_points -= action.cost

	_on_turn_ended()                       # 6. hook (optional)


# ── Steps subclasses must provide ──
@abstract func _choose_action() -> TurnAction
@abstract func _perform(action: TurnAction) -> void
@abstract func _is_alive() -> bool


# ── Hooks subclasses may override ──
func _on_turn_started() -> void:
	pass


func _on_turn_ended() -> void:
	pass


func _on_turn_skipped() -> void:
	print("%s is stunned and skips the turn" % name)
```

```cpp [Unreal (C++)]
// TurnTaker.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GameplayTagContainer.h"
#include "TurnTaker.generated.h"

class UStatusEffectComponent;

struct FTurnAction
{
	int32 Cost = 1;
	TWeakObjectPtr<AActor> Target;
	bool bAttack = false;                                    // attack the target, or move toward it
};

UCLASS(Abstract)
class ATurnTaker : public AActor
{
	GENERATED_BODY()

public:
	// The template method: the order of a turn is fixed here, for every unit.
	// (Not virtual: subclasses cannot reorder or skip the rules.) OnFinished runs when the turn is over.
	void TakeTurn(TFunction<void()> OnFinished);

protected:
	// ── Steps subclasses must provide (asynchronous: call the callback when done) ──
	virtual void ChooseAction(TFunction<void(TOptional<FTurnAction>)> OnChosen) PURE_VIRTUAL(ATurnTaker::ChooseAction, );
	virtual void Perform(const FTurnAction& Action, TFunction<void()> OnDone) PURE_VIRTUAL(ATurnTaker::Perform, );
	virtual bool IsAlive() const PURE_VIRTUAL(ATurnTaker::IsAlive, return false;);

	// ── Hooks subclasses may override ──
	virtual void OnTurnStarted() {}
	virtual void OnTurnEnded() {}
	virtual void OnTurnSkipped();

	UPROPERTY(EditAnywhere, Category = "Turn") int32 MaxActionPoints = 2;
	int32 ActionPoints = 0;

private:
	void NextAction();
	void EndTurn();

	TFunction<void()> OnTurnFinished;
};

// TurnTaker.cpp
#include "TurnTaker.h"
#include "StatusEffectComponent.h"   // TickTurn(), HasTag(FGameplayTag)

void ATurnTaker::TakeTurn(TFunction<void()> OnFinished)
{
	OnTurnFinished = MoveTemp(OnFinished);
	UStatusEffectComponent* Effects = FindComponentByClass<UStatusEffectComponent>();

	Effects->TickTurn();                                     // 1. damage over time, durations
	if (!IsAlive()) { OnTurnFinished(); return; }

	if (Effects->HasTag(FGameplayTag::RequestGameplayTag(TEXT("Status.Stun"))))   // 2. stunned units skip
	{
		OnTurnSkipped();
		OnTurnFinished();
		return;
	}

	ActionPoints = MaxActionPoints;                          // 3. shared rule: regenerate AP
	OnTurnStarted();                                         //    hook (optional)
	NextAction();
}

void ATurnTaker::NextAction()
{
	if (ActionPoints <= 0) { EndTurn(); return; }

	ChooseAction([this](TOptional<FTurnAction> Action)      // 4. varies: player input, AI, ...
	{
		if (!Action) { EndTurn(); return; }                  //    unset = end turn early
		Perform(*Action, [this, Cost = Action->Cost]         // 5. varies: animations, effects
		{
			ActionPoints -= Cost;
			NextAction();
		});
	});
}

void ATurnTaker::EndTurn()
{
	OnTurnEnded();                                           // 6. hook (optional)
	OnTurnFinished();
}

void ATurnTaker::OnTurnSkipped()
{
	UE_LOG(LogTemp, Log, TEXT("%s is stunned and skips the turn"), *GetName());
}
```

:::

### Two units filling in the steps

::: code-group

```csharp [Unity (C#)]
using System.Collections;
using UnityEngine;

public class GoblinAI : TurnTaker
{
    protected override bool IsAlive => GetComponent<Health>().IsAlive;

    protected override TurnAction ChooseAction()
    {
        var target = Board.NearestEnemyOf(this);
        if (target == null) return null;
        return Board.InMeleeRange(this, target) ? TurnAction.Attack(target) : TurnAction.MoveToward(target);
    }

    protected override IEnumerator Perform(TurnAction action) => action.Execute(this);
}

public class PlayerKnight : TurnTaker
{
    protected override bool IsAlive => GetComponent<Health>().IsAlive;
    protected override TurnAction ChooseAction() => PlayerInputQueue.TakeChosenAction();   // set by the UI
    protected override IEnumerator Perform(TurnAction action) => action.Execute(this);
    protected override void OnTurnStarted() => CameraRig.FocusOn(transform);              // optional hook
}
```

```gdscript [Godot (GDScript)]
# goblin_ai.gd
extends TurnTaker


func _is_alive() -> bool:
	return ($Health as Health).is_alive


func _choose_action() -> TurnAction:
	var target := Board.nearest_enemy_of(self)
	if target == null:
		return null
	return TurnAction.attack(target) if Board.in_melee_range(self, target) else TurnAction.move_toward(target)


func _perform(action: TurnAction) -> void:
	await action.execute(self)


# player_knight.gd
extends TurnTaker


func _is_alive() -> bool:
	return ($Health as Health).is_alive


func _choose_action() -> TurnAction:
	return await PlayerInput.action_chosen  # the UI emits the chosen action, or null to end the turn


func _perform(action: TurnAction) -> void:
	await action.execute(self)


func _on_turn_started() -> void:  # optional hook
	CameraRig.focus_on(self)
```

```cpp [Unreal (C++)]
// GoblinAI.h
UCLASS()
class AGoblinAI : public ATurnTaker
{
	GENERATED_BODY()

protected:
	virtual bool IsAlive() const override;

	virtual void ChooseAction(TFunction<void(TOptional<FTurnAction>)> OnChosen) override
	{
		AActor* Target = Board->NearestEnemyOf(this);
		if (!Target) { OnChosen({}); return; }
		FTurnAction Action;
		Action.Target = Target;
		Action.bAttack = Board->InMeleeRange(this, Target);
		OnChosen(Action);                                    // AI answers immediately
	}

	virtual void Perform(const FTurnAction& Action, TFunction<void()> OnDone) override;   // plays a montage, then OnDone()
};

// PlayerKnight.h
UCLASS()
class APlayerKnight : public ATurnTaker
{
	GENERATED_BODY()

protected:
	virtual bool IsAlive() const override;

	virtual void ChooseAction(TFunction<void(TOptional<FTurnAction>)> OnChosen) override
	{
		PendingChoice = MoveTemp(OnChosen);                  // the UI calls it when the player picks
	}

	virtual void Perform(const FTurnAction& Action, TFunction<void()> OnDone) override;
	virtual void OnTurnStarted() override { CameraRig->FocusOn(this); }   // optional hook

private:
	TFunction<void(TOptional<FTurnAction>)> PendingChoice;
};
```

:::

`TurnAction`, `Board`, `PlayerInputQueue` (or the UI) and `CameraRig` stand in for game-specific code. The player's `ChooseAction` waits for input: in Godot by awaiting a signal, in Unreal by keeping the callback until the UI calls it. A Unity version can make `ChooseAction` a coroutine too.

**Engine notes**

- **Unity:** The MonoBehaviour lifecycle is itself a template method: the engine owns the sequence (`Awake` → `OnEnable` → `Start` → `Update`…), and your scripts fill in hooks.
- **Godot:** The node lifecycle works the same way (`_enter_tree` → `_ready` → `_process`…); the leading underscore marks methods meant to be overridden. `@abstract` classes and methods need Godot 4.5+; in older versions, give the steps a body that calls `push_error("not implemented")`.
- **Unreal:** `PURE_VIRTUAL` stands in for `= 0`, because the engine must be able to construct every `UCLASS`, even abstract ones. To let Blueprints fill in a step, declare it `UFUNCTION(BlueprintNativeEvent)` (with a C++ `_Implementation` default) or `BlueprintImplementableEvent`. The lambdas capture `this`; if a unit can be destroyed mid-turn, capture a `TWeakObjectPtr` and check it.

## When to use

- Several classes share the *structure* of an algorithm but differ in some steps: turns, level loading sequences, AI update loops, attack sequences (wind-up → strike → recover), save/load pipelines.
- When the order of steps is a rule that must not be broken.

## When not to use

- When the steps vary more than the structure. Composition with [Strategy](./strategy) is more flexible than an inheritance contract.
- Deep inheritance chains where subclasses override hooks of hooks. Flatten them or use a [Subclass Sandbox](./subclass-sandbox).
- Algorithms with one implementation. Write it as a plain method; extract the template when a second variant appears.

## Pitfalls

- **Deep inheritance.** Template methods encourage hierarchies. If variations multiply (melee AI, ranged AI, flying ranged AI…), move the varying steps into [Strategy](./strategy) objects instead of subclasses.
- **Too many hooks.** A base class with fifteen virtual hooks is hard to understand. Keep hooks to the places where variation is actually needed.
- **Subclasses calling base steps out of order.** If subclasses can call `Perform` themselves, the sequence is no longer guaranteed. Keep step methods `protected`, and the template method non-virtual.
- **Forgetting `base.` calls.** Virtual hooks that do work in the base class break silently when an override forgets `base.OnTurnEnded()`. Keep hooks empty in the base class, so overriding them is always safe.

## Related

- [Subclass Sandbox](./subclass-sandbox) — the inverse: the subclass drives, and the base class offers tools.
- [Strategy](./strategy) — composition instead of inheritance for varying steps.
- [State](./state) — states often share a template for enter/update/exit.
- [Status Effects](./status-effects) and [Gameplay Tags](./tags) — the shared rules this example enforces.
