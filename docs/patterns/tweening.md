# Tweening & Easing

> Interpolate values over time with easing curves instead of linear motion.

**Category:** Game Feel & Input

## Problem

A menu panel slides in at constant speed and stops dead. A coin flies to the score counter in a straight, robotic line. A health bar drops instantly from 80 to 30. A camera follows with `Lerp(current, target, 0.1f)`, which feels different at 30 and 144 FPS. Every one of these animations is technically correct, and all of them feel cheap.

## Solution

Two complementary tools:

**1. Tweens: go from A to B in a fixed time, shaped by an easing curve.**

A tween stores a start value, an end value, a duration and an **easing function** that maps linear progress `t ∈ [0, 1]` to shaped progress. The value each frame is `Lerp(start, end, ease(elapsed / duration))`.

| Easing | Feels like | Use for |
| --- | --- | --- |
| **Ease-out** (quad, cubic, expo) | Fast start, gentle stop | UI appearing, objects arriving (the default for most motion) |
| **Ease-in** | Slow start, fast end | Objects leaving the screen |
| **Ease-in-out** | Smooth both ends | Camera moves, transitions between two rest states |
| **Back** | Slight overshoot, then settle | Buttons popping in, playful UI |
| **Elastic / Bounce** | Springy wobble or bounces | Pickups, rewards, cartoon motion (use sparingly) |

**2. Damping: chase a moving target smoothly, at any frame rate.**

For targets that keep moving (cameras, cursors, smoothed health bars), use exponential smoothing with a *rate*, not a fraction per frame:

```
value = Lerp(value, target, 1 - exp(-rate * deltaTime))
```

Unlike `Lerp(value, target, 0.1f)`, this converges at the same speed whatever the frame rate.

## Pseudocode

```text
// Easing: maps linear progress 0..1 to shaped progress.
ease_out_quad(t)     = 1 - (1 - t)²
ease_in_out_cubic(t) = 4t³ if t < 0.5, else 1 - (2 - 2t)³ / 2
ease_out_back(t)     = 1 + 2.70158 (t - 1)³ + 1.70158 (t - 1)²   // overshoots past 1

// A tween: run for a fixed time and hand the eased progress to apply().
Tween:
    owner, elapsed ← 0, duration, ease, apply(p), on_complete
    unscaled                       // true for UI that must run while paused

run(owner, duration, ease, apply, on_complete):
    remove any tween with the same owner     // replace it, don't fight it
    add a new Tween to tweens

every frame, for each tween in tweens:
    elapsed ← elapsed + (real or game frame time, as unscaled says)
    p ← clamp(elapsed / duration, 0, 1)
    apply(ease(p))                 // e.g. position ← lerp unclamped(from, to, eased p)
    if p ≥ 1:
        remove the tween; on_complete()

// Damping: chase a moving target at the same speed at any frame rate.
damp(current, target, rate, dt):
    return lerp(current, target, 1 - e^(-rate × dt))

shown_health ← damp(shown_health, real_health, 8, frame time)
```

## Example

Easing functions (all take and return values in `[0, 1]` at the ends):

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public static class Ease
{
    public static float Linear(float t) => t;
    public static float OutQuad(float t) => 1f - (1f - t) * (1f - t);
    public static float OutCubic(float t) => 1f - Mathf.Pow(1f - t, 3f);
    public static float InOutCubic(float t) => t < 0.5f ? 4f * t * t * t : 1f - Mathf.Pow(-2f * t + 2f, 3f) / 2f;

    public static float OutBack(float t)
    {
        const float c1 = 1.70158f, c3 = c1 + 1f;
        return 1f + c3 * Mathf.Pow(t - 1f, 3f) + c1 * Mathf.Pow(t - 1f, 2f);
    }

    public static float OutElastic(float t)
    {
        if (t <= 0f || t >= 1f) return t;
        return Mathf.Pow(2f, -10f * t) * Mathf.Sin((t * 10f - 0.75f) * (2f * Mathf.PI / 3f)) + 1f;
    }
}
```

```gdscript [Godot (GDScript)]
# ease.gd: Godot's Tween has these built in (set_trans / set_ease); the functions are useful
# with tween_method, shaders or your own code.
class_name Ease


static func linear(t: float) -> float:
	return t


static func out_quad(t: float) -> float:
	return 1.0 - (1.0 - t) * (1.0 - t)


