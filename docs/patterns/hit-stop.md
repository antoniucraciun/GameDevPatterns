# Hit Stop

> Freeze the game for a few frames on impact to sell weight.

**Also known as:** Hit Pause, Freeze Frame · **Category:** Game Feel & Input

## Problem

A sword swing connects. The damage number appears, the enemy flinches, and the animation carries on smoothly through the impact. It looks correct but feels like hitting air. Players cannot read *when* the hit landed, and heavy attacks feel exactly like light ones.

## Solution

On impact, **stop time briefly**: typically 40–150 ms, roughly 3–9 frames at 60 FPS. The frozen frame gives the eye a moment to register the contact, the pose and the effect, and resuming afterwards makes the motion snap forward.

- **Scale duration with impact.** A light jab gets 40 ms, a heavy finisher 120 ms, and a killing blow can add a slow-motion tail.
- **Choose what freezes.** A *global* stop freezes everything through a [Time Scale](./time-scale) request. A *local* stop freezes only the attacker and victim, by setting their animator speed to 0, while the rest of the world keeps moving. Local stops are essential in multiplayer and with many simultaneous hits.
- **Do not stack.** Ten hits in one frame should give one stop of the *longest* duration, not ten stops added together.
- **Keep feedback alive.** Screen shake, particles and sound should play during the stop, on unscaled time. The freeze is what makes them read clearly.

## Pseudocode

```text
// Global stop: one time-scale request, timed in real time,
// because game time is frozen while it runs.
trigger(duration, scale = 0):
    end ← real now + duration
    if a freeze is running and end ≤ resume_at:
        return                    // a longer stop is already running: don't stack
    resume_at ← end
    if no freeze is running: freeze ← push time-scale request(scale)

every frame, even while the game is paused:
    if a freeze is running and real now ≥ resume_at:
        release freeze

// Local stop: the same rules, but set the attacker's and the victim's
// animation speed to 0 and restore it at resume_at.
```

## Example

A global hit stop built on [Time Scale](./time-scale) requests (`GameTime` in Unity and Godot, `UGameTimeSubsystem` in Unreal). The stop is timed in real time, because game time is frozen while it runs:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class HitStop : MonoBehaviour
{
    public static HitStop Instance { get; private set; }

    GameTime.Request freeze;
    float resumeAt;                                     // in unscaled time

    void Awake() => Instance = this;

    public void Trigger(float duration, float scale = 0f)
    {
        float end = Time.unscaledTime + duration;
        if (freeze != null && end <= resumeAt) return;  // a longer stop is already running: don't stack

        resumeAt = end;
        freeze ??= GameTime.Push(scale, "Hit stop");    // combines with pause and slow-mo correctly
    }

    void Update()                                       // Update still runs while timeScale is 0
    {
        if (freeze != null && Time.unscaledTime >= resumeAt)
        {
            freeze.Dispose();
            freeze = null;
        }
    }

    void OnDestroy() => freeze?.Dispose();
}

// On a hit, scale duration with damage:
// HitStop.Instance.Trigger(Mathf.Lerp(0.04f, 0.12f, damage / 50f));
```

```gdscript [Godot (GDScript)]
# hit_stop.gd: autoload named HitStop. A scale of 0 pauses the SceneTree through GameTime,
# so this node must keep processing while paused.
extends Node

var _freeze: GameTime.Request
var _resume_at := 0.0  # real time, in seconds


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


func trigger(duration: float, scale := 0.0) -> void:
	var end := _now() + duration
	if _freeze != null and end <= _resume_at:
		return  # a longer stop is already running: don't stack
	_resume_at = end
	if _freeze == null:
		_freeze = GameTime.push(scale, "Hit stop")  # combines with pause and slow-mo correctly


func _process(_delta: float) -> void:
	if _freeze != null and _now() >= _resume_at:
		GameTime.release(_freeze)
		_freeze = null


static func _now() -> float:
	return Time.get_ticks_usec() / 1_000_000.0  # not affected by time scale or pause


# On a hit, scale duration with damage:
# HitStop.trigger(lerpf(0.04, 0.12, damage / 50.0))
```

```cpp [Unreal (C++)]
// HitStopSubsystem.h
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "GameTimeSubsystem.h"
#include "HitStopSubsystem.generated.h"

UCLASS()
class UHitStopSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	void Trigger(float Duration, float Scale = 0.f);

	virtual void Tick(float DeltaTime) override;
	virtual bool IsTickableWhenPaused() const override { return true; }   // a scale of 0 pauses the game
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UHitStopSubsystem, STATGROUP_Tickables); }

private:
	TSharedPtr<FTimeRequest> Freeze;
	double ResumeAt = 0.0;                                       // real time, in seconds
};

// HitStopSubsystem.cpp
#include "HitStopSubsystem.h"

void UHitStopSubsystem::Trigger(float Duration, float Scale)
{
	const double End = GetWorld()->GetRealTimeSeconds() + Duration;
	if (Freeze && End <= ResumeAt) return;                       // a longer stop is already running: don't stack

	ResumeAt = End;
	if (!Freeze) Freeze = GetWorld()->GetSubsystem<UGameTimeSubsystem>()->Push(Scale, TEXT("Hit stop"));
}

void UHitStopSubsystem::Tick(float DeltaTime)
{
	if (Freeze && GetWorld()->GetRealTimeSeconds() >= ResumeAt)
	{
		Freeze.Reset();                                          // releases the time request
	}
}

