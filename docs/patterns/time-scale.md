# Time Scale

> Route all simulation time through a scalable clock for pause, slow-mo and fast-forward.

**Category:** Game Loop & Timing

## Problem

The pause menu sets the global time scale to 0 (`Time.timeScale`, `Engine.time_scale`, global time dilation). A slow-motion finisher sets it to 0.2, then back to 1 when it ends, which unpauses the game if the player paused during the finisher. The pause menu's own animations freeze because they use scaled time. Footsteps keep playing. A "freeze one enemy" spell has no way to slow just that enemy. Every system that touches the one global value fights every other system.

## Solution

Treat time scaling as **requests that combine**, not as a value anyone can overwrite, and decide for every system **which clock it runs on**.

1. **Combine requests.** Each requester (pause menu, slow-mo ability, hit stop, cutscene) adds a request with a factor and gets a handle back. The effective scale is the **product** of all active requests, and releasing a handle removes only that request. Pause (×0) during slow-mo (×0.2) stays paused when the slow-mo ends.
2. **Pick a clock per system.**
   - *Gameplay*: scaled time. Freezes when paused.
   - *UI and menus*: unscaled time. Keeps animating while paused.
   - *Audio*: paused explicitly with the game, pitch-adjusted for slow-mo if desired.
3. **Local time scales.** An entity can multiply the global scale by its own factor (frozen enemy ×0, hasted player ×1.5), by using its own delta time instead of the global one.

## Example

One owner of the global time scale. Systems **request** a factor and get a handle back; the actual scale is the product of all active requests, so the pause menu and a slow-motion finisher can't undo each other.

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public static class GameTime
{
    public sealed class Request : IDisposable
    {
        public readonly float Factor;
        public readonly string Reason;          // shown in debug tools: "why is the game slow?"
        internal Request(float factor, string reason) { Factor = factor; Reason = reason; }
        public void Dispose() => Release(this);
    }

    static readonly List<Request> requests = new();
    static float baseFixedDeltaTime = -1f;

    public static float Scale => Time.timeScale;
    public static bool IsPaused => Time.timeScale == 0f;
    public static IReadOnlyList<Request> Active => requests;

    public static Request Push(float factor, string reason)
    {
        var r = new Request(factor, reason);
        requests.Add(r);
        Apply();
        return r;
    }

    static void Release(Request r)
    {
        if (requests.Remove(r)) Apply();
    }

    static void Apply()
    {
        if (baseFixedDeltaTime < 0f) baseFixedDeltaTime = Time.fixedDeltaTime;

        float scale = 1f;
        foreach (var r in requests) scale *= r.Factor;

        Time.timeScale = scale;
        // Keep physics smooth in slow motion: step more often in real time.
        Time.fixedDeltaTime = baseFixedDeltaTime * Mathf.Clamp(scale, 0.05f, 1f);
        AudioListener.pause = scale == 0f;      // or pause only gameplay sources (see pitfalls)
    }

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
    static void Reset() { requests.Clear(); baseFixedDeltaTime = -1f; }
}
```

```gdscript [Godot (GDScript)]
# game_time.gd: autoload named GameTime.
# A factor of 0 pauses the SceneTree (nodes with process_mode ALWAYS, like menus, keep running);
# anything else sets Engine.time_scale.
extends Node


class Request:
	var factor: float
	var reason: String  # shown in debug tools: "why is the game slow?"

	func _init(f: float, r: String) -> void:
		factor = f
		reason = r


var _requests: Array[Request] = []


func push(factor: float, reason: String) -> Request:
	var r := Request.new(factor, reason)
	_requests.append(r)
	_apply()
	return r


func release(r: Request) -> void:
	if r in _requests:
		_requests.erase(r)
		_apply()


func active() -> Array[Request]:
	return _requests


func _apply() -> void:
	var scale := 1.0
	for r in _requests:
		scale *= r.factor
	get_tree().paused = scale == 0.0
	if scale > 0.0:
		Engine.time_scale = scale
		AudioServer.playback_speed_scale = scale  # slow the audio with the game (optional)
```

```cpp [Unreal (C++)]
// GameTimeSubsystem.h: requests are shared handles; dropping the last reference releases the request.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "GameTimeSubsystem.generated.h"

class UGameTimeSubsystem;

