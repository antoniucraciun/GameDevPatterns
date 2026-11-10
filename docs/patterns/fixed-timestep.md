# Fixed Timestep

> Advance the simulation in constant increments for stable, reproducible physics.

**Also known as:** Fixed Update, Accumulator · **Category:** Game Loop & Timing

## Overview

Physics and other simulations give different results when each frame advances them by a different amount of time. A fixed timestep advances the simulation in equal steps, as many as the real time allows, so it behaves the same at any frame rate. This page covers the accumulator loop, interpolating between steps for smooth rendering, and how Unity, Godot and Unreal already run physics this way.

## Problem

Scaling movement by a variable `deltaTime` gives [frame rate independence](./game-loop) for simple motion, but anything integrated over time still depends on the frame rate. Most hand-written simulations use **semi-implicit Euler** (update the velocity from the acceleration, then the position from the new velocity), and its result depends on the step size. A jump reaches a different height at 30 FPS than at 144 FPS. A long frame can let a fast bullet tunnel through a wall, and stiff springs can explode. Replays and lockstep networking become impossible because two machines never take the same steps.

## Solution

Choose a constant step, for example 1/50 s. Keep an **accumulator** of real time not yet simulated. Each frame, add the elapsed real time, then run whole fixed steps while the accumulator holds at least one step. Render once, optionally **interpolating** between the last two simulation states using the leftover fraction.

```
accumulator += frameTime
while accumulator >= step:
    previous = current
    current  = simulate(current, step)
    accumulator -= step
alpha = accumulator / step      // the interpolation alpha: 0 to 1 into the next step
render(lerp(previous, current, alpha))
```

A fixed step doesn't make the simulation more *accurate*: a 1/50 s step still misses the exact answer. It makes it **deterministic**, landing on the same answer every time on every machine, which is what replays, lockstep and rollback need.

<FixedTimestepViz />

## Pseudocode

```text
step        = constant simulation step, e.g. 1/50 s
max_frame   = longest frame time accepted, e.g. 0.25 s
accumulator ← 0          // real time not simulated yet
thrust_held ← false      // input latched for the fixed steps

every rendered frame, with frame_time:
    thrust_held ← is the thrust key down     // sample input every frame
    alpha ← advance(frame_time)
    render, blending the last two states by alpha

advance(frame_time):
    accumulator ← accumulator + min(frame_time, max_frame)
                         // clamp after a hitch: no spiral of death
    while accumulator ≥ step:
        simulate(step)   // always the same size, so results are reproducible
        accumulator ← accumulator - step
    return accumulator / step     // how far we are into the next step

simulate(step):
    if thrust_held:
        apply the upward force to the body for one step
```

## Example

Each engine already runs physics at a fixed step. Apply forces there, and sample input every rendered frame:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

// FixedUpdate runs at Time.fixedDeltaTime (Project Settings → Time).
public class Thruster : MonoBehaviour
{
    [SerializeField] float force = 20f;
    Rigidbody body;
    bool thrustHeld;

    void Awake() => body = GetComponent<Rigidbody>();

    // Input is sampled every rendered frame...
    void Update() => thrustHeld = Input.GetKey(KeyCode.Space);

    // ...but applied in constant-size simulation steps.
    void FixedUpdate()
    {
        if (thrustHeld)
            body.AddForce(Vector3.up * force);
    }
}
```

```gdscript [Godot (GDScript)]
# thruster.gd: _physics_process runs at the physics tick rate
# (Project Settings → Physics → Common → Physics Ticks per Second).
extends RigidBody3D

@export var force := 20.0
var _thrust_held := false


# Input is sampled every rendered frame...
func _process(_delta: float) -> void:
	_thrust_held = Input.is_action_pressed("thrust")


# ...but applied in constant-size simulation steps.
func _physics_process(_delta: float) -> void:
	if _thrust_held:
		apply_central_force(Vector3.UP * force)
```

```cpp [Unreal (C++)]
// ThrusterActor.h: Unreal ticks at a variable rate, so use the async physics tick, which runs at
// a fixed step (Project Settings → Physics → "Tick Physics Async", UE 5.1+).
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Components/StaticMeshComponent.h"
#include "PhysicsProxy/SingleParticlePhysicsProxy.h"
#include <atomic>
#include "ThrusterActor.generated.h"