// On a hit, scale duration with damage:
// GetWorld()->GetSubsystem<UHitStopSubsystem>()->Trigger(FMath::Lerp(0.04f, 0.12f, Damage / 50.f));
```

:::

A local hit stop that freezes only the two characters involved:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class LocalHitStop : MonoBehaviour
{
    [SerializeField] Animator animator;
    float resumeAt;
    float savedSpeed = 1f;
    bool frozen;

    public bool Frozen => frozen;

    public void Freeze(float duration)
    {
        float end = Time.time + duration;
        if (frozen && end <= resumeAt) return;
        if (!frozen) { savedSpeed = animator.speed; animator.speed = 0f; frozen = true; }
        resumeAt = end;
    }

    void Update()
    {
        if (frozen && Time.time >= resumeAt)
        {
            animator.speed = savedSpeed;
            frozen = false;
        }
    }
}

// On a hit: attacker.Freeze(0.08f); victim.Freeze(0.08f);
// Movement code on these characters must also respect the freeze (skip it while Frozen).
```

```gdscript [Godot (GDScript)]
# local_hit_stop.gd: a child node of each character.
class_name LocalHitStop
extends Node

@export var animation_player: AnimationPlayer

var frozen := false  # movement code on the character skips its update while this is true
var _remaining := 0.0
var _saved_speed := 1.0


func freeze(duration: float) -> void:
	if frozen and duration <= _remaining:
		return
	if not frozen:
		_saved_speed = animation_player.speed_scale
		animation_player.speed_scale = 0.0
		frozen = true
	_remaining = duration


func _process(delta: float) -> void:
	if not frozen:
		return
	_remaining -= delta
	if _remaining <= 0.0:
		animation_player.speed_scale = _saved_speed
		frozen = false


# On a hit: attacker_stop.freeze(0.08); victim_stop.freeze(0.08)
```

```cpp [Unreal (C++)]
// LocalHitStopComponent.h: CustomTimeDilation freezes the actor's own tick, animation and movement.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "LocalHitStopComponent.generated.h"

UCLASS(ClassGroup = (Gameplay), meta = (BlueprintSpawnableComponent))
class ULocalHitStopComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	void Freeze(float Duration);
	bool IsFrozen() const { return bFrozen; }

private:
	void Resume();

	FTimerHandle ResumeTimer;
	double ResumeAt = 0.0;
	float SavedDilation = 1.f;
	bool bFrozen = false;
};

// LocalHitStopComponent.cpp
#include "LocalHitStopComponent.h"
#include "TimerManager.h"

void ULocalHitStopComponent::Freeze(float Duration)
{
	const double End = GetWorld()->GetTimeSeconds() + Duration;
	if (bFrozen && End <= ResumeAt) return;

	if (!bFrozen)
	{
		SavedDilation = GetOwner()->CustomTimeDilation;
		GetOwner()->CustomTimeDilation = 0.f;
		bFrozen = true;
	}
	ResumeAt = End;
	// World timers use global time, not the owner's dilation, so this still fires. Setting the
	// same handle again restarts it.
	GetWorld()->GetTimerManager().SetTimer(ResumeTimer, this, &ULocalHitStopComponent::Resume,
		static_cast<float>(End - GetWorld()->GetTimeSeconds()), false);
}

void ULocalHitStopComponent::Resume()
{
	GetOwner()->CustomTimeDilation = SavedDilation;
	bFrozen = false;
}

// On a hit: Attacker->FindComponentByClass<ULocalHitStopComponent>()->Freeze(0.08f); and the same for the victim.
```

:::

**Engine notes**

- **Unity:** `Animator.speed = 0` freezes only the animation. Physics and movement code keep running unless they check `Frozen`.
- **Godot:** `Engine.time_scale` doesn't stop `_process` from running, so a global stop that must freeze scripted motion uses the tree pause (`GameTime.push(0.0, …)`), as here. Particles, sounds and shake that should play through the stop need **Process Mode: Always**. `AnimationPlayer.speed_scale` only freezes animation.
- **Unreal:** `CustomTimeDilation = 0` freezes the actor's tick, its skeletal animation and its movement component, so the local stop needs no checks in movement code. The global stop's subsystem must tick while paused (`IsTickableWhenPaused`) or it would never release the pause. A small non-zero scale such as 0.02 gives a near-freeze through global time dilation instead of pausing the game.

## When to use

- Melee combat, fighting games, action games, anything where hits need weight.
- Breaking objects, landing heavy jumps, parries and perfect blocks.

## When not to use

- Games with constant, frequent hits, such as bullet hells or hordes. Constant freezes break the flow; save it for heavy hits.
- Online multiplayer. Freezing the simulation desyncs players; freeze only the presentation.
- Games where precise timing matters more than impact, such as rhythm games.

## Pitfalls

- **Overuse.** Hit stop on every bullet in a fast shooter makes the game stutter. Reserve it for meaningful hits, and keep rapid-fire stops short or local.
- **Stacking.** Adding durations for multi-hits produces long, broken freezes. Take the maximum.
- **Freezing feedback too.** Particles, shake and audio on scaled time freeze along with the game, which defeats the purpose. Use unscaled time for them.
- **Input lost during the stop.** A button pressed during a 100 ms freeze must still count afterwards. An [Input Buffer](./input-buffer) on unscaled time solves this.
- **Multiplayer.** Global time cannot stop for one player. Use local stops, purely cosmetic, without affecting the simulation.

## Related

- [Time Scale](./time-scale) — the mechanism behind global hit stop.
- [Screen Shake (Trauma)](./screen-shake) — usually triggered on the same hit.
- [Input Buffer](./input-buffer) — keeps presses made during the freeze.
- [Feedback Layering (Juice)](./juice) — hit stop is one layer among many.
