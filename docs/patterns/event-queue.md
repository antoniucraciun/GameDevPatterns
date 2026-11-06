# Event Queue

> Decouple when a message is sent from when it is processed.

**Also known as:** Message Queue · **Category:** Behavioral & Communication

## Problem

An explosion damages twelve enemies in one frame, and each one requests its death sound, so twelve identical sounds play at once, clipping the mix. A damage handler raises an event whose handler deals damage, which raises the event again, and the call stack recurses. An achievement handler runs in the middle of physics callbacks, while half the world has been updated. With [Observer](./observer) and [Event Bus](./event-bus), the receiver runs *immediately, inside the sender's call*. Often, that is exactly the wrong moment.

## Solution

Instead of calling receivers directly, **append the event to a queue** and return. Later, at a well-defined point in the frame, a processor **drains the queue** and handles each event.

That buys several things at once:

- **Control over timing.** Events are processed when the world is in a consistent state, for example after all `Update`s.
- **No re-entrancy.** Handlers that send more events append to the queue instead of recursing.
- **Aggregation.** The processor sees all events of the frame together, so it can merge duplicates (one louder explosion sound instead of twelve), sort by priority, or drop excess.
- **Thread boundaries.** A queue is the standard way to hand work from a background thread to the main thread.

A **ring buffer** (a fixed-size array with head and tail indices) keeps the queue allocation-free.

## Example (Unity C#)

A fixed-capacity, allocation-free queue:

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

public class RingQueue<T>
{
    readonly T[] items;
    int head, count;

    public RingQueue(int capacity) => items = new T[capacity];
    public int Count => count;

    public bool TryEnqueue(in T item)
    {
        if (count == items.Length) return false;             // full: caller decides what to do
        items[(head + count) % items.Length] = item;
        count++;
        return true;
    }

    public bool TryDequeue(out T item)
    {
        if (count == 0) { item = default; return false; }
        item = items[head];
        items[head] = default;                               // don't keep references alive
        head = (head + 1) % items.Length;
        count--;
        return true;
    }
}
```

An audio queue that aggregates requests per frame:

```csharp
public readonly struct PlaySound
{
    public readonly AudioClip Clip;
    public readonly Vector3 Position;
    public readonly float Volume;
    public PlaySound(AudioClip clip, Vector3 position, float volume) { Clip = clip; Position = position; Volume = volume; }
}

public class AudioQueue : MonoBehaviour
{
    public static AudioQueue Instance { get; private set; }

    readonly RingQueue<PlaySound> pending = new(256);
    readonly Dictionary<AudioClip, (Vector3 position, float volume, int count)> merged = new();

    void Awake() => Instance = this;

    // Callers return immediately; nothing plays yet.
    public void Request(AudioClip clip, Vector3 position, float volume = 1f)
    {
        if (!pending.TryEnqueue(new PlaySound(clip, position, volume)))
            Debug.LogWarning("Audio queue full: request dropped");
    }

    // Drained once per frame, after all gameplay has run.
    void LateUpdate()
    {
        merged.Clear();
        while (pending.TryDequeue(out var s))
        {
            // Merge requests for the same clip: average position, keep the loudest, count them.
            if (merged.TryGetValue(s.Clip, out var m))
                merged[s.Clip] = ((m.position * m.count + s.Position) / (m.count + 1), Mathf.Max(m.volume, s.Volume), m.count + 1);
            else
                merged[s.Clip] = (s.Position, s.Volume, 1);
        }

        foreach (var (clip, m) in merged)
        {
            // Many identical requests: play once, a bit louder, instead of N times.
            float volume = Mathf.Min(1f, m.volume * (1f + 0.15f * Mathf.Log(m.count, 2f)));
            AudioSource.PlayClipAtPoint(clip, m.position, volume);
        }
    }
}

// In twelve enemies' death handlers, all in the same frame:
// AudioQueue.Instance.Request(deathClip, transform.position);
// → one sound, slightly louder, at the centre of the deaths.
```

A queue also moves results from worker threads to the main thread. Use `System.Collections.Concurrent.ConcurrentQueue<T>` when producers and the consumer run on different threads, because the ring buffer above is not thread-safe.

## When to use

- Events that should be handled at a specific point in the frame, after physics, after all updates, or at the end of a turn.
- Requests that benefit from batching or merging: audio, VFX spawns, UI notifications, network messages.
- Breaking re-entrant event chains, and passing work between threads.
- Turn-based and simulation games, where actions resolve in order.

## Pitfalls

- **Latency.** Queued events are handled later, possibly next frame. That is fine for sound and UI, but wrong for anything the sender needs to know immediately, such as "did my attack kill it?".
- **Stale references.** By the time the event is processed, the object it refers to may be destroyed. Copy the data you need (positions, IDs) into the event instead of referencing live objects.
- **Feedback loops.** A handler that enqueues an event it also handles runs forever if the processor drains until empty. Process only the events present when draining started, or cap events per frame.
- **Overflow.** A fixed-size queue can fill up. Decide explicitly: drop new events, drop the oldest, or grow, and log it in development builds.
- **Lost ordering guarantees.** Merging and prioritising change the order of events. Do not merge events whose order matters.

## Related

- [Observer](./observer) and [Event Bus](./event-bus) — immediate delivery. The queue adds a delay and a processing point.
- [Command](./command) — commands are often queued and executed in order.
- [Object Pool](./object-pool) — ring buffers and pools are both about fixed, reused memory.
- [Game Loop](./game-loop) — the queue is drained at a chosen point in the loop.
