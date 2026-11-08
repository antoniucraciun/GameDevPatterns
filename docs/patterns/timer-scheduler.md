# Timer / Scheduler

> Centralise delayed and repeating callbacks instead of counting down in every object.

**Category:** Game Loop & Timing

## Problem

Every object counts down its own timers in its per-frame update: `cooldown -= dt; if (cooldown <= 0) ...`. A trap fires every 3 seconds, a buff expires after 10, a door closes after 5, a respawn happens after 8. Hundreds of objects each run an update mostly to subtract a number. Timers are inconsistent: some use scaled time, some unscaled, some forget to reset. Cancelling "the door close timer" when the door is destroyed is easy to forget, so callbacks run on destroyed objects.

## Solution

A **scheduler** owns all timers. Code asks it to *"call this in 3 seconds"* or *"call this every 0.5 seconds"* and receives a **handle** that can cancel the timer.

- Timers are kept **sorted by due time** (a priority queue), so each frame the scheduler only looks at the front of the queue. Objects with no due timers cost nothing.
- Each timer chooses a **clock**: scaled game time (pauses with the game) or unscaled real time (UI, menus).
- Timers can have an **owner**. When the owner is destroyed, its timers are cancelled automatically, so callbacks never touch dead objects.
- **Repeating timers** reschedule themselves from their *due time*, not from "now", so they do not drift.

## Pseudocode

```text
Timer:                       // also the handle the caller keeps
    callback
    due                      // when it should run, on its clock
    interval                 // 0 = once; otherwise repeat this often
    owner                    // optional: skipped once the owner is destroyed
    active ← true

Scheduler:
    one queue per clock (scaled game time, unscaled real time),
    ordered by due time; equal due times keep scheduling order

    after(seconds, callback, owner, clock):
        add Timer(callback, due ← now(clock) + seconds, interval ← 0) to that clock's queue
    every(interval, callback, owner, clock):
        add Timer(callback, due ← now(clock) + interval, interval) to that clock's queue

    every frame, for each clock:
        now ← now(clock)
        while the queue's earliest timer t has t.due ≤ now:   // later ones aren't due either
            remove t from the queue
            if t is not active or t.owner was destroyed: skip it
            run t.callback
            if t.interval > 0 and t is still active:
                t.due ← t.due + t.interval        // from the due time: no drift
                if t.due ≤ now: t.due ← now + t.interval   // after a hitch, skip missed repeats
                put t back in the queue

cancel(t): t.active ← false      // dropped when it reaches the front
```

## Example

A scheduler that runs callbacks later or repeatedly, cancels them with a handle, stops them when their owner is destroyed, and can ignore pause and slow motion. Unity needs one written; Godot and Unreal mostly have it built in.

::: code-group

```csharp [Unity (C#)]
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

```gdscript [Godot (GDScript)]
# scheduler.gd: autoload named Scheduler. Godot's Timer node already does the scheduling;
# making each timer a child of its owner means it is freed with the owner, so callbacks
# never run on deleted objects.
extends Node


## Calls callback once after seconds. Cancel by calling queue_free() on the returned Timer.
func after(seconds: float, callback: Callable, owner: Node, unscaled := false) -> Timer:
	return _make(seconds, callback, owner, true, unscaled)


## Calls callback every interval seconds until cancelled or the owner is freed.
func every(interval: float, callback: Callable, owner: Node, unscaled := false) -> Timer:
	return _make(interval, callback, owner, false, unscaled)


func _make(seconds: float, callback: Callable, owner: Node, one_shot: bool, unscaled: bool) -> Timer:
	var timer := Timer.new()
	timer.wait_time = seconds
	timer.one_shot = one_shot
	if unscaled:
		timer.ignore_time_scale = true                 # ignores Engine.time_scale (Godot 4.2+)
		timer.process_mode = Node.PROCESS_MODE_ALWAYS  # keeps running while the tree is paused
	timer.timeout.connect(callback)
	if one_shot:
		timer.timeout.connect(timer.queue_free)
	owner.add_child(timer)
	timer.start()
	return timer
```

```cpp [Unreal (C++)]
// Unreal's FTimerManager is this scheduler, built in: one per world, ordered by due time,
// with handles for cancelling. Timers bound to a UObject are skipped once it is destroyed.
// There is nothing to write; this is the whole API you need:

FTimerHandle Handle;

// Once, after 2 seconds:
GetWorldTimerManager().SetTimer(Handle, this, &AMyActor::DoThing, 2.f, /*bLoop*/ false);

