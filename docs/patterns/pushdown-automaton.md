# Pushdown Automaton

> A state machine with a stack, so states can be pushed and later resumed.

**Category:** Behavioral & Communication

## Problem

A character is *Running* when it gets stunned. When the stun ends, which state should it return to? A flat [state machine](./state) has no memory: the *Stunned* state must guess, or every state must remember where it came from. The same problem appears with "climb a ladder, then return to whatever you were doing", "open the map in the middle of combat", and "pause, open settings, back, back".

## Solution

Keep states on a **stack**. The top of the stack is the active state.

- **Push** a state to interrupt: the current state is **paused**, not exited, and the new one becomes active.
- **Pop** when the interruption ends: the top state exits, and the one below **resumes** exactly where it was.
- **Switch** (replace the top) for ordinary transitions that should not be remembered.

States get four hooks instead of two: `Enter` and `Exit` for entering and leaving the stack, and `Pause` and `Resume` for being covered and uncovered. A paused state keeps all its data: timers, targets, animation phase.

```
push Stunned            pop (stun ends)
┌──────────┐            ┌──────────┐
│ Stunned  │ ← active   │          │
├──────────┤            ├──────────┤
│ Running  │ paused     │ Running  │ ← resumed, same data
└──────────┘            └──────────┘
```

## Pseudocode

```text
StackState:
    enter()     // pushed onto the stack
    exit()      // popped off the stack
    pause()     // something was pushed on top; keep all data
    resume()    // the state on top was popped
    tick(dt)

StateStack:
    stack       // top = the only state that runs

    push(state):                // interrupt
        if stack not empty: top.pause()
        put state on top
        state.enter()

    pop():                      // the interruption is over
        if stack is empty: return
        take the top off; it.exit()
        if stack not empty: top.resume()   // continues where it was

    switch(state):              // a peer transition, not remembered
        if stack not empty: take the top off; it.exit()
        put state on top
        state.enter()

    tick(dt):
        if stack not empty: top.tick(dt)

Patrol is a StackState:
    waypoint                    // survives being paused
    resume(): play the walk animation again

Stunned is a StackState:
    remaining ← seconds
    enter(): play the stunned animation
    tick(dt):
        remaining ← remaining - dt
        if remaining ≤ 0: states.pop()   // back to whatever was running

push(Patrol)                    // at start
on stun(seconds): push(Stunned(seconds))   // knows nothing of what it covers
```

## Example

### Core

The stack itself has no engine types. Only the top state runs; the ones below it are paused, not exited, so they keep their progress.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public abstract class StackState
{
    public virtual void Enter() { }     // pushed onto the stack
    public virtual void Exit() { }      // popped off the stack
    public virtual void Pause() { }     // something was pushed on top
    public virtual void Resume() { }    // the state on top was popped
    public virtual void Tick(float dt) { }
}

public class StateStack
{
    readonly Stack<StackState> stack = new();
    public StackState Top => stack.Count > 0 ? stack.Peek() : null;

    public void Push(StackState state)
    {
        Top?.Pause();
        stack.Push(state);
        state.Enter();
    }

    public void Pop()
    {
        if (stack.Count == 0) return;
        stack.Pop().Exit();
        Top?.Resume();
    }

    public void Switch(StackState state)   // replace the top without remembering it
    {
        if (stack.Count > 0) stack.Pop().Exit();
        stack.Push(state);
        state.Enter();
    }

    public void Tick(float dt) => Top?.Tick(dt);
}
```

```gdscript [Godot (GDScript)]
# stack_state.gd
class_name StackState
extends RefCounted


func enter() -> void:  # pushed onto the stack
	pass


func exit() -> void:  # popped off the stack
	pass


func pause() -> void:  # something was pushed on top
	pass


func resume() -> void:  # the state on top was popped
	pass


func update(_delta: float) -> void:
	pass


# state_stack.gd
class_name StateStack
extends RefCounted

var _stack: Array[StackState] = []

var top: StackState:
	get:
		return null if _stack.is_empty() else _stack.back()


func push(state: StackState) -> void:
	if top != null:
		top.pause()
	_stack.push_back(state)
	state.enter()


func pop() -> void:
	if _stack.is_empty():
		return
	_stack.pop_back().exit()
	if top != null:
		top.resume()


func replace(state: StackState) -> void:  # replace the top without remembering it
	if not _stack.is_empty():
		_stack.pop_back().exit()
	_stack.push_back(state)
	state.enter()


