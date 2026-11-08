# Input Buffer

> Remember inputs briefly so presses slightly too early still count.

**Category:** Game Feel & Input

## Problem

The player presses Jump a few frames before landing. The character is still airborne, so the jump is rejected. Then the character lands and stands still. To the player the game feels unresponsive and they "definitely pressed it". The same thing happens with attack combos pressed slightly before the previous swing ends, and with dodges pressed during hit-stun.

## Solution

When an action is pressed but cannot happen yet, **remember the press with a timestamp** instead of discarding it. Each frame, check whether the action has become possible. If it has, and the buffered press is still younger than the buffer window (typically 0.1–0.2 s), perform the action and **consume** the buffered press.

<JumpTimingViz mode="buffer" />

## Example

A buffered jump: the press is remembered for a short window and consumed the first frame the character is grounded.

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class BufferedInput
{
    readonly float window;
    float pressedAt = float.NegativeInfinity;

    public BufferedInput(float window) => this.window = window;

    public void Press() => pressedAt = Time.time;

    public bool IsBuffered => Time.time - pressedAt <= window;

    public bool TryConsume()
    {
        if (!IsBuffered) return false;
        pressedAt = float.NegativeInfinity;   // consume so it fires only once
        return true;
    }
}

public class PlatformerJump : MonoBehaviour
{
    [SerializeField] float jumpBufferTime = 0.15f;
    BufferedInput jump;

    void Awake() => jump = new BufferedInput(jumpBufferTime);

    void Update()
    {
        if (Input.GetButtonDown("Jump"))
            jump.Press();

        if (IsGrounded() && jump.TryConsume())
            DoJump();
    }

    bool IsGrounded() => /* ground check */ true;
    void DoJump() { /* apply jump velocity */ }
}
```

```gdscript [Godot (GDScript)]
# buffered_input.gd: counts the age of the last press in game time, so it pauses with the game.
class_name BufferedInput
extends RefCounted

var window: float
var _age := INF  # seconds since the last unconsumed press


func _init(window_seconds: float) -> void:
	window = window_seconds


func press() -> void:
	_age = 0.0


func tick(delta: float) -> void:
	_age += delta


func is_buffered() -> bool:
	return _age <= window


func try_consume() -> bool:
	if not is_buffered():
		return false
	_age = INF  # consume so it fires only once
	return true


# platformer_jump.gd: "jump" is an action in Project Settings > Input Map.
extends CharacterBody2D

@export var jump_buffer_time := 0.15
@export var jump_speed := 600.0  # pixels per second; up is -y in 2D

var _jump: BufferedInput
var _gravity: float = ProjectSettings.get_setting("physics/2d/default_gravity")


func _ready() -> void:
	_jump = BufferedInput.new(jump_buffer_time)  # after the inspector values are applied


func _physics_process(delta: float) -> void:
	_jump.tick(delta)
	if Input.is_action_just_pressed("jump"):
		_jump.press()

	if not is_on_floor():
		velocity.y += _gravity * delta
	elif _jump.try_consume():
		velocity.y = -jump_speed

	move_and_slide()
```

```cpp [Unreal (C++)]
// BufferedInput.h: a plain struct; the caller passes the current time.
#pragma once

#include "CoreMinimal.h"

struct FBufferedInput
{
	float Window = 0.15f;
	double PressedAt = TNumericLimits<double>::Lowest();

	void Press(double Now) { PressedAt = Now; }
	bool IsBuffered(double Now) const { return Now - PressedAt <= Window; }

	bool TryConsume(double Now)
	{
		if (!IsBuffered(Now)) return false;
		PressedAt = TNumericLimits<double>::Lowest();   // consume so it fires only once
		return true;
	}
};

// PlatformerCharacter.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "BufferedInput.h"
#include "PlatformerCharacter.generated.h"

class UInputAction;
struct FInputActionValue;

UCLASS()
class APlatformerCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	APlatformerCharacter();
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;
	virtual void Tick(float DeltaSeconds) override;

protected:
	UPROPERTY(EditDefaultsOnly, Category = "Input")
	TObjectPtr<UInputAction> JumpAction;           // add it to a mapping context (see Input Abstraction)

	UPROPERTY(EditAnywhere, Category = "Input")
	float JumpBufferTime = 0.15f;

private:
	void OnJumpPressed(const FInputActionValue& Value);
	FBufferedInput JumpBuffer;
};

// PlatformerCharacter.cpp
#include "PlatformerCharacter.h"
#include "EnhancedInputComponent.h"
#include "GameFramework/CharacterMovementComponent.h"

APlatformerCharacter::APlatformerCharacter()
{
	PrimaryActorTick.bCanEverTick = true;
}

void APlatformerCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);
	if (UEnhancedInputComponent* Input = Cast<UEnhancedInputComponent>(PlayerInputComponent))
	{
		// Started fires once per press.
		Input->BindAction(JumpAction, ETriggerEvent::Started, this, &APlatformerCharacter::OnJumpPressed);
	}
}

void APlatformerCharacter::OnJumpPressed(const FInputActionValue& Value)
{
	JumpBuffer.Press(GetWorld()->GetTimeSeconds());   // game time: dilated, stops while paused
}

void APlatformerCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	JumpBuffer.Window = JumpBufferTime;
	const double Now = GetWorld()->GetTimeSeconds();
	if (GetCharacterMovement()->IsMovingOnGround() && JumpBuffer.TryConsume(Now))
	{
		LaunchCharacter(FVector(0.f, 0.f, GetCharacterMovement()->JumpZVelocity), false, true);
	}
}
```

:::

For fighting or action games, generalise this to a queue of recent `(action, time)` entries. The combat system can then read a sequence of inputs, for example to recognise a special move.

**Engine notes**

- **Unity:** `Time.time` is scaled time, so a buffered press waits through a pause. With the Input System package, read the press with `action.WasPressedThisFrame()` instead of `Input.GetButtonDown`.
- **Godot:** `Input.is_action_just_pressed` called from `_physics_process` reports the press on the first physics frame after it, so polling and buffering in the same callback is safe. Counting the age with `delta` makes the buffer respect `Engine.time_scale` and pausing.
- **Unreal:** Enhanced Input fires `ETriggerEvent::Started` once per press. `ACharacter::Jump()` doesn't buffer: it only sets a flag that the movement component checks on its next update. That's why this example launches the character directly. Enhanced Input also has a **Combo** trigger for short input sequences. It can replace a hand-written sequence queue for simple special moves.

## When to use

- Any action gated by a state that ends at an unpredictable moment: landing, recovering from an attack, leaving a stun, finishing a reload.
- Combo systems and fighting games.

## When not to use

- Turn-based or menu-driven games. There is no timing window to forgive.
- Actions that must not happen late, such as a dodge or a block in a game about precise timing. Buffering them can feel like the game acted on its own; keep windows very short.
- Simple games without states that block input.

## Pitfalls

- **A window that is too long** makes actions fire when the player has changed their mind. Keep it short and tune it per action.
- **Not consuming** the buffered input makes it trigger repeatedly.
- **Buffering in `FixedUpdate`.** Record presses in `Update`, where `GetButtonDown` is reliable. See [Fixed Timestep](./fixed-timestep).
- **Using `Time.time` while paused or slowed.** Decide whether the buffer should use scaled or unscaled time.

## Related

- [Coyote Time](./coyote-time) — the mirror image: a press slightly *late* still counts.
- [Command](./command) — buffered inputs are often stored as commands.
