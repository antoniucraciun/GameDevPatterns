# Hierarchical State Machine

> Nest states inside super-states to share transitions and behaviour.

**Also known as:** HFSM · **Category:** Behavioral & Communication

## Problem

A character controller built as a flat [state machine](./state) has *Idle*, *Running*, *Crouching*, *Jumping* and *Falling*. Idle, Running and Crouching all need the same rules: jump when Jump is pressed, fall when the ground disappears, take hits. So the same transitions are copied into three states. Adding *Sliding* means copying them again, and fixing a bug in "fall when ungrounded" means fixing it three times. The number of transitions grows much faster than the number of states.

## Solution

Let states have a **parent**. *Idle*, *Running* and *Crouching* become children of a **Grounded** super-state, and *Jumping* and *Falling* children of **Airborne**.

- **Events bubble up.** The active leaf state gets the first chance to handle input or update. Whatever it does not handle is passed to its parent, then the grandparent. *Grounded* handles Jump and "lost the ground" once for all its children.
- **Shared behaviour lives in the parent.** Ground friction and the grounded check belong to *Grounded*.
- **Transitions exit and enter the right levels.** Going from *Running* to *Crouching* exits only *Running* and enters *Crouching*, because *Grounded* stays active. Going from *Running* to *Jumping* exits *Running* and *Grounded*, then enters *Airborne* and *Jumping*. The rule: exit up to the **lowest common ancestor**, then enter down to the target.

```
Grounded                    Airborne
├── Idle                    ├── Jumping
├── Running                 └── Falling
└── Crouching
```

## Example

A platformer character whose states nest: **Grounded** (Idle, Running, Crouching) and **Airborne** (Jumping, Falling). Jump and fall checks live once in the super-states instead of in every leaf.

### The machine

Updates go to the leaf first and bubble up until a state handles them. A transition exits states up to the common ancestor and enters down to the target.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public abstract class HState
{
    public HState Parent { get; }
    protected readonly CharacterContext Ctx;

    protected HState(CharacterContext ctx, HState parent) { Ctx = ctx; Parent = parent; }

    public virtual void Enter() { }
    public virtual void Exit() { }

    // Return true if handled. Unhandled updates bubble to the parent.
    public virtual bool Tick(float dt) => false;
}

public class HStateMachine
{
    public HState Current { get; private set; }

    public void Tick(float dt)
    {
        for (var s = Current; s != null; s = s.Parent)   // leaf first, then ancestors
            if (s.Tick(dt)) return;
    }

    public void ChangeTo(HState target)
    {
        var fromPath = PathFromRoot(Current);
        var toPath = PathFromRoot(target);

        int common = 0;                                  // length of the shared prefix
        while (common < fromPath.Count && common < toPath.Count && fromPath[common] == toPath[common])
            common++;

        for (int i = fromPath.Count - 1; i >= common; i--) fromPath[i].Exit();   // exit upward
        Current = target;
        for (int i = common; i < toPath.Count; i++) toPath[i].Enter();           // enter downward
    }

    static List<HState> PathFromRoot(HState s)
    {
        var path = new List<HState>();
        for (; s != null; s = s.Parent) path.Insert(0, s);
        return path;
    }
}
```

```gdscript [Godot (GDScript)]
# The hierarchy is the scene tree: a state's parent node is its super-state.
#   Character (CharacterBody2D)
#   └─ StateMachine
#      ├─ Grounded
#      │  ├─ Idle        (unique name %Idle)
#      │  ├─ Running     (%Running)
#      │  └─ Crouching   (%Crouching)
#      └─ Airborne
#         ├─ Jumping     (%Jumping)
#         └─ Falling     (%Falling)

# h_state.gd
class_name HState
extends Node

var ctx: Character           # set by the machine
var machine: HStateMachine

var parent_state: HState:
	get:
		return get_parent() as HState  # null at the top level


func enter() -> void:
	pass


func exit() -> void:
	pass


## Return true if handled. Unhandled updates bubble to the parent.
func update(_delta: float) -> bool:
	return false


# h_state_machine.gd
class_name HStateMachine
extends Node

@export var initial_state: HState
var current: HState


func _ready() -> void:
	await owner.ready
	_setup(self)
	change_to(initial_state)


func _setup(node: Node) -> void:
	for child in node.get_children():
		if child is HState:
			(child as HState).ctx = owner as Character
			(child as HState).machine = self
		_setup(child)


