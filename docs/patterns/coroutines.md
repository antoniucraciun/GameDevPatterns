# Coroutines

> Write multi-frame sequences as straight-line code that yields between frames.

**Category:** Game Loop & Timing

## Problem

A door opens over two seconds, waits, plays a sound, then closes. Written in `Update`, it becomes a state machine of flags and timers: `if (opening) { t += dt; if (t > 2) { opening = false; waiting = true; t = 0; } } else if (waiting) ...`. A cutscene with twenty steps becomes unreadable. The logic is naturally sequential ("do this, wait, then do that"), but the [Update Method](./update-method) forces it to be expressed as per-frame state.

## Solution

Write the sequence as **one function that pauses itself**. At each `yield` (or `await`), the function hands control back to the engine and resumes later: next frame, after a delay, or when a condition becomes true. Local variables survive across pauses, so the code reads top to bottom.

Each engine offers this differently. Unity has two forms:

| | Coroutines (`IEnumerator`) | `async` / `Awaitable` (Unity 2023.1+) |
| --- | --- | --- |
| Start | `StartCoroutine(Routine())` | Call an `async Awaitable` method |
| Wait a frame | `yield return null` | `await Awaitable.NextFrameAsync()` |
| Wait seconds | `yield return new WaitForSeconds(2)` | `await Awaitable.WaitForSecondsAsync(2)` |
| Return values | Not directly | `Awaitable<T>` |
| Stops when | The GameObject is disabled or destroyed, or `StopCoroutine` | It doesn't, unless you pass a cancellation token |
| Error handling | Exceptions are logged, and the coroutine stops | `try/catch` works normally |

In **Godot**, any function that uses `await` is a coroutine: `await get_tree().process_frame` waits a frame, and `await get_tree().create_timer(2.0).timeout` waits two seconds. It can await any signal, and returns a value to a caller that awaits it.

**Unreal** C++ has no built-in coroutines. Sequences use timers (`FTimerManager`), Blueprint latent nodes such as `Delay`, or **Timelines**; plugins such as UE5Coro add C++20 `co_await`.

## Example

A door that opens, waits, plays a sound and closes, written as one readable sequence. Triggering it again restarts the sequence.

::: code-group

```csharp [Unity (C#)]
using System.Collections;
using UnityEngine;

public class TimedDoor : MonoBehaviour
{
    [SerializeField] Transform panel;
    [SerializeField] Vector3 openOffset = new(0f, 3f, 0f);
    [SerializeField] float moveSeconds = 2f, stayOpenSeconds = 5f;
    [SerializeField] AudioSource audioSource;

    Coroutine running;
    Vector3 closedPosition;

    void Awake() => closedPosition = panel.localPosition;

    public void Trigger()
    {
        if (running != null) StopCoroutine(running);     // restarting cancels the old sequence
        running = StartCoroutine(OpenWaitClose());
    }

    IEnumerator OpenWaitClose()
    {
        yield return Move(closedPosition + openOffset);   // nested coroutine: waits until it finishes
        audioSource.Play();
        yield return new WaitForSeconds(stayOpenSeconds);
        yield return Move(closedPosition);
        running = null;
    }

    IEnumerator Move(Vector3 target)
    {
        Vector3 start = panel.localPosition;
        for (float t = 0f; t < 1f; t += Time.deltaTime / moveSeconds)
        {
            panel.localPosition = Vector3.Lerp(start, target, Mathf.SmoothStep(0f, 1f, t));
            yield return null;                            // resume next frame
        }
        panel.localPosition = target;
    }
}
```

