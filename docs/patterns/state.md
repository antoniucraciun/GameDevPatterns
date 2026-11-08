# State

> Let an object change its behaviour when its internal state changes.

**Also known as:** Finite State Machine, FSM · **Category:** Behavioral & Communication

## Problem

A player controller starts with a few booleans: `isJumping`, `isCrouching`, `isAttacking`, `isDashing`. Each new mechanic adds another flag and more `if` checks. Soon you hit bugs where the player is somehow jumping and crouching at once, or can dash out of a stun. The combinations grow exponentially, and nothing enforces which combinations are legal.

## Solution

Model the object as being in exactly **one state** at a time. Each state is an object that handles input and updates for that mode, and decides when to **transition** to another state. States get `Enter` and `Exit` hooks for setup and cleanup, such as starting an animation or resetting a timer. Illegal combinations cannot happen because only one state is active.

## Pseudocode

```text
// Every state offers the same hooks; the machine only knows this shape.
State:
    enter()          // setup: start an animation, apply a jump
    exit()           // cleanup
    tick(dt)         // this mode's rules, and when to leave it

StateMachine:
    current          // exactly one active state

    change_to(next):
        if current exists: current.exit()
        current ← next
        current.enter()

    tick(dt):
        current.tick(dt)

Grounded is a State:
    tick(dt):
        move the player at full speed
        if jump pressed or no ground below:
            machine.change_to(Airborne)

Airborne is a State:
    enter():
        if jump pressed: jump        // walking off a ledge does not jump
    tick(dt):
        move the player at 60% speed // reduced air control
        if on the ground and not rising:
            machine.change_to(Grounded)

// The player creates each state once and reuses it.
machine.change_to(Grounded)
every frame: machine.tick(dt)
```

## Example

A platformer character with two states, **Grounded** and **Airborne**. Each state owns its own movement rules and decides when to hand over to the other.

### The machine and its states

::: code-group

```csharp [Unity (C#)]
public abstract class State
{
    protected readonly PlayerController player;
    protected State(PlayerController player) => this.player = player;
    public virtual void Enter() { }
    public virtual void Exit() { }
    public abstract void Tick(float dt);
}

public class StateMachine
{
    public State Current { get; private set; }

    public void ChangeTo(State next)
    {
        Current?.Exit();
        Current = next;
        Current.Enter();
    }

    public void Tick(float dt) => Current?.Tick(dt);
}

public class GroundedState : State
{
    public GroundedState(PlayerController p) : base(p) { }

    public override void Tick(float dt)
    {
        player.Move(player.InputX);
        if (player.JumpPressed || !player.IsGrounded)
            player.Machine.ChangeTo(player.Airborne);
    }
}

public class AirborneState : State
{
    public AirborneState(PlayerController p) : base(p) { }
    public override void Enter() { if (player.JumpPressed) player.Jump(); }

    public override void Tick(float dt)
    {
        player.Move(player.InputX * 0.6f);              // reduced air control
        if (player.IsGrounded && player.VerticalSpeed <= 0f) player.Machine.ChangeTo(player.Grounded);
    }
}
```

```gdscript [Godot (GDScript)]
# One child node per state, under a StateMachine node:
#   Player (CharacterBody2D)
#   └─ StateMachine
#      ├─ Grounded
#      └─ Airborne

# state.gd
class_name State
extends Node

var player: Player         # set by the StateMachine
var machine: StateMachine


func enter() -> void:
	pass


func exit() -> void:
	pass


func physics_update(_delta: float) -> void:
	pass


# state_machine.gd
class_name StateMachine
extends Node

@export var initial_state: State
var current: State


func _ready() -> void:
	await owner.ready  # children are ready before the player; wait for its @onready vars
	for child in get_children():
		var state := child as State
		state.player = owner as Player
		state.machine = self
	change_to(initial_state.name)


func change_to(state_name: String) -> void:
	if current:
		current.exit()
	current = get_node(state_name) as State
	current.enter()


func physics_update(delta: float) -> void:
	if current:
		current.physics_update(delta)


# grounded.gd
extends State


func physics_update(_delta: float) -> void:
	player.move(Input.get_axis("move_left", "move_right"))
	if Input.is_action_just_pressed("jump") or not player.is_on_floor():
		machine.change_to("Airborne")


# airborne.gd
extends State


func enter() -> void:
	if Input.is_action_just_pressed("jump"):
		player.velocity.y = player.jump_velocity


func physics_update(delta: float) -> void:
	player.velocity.y += player.gravity * delta
	player.move(Input.get_axis("move_left", "move_right") * 0.6)  # reduced air control
	if player.is_on_floor():
		machine.change_to("Grounded")
```

