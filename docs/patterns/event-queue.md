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

## Example

### Core: a fixed-capacity queue

A ring buffer: no allocation after construction, and a full queue is reported to the caller instead of growing.

::: code-group

```csharp [Unity (C#)]
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

```gdscript [Godot (GDScript)]
# ring_queue.gd
class_name RingQueue
extends RefCounted

var _items: Array = []
var _head := 0
var _count := 0

var count: int:
	get:
		return _count


func _init(capacity: int) -> void:
	_items.resize(capacity)


func try_enqueue(item: Variant) -> bool:
	if _count == _items.size():
		return false  # full: caller decides what to do
	_items[(_head + _count) % _items.size()] = item
	_count += 1
	return true


## Returns null when the queue is empty (GDScript has no out parameters).
func dequeue() -> Variant:
	if _count == 0:
		return null
	var item: Variant = _items[_head]
	_items[_head] = null  # don't keep references alive
	_head = (_head + 1) % _items.size()
	_count -= 1
	return item
```

```cpp [Unreal (C++)]
// RingQueue.h
#pragma once

#include "CoreMinimal.h"

template <typename T>
class TRingQueue
{
public:
	explicit TRingQueue(int32 Capacity) { Items.SetNum(Capacity); }

	int32 Num() const { return Count; }

	bool TryEnqueue(const T& Item)
	{
		if (Count == Items.Num()) return false;              // full: caller decides what to do
		Items[(Head + Count) % Items.Num()] = Item;
		++Count;
		return true;
	}

	bool TryDequeue(T& OutItem)
	{
		if (Count == 0) return false;
		OutItem = MoveTemp(Items[Head]);
		Items[Head] = T();                                   // don't keep references alive
		Head = (Head + 1) % Items.Num();
		--Count;
		return true;
	}

private:
	TArray<T> Items;
	int32 Head = 0;
	int32 Count = 0;
};
```

:::

### Engine wiring: an audio queue that merges requests per frame

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

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

```gdscript [Godot (GDScript)]
# audio_queue.gd: autoload named AudioQueue.
extends Node


class PlaySound:
	var stream: AudioStream
	var position: Vector3
	var volume: float

	func _init(s: AudioStream, p: Vector3, v: float) -> void:
		stream = s
		position = p
		volume = v


class Merged:
	var position_sum := Vector3.ZERO
	var loudest := 0.0
	var count := 0


var _pending := RingQueue.new(256)
var _merged := {}  # AudioStream -> Merged


func _ready() -> void:
	process_priority = 1000  # higher runs later: drain after gameplay nodes have processed


# Callers return immediately; nothing plays yet.
func request(stream: AudioStream, position: Vector3, volume := 1.0) -> void:
	if not _pending.try_enqueue(PlaySound.new(stream, position, volume)):
		push_warning("Audio queue full: request dropped")


func _process(_delta: float) -> void:
	_merged.clear()
	var s: PlaySound = _pending.dequeue()
	while s != null:
		# Merge requests for the same stream: average position, keep the loudest, count them.
		var m: Merged = _merged.get(s.stream)
		if m == null:
			m = Merged.new()
			_merged[s.stream] = m
		m.position_sum += s.position
		m.loudest = maxf(m.loudest, s.volume)
		m.count += 1
		s = _pending.dequeue()

	for stream in _merged:
		var m: Merged = _merged[stream]
		# Many identical requests: play once, a bit louder, instead of N times.
		var volume := minf(1.0, m.loudest * (1.0 + 0.15 * log(m.count) / log(2.0)))
		_play_at(stream, m.position_sum / m.count, volume)


func _play_at(stream: AudioStream, position: Vector3, volume: float) -> void:
	var player := AudioStreamPlayer3D.new()
	player.stream = stream
	player.volume_db = linear_to_db(volume)
	add_child(player)
	player.global_position = position
	player.finished.connect(player.queue_free)
	player.play()

# In twelve enemies' death handlers, all in the same frame:
# AudioQueue.request(death_sound, global_position)
```

```cpp [Unreal (C++)]
// AudioQueueSubsystem.h
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "RingQueue.h"
#include "AudioQueueSubsystem.generated.h"

