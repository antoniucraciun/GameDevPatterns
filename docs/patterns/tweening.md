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

## Example (Unity C#)

Easing functions (all take and return values in `[0, 1]` at the ends):

```csharp
using System;
using System.Collections.Generic;
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

A tiny tween runner, one `Update` for all tweens:

```csharp
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

Frame-rate-independent damping, for things that chase a moving target:

```csharp
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

In production, a tweening library such as **DOTween**, **PrimeTween** or **LitMotion** adds sequences, loops, curves and zero-allocation APIs. Knowing the pattern helps you choose easings and avoid the pitfalls below.

## When to use

- **Tweens:** UI transitions, pickups, doors, platforms, damage numbers, anything with a clear start and end.
- **Damping:** cameras, smoothed UI values, aim assist, any value chasing a target that keeps changing.

## Pitfalls

- **`Lerp(a, b, 0.1f)` every frame** is frame-rate dependent and never quite arrives. Use exponential damping with `deltaTime`.
- **Fighting tweens.** Starting a new tween on an object that is still tweening makes both write every frame, and it jitters. Kill or replace the previous tween (here, by owner).
- **Tweening destroyed objects.** A callback touching a destroyed object throws. Kill tweens in `OnDestroy`, or check for null in callbacks.
- **Overshoot outside valid ranges.** `OutBack` and `OutElastic` go past 1. Use `LerpUnclamped` where overshoot is intended, and avoid them for values that must stay in range (alpha, fill amounts).
- **Scaled time in menus.** Pause-menu tweens on scaled time never run. Use unscaled time for UI.
- **Allocations.** Lambdas that capture variables allocate on every call. Fine for UI, but avoid creating hundreds of tweens per frame in gameplay.

## Related

- [Screen Shake (Trauma)](./screen-shake) and [Hit Stop](./hit-stop) — other feedback tools that work with tweens.
- [Time Scale](./time-scale) — scaled versus unscaled tweens.
- [Update Method](./update-method) — one runner updating many tweens.
- Camera Follow & Smoothing and Feedback Layering (Juice) — where tweens and damping get used most.