static func out_cubic(t: float) -> float:
	return 1.0 - pow(1.0 - t, 3.0)


static func in_out_cubic(t: float) -> float:
	return 4.0 * t * t * t if t < 0.5 else 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0


static func out_back(t: float) -> float:
	const C1 := 1.70158
	const C3 := C1 + 1.0
	return 1.0 + C3 * pow(t - 1.0, 3.0) + C1 * pow(t - 1.0, 2.0)


static func out_elastic(t: float) -> float:
	if t <= 0.0 or t >= 1.0:
		return t
	return pow(2.0, -10.0 * t) * sin((t * 10.0 - 0.75) * (TAU / 3.0)) + 1.0
```

```cpp [Unreal (C++)]
// Ease.h: header-only. Built-ins: FMath::InterpEaseIn/Out/InOut, InterpCircularOut, InterpExpoOut…
// and UKismetMathLibrary::Ease with EEasingFunc.
#pragma once

#include "CoreMinimal.h"

namespace Ease
{
	inline float Linear(float T) { return T; }
	inline float OutQuad(float T) { return 1.f - (1.f - T) * (1.f - T); }
	inline float OutCubic(float T) { return 1.f - FMath::Pow(1.f - T, 3.f); }
	inline float InOutCubic(float T) { return T < 0.5f ? 4.f * T * T * T : 1.f - FMath::Pow(-2.f * T + 2.f, 3.f) / 2.f; }

	inline float OutBack(float T)
	{
		constexpr float C1 = 1.70158f, C3 = C1 + 1.f;
		return 1.f + C3 * FMath::Pow(T - 1.f, 3.f) + C1 * FMath::Pow(T - 1.f, 2.f);
	}

	inline float OutElastic(float T)
	{
		if (T <= 0.f || T >= 1.f) return T;
		return FMath::Pow(2.f, -10.f * T) * FMath::Sin((T * 10.f - 0.75f) * (2.f * PI / 3.f)) + 1.f;
	}
}
```

:::

Running tweens. Unity has no built-in tween runner, so the Unity tab is a tiny one with one `Update` for all tweens. Godot's `Tween` and Unreal's Timelines are built in:

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public class Tweener : MonoBehaviour
{
    class Tween
    {
        public float Elapsed, Duration;
        public Func<float, float> Ease;
        public Action<float> Apply;            // receives eased progress 0..1 (may overshoot with Back/Elastic)
        public Action OnComplete;
        public bool Unscaled;
        public object Owner;                   // used to cancel or replace tweens
    }

    static Tweener instance;
    readonly List<Tween> tweens = new();

    static Tweener Get() => instance ??= new GameObject("[Tweener]").AddComponent<Tweener>();

    public static void Run(object owner, float duration, Func<float, float> ease, Action<float> apply,
                           Action onComplete = null, bool unscaled = false)
    {
        Kill(owner);                           // a new tween on the same owner replaces the old one
        Get().tweens.Add(new Tween { Owner = owner, Duration = duration, Ease = ease, Apply = apply,
                                     OnComplete = onComplete, Unscaled = unscaled });
    }

    public static void Kill(object owner) => instance?.tweens.RemoveAll(t => t.Owner == owner);

    void Update()
    {
        for (int i = tweens.Count - 1; i >= 0; i--)
        {
            if (i >= tweens.Count) continue;   // a callback killed several tweens
            var t = tweens[i];
            t.Elapsed += t.Unscaled ? Time.unscaledDeltaTime : Time.deltaTime;
            float p = Mathf.Clamp01(t.Elapsed / t.Duration);
            t.Apply(t.Ease(p));
            if (p >= 1f)
            {
                tweens.Remove(t);
                t.OnComplete?.Invoke();
            }
        }
    }
}

// Pop a reward panel in with overshoot, on unscaled time so it works while paused:
// Tweener.Run(panel, 0.35f, Ease.OutBack, p => panel.localScale = Vector3.one * p, unscaled: true);

// Fly a coin to the score counter, arriving gently, then count it:
// Vector3 from = coin.position;
// Tweener.Run(coin, 0.6f, Ease.InOutCubic, p => coin.position = Vector3.LerpUnclamped(from, counter.position, p),
//             () => score.Add(1));
```