UCLASS()
class AThrusterActor : public AActor
{
	GENERATED_BODY()

public:
	AThrusterActor()
	{
		Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
		Body->SetSimulatePhysics(true);
		RootComponent = Body;
		bAsyncPhysicsTickEnabled = true;
	}

	// Called every rendered frame from input (for example an Enhanced Input action).
	void SetThrustHeld(bool bHeld) { bThrustHeld = bHeld; }

	// ...but forces are applied in constant-size simulation steps, on the physics thread.
	virtual void AsyncPhysicsTickActor(float DeltaTime, float SimTime) override
	{
		Super::AsyncPhysicsTickActor(DeltaTime, SimTime);
		if (!bThrustHeld) return;
		// Component functions are game-thread only; use the body's physics-thread handle here.
		if (Chaos::FRigidBodyHandle_Internal* Handle = Body->GetBodyInstance()->GetPhysicsActorHandle()->GetPhysicsThreadAPI())
			Handle->AddForce(FVector::UpVector * Acceleration * Handle->M());
	}

	UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Body;
	UPROPERTY(EditAnywhere, Category = "Thruster") float Acceleration = 2000.f;   // cm/s²

private:
	std::atomic<bool> bThrustHeld = false;   // written on the game thread, read on the physics thread
};
```

:::

For your own simulation that isn't physics (a deterministic gameplay sim, a replay, a lockstep game), write the accumulator yourself:

::: code-group

```csharp [Unity (C#)]
using System;

// Plain C#: call Advance from Update with Time.deltaTime.
public class FixedStepRunner
{
    readonly double step;
    readonly double maxFrameTime;
    readonly Action<double> simulate;
    double accumulator;

    // maxFrameTime: the longest frame accepted, so a hitch can't demand hundreds of catch-up steps.
    public FixedStepRunner(double stepSeconds, Action<double> simulate, double maxFrameTime = 0.25)
    {
        step = stepSeconds;
        this.simulate = simulate;
        this.maxFrameTime = maxFrameTime;
    }

    // Returns the interpolation alpha for rendering between the last two states.
    public double Advance(double frameTime)
    {
        accumulator += Math.Min(frameTime, maxFrameTime);   // clamp: no spiral of death
        while (accumulator >= step)
        {
            simulate(step);
            accumulator -= step;
        }
        return accumulator / step;
    }
}
```

```gdscript [Godot (GDScript)]
# fixed_step_runner.gd: call advance() from _process with delta.
class_name FixedStepRunner
extends RefCounted

var _step: float
var _max_frame_time: float
var _simulate: Callable
var _accumulator := 0.0


# max_frame_time: the longest frame accepted, so a hitch can't demand hundreds of catch-up steps.
func _init(step_seconds: float, simulate: Callable, max_frame_time := 0.25) -> void:
	_step = step_seconds
	_simulate = simulate
	_max_frame_time = max_frame_time


# Returns the interpolation alpha for rendering between the last two states.
func advance(frame_time: float) -> float:
	_accumulator += minf(frame_time, _max_frame_time)  # clamp: no spiral of death
	while _accumulator >= _step:
		_simulate.call(_step)
		_accumulator -= _step
	return _accumulator / _step
```

```cpp [Unreal (C++)]
// FixedStepRunner.h: plain C++. Call Advance from Tick with DeltaSeconds.
#pragma once

#include "CoreMinimal.h"

class FFixedStepRunner
{
public:
	// InMaxFrameTime: the longest frame accepted, so a hitch can't demand hundreds of catch-up steps.
	FFixedStepRunner(double InStep, TFunction<void(double)> InSimulate, double InMaxFrameTime = 0.25)
		: Step(InStep), MaxFrameTime(InMaxFrameTime), Simulate(MoveTemp(InSimulate)) {}

	// Returns the interpolation alpha for rendering between the last two states.
	double Advance(double FrameTime)
	{
		Accumulator += FMath::Min(FrameTime, MaxFrameTime);   // clamp: no spiral of death
		while (Accumulator >= Step)
		{
			Simulate(Step);
			Accumulator -= Step;
		}
		return Accumulator / Step;
	}

private:
	double Step;
	double MaxFrameTime;
	TFunction<void(double)> Simulate;
	double Accumulator = 0.0;
};
```

:::

To render with the returned alpha, the caller keeps two copies of its state, as in the Solution sketch: the simulate callback first sets `previous = current`, then advances `current` by one step, and each frame draws `lerp(previous, current, alpha)`.

**Engine notes**

- **Unity:** set **Interpolate** on the Rigidbody so rendering blends between physics steps and motion looks smooth at any display rate. The runnable Unity sample uses both examples above as written, and adds a `Jumper`: a hand-simulated jump advanced by `FixedStepRunner` at 1/50 s and drawn with interpolation, to show the runner in use. Its peak height is the same on every jump at 30 and about 120 FPS, while the same jump integrated with `deltaTime` peaks lower at 30 FPS than at 120. Docs: [MonoBehaviour.FixedUpdate](https://docs.unity3d.com/ScriptReference/MonoBehaviour.FixedUpdate.html), [Time.fixedDeltaTime](https://docs.unity3d.com/ScriptReference/Time-fixedDeltaTime.html), [Time settings](https://docs.unity3d.com/Manual/class-TimeManager.html) (Fixed Timestep, Maximum Allowed Timestep), [Fixed updates](https://docs.unity3d.com/Manual/fixed-updates.html), [Time handling variations](https://docs.unity3d.com/Manual/time-handling-variations.html), [Rigidbody.AddForce](https://docs.unity3d.com/ScriptReference/Rigidbody.AddForce.html), [Rigidbody.interpolation](https://docs.unity3d.com/ScriptReference/Rigidbody-interpolation.html), [Rigidbody interpolation](https://docs.unity3d.com/Manual/rigidbody-interpolation.html).
- **Godot:** turn on **physics interpolation** (Project Settings → Physics → Common; 2D since 4.3, 3D since 4.4) for the same smoothing. Docs: [Idle and physics processing](https://docs.godotengine.org/en/stable/tutorials/scripting/idle_and_physics_processing.html), [Physics interpolation](https://docs.godotengine.org/en/stable/tutorials/physics/interpolation/physics_interpolation_introduction.html), [RigidBody3D](https://docs.godotengine.org/en/stable/classes/class_rigidbody3d.html) (`apply_central_force`), [ProjectSettings](https://docs.godotengine.org/en/stable/classes/class_projectsettings.html) (`physics/common/physics_ticks_per_second`, `max_physics_steps_per_frame`).
- **Unreal:** by default physics steps with the frame (optionally **substepping**). The async physics tick gives a true fixed step; mark state shared with the game thread as thread-safe, as the `std::atomic` above does. Docs: [Physics Sub-Stepping](https://dev.epicgames.com/documentation/en-us/unreal-engine/physics-sub-stepping-in-unreal-engine).

## When to use

- Physics, character controllers, anything integrated over time.
- Deterministic simulations: replays, lockstep, rollback.

## When not to use

- Purely visual or UI animation: tweens, camera smoothing, UI fades. Run them per frame with the frame delta, or they stutter at frame rates that don't match the step.
- Reading input. Sample it every frame and hand it to the fixed step, or presses that land between steps get lost.
- Simple non-physics games where frame-rate independence via `deltaTime` is enough and determinism doesn't matter.

## Pitfalls

- **One-frame inputs lost or doubled.** Unity's `GetKeyDown` checked in `FixedUpdate` can miss a press (zero steps this frame) or fire twice (two steps). Latch inputs in the per-frame update and consume them in the fixed step. Godot's `is_action_just_pressed()` tracks physics frames and is safe in `_physics_process`; Unreal's input events fire per frame, so latch them the same way for any fixed-step logic of your own.
- **Forces applied in `Update`.** Unity sums every `AddForce` between two physics steps, so pushing from `Update` pushes harder at higher frame rates. Apply forces in `FixedUpdate` (`_physics_process` in Godot), as the example does.
- **Spiral of death.** Clamp frame time (Unity's *Maximum Allowed Timestep*, Godot's *Max Physics Steps per Frame*, Unreal's *Max Substeps*) so a hitch does not demand hundreds of catch-up steps.
- **Visible stutter without interpolation** when the display rate is not a multiple of the step rate.
- A fixed step alone does not make floating-point math deterministic across platforms. See [Determinism](./determinism).

## Related

- [Game Loop](./game-loop) — the outer loop that drives the accumulator.
- [Double Buffer](./double-buffer) — keeps the previous and current state for interpolation.
- [Rollback Netcode](./rollback-netcode) and [Deterministic Lockstep](./deterministic-lockstep) both depend on fixed steps.
