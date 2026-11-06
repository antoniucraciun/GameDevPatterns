# Feedback Layering (Juice)

> Stack sound, particles, animation and shake on every meaningful action.

**Also known as:** Juice, Game Feel Feedback · **Category:** Game Feel & Input

## Problem

The mechanics work: the sword hits, the coin is collected, the button is pressed. But the game feels flat. A hit takes away health with nothing else happening, a coin quietly disappears, a jump has no anticipation and no landing. The fixes are known (shake, particles, sounds, squash and stretch), but they get added ad hoc. Every hit site calls six systems with hand-tuned magic numbers, different weapons feel inconsistent, and designers cannot adjust any of it without a programmer.

## Solution

Treat feedback as a **layered response to an event**, authored as data:

1. **Identify meaningful events.** Hits, kills, pickups, jumps, landings, UI confirmations, level-ups.
2. **Respond on several channels at once.** Each layer is small, and together they sell the moment:

| Layer | Examples |
| --- | --- |
| **Time** | [Hit Stop](./hit-stop), brief slow motion |
| **Camera** | [Screen Shake](./screen-shake), small zoom punch, FOV kick |
| **Object** | Squash and stretch, flash white, knockback, recoil ([Tweening](./tweening)) |
| **Particles** | Sparks, dust, debris, trails |
| **Audio** | Layered sounds with random pitch and volume variation |
| **UI** | Damage numbers, counter punch, screen flash, controller rumble |

3. **Bundle each response into a reusable feedback asset**: "Light Hit", "Heavy Hit", "Coin Pickup". Gameplay plays one asset, and designers tune the layers inside it.
4. **Scale with magnitude.** One asset can scale its layers by intensity (damage dealt, fall height), so small and big versions of an event feel related.

## Example (Unity C#)

A feedback asset made of composable layers, each a small serialisable class:

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

public struct FeedbackContext
{
    public Vector3 Position;
    public Transform Target;          // the object that was hit / collected / landed
    public float Intensity;           // 0..1, e.g. damage / maxDamage
}

[Serializable]
public abstract class FeedbackLayer
{
    public abstract void Play(in FeedbackContext ctx);
}

[Serializable]
public class ShakeLayer : FeedbackLayer
{
    public float trauma = 0.3f;
    public override void Play(in FeedbackContext ctx) => TraumaShake.Instance.AddTrauma(trauma * ctx.Intensity);
}

[Serializable]
public class HitStopLayer : FeedbackLayer
{
    public float minDuration = 0.03f, maxDuration = 0.12f;
    public override void Play(in FeedbackContext ctx) =>
        HitStop.Instance.Trigger(Mathf.Lerp(minDuration, maxDuration, ctx.Intensity));
}

[Serializable]
public class SoundLayer : FeedbackLayer
{
    public AudioClip[] clips;                         // several variants avoid repetition
    [Range(0f, 0.3f)] public float volumeVariation = 0.1f;
    public float volume = 1f;

    public override void Play(in FeedbackContext ctx)
    {
        if (clips.Length == 0) return;
        var clip = clips[UnityEngine.Random.Range(0, clips.Length)];
        // Route through the Event Queue so many identical hits in one frame merge.
        // (Add a pitch parameter to the queue to vary pitch too, which hides repetition even better.)
        AudioQueue.Instance.Request(clip, ctx.Position,
            volume * Mathf.Lerp(0.7f, 1f, ctx.Intensity) * (1f + UnityEngine.Random.Range(-volumeVariation, volumeVariation)));
    }
}

[Serializable]
public class ParticleLayer : FeedbackLayer
{
    public ParticleSystem prefab;
    public int minCount = 5, maxCount = 25;

    public override void Play(in FeedbackContext ctx)
    {
        var ps = UnityEngine.Object.Instantiate(prefab, ctx.Position, Quaternion.identity);   // pool in production
        ps.Emit(Mathf.RoundToInt(Mathf.Lerp(minCount, maxCount, ctx.Intensity)));
        UnityEngine.Object.Destroy(ps.gameObject, ps.main.duration + ps.main.startLifetime.constantMax);
    }
}

[Serializable]
public class SquashLayer : FeedbackLayer
{
    public Vector3 squash = new(1.3f, 0.7f, 1.3f);
    public float duration = 0.25f;

    public override void Play(in FeedbackContext ctx)
    {
        var t = ctx.Target;
        if (t == null) return;
        Vector3 rest = Vector3.one, peak = Vector3.LerpUnclamped(rest, squash, ctx.Intensity);
        // Snap to the squashed shape, then spring back with overshoot.
        Tweener.Run(t, duration, Ease.OutElastic, p => t.localScale = Vector3.LerpUnclamped(peak, rest, p));
    }
}

[CreateAssetMenu(menuName = "Feedback/Feedback")]
public class Feedback : ScriptableObject
{
    [SerializeReference] public List<FeedbackLayer> layers = new();

    public void Play(Vector3 position, Transform target = null, float intensity = 1f)
    {
        var ctx = new FeedbackContext { Position = position, Target = target, Intensity = Mathf.Clamp01(intensity) };
        foreach (var layer in layers)
        {
            try { layer.Play(ctx); }
            catch (Exception e) { Debug.LogException(e, this); }   // one broken layer must not kill the rest
        }
    }
}

// Gameplay: one line per event, and all the feel lives in the asset.
// heavyHitFeedback.Play(hit.point, enemy.transform, damage / 50f);
```

`TraumaShake`, `HitStop`, `AudioQueue`, `Tweener` and `Ease` come from [Screen Shake](./screen-shake), [Hit Stop](./hit-stop), [Event Queue](./event-queue) and [Tweening](./tweening). As with abilities, `[SerializeReference]` lists need a small custom inspector to add layers of different types. The commercial asset **Feel** (More Mountains) is a full-featured version of this pattern.

## When to use

- Every player action that matters, and especially the core loop: hitting, collecting, jumping, scoring.
- UI interactions: buttons, rewards, level-ups, purchases.
- When different weapons, enemies or abilities should feel distinct but consistent.

## When not to use

- Before the core mechanic is fun. Feedback can't fix a game that doesn't work.
- Routine actions that repeat constantly, such as menu navigation. Too much feedback makes everything noisy; scale the feedback to the event's importance.
- Without accessibility options. Flashes and shake need settings to reduce them.

## Pitfalls

- **Noise instead of signal.** If everything shakes, flashes and booms, nothing stands out, and important events get lost. Budget intensity: frequent events stay subtle, rare events go big.
- **Readability.** Particles and flashes can hide hitboxes and telegraphs. Keep gameplay-critical information visible through the effects.
- **Accessibility.** Shake, flashing and rumble can cause discomfort, motion sickness or seizure risk. Offer settings to reduce them, and avoid rapid full-screen flashes.
- **Inconsistency.** Hand-tuned feedback at each call site drifts apart. Reusable assets keep "a heavy hit" feeling the same everywhere.
- **Cost.** Instantiating particles and sources for every hit allocates. Pool effects and route audio through a queue, as in [Wave Spawning](../recipes/wave-spawning) and [Event Queue](./event-queue).

## Related

- [Hit Stop](./hit-stop), [Screen Shake](./screen-shake) and [Tweening & Easing](./tweening) — individual layers.
- [Event Queue](./event-queue) — merges simultaneous feedback such as sounds.
- [Observer](./observer) and [Event Bus](./event-bus) — trigger feedback from gameplay events without coupling.
- [Camera Follow & Smoothing](./camera-smoothing) — the camera that the shake and zoom layers act on.