```gdscript [Godot (GDScript)]
# timed_door.gd: in GDScript any function containing await is a coroutine.
extends Node3D

@export var panel: Node3D
@export var open_offset := Vector3(0, 3, 0)
@export var move_seconds := 2.0
@export var stay_open_seconds := 5.0
@export var sound: AudioStreamPlayer3D

var _closed_position: Vector3
var _run := 0          # bumped on every trigger; an older sequence sees it and stops
var _tween: Tween


func _ready() -> void:
	_closed_position = panel.position


func trigger() -> void:
	_run += 1
	_open_wait_close(_run)  # not awaited: runs alongside the caller


func _open_wait_close(run: int) -> void:
	await _move(_closed_position + open_offset)
	if run != _run:
		return  # restarted while opening
	sound.play()
	await get_tree().create_timer(stay_open_seconds).timeout
	if run != _run:
		return  # restarted while waiting
	await _move(_closed_position)


func _move(target: Vector3) -> void:
	if _tween:
		_tween.kill()  # restarting cancels the old movement
	# A tween created by this node is freed with it, so nothing runs on a deleted door.
	_tween = create_tween().set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	_tween.tween_property(panel, "position", target, move_seconds)
	await _tween.finished
```

```cpp [Unreal (C++)]
// TimedDoor.h: C++ has no built-in coroutines in Unreal, so the sequence is a timer plus a
// Tick-driven move with a completion callback.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TimedDoor.generated.h"

UCLASS()
class ATimedDoor : public AActor
{
	GENERATED_BODY()

public:
	ATimedDoor();

	UFUNCTION(BlueprintCallable, Category = "Door") void Trigger();

	UPROPERTY(VisibleAnywhere) TObjectPtr<USceneComponent> Panel;
	UPROPERTY(EditAnywhere, Category = "Door") FVector OpenOffset = FVector(0, 0, 300);
	UPROPERTY(EditAnywhere, Category = "Door") float MoveSeconds = 2.f;
	UPROPERTY(EditAnywhere, Category = "Door") float StayOpenSeconds = 5.f;
	UPROPERTY(EditAnywhere, Category = "Door") TObjectPtr<USoundBase> OpenSound;

protected:
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

private:
	void MoveTo(const FVector& Target, TFunction<void()> OnArrived);

	FVector ClosedLocation, From, To;
	float Alpha = 1.f;                         // 1 = not moving
	TFunction<void()> Arrived;
	FTimerHandle WaitTimer;
};

// TimedDoor.cpp
#include "TimedDoor.h"
#include "Kismet/GameplayStatics.h"

ATimedDoor::ATimedDoor()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	Panel = CreateDefaultSubobject<USceneComponent>(TEXT("Panel"));
	Panel->SetupAttachment(RootComponent);
}

void ATimedDoor::BeginPlay()
{
	Super::BeginPlay();
	ClosedLocation = Panel->GetRelativeLocation();
}

void ATimedDoor::Trigger()
{
	GetWorldTimerManager().ClearTimer(WaitTimer);   // restarting cancels the old sequence
	MoveTo(ClosedLocation + OpenOffset, [this]
	{
		if (OpenSound) UGameplayStatics::PlaySoundAtLocation(this, OpenSound, GetActorLocation());
		// A weak lambda is skipped if the door has been destroyed in the meantime.
		GetWorldTimerManager().SetTimer(WaitTimer, FTimerDelegate::CreateWeakLambda(this, [this]
		{
			MoveTo(ClosedLocation, nullptr);
		}), StayOpenSeconds, false);
	});
}

void ATimedDoor::MoveTo(const FVector& Target, TFunction<void()> OnArrived)
{
	From = Panel->GetRelativeLocation();
	To = Target;
	Alpha = 0.f;
	Arrived = MoveTemp(OnArrived);               // replacing it cancels the old move's callback
}

void ATimedDoor::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (Alpha >= 1.f) return;
	Alpha = FMath::Min(1.f, Alpha + DeltaSeconds / MoveSeconds);
	Panel->SetRelativeLocation(FMath::InterpEaseInOut(From, To, Alpha, 2.f));
	if (Alpha >= 1.f && Arrived)
	{
		TFunction<void()> Done = MoveTemp(Arrived);
		Arrived = nullptr;
		Done();
	}
}
```