struct FTimeRequest
{
	float Factor = 1.f;
	FString Reason;                                   // shown in debug tools: "why is the game slow?"
	TWeakObjectPtr<UGameTimeSubsystem> Owner;
	~FTimeRequest();
};

UCLASS()
class UGameTimeSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	// Keep the returned handle while the request should apply; Reset() it to release.
	TSharedRef<FTimeRequest> Push(float Factor, FString Reason);
	const TArray<FTimeRequest*>& GetActive() const { return Requests; }

private:
	friend struct FTimeRequest;
	void Release(FTimeRequest* Request);
	void Apply();

	TArray<FTimeRequest*> Requests;
};

// GameTimeSubsystem.cpp
#include "GameTimeSubsystem.h"
#include "Kismet/GameplayStatics.h"

FTimeRequest::~FTimeRequest()
{
	if (UGameTimeSubsystem* Subsystem = Owner.Get()) Subsystem->Release(this);
}

TSharedRef<FTimeRequest> UGameTimeSubsystem::Push(float Factor, FString Reason)
{
	TSharedRef<FTimeRequest> Request = MakeShared<FTimeRequest>();
	Request->Factor = Factor;
	Request->Reason = MoveTemp(Reason);
	Request->Owner = this;
	Requests.Add(&Request.Get());
	Apply();
	return Request;
}

void UGameTimeSubsystem::Release(FTimeRequest* Request)
{
	if (Requests.Remove(Request) > 0) Apply();
}

void UGameTimeSubsystem::Apply()
{
	float Scale = 1.f;
	for (const FTimeRequest* R : Requests) Scale *= R->Factor;

	UWorld* World = GetWorld();
	UGameplayStatics::SetGamePaused(World, Scale == 0.f);   // 0 means paused, not "dilation 0"
	if (Scale > 0.f) UGameplayStatics::SetGlobalTimeDilation(World, Scale);
}
```

:::

Requesters hold their handle and release it when done, so they never undo someone else's change:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class PauseMenu : MonoBehaviour
{
    GameTime.Request pause;

    public void Open()  { pause ??= GameTime.Push(0f, "Pause menu"); gameObject.SetActive(true); }
    public void Close() { pause?.Dispose(); pause = null; gameObject.SetActive(false); }

    // Menu animation must use unscaled time, or it freezes with the game.
    void Update() => transform.localScale = Vector3.one * (1f + 0.02f * Mathf.Sin(Time.unscaledTime * 4f));
}

public class SlowMoFinisher : MonoBehaviour
{
    public async void Play()
    {
        using (GameTime.Push(0.2f, "Finisher slow-mo"))
            await Awaitable.WaitForSecondsAsync(0.2f * 1.5f);   // scaled: 1.5 s of real time at ×0.2
    }
}
```

```gdscript [Godot (GDScript)]
# pause_menu.gd: set this node's Process Mode to "When Paused" (or "Always") so it runs while paused.
extends Control

var _pause: GameTime.Request


func open() -> void:
	if _pause == null:
		_pause = GameTime.push(0.0, "Pause menu")
	show()


func close() -> void:
	GameTime.release(_pause)
	_pause = null
	hide()


# slow_mo_finisher.gd
extends Node


func play() -> void:
	var slow := GameTime.push(0.2, "Finisher slow-mo")
	# create_timer(time, process_always, process_in_physics, ignore_time_scale): 1.5 s of real time.
	await get_tree().create_timer(1.5, true, false, true).timeout
	GameTime.release(slow)
```

```cpp [Unreal (C++)]
// PauseMenuWidget.cpp: UMG widgets keep ticking while the game is paused.
void UPauseMenuWidget::Open()
{
	if (!Pause) Pause = GetWorld()->GetSubsystem<UGameTimeSubsystem>()->Push(0.f, TEXT("Pause menu"));
	AddToViewport();
}

void UPauseMenuWidget::Close()
{
	Pause.Reset();                                       // TSharedPtr<FTimeRequest> Pause; releases it
	RemoveFromParent();
}

// SlowMoFinisher.cpp
void ASlowMoFinisher::Play()
{
	SlowMo = GetWorld()->GetSubsystem<UGameTimeSubsystem>()->Push(0.2f, TEXT("Finisher slow-mo"));
	// World timers are dilated: 0.2 × 1.5 game seconds = 1.5 s of real time.
	GetWorldTimerManager().SetTimer(SlowMoTimer, FTimerDelegate::CreateWeakLambda(this, [this]
	{
		SlowMo.Reset();
	}), 0.2f * 1.5f, false);
}
```

