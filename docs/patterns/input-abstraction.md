# Input Abstraction

> Map physical buttons to game actions so code never reads raw keys.

**Also known as:** Action Mapping · **Category:** Game Feel & Input

## Problem

The player controller checks whether Space was pressed. Then gamepad support is needed, so the check grows into `Space || JoystickButton0`. Then a player asks to rebind jump. Then the inventory screen also uses Space, and opening it makes the character jump. Then the AI should drive the same controller, and the replay system should feed it recorded input. Every one of these changes touches gameplay code, because gameplay talks to *keys* instead of *intentions*.

## Solution

Put a layer between devices and gameplay:

- **Actions** describe intent: *Move*, *Jump*, *Attack*, *Interact*, *Pause*. Gameplay reads only actions.
- **Bindings** connect actions to device inputs: Space, gamepad South button, a touch button. They live in data, so players can rebind them.
- **Action maps** group actions by context (*Gameplay*, *UI*, *Vehicle*). Only the active map's actions fire, so opening a menu disables gameplay actions instead of every script checking "is a menu open?".
- An **interface** in front of gameplay (`ICharacterInput`) lets the player, the AI or a replay drive the same character.

## Pseudocode

```text
// What gameplay sees: intents, never keys.
CharacterInput:
    move()              // a direction
    jump_pressed()      // true for one frame
    attack_held()

// Bindings are data: each action lists the device inputs that trigger it.
Gameplay map:
    Move   ← W/A/S/D, left stick
    Jump   ← Space, gamepad South button
    Attack ← left mouse button, right trigger

PlayerInputSource is a CharacterInput:
    move():          return the value of Move
    jump_pressed():  return whether Jump was pressed this frame
    attack_held():   return whether Attack is down

    set_gameplay_enabled(on):   // a menu turns the whole map off
        enable or disable the gameplay map

    rebind(action):
        disable action
        wait for the next button press b
        replace action's keyboard binding with b
        save all binding overrides; enable action

ChaseAiInput is a CharacterInput:   // an AI drives the same character
    move():          return the flat direction from self to target, normalised
    jump_pressed():  return false
    attack_held():   return distance to target < 2

CharacterMotor, every frame:
    if no input is assigned: do nothing
    move by input.move() × speed × frame time
    if input.jump_pressed(): jump
```

## Example

Each engine ships an input-action system, so the example uses it rather than reading devices directly: Unity's **Input System** package, Godot's **Input Map**, and Unreal's **Enhanced Input**. The first group defines the actions, switches context and rebinds; the second shows gameplay that reads only intents, so an AI can drive the same character.

::: code-group

```csharp [Unity (C#)]
using UnityEngine;
using UnityEngine.InputSystem;

// What gameplay sees: intentions, not devices.
public interface ICharacterInput
{
    Vector2 Move { get; }
    bool JumpPressed { get; }     // true for one frame
    bool AttackHeld { get; }
}

// Actions are defined in code here so the example is self-contained. In a project you would
// normally use an Input Actions asset and its generated C# class.
public class PlayerInputSource : ICharacterInput, System.IDisposable
{
    readonly InputActionMap gameplay = new("Gameplay");
    readonly InputAction move, jump, attack;

    public PlayerInputSource()
    {
        move = gameplay.AddAction("Move", InputActionType.Value);
        move.AddCompositeBinding("2DVector")
            .With("Up", "<Keyboard>/w").With("Down", "<Keyboard>/s")
            .With("Left", "<Keyboard>/a").With("Right", "<Keyboard>/d");
        move.AddBinding("<Gamepad>/leftStick");

        jump = gameplay.AddAction("Jump", InputActionType.Button);
        jump.AddBinding("<Keyboard>/space");
        jump.AddBinding("<Gamepad>/buttonSouth");

        attack = gameplay.AddAction("Attack", InputActionType.Button);
        attack.AddBinding("<Mouse>/leftButton");
        attack.AddBinding("<Gamepad>/rightTrigger");

        gameplay.Enable();
    }

    public Vector2 Move => move.ReadValue<Vector2>();
    public bool JumpPressed => jump.WasPressedThisFrame();
    public bool AttackHeld => attack.IsPressed();

    // Context switching: opening a menu disables gameplay actions entirely.
    public void SetGameplayEnabled(bool enabled) { if (enabled) gameplay.Enable(); else gameplay.Disable(); }

    // Rebinding: let the player press a new button for Jump, then save all overrides.
    // The action must be disabled while rebinding.
    public void RebindJump(System.Action onDone)
    {
        jump.Disable();
        jump.PerformInteractiveRebinding(bindingIndex: 0)          // rebinds the keyboard binding
            .WithControlsExcluding("<Mouse>/position")
            .OnComplete(op =>
            {
                op.Dispose();
                jump.Enable();
                PlayerPrefs.SetString("bindings", gameplay.SaveBindingOverridesAsJson());
                onDone();
            })
            .OnCancel(op => { op.Dispose(); jump.Enable(); })
            .Start();
    }

    public void LoadBindings()
    {
        var json = PlayerPrefs.GetString("bindings", "");
        if (!string.IsNullOrEmpty(json)) gameplay.LoadBindingOverridesFromJson(json);
    }

    public void Dispose() => gameplay.Dispose();
}
```