class USoundBase;

struct FPlaySound
{
	TWeakObjectPtr<USoundBase> Sound;
	FVector Location = FVector::ZeroVector;
	float Volume = 1.f;
};

UCLASS()
class UAudioQueueSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	// Callers return immediately; nothing plays yet.
	void Request(USoundBase* Sound, const FVector& Location, float Volume = 1.f);

	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UAudioQueueSubsystem, STATGROUP_Tickables); }

private:
	struct FMerged
	{
		FVector LocationSum = FVector::ZeroVector;
		float Loudest = 0.f;
		int32 Count = 0;
	};

	TRingQueue<FPlaySound> Pending{256};     // a member initializer, since UObjects need a default constructor
	TMap<TWeakObjectPtr<USoundBase>, FMerged> Merged;
};

// AudioQueueSubsystem.cpp
#include "AudioQueueSubsystem.h"
#include "Kismet/GameplayStatics.h"

void UAudioQueueSubsystem::Request(USoundBase* Sound, const FVector& Location, float Volume)
{
	if (!Pending.TryEnqueue(FPlaySound{Sound, Location, Volume}))
		UE_LOG(LogTemp, Warning, TEXT("Audio queue full: request dropped"));
}

// Tickable objects tick after the world's actor tick groups, so this drains after gameplay.
void UAudioQueueSubsystem::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	Merged.Reset();
	FPlaySound S;
	while (Pending.TryDequeue(S))
	{
		// Merge requests for the same sound: average location, keep the loudest, count them.
		FMerged& M = Merged.FindOrAdd(S.Sound);
		M.LocationSum += S.Location;
		M.Loudest = FMath::Max(M.Loudest, S.Volume);
		++M.Count;
	}

	for (const TPair<TWeakObjectPtr<USoundBase>, FMerged>& Pair : Merged)
	{
		USoundBase* Sound = Pair.Key.Get();
		if (!Sound) continue;
		const FMerged& M = Pair.Value;
		// Many identical requests: play once, a bit louder, instead of N times.
		const float Volume = FMath::Min(1.f, M.Loudest * (1.f + 0.15f * FMath::Log2(static_cast<float>(M.Count))));
		UGameplayStatics::PlaySoundAtLocation(this, Sound, M.LocationSum / M.Count, Volume);
	}
}

// In twelve enemies' death handlers, all in the same frame:
// GetWorld()->GetSubsystem<UAudioQueueSubsystem>()->Request(DeathSound, GetActorLocation());
```

:::

A queue also moves results from worker threads to the main thread. The ring buffers above are not thread-safe; use a concurrent queue when producers and the consumer run on different threads.

**Engine notes**

- **Unity:** Use `System.Collections.Concurrent.ConcurrentQueue<T>` for cross-thread queues.
- **Godot:** `call_deferred()` (on any `Object` or `Callable`) and signals connected with `CONNECT_DEFERRED` already queue calls until idle time, which covers "don't handle it mid-frame" without a custom queue. Across threads, guard a queue with a `Mutex`, or hand work to the main thread with `call_deferred`.
- **Unreal:** `TQueue<T>` (`Containers/Queue.h`) is a lock-free queue for one producer and one consumer by default (`EQueueMode::Mpsc` for many producers); `TCircularQueue<T>` is a fixed-capacity lock-free ring. `AsyncTask(ENamedThreads::GameThread, ...)` runs a lambda on the game thread. `UTickableWorldSubsystem` needs UE 5.0+.

## When to use

- Events that should be handled at a specific point in the frame, after physics, after all updates, or at the end of a turn.
- Requests that benefit from batching or merging: audio, VFX spawns, UI notifications, network messages.
- Breaking re-entrant event chains, and passing work between threads.
- Turn-based and simulation games, where actions resolve in order.

## When not to use

- Events that must be handled immediately, such as a hit that must stop the attack this frame. Use a direct call or [Observer](./observer).
- Low-volume events with no ordering or threading needs. A queue adds latency and makes stack traces useless.
- When the queue becomes the main way systems talk. Debugging who sent what, when, gets hard; keep it for batching and deferral.

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
