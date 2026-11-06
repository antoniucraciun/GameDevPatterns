# Coroutines

> Write multi-frame sequences as straight-line code that yields between frames.

**Category:** Game Loop & Timing

## Problem

A door opens over two seconds, waits, plays a sound, then closes. Written in `Update`, it becomes a state machine of flags and timers: `if (opening) { t += dt; if (t > 2) { opening = false; waiting = true; t = 0; } } else if (waiting) ...`. A cutscene with twenty steps becomes unreadable. The logic is naturally sequential ("do this, wait, then do that"), but the [Update Method](./update-method) forces it to be expressed as per-frame state.

## Solution

Write the sequence as **one function that pauses itself**. At each `yield` (or `await`), the function hands control back to the engine and resumes later: next frame, after a delay, or when a condition becomes true. Local variables survive across pauses, so the code reads top to bottom.

Unity offers two forms:

| | Coroutines (`IEnumerator`) | `async` / `Awaitable` (Unity 2023.1+) |
| --- | --- | --- |
| Start | `StartCoroutine(Routine())` | Call an `async Awaitable` method |
| Wait a frame | `yield return null` | `await Awaitable.NextFrameAsync()` |
| Wait seconds | `yield return new WaitForSeconds(2)` | `await Awaitable.WaitForSecondsAsync(2)` |
| Return values | Not directly | `Awaitable<T>` |
| Stops when | The GameObject is disabled or destroyed, or `StopCoroutine` | It doesn't, unless you pass a cancellation token |
| Error handling | Exceptions are logged, and the coroutine stops | `try/catch` works normally |

## Example (Unity C#)

A coroutine sequence, readable top to bottom:

```csharp
using System.Collections;
using UnityEngine;

public class TimedDoor : MonoBehaviour
{
    [SerializeField] Transform panel;
    [SerializeField] Vector3 openOffset = new(0f, 3f, 0f);
    [SerializeField] float moveSeconds = 2f, stayOpenSeconds = 5f;
    [SerializeField] AudioSource audioSource;

    Coroutine running;
    Vector3 closedPosition;

    void Awake() => closedPosition = panel.localPosition;

    public void Trigger()
    {
        if (running != null) StopCoroutine(running);     // restarting cancels the old sequence
        running = StartCoroutine(OpenWaitClose());
    }

    IEnumerator OpenWaitClose()
    {
        yield return Move(closedPosition + openOffset);   // nested coroutine: waits until it finishes
        audioSource.Play();
        yield return new WaitForSeconds(stayOpenSeconds);
        yield return Move(closedPosition);
        running = null;
    }

    IEnumerator Move(Vector3 target)
    {
        Vector3 start = panel.localPosition;
        for (float t = 0f; t < 1f; t += Time.deltaTime / moveSeconds)
        {
            panel.localPosition = Vector3.Lerp(start, target, Mathf.SmoothStep(0f, 1f, t));
            yield return null;                            // resume next frame
        }
        panel.localPosition = target;
    }
}
```

The same sequence with `async`, plus cancellation, which async code must handle itself:

```csharp
public class TimedDoorAsync : MonoBehaviour
{
    [SerializeField] Transform panel;
    [SerializeField] Vector3 openOffset = new(0f, 3f, 0f);
    [SerializeField] float moveSeconds = 2f, stayOpenSeconds = 5f;

    public async Awaitable OpenWaitClose()
    {
        // destroyCancellationToken fires when this object is destroyed: without it, the
        // method would keep running and touch a destroyed transform.
        var token = destroyCancellationToken;
        Vector3 closed = panel.localPosition;
        try
        {
            await Move(closed + openOffset, token);
            await Awaitable.WaitForSecondsAsync(stayOpenSeconds, token);
            await Move(closed, token);
        }
        catch (System.OperationCanceledException) { /* destroyed mid-sequence: nothing to do */ }
    }

    async Awaitable Move(Vector3 target, System.Threading.CancellationToken token)
    {
        Vector3 start = panel.localPosition;
        for (float t = 0f; t < 1f; t += Time.deltaTime / moveSeconds)
        {
            panel.localPosition = Vector3.Lerp(start, target, Mathf.SmoothStep(0f, 1f, t));
            await Awaitable.NextFrameAsync(token);
        }
        panel.localPosition = target;
    }
}
```

Coroutines and async methods are perfect for **sequences**: cutscenes, tutorials, spawn waves, door and elevator logic, UI transitions. For behaviour that must react to changing conditions every frame (AI, movement), a [State](./state) machine or the [Update Method](./update-method) is usually clearer.

## When to use

- Scripted sequences with waits: cutscenes, tutorials, intros, scripted events, wave timing.
- Spreading work over frames (see [Time Slicing](./time-slicing)).
- Waiting for asynchronous operations: scene loads, web requests, Addressables.

## Pitfalls

- **Stopped by disabling.** Coroutines stop silently when their GameObject is deactivated, and do not resume when it is re-enabled. Run long-lived sequences on an object that stays active.
- **Async that never stops.** `async` methods keep running after their object is destroyed, unless they use `destroyCancellationToken`. Always pass a token to waits in MonoBehaviours.
- **Allocations.** `new WaitForSeconds(...)` allocates each time. Cache it in a field when used in a loop, or use `yield return null` with your own timer.
- **Hidden state.** Many coroutines running at once on one object, starting and stopping each other, are hard to debug. Keep a handle (`Coroutine running`) and stop the old one before starting a new one.
- **Frame-rate-dependent loops.** `yield return null` loops that move a fixed amount per frame run faster at higher frame rates. Use `Time.deltaTime`, as above.
- **Time scale.** `WaitForSeconds` uses scaled time and never finishes while the game is paused. Use `WaitForSecondsRealtime` for UI and pause menus.

## Related

- [Update Method](./update-method) — the per-frame alternative for continuous behaviour.
- [Time Slicing](./time-slicing) — coroutines are a convenient way to spread work over frames.
- [State](./state) — better than coroutines for reactive, interruptible behaviour.
- [Tweening & Easing](./tweening) — for simple interpolation, tweens replace hand-written coroutine loops.
- [Time Scale](./time-scale) — scaled versus realtime waits.
