# Camera Follow & Smoothing

> Dead zones, look-ahead and damping to keep the camera readable.

**Category:** Game Feel & Input

## Problem

`camera.position = player.position + offset` produces a camera glued to the player: every tiny movement and jump bob jerks the whole screen. Smoothing it with `Lerp(camera, target, 0.1f)` behaves differently at 30 and 144 FPS, and lags so far behind a sprinting player that they run off-screen. In a platformer, every jump drags the camera up and down, which is tiring to watch. The player cannot see what is ahead of them, which is exactly where the danger is.

## Solution

Treat the camera as a small system with several deliberate behaviours:

| Behaviour | What it does |
| --- | --- |
| **Dead zone** | The camera does not move while the target stays inside a central box. Small movements cause no camera motion. |
| **Look-ahead** | The camera leads in the direction of movement, so the player sees what is coming. |
| **Damping** | Frame-rate-independent smoothing toward the desired position (`SmoothDamp` or exponential damping), often with different speeds per axis. |
| **Platform snapping** | In platformers, vertical follow is relaxed while airborne and catches up on landing, so jumps do not bob the screen. |
| **Bounds** | Clamp to level limits, so the camera never shows outside the level. |
| **Separation from effects** | Shake and zoom punches apply to a child transform, so they never disturb the follow logic. |

Run the camera in `LateUpdate`, after all movement for the frame has finished. For Rigidbody targets, enable interpolation, so the camera follows a smooth position.

## Example

A 2D platformer camera with a dead zone, look-ahead, grounded vertical snapping and level bounds. Godot's `Camera2D` and Unreal's `USpringArmComponent` already provide part of this, so those tabs configure the built-in features and add only the rest:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class PlatformerCamera : MonoBehaviour
{
    [SerializeField] Transform target;
    [SerializeField] Rigidbody2D targetBody;             // for velocity-based look-ahead
    [SerializeField] Vector2 offset = new(0f, 1.5f);

    [Header("Dead zone (world units)")]
    [SerializeField] Vector2 deadZone = new(1.5f, 1f);

    [Header("Look-ahead")]
    [SerializeField] float lookAheadDistance = 3f;
    [SerializeField] float lookAheadSmoothTime = 0.5f;

    [Header("Damping")]
    [SerializeField] float horizontalSmoothTime = 0.15f;
    [SerializeField] float verticalSmoothTime = 0.25f;

    [Header("Bounds")]
    [SerializeField] Rect levelBounds = new(-50f, -10f, 200f, 40f);

    Vector2 focus;                                       // the point the camera centres on
    float lookAhead, lookAheadVelocity;
    Vector2 smoothVelocity;
    float groundedY;
    Camera cam;

    void Start()
    {
        cam = GetComponent<Camera>();
        focus = (Vector2)target.position + offset;
        groundedY = focus.y;
    }

    public bool TargetGrounded { get; set; } = true;     // set by the player controller

    void LateUpdate()
    {
        Vector2 t = (Vector2)target.position + offset;

        // 1. Dead zone: move the focus only when the target pushes against the box edges.
        if (t.x > focus.x + deadZone.x) focus.x = t.x - deadZone.x;
        if (t.x < focus.x - deadZone.x) focus.x = t.x + deadZone.x;

        // 2. Vertical: follow the ground height while grounded; while airborne, only follow big drops or rises.
        if (TargetGrounded) groundedY = t.y;
        else if (t.y < groundedY - 2f || t.y > groundedY + 4f) groundedY = t.y;
        focus.y = groundedY;

        // 3. Look-ahead in the direction of horizontal movement.
        float vx = targetBody ? targetBody.linearVelocity.x : 0f;
        float desiredLookAhead = Mathf.Abs(vx) > 0.5f ? Mathf.Sign(vx) * lookAheadDistance : lookAhead;
        lookAhead = Mathf.SmoothDamp(lookAhead, desiredLookAhead, ref lookAheadVelocity, lookAheadSmoothTime);

        // 4. Damping, per axis: frame-rate independent.
        Vector2 desired = new(focus.x + lookAhead, focus.y);
        Vector2 current = transform.position;
        current.x = Mathf.SmoothDamp(current.x, desired.x, ref smoothVelocity.x, horizontalSmoothTime);
        current.y = Mathf.SmoothDamp(current.y, desired.y, ref smoothVelocity.y, verticalSmoothTime);

        // 5. Bounds: keep the whole view inside the level.
        float halfH = cam.orthographicSize, halfW = halfH * cam.aspect;
        current.x = Mathf.Clamp(current.x, levelBounds.xMin + halfW, levelBounds.xMax - halfW);
        current.y = Mathf.Clamp(current.y, levelBounds.yMin + halfH, levelBounds.yMax - halfH);

        transform.position = new Vector3(current.x, current.y, transform.position.z);
    }

#if UNITY_EDITOR
    void OnDrawGizmosSelected()                         // visualise the dead zone (see Debug Draw)
    {
        Gizmos.color = Color.yellow;
        Gizmos.DrawWireCube(new Vector3(focus.x, focus.y, 0f), new Vector3(deadZone.x * 2f, deadZone.y * 2f, 0f));
    }
#endif
}
```

```gdscript [Godot (GDScript)]
# platformer_camera.gd: a Camera2D that is NOT a child of the player. The script moves the
# camera's position (its target); Camera2D's drag margins (dead zone), position smoothing (damping)
# and limits (bounds) then decide what the screen shows.
extends Camera2D