func physics_update(delta: float) -> void:
	var s := current
	while s != null:  # leaf first, then ancestors
		if s.update(delta):
			return
		s = s.parent_state


func change_to(target: HState) -> void:
	var from_path := _path_from_root(current)
	var to_path := _path_from_root(target)

	var common := 0  # length of the shared prefix
	while common < from_path.size() and common < to_path.size() and from_path[common] == to_path[common]:
		common += 1

	for i in range(from_path.size() - 1, common - 1, -1):
		from_path[i].exit()  # exit upward
	current = target
	for i in range(common, to_path.size()):
		to_path[i].enter()   # enter downward


func _path_from_root(s: HState) -> Array[HState]:
	var path: Array[HState] = []
	while s != null:
		path.push_front(s)
		s = s.parent_state
	return path
```

```cpp [Unreal (C++)]
// HStateMachine.h: plain C++, no UObjects, so nothing for the garbage collector to track.
#pragma once

#include "CoreMinimal.h"

class FHState
{
public:
	explicit FHState(FHState* InParent) : Parent(InParent) {}
	virtual ~FHState() = default;

	FHState* GetParent() const { return Parent; }

	virtual void Enter() {}
	virtual void Exit() {}

	// Return true if handled. Unhandled updates bubble to the parent.
	virtual bool Tick(float DeltaSeconds) { return false; }

private:
	FHState* Parent;
};

class FHStateMachine
{
public:
	FHState* GetCurrent() const { return Current; }

	void Tick(float DeltaSeconds)
	{
		for (FHState* S = Current; S; S = S->GetParent())   // leaf first, then ancestors
			if (S->Tick(DeltaSeconds)) return;
	}

	void ChangeTo(FHState* Target)
	{
		const FPath From = PathFromRoot(Current);
		const FPath To = PathFromRoot(Target);

		int32 Common = 0;                                     // length of the shared prefix
		while (Common < From.Num() && Common < To.Num() && From[Common] == To[Common])
			++Common;

		for (int32 i = From.Num() - 1; i >= Common; --i) From[i]->Exit();   // exit upward
		Current = Target;
		for (int32 i = Common; i < To.Num(); ++i) To[i]->Enter();          // enter downward
	}

private:
	using FPath = TArray<FHState*, TInlineAllocator<8>>;        // no heap allocation for shallow trees

	static FPath PathFromRoot(FHState* S)
	{
		FPath Path;
		for (; S; S = S->GetParent()) Path.Insert(S, 0);
		return Path;
	}

	FHState* Current = nullptr;
};
```

:::

### The character's states

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class CharacterContext
{
    public HStateMachine Machine = new();
    public Vector2 MoveInput;
    public bool JumpPressed, CrouchHeld, IsGrounded;
    public Rigidbody2D Body;

    public HState Grounded, Idle, Running, Crouching, Airborne, Jumping, Falling;
}

// ── Super-states: shared rules, written once ──

public class GroundedState : HState
{
    public GroundedState(CharacterContext c) : base(c, null) { }

    public override bool Tick(float dt)
    {
        if (Ctx.JumpPressed) { Ctx.Machine.ChangeTo(Ctx.Jumping); return true; }   // for ALL grounded children
        if (!Ctx.IsGrounded) { Ctx.Machine.ChangeTo(Ctx.Falling); return true; }
        return true;
    }
}

public class AirborneState : HState
{
    public AirborneState(CharacterContext c) : base(c, null) { }

    public override bool Tick(float dt)
    {
        if (Ctx.IsGrounded && Ctx.Body.linearVelocity.y <= 0f) { Ctx.Machine.ChangeTo(Ctx.Idle); return true; }
        return true;
    }
}

// ── Leaf states: only what is specific to them ──

public class IdleState : HState
{
    public IdleState(CharacterContext c, HState parent) : base(c, parent) { }

    public override bool Tick(float dt)
    {
        if (Ctx.CrouchHeld) { Ctx.Machine.ChangeTo(Ctx.Crouching); return true; }
        if (Ctx.MoveInput.x != 0f) { Ctx.Machine.ChangeTo(Ctx.Running); return true; }
        return false;                                   // let Grounded check jump and falling
    }
}

public class JumpingState : HState
{
    public JumpingState(CharacterContext c, HState parent) : base(c, parent) { }

    public override void Enter() => Ctx.Body.linearVelocity = new Vector2(Ctx.Body.linearVelocity.x, 12f);

    public override bool Tick(float dt)
    {
        if (Ctx.Body.linearVelocity.y < 0f) { Ctx.Machine.ChangeTo(Ctx.Falling); return true; }
        return false;                                   // let Airborne check landing
    }
}

// Running, Crouching and Falling follow the same shape. Wiring:
// ctx.Grounded = new GroundedState(ctx);
// ctx.Idle = new IdleState(ctx, ctx.Grounded);  ctx.Running = ...;  ctx.Crouching = ...;
// ctx.Airborne = new AirborneState(ctx);
// ctx.Jumping = new JumpingState(ctx, ctx.Airborne);  ctx.Falling = ...;
// ctx.Machine.ChangeTo(ctx.Idle);   // enters Grounded, then Idle
```