```cpp [Unreal (C++)]
// PlayerMoveState.h: states are UObjects owned by the character, created once and reused.
#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "PlayerMoveState.generated.h"

class APlatformerCharacter;

UCLASS(Abstract)
class UPlayerMoveState : public UObject
{
	GENERATED_BODY()

public:
	virtual void Enter(APlatformerCharacter& Player) {}
	virtual void Exit(APlatformerCharacter& Player) {}
	virtual void Tick(APlatformerCharacter& Player, float DeltaSeconds) {}
};

UCLASS()
class UGroundedState : public UPlayerMoveState
{
	GENERATED_BODY()

public:
	virtual void Tick(APlatformerCharacter& Player, float DeltaSeconds) override;
};

UCLASS()
class UAirborneState : public UPlayerMoveState
{
	GENERATED_BODY()

public:
	virtual void Enter(APlatformerCharacter& Player) override;
	virtual void Tick(APlatformerCharacter& Player, float DeltaSeconds) override;
};

// PlayerMoveState.cpp
#include "PlayerMoveState.h"
#include "PlatformerCharacter.h"
#include "GameFramework/CharacterMovementComponent.h"

void UGroundedState::Tick(APlatformerCharacter& Player, float DeltaSeconds)
{
	Player.AddMovementInput(FVector::ForwardVector, Player.InputX);
	if (Player.bJumpPressed || !Player.GetCharacterMovement()->IsMovingOnGround())
		Player.ChangeState(Player.Airborne);
}

void UAirborneState::Enter(APlatformerCharacter& Player)
{
	if (Player.bJumpPressed) Player.Jump();
}

void UAirborneState::Tick(APlatformerCharacter& Player, float DeltaSeconds)
{
	Player.AddMovementInput(FVector::ForwardVector, Player.InputX * 0.6f);   // reduced air control
	if (Player.GetCharacterMovement()->IsMovingOnGround())
		Player.ChangeState(Player.Grounded);
}
```

:::

### The character that owns them

Create state instances once and reuse them, so transitions do not allocate.

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

[RequireComponent(typeof(Rigidbody2D))]
public class PlayerController : MonoBehaviour
{
    [SerializeField] float speed = 6f, jumpVelocity = 12f;
    [SerializeField] LayerMask groundMask;

    public readonly StateMachine Machine = new();
    public State Grounded { get; private set; }
    public State Airborne { get; private set; }

    public float InputX { get; private set; }
    public bool JumpPressed { get; private set; }
    public bool IsGrounded { get; private set; }
    public float VerticalSpeed => body.linearVelocity.y;

    Rigidbody2D body;

    void Awake()
    {
        body = GetComponent<Rigidbody2D>();
        Grounded = new GroundedState(this);
        Airborne = new AirborneState(this);
        Machine.ChangeTo(Grounded);
    }

    void Update()
    {
        InputX = Input.GetAxisRaw("Horizontal");
        JumpPressed = Input.GetButtonDown("Jump");
        IsGrounded = Physics2D.Raycast(transform.position, Vector2.down, 1.05f, groundMask);
        Machine.Tick(Time.deltaTime);
    }

    public void Move(float x) => body.linearVelocity = new Vector2(x * speed, body.linearVelocity.y);
    public void Jump() => body.linearVelocity = new Vector2(body.linearVelocity.x, jumpVelocity);
}
```

```gdscript [Godot (GDScript)]
# player.gd
class_name Player
extends CharacterBody2D

@export var speed := 300.0
@export var jump_velocity := -400.0  # negative is up in 2D

