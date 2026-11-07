# Game Loop

> Decouple the progression of game time from user input and processor speed.

**Category:** Game Loop & Timing

## Problem

A desktop application waits for the user: nothing happens until a click arrives. A game cannot work that way. Enemies keep moving, timers keep ticking and animations keep playing whether or not the player presses anything. Time also has to advance at the same rate on a fast gaming PC and on a five-year-old phone.

## Solution

Run a loop for the lifetime of the game. Each iteration does three things:

1. **Process input** without blocking. Read whatever arrived since the last iteration.
2. **Update** the simulation by the amount of time that has passed.
3. **Render** the current state.

The key decision is how the loop measures and spends time:

| Variant | How it works | Trade-off |
| --- | --- | --- |
| Uncapped, fixed step | Update by a constant step every iteration | Game speed depends on the machine |
| Variable step | Update by the real elapsed time (`deltaTime`) | Simple, but physics becomes non-deterministic and unstable on long frames |
| Fixed update, variable render | Accumulate real time; run as many fixed updates as fit; render once | Stable and reproducible. Rendering may need interpolation. See [Fixed Timestep](./fixed-timestep). |

## Example

Every engine owns the loop. What you control is **where your code runs in it**. Each engine polls input, runs physics zero or more times at a fixed step, runs per-frame updates, then renders. You can add your own systems to that loop without attaching them to an object in the scene:

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.LowLevel;
using UnityEngine.PlayerLoop;

// Inserts a custom step into Unity's PlayerLoop, next to MonoBehaviour.Update.
public static class CustomLoop
{
    public struct GameSystemsUpdate { }

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
    static void Install()
    {
        var loop = PlayerLoop.GetCurrentPlayerLoop();
        for (int i = 0; i < loop.subSystemList.Length; i++)
        {
            if (loop.subSystemList[i].type != typeof(Update)) continue;

            var update = loop.subSystemList[i];
            var systems = new List<PlayerLoopSystem>(update.subSystemList)
            {
                new PlayerLoopSystem { type = typeof(GameSystemsUpdate), updateDelegate = Tick }
            };
            update.subSystemList = systems.ToArray();
            loop.subSystemList[i] = update;
        }
        PlayerLoop.SetPlayerLoop(loop);
    }

    // Runs once per frame, without needing a GameObject.
    static void Tick() { /* update your plain C# systems here */ }
}
```

```gdscript [Godot (GDScript)]
# game_systems.gd: register as an autoload (Project Settings → Globals) named GameSystems.
# Autoloads live for the whole game, outside any scene.
extends Node


func _ready() -> void:
	# The SceneTree emits these once per frame, before nodes' _process / _physics_process.
	get_tree().process_frame.connect(_on_frame)
	get_tree().physics_frame.connect(_on_physics_step)
	# Or simply use _process here and set process_priority to order it against other nodes.


func _on_frame() -> void:
	var dt := get_process_delta_time()
	# update your plain GDScript systems here


func _on_physics_step() -> void:
	var dt := get_physics_process_delta_time()
	# fixed-step systems here
```

```cpp [Unreal (C++)]
// GameSystemsSubsystem.h: a world subsystem that ticks once per frame, with no actor in the level.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "GameSystemsSubsystem.generated.h"

UCLASS()
class UGameSystemsSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Tick(float DeltaTime) override
	{
		// update your plain C++ systems here
	}

	virtual TStatId GetStatId() const override
	{
		RETURN_QUICK_DECLARE_CYCLE_STAT(UGameSystemsSubsystem, STATGROUP_Tickables);
	}
};
```

:::

A hand-written loop in a custom engine, in any language:

```
previous = clock.now()
while running:
    current  = clock.now()
    elapsed  = current - previous
    previous = current

    process_input()
    update(elapsed)
    render()
```

**Engine notes**

- **Unity:** per frame, input is polled, `FixedUpdate` runs zero or more times, then `Update`, `LateUpdate`, then rendering. Script execution order (Project Settings) orders scripts within each phase.
- **Godot:** input events are handled first, then `_physics_process` runs zero or more times at the physics tick rate, then `_process`, then rendering. `process_priority` and `process_physics_priority` order nodes within each.
- **Unreal:** actors and components tick in **tick groups** (`TG_PrePhysics`, `TG_DuringPhysics`, `TG_PostPhysics`, `TG_PostUpdateWork`). Set `PrimaryActorTick.TickGroup`, or add tick prerequisites, to order them.

## When to use

- Always. Every real-time game has one. The real question is whether you write it yourself or use the engine's, and which timing variant you choose.

## When not to use

- Writing your own loop inside Unity, Godot or Unreal. The engine already runs one: hook into it with [Update Method](./update-method), [Fixed Timestep](./fixed-timestep) and the engine's script execution order.
- Turn-based or menu-driven games with no continuous simulation. An event-driven app that waits for input is simpler and saves battery.

## Pitfalls

- **Spiral of death:** if an update takes longer than the time it simulates, the loop falls further behind every frame. Clamp the elapsed time to a maximum.
- **Busy-waiting** burns battery on mobile. Let vsync or the platform throttle the frame rate.
- **Mixing time bases.** Use `Time.deltaTime` in `Update` and `Time.fixedDeltaTime` in `FixedUpdate`, and never cache one for use in the other.

## Related

- [Update Method](./update-method) — how individual objects plug into the loop.
- [Fixed Timestep](./fixed-timestep) — the most robust timing strategy.
- [Double Buffer](./double-buffer) — avoids reading half-updated state within one tick.