// Every 3 seconds (the first call after 3 s, or pass a different FirstDelay):
GetWorldTimerManager().SetTimer(Handle, this, &AMyActor::DoThing, 3.f, /*bLoop*/ true);

// With a lambda that is skipped if this object has been destroyed:
GetWorldTimerManager().SetTimer(Handle, FTimerDelegate::CreateWeakLambda(this, [this] { DoThing(); }), 2.f, false);

// Cancel, or check:
GetWorldTimerManager().ClearTimer(Handle);
bool bPending = GetWorldTimerManager().IsTimerActive(Handle);

// World timers follow pause and time dilation. For real-time timers (UI while paused),
// use the core ticker instead:
FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([](float) { /* ... */ return false; }), 2.f);
```

:::

Using it:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

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

```gdscript [Godot (GDScript)]
# spike_trap.gd
extends Node3D


func _ready() -> void:
	Scheduler.every(3.0, _fire, self)  # stops automatically when the trap is freed


func _fire() -> void:
	pass  # extend spikes, damage anything on top


# door.gd
extends Node3D

var _close_timer: Timer


func open() -> void:
	# open...
	if is_instance_valid(_close_timer):
		_close_timer.queue_free()  # re-opening restarts the countdown
	_close_timer = Scheduler.after(5.0, close, self)


func close() -> void:
	pass  # close


# UI toast that disappears while the game is paused:
#   Scheduler.after(2.0, toast.hide, toast, true)
```

```cpp [Unreal (C++)]
// SpikeTrap.cpp
void ASpikeTrap::BeginPlay()
{
	Super::BeginPlay();
	// Bound to this actor: cleared automatically when it is destroyed.
	GetWorldTimerManager().SetTimer(FireTimer, this, &ASpikeTrap::Fire, 3.f, /*bLoop*/ true);
}

void ASpikeTrap::Fire() { /* extend spikes, damage anything on top */ }

// Door.cpp
void ADoor::Open()
{
	/* open */
	// Setting a timer on an active handle replaces it, so re-opening restarts the countdown.
	GetWorldTimerManager().SetTimer(CloseTimer, this, &ADoor::Close, 5.f, false);
}

void ADoor::Close() { /* close */ }
```

:::

**Engine notes**

- **Unity:** `t.Owner is not null && t.Owner == null` uses Unity's overloaded `==` to detect a destroyed owner, while `is not null` checks for a real C# null (no owner given).
- **Godot:** for one-off waits inside a function, `await get_tree().create_timer(2.0).timeout` is shorter. Its later arguments let it run while paused or ignore the time scale, but it is not tied to an owner.
- **Unreal:** timers are stored per world, so they reset on level change. Avoid binding lambdas that capture `this` without `CreateWeakLambda` or `CreateUObject`: a plain lambda keeps firing after the actor is gone.

## When to use

- Delays, cooldowns, respawns, expirations, periodic effects: anything that runs a callback later.
- Many objects with occasional timers, where per-object `Update` loops would be wasteful.
- When pause behaviour must be consistent: gameplay timers pause, UI timers do not.

## When not to use

- One or two timers in a single script. A `float` counted down in `Update` is clearer than a scheduling system.
- Precise, fixed-rate simulation. Use [Fixed Timestep](./fixed-timestep).
- Delays tied to animation or sound. Use animation events or the audio clock, which won't drift from what the player sees and hears.

## Pitfalls

- **Callbacks on destroyed objects.** Without owner checks or cancellation, `Close()` runs on a destroyed door and throws. Pass an owner, or cancel when the owner is destroyed.
- **Capturing loop variables or large objects.** Lambdas keep captured objects alive until the timer fires or is cancelled. Avoid long timers capturing big data.
- **Drift in repeating timers.** Rescheduling from "now" instead of the due time makes "every 0.5 s" slowly drift. Rescheduling from the due time keeps the rhythm.
- **Catch-up storms.** After a long hitch, a 0.1 s repeating timer could be overdue 50 times. Decide whether to catch up or skip. Here, overdue repeats are skipped.
- **Order assumptions.** Two timers due on the same frame run in scheduling order. Do not rely on more than that.
- **Determinism.** For lockstep or replays, schedule by simulation step counts rather than seconds (see [Fixed Timestep](./fixed-timestep)).

## Related

- [Update Method](./update-method) — what timers replace for objects that only wait.
- [Coroutines](./coroutines) — an alternative for sequences, tied to their owner's lifetime.
- [Time Scale](./time-scale) — scaled versus unscaled clocks.
- [Status Effects](./status-effects) — durations and ticks can run on a scheduler.