```gdscript [Godot (GDScript)]
# Actions ("move_left", "move_right", "move_up", "move_down", "jump", "attack") and their keys,
# buttons and sticks are defined in Project Settings > Input Map.

# character_input.gd: what gameplay sees. GDScript has no interfaces, so this is a base class.
class_name CharacterInput
extends RefCounted


func get_move() -> Vector2:
	return Vector2.ZERO


func is_jump_pressed() -> bool:  # true for one frame
	return false


func is_attack_held() -> bool:
	return false


# player_input_source.gd
class_name PlayerInputSource
extends CharacterInput

# Context switching: Godot has no action maps, so a menu turns gameplay input off here.
var enabled := true


func get_move() -> Vector2:
	if not enabled:
		return Vector2.ZERO
	return Input.get_vector("move_left", "move_right", "move_up", "move_down")


func is_jump_pressed() -> bool:
	return enabled and Input.is_action_just_pressed("jump")


func is_attack_held() -> bool:
	return enabled and Input.is_action_pressed("attack")


# rebinder.gd: autoload. Waits for the next key press, replaces the action's keyboard binding
# (gamepad bindings are kept) and saves it.
extends Node

const SAVE_PATH := "user://bindings.cfg"

var _waiting_for: StringName = &""


func _ready() -> void:
	load_bindings()


func start_rebind(action: StringName) -> void:
	_waiting_for = action


func _input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if _waiting_for == &"" or key == null or not key.pressed or key.echo:
		return
	get_viewport().set_input_as_handled()
	if key.physical_keycode != KEY_ESCAPE:  # Escape cancels
		_set_key(_waiting_for, key.physical_keycode)
		var config := ConfigFile.new()
		config.load(SAVE_PATH)  # fine if the file doesn't exist yet
		config.set_value("keyboard", _waiting_for, key.physical_keycode)
		config.save(SAVE_PATH)
	_waiting_for = &""


func load_bindings() -> void:
	var config := ConfigFile.new()
	if config.load(SAVE_PATH) != OK:
		return
	for action in config.get_section_keys("keyboard"):
		_set_key(action, config.get_value("keyboard", action))


func _set_key(action: StringName, keycode: Key) -> void:
	for old in InputMap.action_get_events(action):
		if old is InputEventKey:
			InputMap.action_erase_event(action, old)
	var key := InputEventKey.new()
	key.physical_keycode = keycode  # physical: the same key position on every keyboard layout
	InputMap.action_add_event(action, key)
```

