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

## Example (Unity C#)

Unity owns the loop, but its order of operations is worth knowing: input is polled, `FixedUpdate` runs zero or more times, then `Update`, then `LateUpdate`, then rendering. You can also insert your own systems into the engine's loop with the low-level `PlayerLoop` API:

```csharp
using UnityEngine;
using UnityEngine.LowLevel;
using UnityEngine.PlayerLoop;

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
            var systems = new System.Collections.Generic.List<PlayerLoopSystem>(update.subSystemList)
            {
                new PlayerLoopSystem { type = typeof(GameSystemsUpdate), updateDelegate = Tick }
            };
            update.subSystemList = systems.ToArray();
            loop.subSystemList[i] = update;
        }
        PlayerLoop.SetPlayerLoop(loop);
    }

    // Runs once per frame alongside MonoBehaviour.Update, without needing a GameObject.
    static void Tick() { /* update your plain C# systems here */ }
}
```

A hand-written loop in a custom engine looks like this:

```csharp
double previous = Clock.Now();
while (running)
{
    double current = Clock.Now();
    double elapsed = current - previous;
    previous = current;

    ProcessInput();
    Update(elapsed);
    Render();
}
```

## When to use

- Always. Every real-time game has one. The real question is whether you write it yourself or use the engine's, and which timing variant you choose.

## Pitfalls

- **Spiral of death:** if an update takes longer than the time it simulates, the loop falls further behind every frame. Clamp the elapsed time to a maximum.
- **Busy-waiting** burns battery on mobile. Let vsync or the platform throttle the frame rate.
- **Mixing time bases.** Use `Time.deltaTime` in `Update` and `Time.fixedDeltaTime` in `FixedUpdate`, and never cache one for use in the other.

## Related

- [Update Method](./update-method) — how individual objects plug into the loop.
- [Fixed Timestep](./fixed-timestep) — the most robust timing strategy.
- [Double Buffer](./double-buffer) — avoids reading half-updated state within one tick.
