# Coyote Time

> Allow jumping for a few frames after walking off a ledge.

**Category:** Game Feel & Input

## Problem

The player runs toward a gap and presses Jump at what *looks* like the edge. On the exact frame of the press, the character's collider has already left the platform, so the ground check fails and the character falls. Players perceive this as the game cheating them, because human reaction time and visual perception cannot resolve single frames.

## Solution

Record **when the character was last grounded**. Allow a jump as long as that moment was within a short grace period, typically 0.08–0.15 s. Once a jump is used, invalidate the grace period so it cannot be used for a second jump in mid-air.

<JumpTimingViz mode="coyote" />

## Example

Combined with an [Input Buffer](./input-buffer), this covers both early and late presses:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class PlatformerController : MonoBehaviour
{
    [SerializeField] float coyoteTime = 0.1f;
    [SerializeField] float jumpBufferTime = 0.15f;
    [SerializeField] float jumpVelocity = 12f;

    Rigidbody2D body;
    float lastGroundedTime = float.NegativeInfinity;
    float lastJumpPressedTime = float.NegativeInfinity;

    void Awake() => body = GetComponent<Rigidbody2D>();

    void Update()
    {
        if (IsGrounded()) lastGroundedTime = Time.time;
        if (Input.GetButtonDown("Jump")) lastJumpPressedTime = Time.time;

        bool canCoyoteJump = Time.time - lastGroundedTime <= coyoteTime;
        bool jumpBuffered  = Time.time - lastJumpPressedTime <= jumpBufferTime;

        if (canCoyoteJump && jumpBuffered)
        {
            body.linearVelocity = new Vector2(body.linearVelocity.x, jumpVelocity);
            lastGroundedTime = float.NegativeInfinity;     // no second jump from the same grace period
            lastJumpPressedTime = float.NegativeInfinity;  // consume the buffered press
        }
    }

    bool IsGrounded() => /* ground check */ false;
}
```

```gdscript [Godot (GDScript)]
# platformer_controller.gd: "jump", "move_left" and "move_right" are Input Map actions.
extends CharacterBody2D

@export var coyote_time := 0.1
@export var jump_buffer_time := 0.15
@export var jump_speed := 600.0  # pixels per second; up is -y in 2D
@export var run_speed := 300.0

var _since_grounded := INF
var _since_jump_pressed := INF
var _gravity: float = ProjectSettings.get_setting("physics/2d/default_gravity")


func _physics_process(delta: float) -> void:
	_since_grounded += delta
	_since_jump_pressed += delta

	if is_on_floor():  # result of the last move_and_slide()
		_since_grounded = 0.0
	else:
		velocity.y += _gravity * delta
	if Input.is_action_just_pressed("jump"):
		_since_jump_pressed = 0.0

	var can_coyote_jump := _since_grounded <= coyote_time
	var jump_buffered := _since_jump_pressed <= jump_buffer_time
	if can_coyote_jump and jump_buffered:
		velocity.y = -jump_speed
		_since_grounded = INF  # no second jump from the same grace period
		_since_jump_pressed = INF  # consume the buffered press

	velocity.x = Input.get_axis("move_left", "move_right") * run_speed
	move_and_slide()
```

```cpp [Unreal (C++)]
// PlatformerCharacter.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "PlatformerCharacter.generated.h"

class UInputAction;

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
	TObjectPtr<UInputAction> JumpAction;

	UPROPERTY(EditAnywhere, Category = "Jump") float CoyoteTime = 0.1f;
	UPROPERTY(EditAnywhere, Category = "Jump") float JumpBufferTime = 0.15f;

private:
	void OnJumpPressed();

	double LastGroundedTime = TNumericLimits<double>::Lowest();
	double LastJumpPressedTime = TNumericLimits<double>::Lowest();
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
		Input->BindAction(JumpAction, ETriggerEvent::Started, this, &APlatformerCharacter::OnJumpPressed);
	}
}

void APlatformerCharacter::OnJumpPressed()
{
	LastJumpPressedTime = GetWorld()->GetTimeSeconds();
}

void APlatformerCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	UCharacterMovementComponent* Movement = GetCharacterMovement();
	const double Now = GetWorld()->GetTimeSeconds();
	if (Movement->IsMovingOnGround()) LastGroundedTime = Now;

	const bool bCanCoyoteJump = Now - LastGroundedTime <= CoyoteTime;
	const bool bJumpBuffered = Now - LastJumpPressedTime <= JumpBufferTime;

	if (bCanCoyoteJump && bJumpBuffered)
	{
		LaunchCharacter(FVector(0.f, 0.f, Movement->JumpZVelocity), false, true);
		LastGroundedTime = TNumericLimits<double>::Lowest();      // no second jump from the same grace period
		LastJumpPressedTime = TNumericLimits<double>::Lowest();   // consume the buffered press
	}
}
```

:::

**Engine notes**

- **Unity:** `linearVelocity` is the Unity 6 name. In earlier versions, use `velocity`.
- **Godot:** `is_on_floor()` reflects the last `move_and_slide()` call, so read it before moving, as here. On a `CharacterBody2D`, **Floor Snap Length** keeps the body grounded on slopes and small steps, which reduces how often coyote time has to cover for a missed ground check.
- **Unreal:** `ACharacter` has no coyote time. To keep using the built-in `Jump()` (with its hold time and jump count), override `CanJumpInternal_Implementation()` to also return true while `Now - LastGroundedTime <= CoyoteTime`. The movement component also offers **Perch** settings and `LedgeCheckThreshold`, which control when a character standing on an edge starts to fall.

## When to use

- Any platformer or action game with ledges and jumps.
- More generally, any timing check where the player's intent is clear but the frame-perfect state disagrees, such as wall jumps or grabbing ledges.

## When not to use

- Games without platforming or ledges.
- Precision platformers where exact edges are part of the challenge. Keep it very short, if you use it at all.

## Pitfalls

- **Double jumps.** Forgetting to invalidate the grace period after jumping lets the player jump again in mid-air.
- **Jumping while rising.** Your ground check may report "grounded" for a frame after takeoff. Ignore it while vertical velocity is positive.
- **A grace period that is too long** feels floaty and lets players walk on air. Players should never notice this mechanic exists.

## Related

- [Input Buffer](./input-buffer) — tolerates presses that come too early. Coyote time tolerates presses that come too late.
- [State](./state) — grounded and airborne states make the grace period easy to track.