:::

A per-entity local time scale for effects like "freeze this enemy":

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class LocalTime : MonoBehaviour
{
    public float Scale = 1f;                                 // set by spells and status effects
    public float DeltaTime => Time.deltaTime * Scale;        // use instead of Time.deltaTime
}

// In the enemy:  transform.position += velocity * localTime.DeltaTime;
// Animator:      animator.speed = localTime.Scale;
```

```gdscript [Godot (GDScript)]
# enemy.gd: a per-node time scale, applied wherever delta is used.
extends CharacterBody3D

@export var time_scale := 1.0  # set by spells and status effects
@onready var _anim: AnimationPlayer = $AnimationPlayer


func _physics_process(delta: float) -> void:
	var dt := delta * time_scale
	_anim.speed_scale = time_scale
	# move using dt instead of delta...
```

```cpp [Unreal (C++)]
// Built in: every actor has CustomTimeDilation, which scales the DeltaSeconds that its Tick
// and its components' ticks receive (see the notes for what it does not cover).
Enemy->CustomTimeDilation = 0.f;    // frozen
Enemy->CustomTimeDilation = 0.5f;   // half speed
Enemy->CustomTimeDilation = 1.f;    // normal
```

:::

**Engine notes**

- **Unity:** `Awaitable` is Unity 6 (2023.1+). In older versions, use a coroutine with `WaitForSeconds`, which also respects the time scale.
- **Godot:** `Engine.time_scale` also scales physics, timers and animations. Pausing works through `get_tree().paused` and each node's **Process Mode**, which is how menus keep running.
- **Unreal:** `SetGlobalTimeDilation` is clamped by the World Settings' min and max dilation. `CustomTimeDilation` affects the actor's tick, its skeletal animation and its movement components, but not world timers it sets, which use global time.

## When to use

- Pause menus, slow motion, bullet time, fast-forward in strategy and simulation games, hit stop.
- Any game where more than one system wants to change the speed of time.

## When not to use

- Pausing in a game with only one pause source. Setting the global time scale to 0 directly is enough until a second system needs to change time.
- Slowing a single object, enemy or projectile. Give it its own speed multiplier; a global time scale affects everything.
- Multiplayer games, where you can't change time for one player. Pause or slow the local presentation instead.

## Pitfalls

- **Overwriting instead of combining.** Any code that assigns the engine's time scale directly breaks the request system. Make `GameTime` the only writer, and search the codebase for stray assignments.
- **The wrong clock.** UI tweens, menu particles and "press any key" prompts must keep running while paused. In Unity they need `unscaledDeltaTime`, Animator update mode *Unscaled Time*, and particle systems with *Use Unscaled Time*. In Godot, when pausing through `get_tree().paused`, they need the **Always** process mode. In Unreal, actors and components that must run during `SetGamePaused` need *Tick Even When Paused*. Otherwise they freeze when paused.
- **Zero delta.** In Unity, `FixedUpdate` stops at scale 0, but `Update` keeps running with `deltaTime == 0`. Code that divides by the frame delta breaks, and per-frame input handling keeps working, which is usually what you want for unpausing. Unreal clamps global time dilation to a small minimum instead of 0.
- **Audio.** `AudioListener.pause` pauses *everything*, including menu sounds. Mark UI sources with `ignoreListenerPause = true`, or route gameplay audio through a mixer group you pause and pitch.
- **Leaked requests.** A slow-mo that never releases its handle (its object was destroyed mid-effect) keeps the game slow forever. Release when the owner is destroyed, and show active requests in a debug overlay.
- **Networked games.** You cannot slow down or pause a shared server simulation for one player. Time scale is a single-player tool, except for client-side cosmetics.

## Related

- [Game Loop](./game-loop) and [Fixed Timestep](./fixed-timestep) — what the scale actually controls.
- [Game State Manager](./game-state-manager) — the *Paused* state pushes a time-scale request.
- [Hit Stop](./hit-stop) — a very short time-scale request on impact.
- [Status Effects](./status-effects) — freeze and haste effects drive local time scales.