```gdscript [Godot (GDScript)]
# character.gd
class_name Character
extends CharacterBody2D

@export var jump_velocity := -400.0
var gravity: float = ProjectSettings.get_setting("physics/2d/default_gravity")
@onready var _machine: HStateMachine = $StateMachine


func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y += gravity * delta
	_machine.physics_update(delta)
	move_and_slide()


# ── Super-states: shared rules, written once ──

# grounded.gd
extends HState


func update(_delta: float) -> bool:
	if Input.is_action_just_pressed("jump"):
		machine.change_to(%Jumping)  # for ALL grounded children
	elif not ctx.is_on_floor():
		machine.change_to(%Falling)
	return true


# airborne.gd
extends HState


func update(_delta: float) -> bool:
	if ctx.is_on_floor() and ctx.velocity.y >= 0.0:  # y points down in 2D
		machine.change_to(%Idle)
	return true


# ── Leaf states: only what is specific to them ──

# idle.gd
extends HState


func update(_delta: float) -> bool:
	if Input.is_action_pressed("crouch"):
		machine.change_to(%Crouching)
		return true
	if Input.get_axis("move_left", "move_right") != 0.0:
		machine.change_to(%Running)
		return true
	return false  # let Grounded check jump and falling


# jumping.gd
extends HState


func enter() -> void:
	ctx.velocity.y = ctx.jump_velocity


func update(_delta: float) -> bool:
	if ctx.velocity.y > 0.0:
		machine.change_to(%Falling)
		return true
	return false  # let Airborne check landing

# Running, Crouching and Falling follow the same shape.
# Set the StateMachine's initial_state to Idle: it enters Grounded, then Idle.
```