@export var target: CharacterBody2D
@export var follow_offset := Vector2(0.0, -48.0)  # pixels; up is -y
@export var look_ahead_distance := 96.0
@export var look_ahead_rate := 3.0  # exponential damping rate
@export var level_bounds := Rect2i(-1600, -640, 6400, 1280)

var _grounded_y: float
var _look_ahead := 0.0


func _ready() -> void:
	process_callback = Camera2D.CAMERA2D_PROCESS_PHYSICS  # the player moves in physics frames

	# 1. Dead zone: the camera moves only when its target leaves the middle of the screen.
	drag_horizontal_enabled = true
	drag_left_margin = 0.1  # fractions of half the screen
	drag_right_margin = 0.1
	drag_vertical_enabled = false  # vertical is handled below

	# 4. Damping.
	position_smoothing_enabled = true
	position_smoothing_speed = 6.0

	# 5. Bounds: the view never shows anything outside the level.
	limit_left = level_bounds.position.x
	limit_top = level_bounds.position.y
	limit_right = level_bounds.end.x
	limit_bottom = level_bounds.end.y

	global_position = target.global_position + follow_offset
	_grounded_y = global_position.y
	reset_smoothing()


func _physics_process(delta: float) -> void:
	var t := target.global_position + follow_offset

	# 2. Vertical: follow the ground height while grounded; while airborne, only follow big drops or rises.
	if target.is_on_floor():
		_grounded_y = t.y
	elif t.y > _grounded_y + 128.0 or t.y < _grounded_y - 256.0:
		_grounded_y = t.y

	# 3. Look-ahead in the direction of horizontal movement, applied as an offset.
	var vx := target.velocity.x
	var desired := signf(vx) * look_ahead_distance if absf(vx) > 20.0 else _look_ahead
	_look_ahead = lerpf(_look_ahead, desired, 1.0 - exp(-look_ahead_rate * delta))
	offset.x = _look_ahead

	global_position = Vector2(t.x, _grounded_y)
```

```cpp [Unreal (C++)]
// SideScrollerCharacter.h (excerpt). USpringArmComponent's camera lag is the damping; the
// character moves the arm's origin to a focus point with a dead zone, grounded vertical snapping,
// look-ahead and bounds. Side view: X is horizontal, Z is up.
UPROPERTY(VisibleAnywhere) TObjectPtr<USpringArmComponent> CameraBoom;
UPROPERTY(VisibleAnywhere) TObjectPtr<UCameraComponent> Camera;

UPROPERTY(EditAnywhere, Category = "Camera") FVector2D DeadZone = FVector2D(150.f, 100.f);   // cm
UPROPERTY(EditAnywhere, Category = "Camera") float LookAheadDistance = 300.f;
UPROPERTY(EditAnywhere, Category = "Camera") float LookAheadSpeed = 2.f;
// Where the camera centre may go: the level bounds shrunk by half the view size.
UPROPERTY(EditAnywhere, Category = "Camera") FBox2D CameraBounds = FBox2D(FVector2D(-4000.f, -500.f), FVector2D(16000.f, 3000.f));

FVector2D Focus;                 // X and Z of the point the camera centres on
double GroundedZ = 0.0;
float LookAhead = 0.f;

// SideScrollerCharacter.cpp
#include "SideScrollerCharacter.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/SpringArmComponent.h"

ASideScrollerCharacter::ASideScrollerCharacter()
{
	PrimaryActorTick.bCanEverTick = true;

	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
	CameraBoom->SetupAttachment(RootComponent);
	CameraBoom->SetUsingAbsoluteLocation(true);           // we place it; it doesn't follow the capsule
	CameraBoom->SetUsingAbsoluteRotation(true);           // side view: never rotates with the character
	CameraBoom->SetWorldRotation(FRotator(0.f, -90.f, 0.f));
	CameraBoom->TargetArmLength = 1500.f;
	CameraBoom->bDoCollisionTest = false;

	// 4. Damping: built in.
	CameraBoom->bEnableCameraLag = true;
	CameraBoom->CameraLagSpeed = 6.f;
	CameraBoom->CameraLagMaxDistance = 600.f;             // never fall further behind than this

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
}