```gdscript [Godot (GDScript)]
# reward_ui.gd: Tween is built in. create_tween() on a node binds the tween to it, so it stops
# when the node is freed.
extends Control

@export var panel: Control
@export var counter: Control

var _panel_tween: Tween


# Pop a reward panel in with overshoot, while the game is paused.
func pop_in() -> void:
	if _panel_tween:
		_panel_tween.kill()  # a new tween on the same target replaces the old one
	panel.pivot_offset = panel.size / 2.0
	panel.scale = Vector2.ZERO
	_panel_tween = panel.create_tween()
	_panel_tween.set_pause_mode(Tween.TWEEN_PAUSE_PROCESS)  # keeps running while the tree is paused
	_panel_tween.tween_property(panel, "scale", Vector2.ONE, 0.35) \
		.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


# Fly a coin to the score counter, arriving gently, then count it.
func fly_coin(coin: Control, on_arrived: Callable) -> void:
	var tween := coin.create_tween()
	tween.tween_property(coin, "global_position", counter.global_position, 0.6) \
		.set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	tween.tween_callback(on_arrived)
	tween.tween_callback(coin.queue_free)


# A custom curve from the Ease class: tween a 0..1 progress and apply it yourself.
func wobble(target: Control) -> void:
	var tween := target.create_tween()
	tween.tween_method(func(p: float) -> void: target.scale = Vector2.ONE * (0.5 + 0.5 * Ease.out_elastic(p)),
		0.0, 1.0, 0.5)
```

```cpp [Unreal (C++)]
// PopInComponent.h: an FTimeline driven by a curve asset. The curve is the easing: draw it in
// the curve editor (0 to 1 over 0.35 s, overshooting like OutBack). The Timeline component and
// Blueprint Timeline node wrap the same struct; UMG widget animations do this for UI.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Components/TimelineComponent.h"
#include "PopInComponent.generated.h"

class UCurveFloat;

UCLASS(ClassGroup = (Feedback), meta = (BlueprintSpawnableComponent))
class UPopInComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UPopInComponent();
	void Play();
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

protected:
	UPROPERTY(EditAnywhere, Category = "Tween")
	TObjectPtr<UCurveFloat> Curve;

private:
	UFUNCTION() void OnProgress(float Value);
	UFUNCTION() void OnFinished();

	FTimeline Timeline;
};

// PopInComponent.cpp
#include "PopInComponent.h"
#include "Curves/CurveFloat.h"

UPopInComponent::UPopInComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.bStartWithTickEnabled = false;   // tick only while playing
}

void UPopInComponent::Play()
{
	FOnTimelineFloat Progress;
	Progress.BindUFunction(this, GET_FUNCTION_NAME_CHECKED(UPopInComponent, OnProgress));
	FOnTimelineEvent Finished;
	Finished.BindUFunction(this, GET_FUNCTION_NAME_CHECKED(UPopInComponent, OnFinished));

	Timeline = FTimeline();                                // replaces a tween that is still running
	Timeline.AddInterpFloat(Curve, Progress);
	Timeline.SetTimelineFinishedFunc(Finished);
	Timeline.SetTimelineLengthMode(TL_LastKeyFrame);       // length = the curve's last key
	Timeline.PlayFromStart();
	SetComponentTickEnabled(true);
}

void UPopInComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	Timeline.TickTimeline(DeltaTime);
}

void UPopInComponent::OnProgress(float Value)
{
	GetOwner()->SetActorScale3D(FVector(Value));
}

void UPopInComponent::OnFinished()
{
	SetComponentTickEnabled(false);
}
```

:::

Frame-rate-independent damping, for things that chase a moving target:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public static class Damp
{
    // rate: higher = snappier. ~5 is soft, ~15 is tight, ~30 is nearly instant.
    public static float Towards(float current, float target, float rate, float dt) =>
        Mathf.Lerp(current, target, 1f - Mathf.Exp(-rate * dt));

    public static Vector3 Towards(Vector3 current, Vector3 target, float rate, float dt) =>
        Vector3.Lerp(current, target, 1f - Mathf.Exp(-rate * dt));
}

// A health bar that drains smoothly toward the real value:
// shownHealth = Damp.Towards(shownHealth, realHealth, 8f, Time.deltaTime);
```

```gdscript [Godot (GDScript)]
# damp.gd
class_name Damp


