# Hit Stop

> Freeze the game for a few frames on impact to sell weight.

**Also known as:** Hit Pause, Freeze Frame · **Category:** Game Feel & Input

## Problem

A sword swing connects. The damage number appears, the enemy flinches, and the animation carries on smoothly through the impact. It looks correct but feels like hitting air. Players cannot read *when* the hit landed, and heavy attacks feel exactly like light ones.

## Solution

On impact, **stop time briefly**: typically 40–150 ms, roughly 3–9 frames at 60 FPS. The frozen frame gives the eye a moment to register the contact, the pose and the effect, and resuming afterwards makes the motion snap forward.

- **Scale duration with impact.** A light jab gets 40 ms, a heavy finisher 120 ms, and a killing blow can add a slow-motion tail.
- **Choose what freezes.** A *global* stop freezes everything through a [Time Scale](./time-scale) request. A *local* stop freezes only the attacker and victim, by setting their animator speed to 0, while the rest of the world keeps moving. Local stops are essential in multiplayer and with many simultaneous hits.
- **Do not stack.** Ten hits in one frame should give one stop of the *longest* duration, not ten stops added together.
- **Keep feedback alive.** Screen shake, particles and sound should play during the stop, on unscaled time. The freeze is what makes them read clearly.

## Example (Unity C#)

A global hit stop built on [Time Scale](./time-scale) requests:

```csharp
using UnityEngine;

public class HitStop : MonoBehaviour
{
    public static HitStop Instance { get; private set; }

    GameTime.Request freeze;
    float resumeAt;                                     // in unscaled time

    void Awake() => Instance = this;

    public void Trigger(float duration, float scale = 0f)
    {
        float end = Time.unscaledTime + duration;
        if (freeze != null && end <= resumeAt) return;  // a longer stop is already running: don't stack

        resumeAt = end;
        freeze ??= GameTime.Push(scale, "Hit stop");    // combines with pause and slow-mo correctly
    }

    void Update()                                       // Update still runs while timeScale is 0
    {
        if (freeze != null && Time.unscaledTime >= resumeAt)
        {
            freeze.Dispose();
            freeze = null;
        }
    }

    void OnDestroy() => freeze?.Dispose();
}

// On a hit, scale duration with damage:
// HitStop.Instance.Trigger(Mathf.Lerp(0.04f, 0.12f, damage / 50f));
```

A local hit stop that freezes only the two characters involved:

```csharp
public class LocalHitStop : MonoBehaviour
{
    [SerializeField] Animator animator;
    float resumeAt;
    float savedSpeed = 1f;
    bool frozen;

    public void Freeze(float duration)
    {
        float end = Time.time + duration;
        if (frozen && end <= resumeAt) return;
        if (!frozen) { savedSpeed = animator.speed; animator.speed = 0f; frozen = true; }
        resumeAt = end;
    }

    void Update()
    {
        if (frozen && Time.time >= resumeAt)
        {
            animator.speed = savedSpeed;
            frozen = false;
        }
    }
}

// On a hit: attacker.Freeze(0.08f); victim.Freeze(0.08f);
// Movement code on these characters must also respect the freeze (skip it while frozen).
```

## When to use

- Melee combat, fighting games, action games, anything where hits need weight.
- Breaking objects, landing heavy jumps, parries and perfect blocks.

## Pitfalls

- **Overuse.** Hit stop on every bullet in a fast shooter makes the game stutter. Reserve it for meaningful hits, and keep rapid-fire stops short or local.
- **Stacking.** Adding durations for multi-hits produces long, broken freezes. Take the maximum.
- **Freezing feedback too.** Particles, shake and audio on scaled time freeze along with the game, which defeats the purpose. Use unscaled time for them.
- **Input lost during the stop.** A button pressed during a 100 ms freeze must still count afterwards. An [Input Buffer](./input-buffer) on unscaled time solves this.
- **Multiplayer.** Global time cannot stop for one player. Use local stops, purely cosmetic, without affecting the simulation.

## Related

- [Time Scale](./time-scale) — the mechanism behind global hit stop.
- [Screen Shake (Trauma)](./screen-shake) — usually triggered on the same hit.
- [Input Buffer](./input-buffer) — keeps presses made during the freeze.
- [Feedback Layering (Juice)](./juice) — hit stop is one layer among many.