void ASideScrollerCharacter::BeginPlay()
{
	Super::BeginPlay();
	const FVector T = GetActorLocation();
	Focus = FVector2D(T.X, T.Z);
	GroundedZ = T.Z;
}

void ASideScrollerCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const FVector T = GetActorLocation() + FVector(0.f, 0.f, 150.f);

	// 1. Dead zone: move the focus only when the character pushes against the box edges.
	if (T.X > Focus.X + DeadZone.X) Focus.X = T.X - DeadZone.X;
	if (T.X < Focus.X - DeadZone.X) Focus.X = T.X + DeadZone.X;

	// 2. Vertical: follow the ground height while grounded; while airborne, only follow big drops or rises.
	if (GetCharacterMovement()->IsMovingOnGround()) GroundedZ = T.Z;
	else if (T.Z < GroundedZ - 200.f || T.Z > GroundedZ + 400.f) GroundedZ = T.Z;

	// 3. Look-ahead in the direction of horizontal movement.
	const double Vx = GetVelocity().X;
	const float DesiredLookAhead = FMath::Abs(Vx) > 50.0 ? static_cast<float>(FMath::Sign(Vx)) * LookAheadDistance : LookAhead;
	LookAhead = FMath::FInterpTo(LookAhead, DesiredLookAhead, DeltaSeconds, LookAheadSpeed);

	// 5. Bounds, then hand the point to the spring arm, whose lag smooths the move.
	const double X = FMath::Clamp(Focus.X + LookAhead, CameraBounds.Min.X, CameraBounds.Max.X);
	const double Z = FMath::Clamp(GroundedZ, CameraBounds.Min.Y, CameraBounds.Max.Y);
	CameraBoom->SetWorldLocation(FVector(X, T.Y, Z));
}
```

:::

Put the [Screen Shake](./screen-shake) on a child of the camera, or on the camera with the follow logic on a parent rig, so shake offsets never feed back into the follow logic. Godot's shake can use `Camera2D.offset`, which this script only sets on X; add the shake to it rather than overwriting it.

**Engine notes**

- **Unity:** **Cinemachine** provides dead zones, damping, look-ahead, confiners and multi-target framing as configurable components. For most 3D games it is the right starting point. The concepts above are what you tune inside it.
- **Godot:** `Camera2D` has drag margins, position smoothing and limits built in, with **Limit Smoothed** to ease into the bounds instead of stopping hard. Turn on **Editor > Draw Drag Margin** and **Draw Limits** to see them in the 2D editor. There is no built-in `Camera3D` follow; the Phantom Camera add-on fills that gap.
- **Unreal:** the spring arm's lag (`bEnableCameraLag`, `bEnableCameraRotationLag`) smooths all axes with one speed, so per-axis damping needs your own interpolation. For level bounds and framing that apply to every camera, override `APlayerCameraManager::UpdateViewTarget`, or use a **Camera Modifier**. UE 5.5+ also ships the experimental **Gameplay Cameras** plugin with rigs built from nodes.

## When to use

- Every game with a moving camera.
- Platformers (dead zones, vertical snapping, look-ahead), top-down games (look-ahead toward aim or movement), third-person games (damping, collision) and multiplayer games on one screen (framing several targets).

## When not to use

- First-person cameras. Smoothing the view causes nausea; keep it locked to the head.
- When Cinemachine already provides it. Configure it instead of writing your own.
- Competitive games where any camera lag hurts aiming.

## Pitfalls

- **`Lerp` with a constant factor.** It depends on the frame rate and never fully arrives. Use `SmoothDamp` or exponential damping with `deltaTime`.
- **Following in `Update`.** If the camera updates before the player moves, it lags one frame, which causes jitter. Use `LateUpdate`, and interpolate Rigidbody targets.
- **Smoothing too much.** A floaty camera feels laggy and loses fast players. Keep horizontal damping tight in fast games, and use look-ahead rather than more smoothing.
- **Look-ahead flipping.** Quick direction changes swing the camera back and forth. Smooth the look-ahead separately and more slowly, and only change it above a velocity threshold, as above.
- **Pixel art shimmer.** Sub-pixel camera positions make pixel art crawl. Snap the final position to the pixel grid, or use the Pixel Perfect Camera.

## Related

- [Tweening & Easing](./tweening) — damping and easing functions.
- [Screen Shake (Trauma)](./screen-shake) — applied on top of the follow position.
- [Feedback Layering (Juice)](./juice) — zoom punches and camera kicks as feedback layers.
- [Tight Platformer Controller](../recipes/platformer-controller) — the controller this camera is designed to follow.
- [Debug Draw](./debug-draw) — visualising dead zones and targets while tuning.