func update(delta: float) -> void:
	if top != null:
		top.update(delta)
```

```cpp [Unreal (C++)]
// StateStack.h: plain C++; the stack owns its states.
#pragma once

#include "CoreMinimal.h"

class FStackState
{
public:
	virtual ~FStackState() = default;
	virtual void Enter() {}     // pushed onto the stack
	virtual void Exit() {}      // popped off the stack
	virtual void Pause() {}     // something was pushed on top
	virtual void Resume() {}    // the state on top was popped
	virtual void Tick(float DeltaSeconds) {}
};

class FStateStack
{
public:
	FStackState* Top() const { return Stack.Num() > 0 ? Stack.Last().Get() : nullptr; }

	void Push(TUniquePtr<FStackState> State)
	{
		if (FStackState* Current = Top()) Current->Pause();
		Stack.Add(MoveTemp(State));
		Stack.Last()->Enter();
	}

	void Pop()
	{
		if (Stack.Num() == 0) return;
		Retire(Stack.Pop());
		if (FStackState* Current = Top()) Current->Resume();
	}

	void Switch(TUniquePtr<FStackState> State)   // replace the top without remembering it
	{
		if (Stack.Num() > 0) Retire(Stack.Pop());
		Stack.Add(MoveTemp(State));
		Stack.Last()->Enter();
	}

	void Tick(float DeltaSeconds)
	{
		Retired.Reset();                          // safe now: no popped state is still on the call stack
		if (FStackState* Current = Top()) Current->Tick(DeltaSeconds);
	}

private:
	// A state may pop itself from inside its own Tick, so deleting it right away would
	// destroy the object whose function is still running. Keep it until the next Tick.
	void Retire(TUniquePtr<FStackState> State)
	{
		State->Exit();
		Retired.Add(MoveTemp(State));
	}

	TArray<TUniquePtr<FStackState>> Stack;
	TArray<TUniquePtr<FStackState>> Retired;
};
```

:::

### Interruptions that return to whatever was happening before

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class Character : MonoBehaviour
{
    public readonly StateStack States = new();
    public Animator Animator;

    void Start() => States.Push(new PatrolState(this));
    void Update() => States.Tick(Time.deltaTime);

    // Any system can interrupt: the stun knows nothing about what it interrupted.
    public void Stun(float seconds) => States.Push(new StunnedState(this, seconds));
}

public class PatrolState : StackState
{
    readonly Character c;
    int waypoint;                       // survives being paused
    public PatrolState(Character c) => this.c = c;

    public override void Resume() => c.Animator.Play("Walk");   // pick up where we left off
    public override void Tick(float dt) { /* walk toward waypoint, advance index on arrival */ }
}

public class StunnedState : StackState
{
    readonly Character c;
    float remaining;
    public StunnedState(Character c, float seconds) { this.c = c; remaining = seconds; }

    public override void Enter() => c.Animator.Play("Stunned");

    public override void Tick(float dt)
    {
        if ((remaining -= dt) <= 0f) c.States.Pop();   // return to whatever was running before
    }
}
```

```gdscript [Godot (GDScript)]
# enemy.gd
class_name Enemy
extends CharacterBody3D

var states := StateStack.new()
@onready var anim: AnimationPlayer = $AnimationPlayer


func _ready() -> void:
	states.push(PatrolState.new(self))


func _physics_process(delta: float) -> void:
	states.update(delta)


# Any system can interrupt: the stun knows nothing about what it interrupted.
func stun(seconds: float) -> void:
	states.push(StunnedState.new(self, seconds))


class PatrolState extends StackState:
	var _enemy: Enemy
	var _waypoint := 0  # survives being paused

	func _init(enemy: Enemy) -> void:
		_enemy = enemy

	func resume() -> void:
		_enemy.anim.play("walk")  # pick up where we left off

	func update(_delta: float) -> void:
		pass  # walk toward the waypoint, advance the index on arrival


class StunnedState extends StackState:
	var _enemy: Enemy
	var _remaining: float

	func _init(enemy: Enemy, seconds: float) -> void:
		_enemy = enemy
		_remaining = seconds

	func enter() -> void:
		_enemy.anim.play("stunned")

	func update(delta: float) -> void:
		_remaining -= delta
		if _remaining <= 0.0:
			_enemy.states.pop()  # return to whatever was running before
```