# rate: higher = snappier. ~5 is soft, ~15 is tight, ~30 is nearly instant.
static func towards(current: float, target: float, rate: float, delta: float) -> float:
	return lerpf(current, target, 1.0 - exp(-rate * delta))


static func towards_v3(current: Vector3, target: Vector3, rate: float, delta: float) -> Vector3:
	return current.lerp(target, 1.0 - exp(-rate * delta))


# A health bar that drains smoothly toward the real value:
# _shown_health = Damp.towards(_shown_health, health, 8.0, delta)
```

```cpp [Unreal (C++)]
// Damp.h
#pragma once

#include "CoreMinimal.h"

namespace Damp
{
	// Rate: higher = snappier. ~5 is soft, ~15 is tight, ~30 is nearly instant.
	inline float Towards(float Current, float Target, float Rate, float DeltaSeconds)
	{
		return FMath::Lerp(Current, Target, 1.f - FMath::Exp(-Rate * DeltaSeconds));
	}

	inline FVector Towards(const FVector& Current, const FVector& Target, float Rate, float DeltaSeconds)
	{
		return FMath::Lerp(Current, Target, 1.f - FMath::Exp(-Rate * DeltaSeconds));
	}
}

// A health bar that drains smoothly toward the real value:
// ShownHealth = Damp::Towards(ShownHealth, Health, 8.f, DeltaSeconds);
```

:::

**Engine notes**

- **Unity:** in production, a tweening library such as **DOTween**, **PrimeTween** or **LitMotion** adds sequences, loops, curves and zero-allocation APIs. Knowing the pattern helps you choose easings and avoid the pitfalls below.
- **Godot:** `Tween` covers sequences (`tween_property` calls run one after another), parallel steps (`set_parallel` or `parallel()`), loops (`set_loops`), delays and callbacks. A tween made with `create_tween()` on a node is killed when that node is freed, which avoids tweening freed objects. `Tween.set_ignore_time_scale` (4.3+) makes a tween ignore `Engine.time_scale`.
- **Unreal:** `FMath::FInterpTo` and `VInterpTo` are the built-in chasers. They move a fraction `DeltaTime * Speed` of the remaining distance, which is close to the exponential damping above at high frame rates but not exactly frame-rate independent. For UI, use UMG **widget animations**. A component's tick stops while the game is paused unless you set `PrimaryComponentTick.bTickEvenWhenPaused`.

## When to use

- **Tweens:** UI transitions, pickups, doors, platforms, damage numbers, anything with a clear start and end.
- **Damping:** cameras, smoothed UI values, aim assist, any value chasing a target that keeps changing.

## When not to use

- Movement driven by physics or gameplay rules. A tween fights the simulation.
- Values whose target changes every frame. Use damping instead of restarting the tween.
- Long, choreographed sequences. Use the engine's sequencer: Unity's Timeline, Godot's `AnimationPlayer`, Unreal's Sequencer.

## Pitfalls

- **`Lerp(a, b, 0.1f)` every frame** is frame-rate dependent and never quite arrives. Use exponential damping with `deltaTime`.
- **Fighting tweens.** Starting a new tween on an object that is still tweening makes both write every frame, and it jitters. Kill or replace the previous tween (here, by owner).
- **Tweening destroyed objects.** A callback touching a destroyed object throws. Kill tweens when their target is destroyed, or check that it is still valid in callbacks. Godot tweens created with a node's `create_tween()` are bound to that node and stop with it.
- **Overshoot outside valid ranges.** `OutBack` and `OutElastic` go past 1. Use `LerpUnclamped` where overshoot is intended, and avoid them for values that must stay in range (alpha, fill amounts).
- **Scaled time in menus.** Pause-menu tweens on scaled time never run. Use unscaled time for UI.
- **Allocations.** Lambdas that capture variables allocate on every call. Fine for UI, but avoid creating hundreds of tweens per frame in gameplay.

## Related

- [Screen Shake (Trauma)](./screen-shake) and [Hit Stop](./hit-stop) — other feedback tools that work with tweens.
- [Time Scale](./time-scale) — scaled versus unscaled tweens.
- [Update Method](./update-method) — one runner updating many tweens.
- [Camera Follow & Smoothing](./camera-smoothing) and [Feedback Layering (Juice)](./juice) — where tweens and damping get used most.