```cpp [Unreal (C++)]
// The actions and their keys live in assets:
//   IA_Move   (Value Type: Axis2D) mapped to WASD (with Swizzle/Negate modifiers) and the left stick
//   IA_Jump   (Digital)            mapped to Space Bar and Gamepad Face Button Bottom
//   IA_Attack (Digital)            mapped to Left Mouse Button and Gamepad Right Trigger
//   IMC_Gameplay and IMC_Menu: Input Mapping Contexts, the equivalent of action maps.

// GamePlayerController.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "GamePlayerController.generated.h"

class UInputMappingContext;

UCLASS()
class AGamePlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	// Context switching: swap mapping contexts instead of checking "is a menu open?" everywhere.
	void SetGameplayEnabled(bool bEnabled);

protected:
	virtual void BeginPlay() override;

	UPROPERTY(EditDefaultsOnly, Category = "Input") TObjectPtr<UInputMappingContext> GameplayContext;
	UPROPERTY(EditDefaultsOnly, Category = "Input") TObjectPtr<UInputMappingContext> MenuContext;
};

// GamePlayerController.cpp
#include "GamePlayerController.h"
#include "EnhancedInputSubsystems.h"
#include "InputMappingContext.h"

void AGamePlayerController::BeginPlay()
{
	Super::BeginPlay();
	SetGameplayEnabled(true);
}

void AGamePlayerController::SetGameplayEnabled(bool bEnabled)
{
	UEnhancedInputLocalPlayerSubsystem* Input =
		ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(GetLocalPlayer());
	if (!Input) return;

	Input->RemoveMappingContext(bEnabled ? MenuContext : GameplayContext);
	Input->AddMappingContext(bEnabled ? GameplayContext : MenuContext, /*Priority*/ 0);
}
```

:::

Gameplay depends only on intents, so other sources plug in without changes:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class CharacterMotor : MonoBehaviour
{
    public ICharacterInput Input { get; set; }       // assigned by whoever controls this character

    void Update()
    {
        if (Input == null) return;
        Vector2 m = Input.Move;
        transform.position += new Vector3(m.x, 0f, m.y) * (5f * Time.deltaTime);
        if (Input.JumpPressed) { /* jump */ }
    }
}

// An AI drives the same motor by implementing the same interface.
public class ChaseAiInput : ICharacterInput
{
    readonly Transform self, target;
    public ChaseAiInput(Transform self, Transform target) { this.self = self; this.target = target; }

    public Vector2 Move
    {
        get { var d = target.position - self.position; return new Vector2(d.x, d.z).normalized; }
    }
    public bool JumpPressed => false;
    public bool AttackHeld => Vector3.Distance(self.position, target.position) < 2f;
}
```

```gdscript [Godot (GDScript)]
# character_motor.gd
extends CharacterBody3D

@export var speed := 5.0
var input: CharacterInput  # assigned by whoever controls this character


func _physics_process(_delta: float) -> void:
	if input == null:
		return
	var m := input.get_move()
	velocity = Vector3(m.x, velocity.y, m.y) * Vector3(speed, 1.0, speed)
	if input.is_jump_pressed():
		pass  # jump
	move_and_slide()


# chase_ai_input.gd: an AI drives the same motor through the same base class.
class_name ChaseAiInput
extends CharacterInput

var _body: Node3D
var _target: Node3D


func _init(body: Node3D, target: Node3D) -> void:
	_body = body
	_target = target


func get_move() -> Vector2:
	var d := _target.global_position - _body.global_position
	return Vector2(d.x, d.z).normalized()


func is_attack_held() -> bool:
	return _body.global_position.distance_to(_target.global_position) < 2.0
```

```cpp [Unreal (C++)]
// In Unreal the Pawn / Controller split is the abstraction: the character exposes intents, and a
// PlayerController (through Enhanced Input) or an AIController calls the same functions.

// GameCharacter.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "InputActionValue.h"
#include "GameCharacter.generated.h"

class UInputAction;

UCLASS()
class AGameCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	// Intents: called by player input and by AI alike.
	void MoveIntent(FVector2D Direction);       // X = right, Y = forward
	void SetAttackHeld(bool bHeld) { bAttackHeld = bHeld; }

	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

protected:
	UPROPERTY(EditDefaultsOnly, Category = "Input") TObjectPtr<UInputAction> MoveAction;
	UPROPERTY(EditDefaultsOnly, Category = "Input") TObjectPtr<UInputAction> JumpAction;
	UPROPERTY(EditDefaultsOnly, Category = "Input") TObjectPtr<UInputAction> AttackAction;

private:
	void OnMove(const FInputActionValue& Value) { MoveIntent(Value.Get<FVector2D>()); }
	void OnAttackStarted() { SetAttackHeld(true); }
	void OnAttackCompleted() { SetAttackHeld(false); }

	bool bAttackHeld = false;
};

