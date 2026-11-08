# Update Method

> Let every object simulate one frame of its own behaviour when asked.

**Category:** Game Loop & Timing

## Problem

A world holds dozens of independent things: a patrolling guard, a spinning pickup, a door that slowly closes. Hard-coding all of their behaviour into one giant loop body does not scale, and adding a new kind of object would mean editing that loop.

## Solution

Give every active object an `Update(dt)` method that advances it by one frame. The game keeps a collection of active objects and calls `Update` on each of them once per frame. Each object keeps whatever state it needs between calls, such as the patrol waypoint index or how far the door has closed.

## Pseudocode

```text
// Each object keeps its own state between frames and advances itself.
Patrol:
    waypoints, speed
    index ← 0                    // the waypoint it is heading for

    update(dt):
        target ← waypoints[index]
        move position toward target by at most speed × dt
        if position has reached target:
            index ← (index + 1) mod number of waypoints

// The loop only knows that objects can be updated.
TickManager:
    objects                      // everything that wants an update

    register(obj):   add obj to objects
    unregister(obj): remove obj from objects

    every frame, with frame time dt:
        // Backwards, so an object can unregister itself during its update.
        for i from the last index of objects down to 0:
            objects[i].update(dt)
```

## Example

Every engine has this pattern built in: you override one method and the engine calls it every frame.

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class Patrol : MonoBehaviour
{
    [SerializeField] Transform[] waypoints;
    [SerializeField] float speed = 3f;
    int index;

    void Update()
    {
        Vector3 target = waypoints[index].position;
        transform.position = Vector3.MoveTowards(transform.position, target, speed * Time.deltaTime);
        if (transform.position == target)
            index = (index + 1) % waypoints.Length;
    }
}
```

```gdscript [Godot (GDScript)]
# patrol.gd
extends Node3D

@export var waypoints: Array[Node3D] = []
@export var speed := 3.0
var _index := 0


func _process(delta: float) -> void:
	var target := waypoints[_index].global_position
	global_position = global_position.move_toward(target, speed * delta)
	if global_position.is_equal_approx(target):
		_index = (_index + 1) % waypoints.size()
```

```cpp [Unreal (C++)]
// PatrolActor.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "PatrolActor.generated.h"

UCLASS()
class APatrolActor : public AActor
{
	GENERATED_BODY()

public:
	APatrolActor() { PrimaryActorTick.bCanEverTick = true; }

	UPROPERTY(EditAnywhere, Category = "Patrol") TArray<TObjectPtr<AActor>> Waypoints;
	UPROPERTY(EditAnywhere, Category = "Patrol") float Speed = 300.f;   // cm/s

	virtual void Tick(float DeltaSeconds) override
	{
		Super::Tick(DeltaSeconds);
		if (Waypoints.IsEmpty()) return;

		const FVector Target = Waypoints[Index]->GetActorLocation();
		const FVector Next = FMath::VInterpConstantTo(GetActorLocation(), Target, DeltaSeconds, Speed);
		SetActorLocation(Next);
		if (Next.Equals(Target)) Index = (Index + 1) % Waypoints.Num();
	}

private:
	int32 Index = 0;
};
```

:::

With thousands of objects, the per-object call overhead adds up. A common optimisation is one manager that holds a plain list and calls a method on each object:

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public interface ITickable { void Tick(float dt); }

public class TickManager : MonoBehaviour
{
    static readonly List<ITickable> tickables = new();
    public static void Register(ITickable t) => tickables.Add(t);
    public static void Unregister(ITickable t) => tickables.Remove(t);

    void Update()
    {
        float dt = Time.deltaTime;
        // Iterate backwards so objects can unregister themselves during Tick.
        for (int i = tickables.Count - 1; i >= 0; i--)
            tickables[i].Tick(dt);
    }
}
```

```gdscript [Godot (GDScript)]
# tick_manager.gd: autoload named TickManager. Ticked objects can be plain RefCounted
# objects (no node, no scene tree) as long as they have a tick(dt) method.
extends Node

var _tickables: Array = []


func register(obj: Object) -> void:
	_tickables.append(obj)


func unregister(obj: Object) -> void:
	_tickables.erase(obj)


func _process(delta: float) -> void:
	# Iterate backwards so objects can unregister themselves during tick.
	for i in range(_tickables.size() - 1, -1, -1):
		_tickables[i].tick(delta)
```

```cpp [Unreal (C++)]
// TickManagerSubsystem.h: ticks plain C++ objects with one virtual call each.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "TickManagerSubsystem.generated.h"

class IManagedTick
{
public:
	virtual ~IManagedTick() = default;
	virtual void ManagedTick(float DeltaTime) = 0;
};

UCLASS()
class UTickManagerSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	void Register(IManagedTick* Obj) { Tickables.Add(Obj); }
	void Unregister(IManagedTick* Obj) { Tickables.Remove(Obj); }

	virtual void Tick(float DeltaTime) override
	{
		// Iterate backwards so objects can unregister themselves during ManagedTick.
		for (int32 I = Tickables.Num() - 1; I >= 0; --I)
			Tickables[I]->ManagedTick(DeltaTime);
	}

	virtual TStatId GetStatId() const override
	{
		RETURN_QUICK_DECLARE_CYCLE_STAT(UTickManagerSubsystem, STATGROUP_Tickables);
	}

private:
	TArray<IManagedTick*> Tickables;   // owners must Unregister before they are destroyed
};
```

:::

**Engine notes**

- **Unity:** `Update`, `FixedUpdate` and `LateUpdate` are all update methods. The engine-to-script call per `MonoBehaviour` is the overhead the manager avoids.
- **Godot:** `_process` and `_physics_process` run only while processing is enabled; `set_process(false)` turns an idle node off for free.
- **Unreal:** actors and components only tick if `bCanEverTick` is set. Lower `PrimaryActorTick.TickInterval` for things that don't need every frame, and turn ticking off with `SetActorTickEnabled(false)` when idle.

## When to use

- Many independent objects that each need a little work every frame.
- Behaviour that is easy to express as "advance by one step".

## When not to use

- Objects that sit idle most of the time: doors, pickups, spawners waiting for a trigger. React to events with [Observer](./observer) or schedule work with a [Timer](./timer-scheduler) instead of checking every frame.
- Thousands of identical objects. One manager looping over a plain array is faster than thousands of `Update` calls; see [Data Locality](./data-locality).
- Work that only needs to happen every few frames or seconds. Use [Time Slicing](./time-slicing) or a timer.

## Pitfalls

- **Update order is undefined between objects.** If A reads B's position, A may see this frame's value or last frame's. Use a later update phase (`LateUpdate`, `process_priority`, tick groups), explicit system ordering or a [Double Buffer](./double-buffer).
- **Modifying the collection while iterating it**, for example spawning or destroying objects during `Update`. Defer the changes, or iterate a copy or backwards.
- **Empty `Update` methods still cost a call.** Disable components that have nothing to do, or switch to events.
- **Polling things that rarely change.** Prefer [Observer](./observer) when something only matters at the moment it changes.

## Related

- [Game Loop](./game-loop) — what calls the update methods.
- [Component](./component) — update methods usually live on components.
- [Time Slicing](./time-slicing) — when each update is too expensive to run every frame.