var gravity: float = ProjectSettings.get_setting("physics/2d/default_gravity")

@onready var _machine: StateMachine = $StateMachine


func _physics_process(delta: float) -> void:
	_machine.physics_update(delta)  # the state sets velocity...
	move_and_slide()                # ...the body applies it


func move(input_x: float) -> void:
	velocity.x = input_x * speed
```

```cpp [Unreal (C++)]
// PlatformerCharacter.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "PlatformerCharacter.generated.h"

class UPlayerMoveState;

UCLASS()
class APlatformerCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	APlatformerCharacter();

	void ChangeState(UPlayerMoveState* Next);

	UPROPERTY() TObjectPtr<UPlayerMoveState> Grounded;
	UPROPERTY() TObjectPtr<UPlayerMoveState> Airborne;

	float InputX = 0.f;            // written by Enhanced Input bindings
	bool bJumpPressed = false;

protected:
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

private:
	UPROPERTY() TObjectPtr<UPlayerMoveState> Current;
};

// PlatformerCharacter.cpp
#include "PlatformerCharacter.h"
#include "PlayerMoveState.h"

APlatformerCharacter::APlatformerCharacter()
{
	PrimaryActorTick.bCanEverTick = true;
}

void APlatformerCharacter::BeginPlay()
{
	Super::BeginPlay();
	Grounded = NewObject<UGroundedState>(this);
	Airborne = NewObject<UAirborneState>(this);
	ChangeState(Grounded);
}

void APlatformerCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (Current) Current->Tick(*this, DeltaSeconds);
	bJumpPressed = false;          // a press is consumed by one tick
}

void APlatformerCharacter::ChangeState(UPlayerMoveState* Next)
{
	if (Current) Current->Exit(*this);
	Current = Next;
	Current->Enter(*this);
}
```

:::

**Engine notes**

- **Unity:** `Rigidbody2D.linearVelocity` is Unity 6; use `velocity` in older versions. The Animator's state machine is for animation; driving gameplay rules from it couples them to animation timing.
- **Godot:** Node-per-state keeps each state's script and `@export` tuning visible in the scene tree. `AnimationTree`'s state machine is for animation, not gameplay logic. The `await owner.ready` is needed because child nodes are ready before their parent.
- **Unreal:** The `CharacterMovementComponent` already tracks walking versus falling (`MovementMode`, `OnMovementModeChanged`, `Landed`), so a simple grounded/airborne split can listen to it instead. For larger or designer-edited state machines, use **StateTree** (UE 5.1+, plugin). States are `UPROPERTY` so the garbage collector keeps them alive.

## When to use

- An entity has distinct modes with different behaviour and clear rules for moving between them: player movement, enemy AI, doors, weapons.
- Top-level game flow: boot, menu, playing, paused, game over.

## When not to use

- Objects with two or three modes and simple rules. An enum and a `switch` is clearer than a class per state.
- When the number of states and transitions explodes. Shared transitions belong in a [Hierarchical State Machine](./hierarchical-state-machine), and AI that picks from many options suits a [Behavior Tree](./behavior-tree), [Utility AI](./utility-ai) or [GOAP](./goap).
- Several independent modes at once, such as moving and reloading. Use one state machine per concern, not one machine with every combination.

## Pitfalls

- **State explosion.** Many states that share most of their transitions call for a [Hierarchical State Machine](./hierarchical-state-machine).
- **Needing to resume a previous state**, for example "pause, then return to what I was doing", calls for a [Pushdown Automaton](./pushdown-automaton).
- **Parallel concerns in one machine.** Movement and weapon state are independent. Use two machines, not a cross-product of states.
- **Transitions scattered everywhere.** Keep transition logic inside states, or in one transition table, but not both.

## Related

- [Hierarchical State Machine](./hierarchical-state-machine) and [Pushdown Automaton](./pushdown-automaton) — the extended forms.
- [Strategy](./strategy) — similar structure, but chosen from outside rather than switching itself.
- [Behavior Tree](./behavior-tree) — an alternative for AI that scales better with many behaviours.
- [Command](./command) — states often produce or consume commands.