// GameCharacter.cpp
#include "GameCharacter.h"
#include "EnhancedInputComponent.h"

void AGameCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);
	UEnhancedInputComponent* Input = CastChecked<UEnhancedInputComponent>(PlayerInputComponent);
	Input->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AGameCharacter::OnMove);
	Input->BindAction(JumpAction, ETriggerEvent::Started, this, &ACharacter::Jump);
	Input->BindAction(JumpAction, ETriggerEvent::Completed, this, &ACharacter::StopJumping);
	Input->BindAction(AttackAction, ETriggerEvent::Started, this, &AGameCharacter::OnAttackStarted);
	Input->BindAction(AttackAction, ETriggerEvent::Completed, this, &AGameCharacter::OnAttackCompleted);
}

void AGameCharacter::MoveIntent(FVector2D Direction)
{
	AddMovementInput(FVector::ForwardVector, Direction.Y);
	AddMovementInput(FVector::RightVector, Direction.X);
}

// ChaseAIController.cpp: an AI drives the same pawn through the same intents.
// (For real navigation, use MoveToActor and the navmesh; this mirrors the other tabs.)
void AChaseAIController::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	AGameCharacter* Self = Cast<AGameCharacter>(GetPawn());
	if (!Self || !Target) return;                      // UPROPERTY() TObjectPtr<AActor> Target;

	const FVector ToTarget = Target->GetActorLocation() - Self->GetActorLocation();
	Self->MoveIntent(FVector2D(ToTarget.Y, ToTarget.X).GetSafeNormal());
	Self->SetAttackHeld(ToTarget.Size() < 200.f);      // centimetres
}
```

:::

**Engine notes**

- **Unity:** needs the **Input System** package (`com.unity.inputsystem`). The **Player Input** component can create the action asset, switch action maps and handle split-screen device assignment for you.
- **Godot:** the Input Map is built in, and `Input.get_vector` applies the deadzone. There are no action maps: turn gameplay input off yourself, as here, or read gameplay input in `_unhandled_input` so focused UI controls consume events first. Rebinding uses `InputMap.action_erase_event` and `action_add_event`; the bindings aren't saved automatically.
- **Unreal:** Enhanced Input is the default input system in UE 5.1 and later. Triggers such as **Pressed**, **Hold** and **Tap** and modifiers such as **Dead Zone**, **Swizzle** and **Negate** are set on the action or the mapping, not in code. Player rebinding and saving is handled by **Enhanced Input User Settings** (UE 5.3+, enabled in Project Settings), which stores player-mapped keys per mapping context.

## When to use

- Every game with more than one input device, rebindable controls or menus. In practice, every shipped game.
- When AI, replays, networking or tests need to drive the same characters as the player.

## When not to use

- Game jams and prototypes with one device and fixed controls. Reading input directly is faster.
- Duplicating what the engine's input system already does. Unity's Input System, Godot's Input Map and Unreal's Enhanced Input are input abstractions with actions and bindings; build on them instead of wrapping them again.

## Pitfalls

- **Raw input leaking back.** A single `Keyboard.current.spaceKey` in gameplay code bypasses rebinding and context switching. Search for direct device access and route it through actions.
- **One-frame actions in the fixed step.** Unity's `WasPressedThisFrame` is a frame concept, so checking it in `FixedUpdate` misses or doubles presses. Latch presses in the per-frame update (see [Input Buffer](./input-buffer)) or use callbacks.
- **Overlapping maps.** Leaving *Gameplay* and *UI* enabled together means Escape both pauses and closes the menu. Enable exactly the maps the current context needs.
- **Rebinding conflicts.** Binding Jump to the same button as Attack silently breaks one of them. Detect conflicts and offer to swap.
- **Displaying the wrong glyphs.** Prompts that always say "Press Space" confuse gamepad players. Show bindings from the action (`GetBindingDisplayString`) for the active device.

## Related

- [Command](./command) — actions can produce command objects for queuing, undo and networking.
- [Input Buffer](./input-buffer) and [Coyote Time](./coyote-time) — timing forgiveness on top of actions.
- [Replay System](./replay-system) — a replay is just another `ICharacterInput`.
- [Screen Stack](./screen-stack) and [Game State Manager](./game-state-manager) — switch action maps on context changes.
