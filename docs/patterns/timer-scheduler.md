# Timer / Scheduler

> Centralise delayed and repeating callbacks instead of counting down in every object.

**Category:** Game Loop & Timing

## Problem

Every object counts down its own timers in `Update`: `cooldown -= Time.deltaTime; if (cooldown <= 0) ...`. A trap fires every 3 seconds, a buff expires after 10, a door closes after 5, a respawn happens after 8. Hundreds of objects each run an `Update` mostly to subtract a number. Timers are inconsistent: some use scaled time, some unscaled, some forget to reset. Cancelling "the door close timer" when the door is destroyed is easy to forget, so callbacks run on destroyed objects.

## Solution

A **scheduler** owns all timers. Code asks it to *"call this in 3 seconds"* or *"call this every 0.5 seconds"* and receives a **handle** that can cancel the timer.

- Timers are kept **sorted by due time** (a priority queue), so each frame the scheduler only looks at the front of the queue. Objects with no due timers cost nothing.
- Each timer chooses a **clock**: scaled game time (pauses with the game) or unscaled real time (UI, menus).
- Timers can have an **owner**. When the owner is destroyed, its timers are cancelled automatically, so callbacks never touch dead objects.
- **Repeating timers** reschedule themselves from their *due time*, not from "now", so they do not drift.

## Example (Unity C#)

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

public sealed class TimerHandle
{
    internal Action Callback;
    internal double Due;
    internal float Interval;                 // > 0 = repeating
    internal bool Unscaled;
    internal UnityEngine.Object Owner;
    internal long Order;                     // tie-breaker: same due time runs in scheduling order
    public bool IsActive { get; internal set; } = true;

    public void Cancel() => IsActive = false;
}

public class Scheduler : MonoBehaviour
{
    static Scheduler instance;
    static Scheduler Get() => instance ??= new GameObject("[Scheduler]").AddComponent<Scheduler>();

    // Two queues: one per clock. SortedSet keeps timers ordered by due time.
    readonly SortedSet<TimerHandle> scaled = new(new ByDue());
    readonly SortedSet<TimerHandle> unscaled = new(new ByDue());
    long order;

    class ByDue : IComparer<TimerHandle>
    {
        public int Compare(TimerHandle a, TimerHandle b) =>
            a.Due != b.Due ? a.Due.CompareTo(b.Due) : a.Order.CompareTo(b.Order);
    }

    public static TimerHandle After(float seconds, Action callback, UnityEngine.Object owner = null, bool unscaled = false) =>
        Get().Add(seconds, 0f, callback, owner, unscaled);

    public static TimerHandle Every(float interval, Action callback, UnityEngine.Object owner = null, bool unscaled = false) =>
        Get().Add(interval, interval, callback, owner, unscaled);

    TimerHandle Add(float delay, float interval, Action callback, UnityEngine.Object owner, bool unscaledClock)
    {
        var t = new TimerHandle
        {
            Callback = callback, Interval = interval, Owner = owner, Unscaled = unscaledClock,
            Due = Now(unscaledClock) + delay, Order = order++,
        };
        (unscaledClock ? unscaled : scaled).Add(t);
        return t;
    }

    static double Now(bool unscaledClock) => unscaledClock ? Time.unscaledTimeAsDouble : Time.timeAsDouble;

    void Update()
    {
        Run(scaled, Time.timeAsDouble);
        Run(unscaled, Time.unscaledTimeAsDouble);
    }

    static void Run(SortedSet<TimerHandle> queue, double now)
    {
        while (queue.Count > 0)
        {
            var t = queue.Min;
            if (t.Due > now) break;                                  // nothing else is due: stop early
            queue.Remove(t);

            // Skip cancelled timers, and timers whose owner was destroyed.
            if (!t.IsActive || (t.Owner is not null && t.Owner == null)) { t.IsActive = false; continue; }

            try { t.Callback(); }
            catch (Exception e) { Debug.LogException(e); }

            if (t.Interval > 0f && t.IsActive)
            {
                t.Due += t.Interval;                                 // from the due time: no drift
                if (t.Due <= now) t.Due = now + t.Interval;          // after a long hitch, don't fire repeatedly
                queue.Add(t);
            }
            else t.IsActive = false;
        }
    }
}
```

Using it:

```csharp
public class SpikeTrap : MonoBehaviour
{
    void Start() => Scheduler.Every(3f, Fire, owner: this);        // stops automatically when destroyed
    void Fire() { /* extend spikes, damage anything on top */ }
}

public class Door : MonoBehaviour
{
    TimerHandle closeTimer;

    public void Open()
    {
        /* open */
        closeTimer?.Cancel();                                      // re-opening restarts the countdown
        closeTimer = Scheduler.After(5f, Close, owner: this);
    }

    void Close() { /* close */ }
}

// UI toast that disappears while the game is paused:
// Scheduler.After(2f, () => toast.SetActive(false), owner: toast, unscaled: true);
```

`t.Owner is not null && t.Owner == null` uses Unity's overloaded `==` to detect a destroyed owner, while `is not null` checks for a real C# null (no owner given).

## When to use

- Delays, cooldowns, respawns, expirations, periodic effects: anything that runs a callback later.
- Many objects with occasional timers, where per-object `Update` loops would be wasteful.
- When pause behaviour must be consistent: gameplay timers pause, UI timers do not.

## When not to use

- One or two timers in a single script. A `float` counted down in `Update` is clearer than a scheduling system.
- Precise, fixed-rate simulation. Use [Fixed Timestep](./fixed-timestep).
- Delays tied to animation or sound. Use animation events or the audio clock, which won't drift from what the player sees and hears.

## Pitfalls

- **Callbacks on destroyed objects.** Without owner checks or cancellation, `Close()` runs on a destroyed door and throws. Pass an owner, or cancel in `OnDestroy`.
- **Capturing loop variables or large objects.** Lambdas keep captured objects alive until the timer fires or is cancelled. Avoid long timers capturing big data.
- **Drift in repeating timers.** Rescheduling from "now" instead of the due time makes "every 0.5 s" slowly drift. Rescheduling from the due time keeps the rhythm.
- **Catch-up storms.** After a long hitch, a 0.1 s repeating timer could be overdue 50 times. Decide whether to catch up or skip. Here, overdue repeats are skipped.
- **Order assumptions.** Two timers due on the same frame run in scheduling order. Do not rely on more than that.
- **Determinism.** For lockstep or replays, schedule by simulation step counts rather than seconds (see [Fixed Timestep](./fixed-timestep)).

## Related

- [Update Method](./update-method) — what timers replace for objects that only wait.
- [Coroutines](./coroutines) — an alternative for sequences, tied to a GameObject's lifetime.
- [Time Scale](./time-scale) — scaled versus unscaled clocks.
- [Status Effects](./status-effects) — durations and ticks can run on a scheduler.
