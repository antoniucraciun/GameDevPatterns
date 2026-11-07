# Fixed Timestep

> Advance the simulation in constant increments for stable, reproducible physics.

**Also known as:** Fixed Update, Accumulator · **Category:** Game Loop & Timing

## Problem

When the simulation advances by a variable `deltaTime`, results depend on the frame rate. A jump reaches a different height at 30 FPS than at 144 FPS. A long frame can let a fast bullet tunnel through a wall, and stiff springs can explode. Replays and lockstep networking become impossible because two machines never take the same steps.

## Solution

Choose a constant step, for example 1/50 s. Keep an **accumulator** of real time not yet simulated. Each frame, add the elapsed real time, then run whole fixed steps while the accumulator holds at least one step. Render once, optionally **interpolating** between the last two simulation states using the leftover fraction.

```
accumulator += frameTime
while accumulator >= step:
    previous = current
    current  = simulate(current, step)
    accumulator -= step
alpha = accumulator / step
render(lerp(previous, current, alpha))
```

<FixedTimestepViz />

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
    readonly Action<double> simulate;
    double accumulator;

    public FixedStepRunner(double stepSeconds, Action<double> simulate)
    {
        step = stepSeconds;
        this.simulate = simulate;
    }

    // Returns the interpolation alpha for rendering between the last two states.
    public double Advance(double frameTime)
    {
        accumulator += Math.Min(frameTime, 0.25);   // clamp after a hitch to avoid a spiral of death
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
var _simulate: Callable
var _accumulator := 0.0


func _init(step_seconds: float, simulate: Callable) -> void:
	_step = step_seconds
	_simulate = simulate


# Returns the interpolation alpha for rendering between the last two states.
func advance(frame_time: float) -> float:
	_accumulator += minf(frame_time, 0.25)  # clamp after a hitch to avoid a spiral of death
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
	FFixedStepRunner(double InStep, TFunction<void(double)> InSimulate)
		: Step(InStep), Simulate(MoveTemp(InSimulate)) {}

	// Returns the interpolation alpha for rendering between the last two states.
	double Advance(double FrameTime)
	{
		Accumulator += FMath::Min(FrameTime, 0.25);   // clamp after a hitch to avoid a spiral of death
		while (Accumulator >= Step)
		{
			Simulate(Step);
			Accumulator -= Step;
		}
		return Accumulator / Step;
	}

private:
	double Step;
	TFunction<void(double)> Simulate;
	double Accumulator = 0.0;
};
```

:::

**Engine notes**

- **Unity:** set **Interpolate** on the Rigidbody so rendering blends between physics steps and motion looks smooth at any display rate.
- **Godot:** turn on **physics interpolation** (Project Settings → Physics → Common; 2D since 4.3, 3D since 4.4) for the same smoothing.
- **Unreal:** by default physics steps with the frame (optionally **substepping**). The async physics tick gives a true fixed step; mark state shared with the game thread as thread-safe, as the `std::atomic` above does.

## When to use

- Physics, character controllers, anything integrated over time.
- Deterministic simulations: replays, lockstep, rollback.

## When not to use

- Purely visual or UI animation: tweens, camera smoothing, UI fades. Run them per frame with `Time.deltaTime`, or they stutter at frame rates that don't match the step.
- Reading input. Sample it every frame and hand it to the fixed step, or presses that land between steps get lost.
- Simple non-physics games where frame-rate independence via `deltaTime` is enough and determinism doesn't matter.

## Pitfalls

- **One-frame inputs lost or doubled.** `GetKeyDown` checked in `FixedUpdate` can miss a press (zero steps this frame) or fire twice (two steps). Latch inputs in `Update` and consume them in the fixed step.
- **Spiral of death.** Clamp frame time (Unity's *Maximum Allowed Timestep*) so a hitch does not demand hundreds of catch-up steps.
- **Visible stutter without interpolation** when the display rate is not a multiple of the step rate.
- A fixed step alone does not make floating-point math deterministic across platforms. See [Determinism](./determinism).

## Related

- [Game Loop](./game-loop) — the outer loop that drives the accumulator.
- [Double Buffer](./double-buffer) — keeps the previous and current state for interpolation.
- [Rollback Netcode](./rollback-netcode) and [Deterministic Lockstep](./deterministic-lockstep) both depend on fixed steps.
