# Time Scale

> Route all simulation time through a scalable clock for pause, slow-mo and fast-forward.

**Category:** Game Loop & Timing

## Problem

The pause menu sets `Time.timeScale = 0`. A slow-motion finisher sets it to 0.2, then back to 1 when it ends, which unpauses the game if the player paused during the finisher. The pause menu's own animations freeze because they use scaled time. Footsteps keep playing. A "freeze one enemy" spell has no way to slow just that enemy. Every system that touches the one global value fights every other system.

## Solution

Treat time scaling as **requests that combine**, not as a value anyone can overwrite, and decide for every system **which clock it runs on**.

1. **Combine requests.** Each requester (pause menu, slow-mo ability, hit stop, cutscene) adds a request with a factor and gets a handle back. The effective scale is the **product** of all active requests, and releasing a handle removes only that request. Pause (×0) during slow-mo (×0.2) stays paused when the slow-mo ends.
2. **Pick a clock per system.**
   - *Gameplay*: scaled time. Freezes when paused.
   - *UI and menus*: unscaled time. Keeps animating while paused.
   - *Audio*: paused explicitly with the game, pitch-adjusted for slow-mo if desired.
3. **Local time scales.** An entity can multiply the global scale by its own factor (frozen enemy ×0, hasted player ×1.5), by using its own `deltaTime` instead of `Time.deltaTime`.

## Example (Unity C#)

```csharp
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

Requesters hold their handle and dispose it when done, so they never undo someone else's change:

```csharp
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

A per-entity local time scale for effects like "freeze this enemy":

```csharp
public class LocalTime : MonoBehaviour
{
    public float Scale = 1f;                                 // set by spells and status effects
    public float DeltaTime => Time.deltaTime * Scale;        // use instead of Time.deltaTime
}

// In the enemy:  transform.position += velocity * localTime.DeltaTime;
// Animator:      animator.speed = localTime.Scale;
```

`Awaitable` is Unity 6 (2023.1+). In older versions, use a coroutine with `WaitForSeconds`, which also respects the time scale.

## When to use

- Pause menus, slow motion, bullet time, fast-forward in strategy and simulation games, hit stop.
- Any game where more than one system wants to change the speed of time.

## Pitfalls

- **Overwriting instead of combining.** Any code that assigns `Time.timeScale` directly breaks the request system. Make `GameTime` the only writer, and search the codebase for stray assignments.
- **The wrong clock.** UI tweens, menu particles and "press any key" prompts need `unscaledDeltaTime`, Animator update mode *Unscaled Time*, and particle systems with *Use Unscaled Time*. Otherwise they freeze when paused.
- **`FixedUpdate` stops at scale 0**, but `Update` keeps running with `deltaTime == 0`. Code that divides by `deltaTime` breaks, and input handling in `Update` keeps working, which is usually what you want for unpausing.
- **Audio.** `AudioListener.pause` pauses *everything*, including menu sounds. Mark UI sources with `ignoreListenerPause = true`, or route gameplay audio through a mixer group you pause and pitch.
- **Leaked requests.** A slow-mo that never releases its handle (its object was destroyed mid-effect) keeps the game slow forever. Release in `OnDestroy`, and show active requests in a debug overlay.
- **Networked games.** You cannot slow down or pause a shared server simulation for one player. Time scale is a single-player tool, except for client-side cosmetics.

## Related

- [Game Loop](./game-loop) and [Fixed Timestep](./fixed-timestep) — what the scale actually controls.
- [Game State Manager](./game-state-manager) — the *Paused* state pushes a time-scale request.
- [Hit Stop](./hit-stop) — a very short time-scale request on impact.
- [Status Effects](./status-effects) — freeze and haste effects drive local time scales.