:::

Coroutines and async functions are perfect for **sequences**: cutscenes, tutorials, spawn waves, door and elevator logic, UI transitions. For behaviour that must react to changing conditions every frame (AI, movement), a [State](./state) machine or the [Update Method](./update-method) is usually clearer.

**Engine notes**

- **Unity:** coroutines stop when their GameObject is disabled or destroyed. Unity 6 also has `async Awaitable` methods (`Awaitable.NextFrameAsync`, `WaitForSecondsAsync`); pass `destroyCancellationToken` so they stop when the object is destroyed instead of touching a dead transform.
- **Godot:** `await` works on any signal: `create_timer(...).timeout`, `tween.finished`, `animation_finished`, your own signals. A coroutine on a freed node simply never resumes, but it can still resume after the node *left* the tree, so check `is_inside_tree()` after long waits if that matters.
- **Unreal:** Blueprints have latent nodes (`Delay`, `Move Component To`) and **Timelines**, which are the usual way to script sequences. In C++, use timers with weak delegates as above, a `UTimelineComponent`, or a coroutine plugin such as UE5Coro if you want `co_await`.

## When to use

- Scripted sequences with waits: cutscenes, tutorials, intros, scripted events, wave timing.
- Spreading work over frames (see [Time Slicing](./time-slicing)).
- Waiting for asynchronous operations: scene loads, web requests, asset streaming.

## When not to use

- Long-lived state machines that need to be inspected, saved or interrupted cleanly. Use [State](./state); a coroutine's state is hidden in its stack and can't be serialised.
- Logic that must keep running after its owner is disabled or freed. Unity coroutines stop silently when their GameObject is disabled, Godot coroutines never resume once their node is freed, and Unreal timers are cleared with their object.
- Heavy background work. Coroutines run on the main thread, so they do not make work parallel; use worker threads or the [Job System](./job-system).

## Pitfalls

- **Stopped with their owner.** Unity coroutines stop silently when their GameObject is deactivated, and do not resume when it is re-enabled. Godot coroutines never resume once their node is freed. Unreal timers are cleared when their object is destroyed. Run long-lived sequences on an owner that stays alive.
- **Async that outlives its object.** Unity `async` methods keep running after their object is destroyed, unless they use `destroyCancellationToken`; always pass a token to waits in MonoBehaviours. In Godot, a coroutine can resume after its node has left the tree, so check `is_inside_tree()` after long waits. In Unreal, bind timer and latent callbacks with weak delegates.
- **Allocations (Unity).** `new WaitForSeconds(...)` allocates garbage each time. Cache it in a field when used in a loop, or use `yield return null` with your own timer. GDScript and Unreal C++ timers are not garbage-collected, so this is a Unity concern.
- **Hidden state.** Many coroutines running at once on one object, starting and stopping each other, are hard to debug. Keep a handle (Unity's `Coroutine`, Unreal's `FTimerHandle`, or a run counter in Godot that an old coroutine checks after each `await`) and stop the old one before starting a new one.
- **Frame-rate-dependent loops.** Loops that wait one frame and move a fixed amount run faster at higher frame rates. Scale by the frame delta (`Time.deltaTime`, `delta`, `DeltaSeconds`), as above.
- **Time scale.** `WaitForSeconds` uses scaled time and never finishes while the game is paused. Use `WaitForSecondsRealtime` for UI and pause menus.

## Related

- [Update Method](./update-method) — the per-frame alternative for continuous behaviour.
- [Time Slicing](./time-slicing) — coroutines are a convenient way to spread work over frames.
- [State](./state) — better than coroutines for reactive, interruptible behaviour.
- [Tweening & Easing](./tweening) — for simple interpolation, tweens replace hand-written coroutine loops.
- [Time Scale](./time-scale) — scaled versus realtime waits.