```cpp [Unreal (C++)]
// EnemyCharacter.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "StateStack.h"
#include "EnemyCharacter.generated.h"

class UAnimMontage;

UCLASS()
class AEnemyCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	AEnemyCharacter();

	// Any system can interrupt: the stun knows nothing about what it interrupted.
	void Stun(float Seconds);

	FStateStack States;

	UPROPERTY(EditDefaultsOnly, Category = "Animation") TObjectPtr<UAnimMontage> StunMontage;

protected:
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
};

// EnemyCharacter.cpp
#include "EnemyCharacter.h"

class FPatrolState : public FStackState
{
public:
	explicit FPatrolState(AEnemyCharacter& InEnemy) : Enemy(InEnemy) {}
	virtual void Tick(float DeltaSeconds) override { /* walk toward waypoint, advance index on arrival */ }

private:
	AEnemyCharacter& Enemy;
	int32 Waypoint = 0;                       // survives being paused
};

class FStunnedState : public FStackState
{
public:
	FStunnedState(AEnemyCharacter& InEnemy, float Seconds) : Enemy(InEnemy), Remaining(Seconds) {}

	virtual void Enter() override { Enemy.PlayAnimMontage(Enemy.StunMontage); }
	virtual void Exit() override { Enemy.StopAnimMontage(Enemy.StunMontage); }

	virtual void Tick(float DeltaSeconds) override
	{
		if ((Remaining -= DeltaSeconds) <= 0.f) Enemy.States.Pop();   // return to whatever was running before
	}

private:
	AEnemyCharacter& Enemy;
	float Remaining;
};

AEnemyCharacter::AEnemyCharacter()
{
	PrimaryActorTick.bCanEverTick = true;
}

void AEnemyCharacter::BeginPlay()
{
	Super::BeginPlay();
	States.Push(MakeUnique<FPatrolState>(*this));
}

void AEnemyCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	States.Tick(DeltaSeconds);
}

void AEnemyCharacter::Stun(float Seconds)
{
	States.Push(MakeUnique<FStunnedState>(*this, Seconds));
}
```

:::

The same structure drives game flow (*Playing* → push *Paused* → push *Settings* → pop → pop), which is what a [Screen Stack](./screen-stack) does for UI.

**Engine notes**

- **Unity:** The Animator has no stack of its own; the states call `Animator.Play` on enter and resume, as here.
- **Godot:** `RefCounted` states are freed when the stack drops them, so there is nothing to clean up. Inner classes keep small states next to the node that uses them.
- **Unreal:** Owning states with `TUniquePtr` frees them on pop, which is why a state that pops itself must not be deleted mid-`Tick` (the `Retired` list above). For purely visual interruptions, an animation montage already plays over the current animation and blends back when it ends.

## When to use

- Interruptions that should return to the previous state: stuns, knockdowns, cutscenes, dialogues, ladders, vehicles, menus.
- Nested modes where "back" means "where I was", not a fixed state.

## When not to use

- Transitions that never need to return. A plain [State](./state) machine is simpler.
- Deep or unbounded stacks, such as a stun during a stun during a cutscene. Cap the stack or the player can get stuck in old states.
- Menus only. If states are UI screens, a [Screen Stack](./screen-stack) is the same idea with UI-specific features.

## Pitfalls

- **Pushing what should be switched.** If *Walk → Run → Walk → Run* is done with pushes, the stack grows forever. Use `Switch` for peer transitions, and `Push` only for interruptions.
- **Stale paused states.** A paused *Attack* state targeting an enemy that died during the stun resumes against nothing. Re-validate in `Resume`.
- **Interruptions of interruptions.** A second stun pushed during the first gives two stun states, popping one at a time. Decide whether repeated interruptions stack, refresh or are ignored.
- **Popping from the wrong place.** Only the top state should pop itself, or a manager on its behalf. Popping while another state is on top removes the wrong one.
- **Only the top runs.** Paused states do not tick. If something must keep running underneath (a cooldown timer), move it out of the state, or tick paused states explicitly.

## Related

- [State](./state) — the flat machine without memory.
- [Hierarchical State Machine](./hierarchical-state-machine) — nesting by structure rather than by time.
- [Screen Stack](./screen-stack) — this pattern applied to menus.
- [Game State Manager](./game-state-manager) — can use a stack so *Paused* sits on top of *Playing*.
- [Memento](./memento) — an alternative way to return to an earlier state, by snapshot.