```cpp [Unreal (C++)]
// CharacterStates.h
#pragma once

#include "HStateMachine.h"

class APlatformerCharacter;

class FCharacterState : public FHState
{
public:
	FCharacterState(APlatformerCharacter& InCharacter, FHState* InParent) : FHState(InParent), C(InCharacter) {}

protected:
	APlatformerCharacter& C;
};

// ── Super-states: shared rules, written once ──
class FGroundedState : public FCharacterState { public: using FCharacterState::FCharacterState; virtual bool Tick(float) override; };
class FAirborneState : public FCharacterState { public: using FCharacterState::FCharacterState; virtual bool Tick(float) override; };

// ── Leaf states: only what is specific to them ──
class FIdleState : public FCharacterState { public: using FCharacterState::FCharacterState; virtual bool Tick(float) override; };

class FJumpingState : public FCharacterState
{
public:
	using FCharacterState::FCharacterState;
	virtual void Enter() override;
	virtual bool Tick(float) override;
};

// PlatformerCharacter.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "CharacterStates.h"
#include "PlatformerCharacter.generated.h"

UCLASS()
class APlatformerCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	APlatformerCharacter();

	FHStateMachine Machine;
	FVector2D MoveInput = FVector2D::ZeroVector;          // written by Enhanced Input bindings
	bool bJumpPressed = false;
	bool bCrouchHeld = false;

	// Owned here; Running, Crouching and Falling follow the same shape.
	TUniquePtr<FHState> Grounded, Idle, Running, Crouching, Airborne, Jumping, Falling;

protected:
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
};

// PlatformerCharacter.cpp
#include "PlatformerCharacter.h"
#include "GameFramework/CharacterMovementComponent.h"

APlatformerCharacter::APlatformerCharacter()
{
	PrimaryActorTick.bCanEverTick = true;
}

void APlatformerCharacter::BeginPlay()
{
	Super::BeginPlay();
	Grounded = MakeUnique<FGroundedState>(*this, nullptr);
	Idle = MakeUnique<FIdleState>(*this, Grounded.Get());
	// Running = ...;  Crouching = ...;
	Airborne = MakeUnique<FAirborneState>(*this, nullptr);
	Jumping = MakeUnique<FJumpingState>(*this, Airborne.Get());
	// Falling = ...;
	Machine.ChangeTo(Idle.Get());                          // enters Grounded, then Idle
}

void APlatformerCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	Machine.Tick(DeltaSeconds);
	bJumpPressed = false;
}

bool FGroundedState::Tick(float)
{
	if (C.bJumpPressed) { C.Machine.ChangeTo(C.Jumping.Get()); return true; }   // for ALL grounded children
	if (!C.GetCharacterMovement()->IsMovingOnGround()) { C.Machine.ChangeTo(C.Falling.Get()); return true; }
	return true;
}

bool FAirborneState::Tick(float)
{
	if (C.GetCharacterMovement()->IsMovingOnGround()) { C.Machine.ChangeTo(C.Idle.Get()); return true; }
	return true;
}

bool FIdleState::Tick(float)
{
	if (C.bCrouchHeld) { C.Machine.ChangeTo(C.Crouching.Get()); return true; }
	if (!FMath::IsNearlyZero(C.MoveInput.X)) { C.Machine.ChangeTo(C.Running.Get()); return true; }
	return false;                                          // let Grounded check jump and falling
}

void FJumpingState::Enter()
{
	C.Jump();                                              // the movement component applies JumpZVelocity
}

bool FJumpingState::Tick(float)
{
	if (C.GetVelocity().Z < 0.f) { C.Machine.ChangeTo(C.Falling.Get()); return true; }
	return false;                                          // let Airborne check landing
}
```

:::

`ChangeTo` here finds the common ancestor by building two short paths, which is fine for shallow hierarchies. Cache the paths if transitions are frequent and hierarchies are deep.

**Engine notes**

- **Unity:** `Rigidbody2D.linearVelocity` is Unity 6; use `velocity` in older versions. Animator sub-state machines nest too, but they drive animation, not gameplay rules.
- **Godot:** Nesting state nodes makes the scene tree the hierarchy, so it is visible and editable in the editor. `%Name` lookups need **Access as Unique Name** turned on for those nodes, and only resolve within the same scene.
- **Unreal:** **StateTree** (UE 5.1+, plugin) is Unreal's built-in hierarchical state machine: states nest, a parent state's tasks keep running while a child is active, and transitions can be set on any level. Prefer it when designers author the states; hand-written code like this suits small, code-only machines.

## When to use

- State machines where groups of states share transitions: character controllers, enemy AI (*Combat* containing *Melee*, *Ranged* and *TakingCover*), UI flows.
- When a flat machine's transition count is clearly growing faster than its state count.

## When not to use

- Flat machines with a few states and little shared behaviour. The hierarchy adds indirection without saving anything.
- AI that chooses between many possible actions. A [Behavior Tree](./behavior-tree) or [Utility AI](./utility-ai) handles priorities more naturally.
- Interruptions that should return to wherever you were. Use a [Pushdown Automaton](./pushdown-automaton).

## Pitfalls

- **Parents that always handle.** If a super-state returns `true` without checking anything, its children's later checks never matter. Decide deliberately which level owns which decision.
- **Child-first versus parent-first.** Here children get the first chance, so they can override shared behaviour. Some designs let parents pre-empt (for example, "stunned" overrides everything). Choose one order and document it.
- **Entering a super-state directly.** `ChangeTo(Grounded)` leaves no leaf active. Either always target leaves, or give each super-state a default child to enter.
- **Deep hierarchies.** Three levels are usually enough. Deeper trees become hard to follow, and a [Behavior Tree](./behavior-tree) may suit the problem better.

## Related

- [State](./state) — the flat version this extends.
- [Pushdown Automaton](./pushdown-automaton) — adds a stack for interrupting and resuming states.
- [Behavior Tree](./behavior-tree) — an alternative for AI with many prioritised behaviours.
- [Tight Platformer Controller](../recipes/platformer-controller) — a flat two-state controller that this pattern would scale up.
