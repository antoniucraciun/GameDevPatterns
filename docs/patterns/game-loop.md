# Game Loop

> Decouple the progression of game time from user input and processor speed.

**Category:** Game Loop & Timing

## Overview

The game loop is the heartbeat of a real-time game: every frame it reads input, advances the simulation and draws the result, whether or not the player does anything. Unity, Godot and Unreal already run this loop for you. This page shows how each frame is ordered, how the loop keeps game time independent of the machine's speed, and where your own code can run inside it.

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

Both of the last two variants give you **frame rate independence**: because the simulation advances by the real time that has passed, not by a fixed amount per frame, the game runs at the same speed at 30 FPS and at 144 FPS.

<GameLoopViz />

## Pseudocode

What one frame does, and where your own systems plug in. The engines run this loop for you; a custom engine writes it out.

```text
step        = the fixed physics step, e.g. 1/50 s
max_elapsed = the longest frame worth simulating, e.g. 0.25 s
systems     = your own per-frame systems, registered once at startup

register(system):              // at game start, no scene object needed
    add system to systems

run():
    previous ← clock now
    while running:
        current ← clock now
        elapsed ← min(current - previous, max_elapsed)   // clamp: no spiral of death
        previous ← current

        process_input()        // read what has arrived, never wait for it
        run as many fixed steps of size step as elapsed time allows
                               // zero or more; see Fixed Timestep
        for each system in systems:
            system.update(elapsed)     // per-frame work
        render()
```

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
    // An empty marker type. The PlayerLoop identifies each step by a type:
    // this one names the step in the Profiler, and lets you find or remove it later.
    public struct GameSystemsUpdate { }

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
    static void Install()
    {
        var loop = PlayerLoop.GetCurrentPlayerLoop();
        for (int i = 0; i < loop.subSystemList.Length; i++)
        {
            if (loop.subSystemList[i].type != typeof(Update)) continue;

            var update = loop.subSystemList[i];
            var systems = new List<PlayerLoopSystem>(update.subSystemList);
            systems.RemoveAll(s => s.type == typeof(GameSystemsUpdate)); // never insert it twice
            systems.Add(new PlayerLoopSystem { type = typeof(GameSystemsUpdate), updateDelegate = Tick });
            update.subSystemList = systems.ToArray();
            loop.subSystemList[i] = update; // PlayerLoopSystem is a struct: write the copy back
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

**Engine notes**

- **Unity:** per frame, input is polled, `FixedUpdate` runs zero or more times, then `Update`, `LateUpdate`, then rendering. Script execution order (Project Settings) orders scripts within each phase. The runnable Unity sample differs from the code above in one way: it installs the step from a component in its scene (`OnEnable`) and removes it again (`OnDisable`), so it doesn't run in other samples. A real game installs it once at startup, as shown here. Docs: [Event function execution order](https://docs.unity3d.com/Manual/execution-order.html), [PlayerLoop](https://docs.unity3d.com/ScriptReference/LowLevel.PlayerLoop.html), [PlayerLoopSystem](https://docs.unity3d.com/ScriptReference/LowLevel.PlayerLoopSystem.html), [RuntimeInitializeOnLoadMethod](https://docs.unity3d.com/ScriptReference/RuntimeInitializeOnLoadMethodAttribute.html), [Time settings](https://docs.unity3d.com/Manual/class-TimeManager.html) (Fixed Timestep, Maximum Allowed Timestep), [Domain reloading](https://docs.unity3d.com/Manual/domain-reloading.html).
- **Godot:** input events are handled first, then `_physics_process` runs zero or more times at the physics tick rate, then `_process`, then rendering. `process_priority` and `process_physics_priority` order nodes within each. Docs: [Idle and physics processing](https://docs.godotengine.org/en/stable/tutorials/scripting/idle_and_physics_processing.html), [SceneTree](https://docs.godotengine.org/en/stable/classes/class_scenetree.html) (`process_frame`, `physics_frame`), [Singletons (Autoload)](https://docs.godotengine.org/en/stable/tutorials/scripting/singletons_autoload.html), [Node](https://docs.godotengine.org/en/stable/classes/class_node.html) (`process_priority`).
- **Unreal:** actors and components tick in **tick groups** (`TG_PrePhysics`, `TG_DuringPhysics`, `TG_PostPhysics`, `TG_PostUpdateWork`). Set `PrimaryActorTick.TickGroup`, or add tick prerequisites, to order them. Docs: [Actor Ticking](https://dev.epicgames.com/documentation/en-us/unreal-engine/actor-ticking-in-unreal-engine), [Programming Subsystems](https://dev.epicgames.com/documentation/en-us/unreal-engine/programming-subsystems-in-unreal-engine).

## When to use

- Always. Every real-time game has one. The real question is whether you write it yourself or use the engine's, and which timing variant you choose.

## When not to use

- Writing your own loop inside Unity, Godot or Unreal. The engine already runs one: hook into it with [Update Method](./update-method), [Fixed Timestep](./fixed-timestep) and the engine's script execution order.
- Turn-based or menu-driven games with no continuous simulation. An event-driven app that waits for input is simpler and saves battery.

## Pitfalls

- **Spiral of death:** if an update takes longer than the time it simulates, the loop falls further behind every frame. Clamp the elapsed time to a maximum.
- **Busy-waiting** burns battery on mobile. Let vsync or the platform throttle the frame rate.
- **Mixing time bases.** Use the frame delta in per-frame code and the fixed step in fixed-step code (`Time.deltaTime` / `Time.fixedDeltaTime` in Unity, the `delta` passed to `_process` / `_physics_process` in Godot, `DeltaSeconds` in Unreal's `Tick`), and never cache one for use in the other.
- **Changing a copy of the Unity PlayerLoop.** `PlayerLoopSystem` is a struct, so `loop.subSystemList[i]` gives you a copy. After changing a phase's `subSystemList`, write it back with `loop.subSystemList[i] = update` before calling `PlayerLoop.SetPlayerLoop(loop)`. Otherwise Unity receives the unchanged loop: an insert silently does nothing, and a removal step never removes anything, so your step piles up across Play sessions.
- **Inserting a Unity PlayerLoop step twice.** With [Domain Reload](https://docs.unity3d.com/Manual/domain-reloading.html) disabled (Enter Play Mode Options), the modified PlayerLoop may survive from one Play session to the next, and a startup `Install` would then add a second copy of the step. Remove any existing entry of your marker type before inserting it, as the example does.

## Related

- [Update Method](./update-method) — how individual objects plug into the loop.
- [Fixed Timestep](./fixed-timestep) — the most robust timing strategy.
- [Double Buffer](./double-buffer) — avoids reading half-updated state within one tick.
