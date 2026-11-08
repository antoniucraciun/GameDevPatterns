# Iterator

> Walk a collection (inventory, spatial grid, scene tree) without exposing how it is stored.

**Also known as:** Cursor, Enumerator · **Category:** Behavioral & Communication

## Problem

The game keeps the last 32 hits the player took in a fixed-size array that wraps around: a ring buffer, so recording a hit never allocates. Three systems read it: the death recap screen ("killed by: Goblin Archer, 3 hits for 87"), the damage-direction indicators on the HUD, and the lag-compensation history on the server. Each one writes its own loop over the raw array: `items[(head - count + i + capacity) % capacity]`. Two of the three get the wrap-around subtly wrong, so after the buffer first fills the recap shows a stale hit from a minute ago. And because the array is public, the HUD "fixes" a display bug by writing into it.

Later the team wants the log to grow during boss fights. That changes the storage, and every loop that knew about `head` and `capacity` has to be found and rewritten.

## Solution

Give the collection an **iterator**: a small object that knows how to step through it and hands out one element at a time. Callers only see "is there a next element, and what is it", and the collection keeps its layout to itself.

- **Iterable collection:** `RingBuffer`, which exposes a way to start iterating and nothing about `head` or wrap-around.
- **Iterator:** holds the position (here, an offset from the oldest entry), steps forward, and returns the current element.
- **Caller:** a plain `foreach` / `for … in` / range-based `for`.

Each language has this built in, and you plug into it rather than writing a new protocol:

| Engine language | Make a type iterable by… | Allocation-free form |
| --- | --- | --- |
| C# (Unity) | `GetEnumerator()` returning something with `MoveNext()` and `Current`, or an iterator method using `yield return` | A **struct** enumerator returned from a public `GetEnumerator()`, as `List<T>` does |
| GDScript (Godot) | `_iter_init`, `_iter_next` and `_iter_get` on any object | Keep the position in the `iter` argument, not in a new object |
| C++ (Unreal) | `begin()` and `end()` returning a type with `*`, `++` and `!=` | Iterators are plain values, so always |

The same idea covers much more than lists: a [spatial partition](./spatial-partition) query that yields the objects in a radius cell by cell, an inventory that skips empty slots and the extra cells of large items, a depth-first walk of a scene or UI tree with an explicit stack, or the items in a [composite](./composite).

## Pseudocode

```text
// The collection: a fixed array that overwrites its oldest entry
// when full.
RingBuffer:
    items[capacity]
    head               // where the next add writes
    count              // how many slots hold an entry

    add(item):
        items[head] ← item
        head ← (head + 1) mod capacity
        if count < capacity: count ← count + 1

    iterate():         // callers never see head or the wrap-around
        return a new Iterator over this buffer

// The iterator: a position in one walk, and nothing else.
Iterator:
    buffer
    offset ← -1        // 0 = oldest entry; -1 = not started yet

    move_next():       // step forward; false once all were visited
        offset ← offset + 1
        return offset < buffer.count

    current():
        n ← buffer.capacity
        oldest ← (buffer.head - buffer.count + n) mod n
        return buffer.items[(oldest + offset) mod n]

// The caller only asks "is there a next one, and what is it?"
it ← buffer.iterate()
while it.move_next():
    show(it.current())
```

## Example

A ring buffer that callers can walk oldest-to-newest without knowing how it wraps. The **core** is the buffer and its iterator, with no engine types. The **engine wiring** records hits and builds the death recap from them. The last group shows the most common iterator bug in games: changing a collection while walking it.

### Core

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections;
using System.Collections.Generic;

// Fixed-capacity history that overwrites its oldest entry when full.
public class RingBuffer<T> : IEnumerable<T>
{
    readonly T[] items;
    int head;                        // where the next Add writes
    int version;                     // changes on every write, so enumerators can notice

    public RingBuffer(int capacity) => items = new T[capacity];

    public int Count { get; private set; }

    public void Add(T item)
    {
        items[head] = item;
        head = (head + 1) % items.Length;
        if (Count < items.Length) Count++;
        version++;
    }

    // foreach looks for this method by name and uses the struct directly: no allocation.
    public Enumerator GetEnumerator() => new Enumerator(this);

    // The interface versions box the struct. They exist so LINQ and IEnumerable<T> parameters work.
    IEnumerator<T> IEnumerable<T>.GetEnumerator() => GetEnumerator();
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

    // Oldest to newest, however the array has wrapped.
    public struct Enumerator : IEnumerator<T>
    {
        readonly RingBuffer<T> buffer;
        readonly int startVersion;
        int offset;                  // 0 = oldest; -1 = before the first MoveNext

        internal Enumerator(RingBuffer<T> buffer)
        {
            this.buffer = buffer;
            startVersion = buffer.version;
            offset = -1;
        }

        public T Current
        {
            get
            {
                int capacity = buffer.items.Length;
                return buffer.items[(buffer.head - buffer.Count + offset + capacity) % capacity];
            }
        }

        object IEnumerator.Current => Current;

        public bool MoveNext()
        {
            if (startVersion != buffer.version)
                throw new InvalidOperationException("RingBuffer was modified during iteration.");
            return ++offset < buffer.Count;
        }

        public void Reset() => offset = -1;
        public void Dispose() { }
    }

    // The short way: an iterator method. The compiler writes the state machine for you,
    // but each call allocates it, so keep these out of per-frame code.
    public IEnumerable<T> NewestFirst()
    {
        for (int i = 1; i <= Count; i++)
            yield return items[(head - i + items.Length) % items.Length];
    }
}
```

```gdscript [Godot (GDScript)]
# ring_buffer.gd: fixed-capacity history that overwrites its oldest entry when full.
class_name RingBuffer
extends RefCounted

var _items: Array = []
var _head := 0  # where the next add() writes
var _count := 0


func _init(capacity: int) -> void:
	_items.resize(capacity)


func size() -> int:
	return _count


func add(item: Variant) -> void:
	_items[_head] = item
	_head = (_head + 1) % _items.size()
	_count = mini(_count + 1, _items.size())


# `for x in buffer` calls these three. The position lives in iter[0], not on the buffer,
# so two loops over the same buffer at once (nested, or from a signal) don't disturb each other.
func _iter_init(iter: Array) -> bool:
	iter[0] = 0  # 0 = oldest
	return _count > 0


func _iter_next(iter: Array) -> bool:
	iter[0] += 1
	return iter[0] < _count


func _iter_get(offset: Variant) -> Variant:
	var capacity := _items.size()
	return _items[(_head - _count + offset + capacity) % capacity]
```

```cpp [Unreal (C++)]
// FixedRing.h: plain C++. Unreal's TRingBuffer grows instead of overwriting, so this is
// a fixed-capacity history with its own iterator.
#pragma once

#include "CoreMinimal.h"

template <typename T>
class TFixedRing
{
public:
	explicit TFixedRing(int32 Capacity) { Items.SetNum(Capacity); }

	int32 Num() const { return Count; }

	void Add(const T& Item)
	{
		Items[Head] = Item;
		Head = (Head + 1) % Items.Num();
		Count = FMath::Min(Count + 1, Items.Num());
	}

	// Oldest to newest, however the array has wrapped.
	class FConstIterator
	{
	public:
		FConstIterator(const TFixedRing& InRing, int32 InOffset) : Ring(&InRing), Offset(InOffset) {}

		const T& operator*() const
		{
			const int32 Capacity = Ring->Items.Num();
			return Ring->Items[(Ring->Head - Ring->Count + Offset + Capacity) % Capacity];
		}
		FConstIterator& operator++() { ++Offset; return *this; }
		bool operator!=(const FConstIterator& Other) const { return Offset != Other.Offset; }

	private:
		const TFixedRing* Ring;
		int32 Offset;                     // 0 = oldest
	};

	// Lower-case begin()/end() are what range-based for looks for.
	FConstIterator begin() const { return FConstIterator(*this, 0); }
	FConstIterator end() const { return FConstIterator(*this, Count); }

private:
	TArray<T> Items;
	int32 Head = 0;                       // where the next Add writes
	int32 Count = 0;
};
```

:::

### Engine wiring

The combat log is itself iterable, so the death recap can walk it but has no way to add to it.

::: code-group

```csharp [Unity (C#)]
using System.Text;
using UnityEngine;

public struct HitRecord
{
    public string Attacker;
    public float Damage;
    public float Time;
}

public class CombatLog : MonoBehaviour
{
    [SerializeField] int capacity = 32;
    RingBuffer<HitRecord> recent;

    void Awake() => recent = new RingBuffer<HitRecord>(capacity);

    public void Record(string attacker, float damage) =>
        recent.Add(new HitRecord { Attacker = attacker, Damage = damage, Time = Time.time });

    // Readers can foreach over the log, but can't reach Add.
    public RingBuffer<HitRecord>.Enumerator GetEnumerator() => recent.GetEnumerator();
}

public class DeathRecap : MonoBehaviour
{
    [SerializeField] CombatLog log;
    [SerializeField] TMPro.TMP_Text text;
    [SerializeField] float window = 10f;
    readonly StringBuilder sb = new();

    public void Show()
    {
        sb.Clear();
        float total = 0f;
        foreach (var hit in log)                         // oldest first, no allocation
        {
            if (Time.time - hit.Time > window) continue;
            sb.Append(hit.Attacker).Append(": ").Append(Mathf.RoundToInt(hit.Damage)).AppendLine();
            total += hit.Damage;
        }
        sb.Append("Total: ").Append(Mathf.RoundToInt(total));
        text.text = sb.ToString();
        gameObject.SetActive(true);
    }
}
```

```gdscript [Godot (GDScript)]
# combat_log.gd: records hits, and can be walked with `for hit in combat_log`.
class_name CombatLog
extends Node

@export var capacity := 32
var _recent: RingBuffer


func _ready() -> void:
	_recent = RingBuffer.new(capacity)


func record(attacker: String, damage: float) -> void:
	_recent.add({attacker = attacker, damage = damage, time = Time.get_ticks_msec() / 1000.0})


# Forward iteration to the buffer: readers can walk the log but can't reach add().
# This works because the position lives in `iter`, not in the buffer.
func _iter_init(iter: Array) -> bool:
	return _recent._iter_init(iter)


func _iter_next(iter: Array) -> bool:
	return _recent._iter_next(iter)


func _iter_get(offset: Variant) -> Variant:
	return _recent._iter_get(offset)


# death_recap.gd
extends Label

@export var combat_log: CombatLog
@export var window := 10.0


func show_recap() -> void:
	var now := Time.get_ticks_msec() / 1000.0
	var lines := PackedStringArray()
	var total := 0.0
	for hit in combat_log:  # oldest first
		if now - hit.time > window:
			continue
		lines.append("%s: %d" % [hit.attacker, roundi(hit.damage)])
		total += hit.damage
	lines.append("Total: %d" % roundi(total))
	text = "\n".join(lines)
	show()
```

```cpp [Unreal (C++)]
// CombatLogComponent.h
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "FixedRing.h"
#include "CombatLogComponent.generated.h"

struct FHitRecord
{
	FString Attacker;
	float Damage = 0.f;
	double Time = 0.0;
};

UCLASS(ClassGroup = (Gameplay), meta = (BlueprintSpawnableComponent))
class UCombatLogComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	void Record(const FString& Attacker, float Damage)
	{
		Recent.Add({Attacker, Damage, GetWorld()->GetTimeSeconds()});
	}

	// A const reference: callers can range-for over it, but Add isn't const, so they can't write.
	const TFixedRing<FHitRecord>& GetRecent() const { return Recent; }

	// The death recap text, oldest hit first.
	FString BuildRecap(double Window = 10.0) const
	{
		const double Now = GetWorld()->GetTimeSeconds();
		FString Text;
		float Total = 0.f;
		for (const FHitRecord& Hit : Recent)
		{
			if (Now - Hit.Time > Window) continue;
			Text += FString::Printf(TEXT("%s: %d\n"), *Hit.Attacker, FMath::RoundToInt(Hit.Damage));
			Total += Hit.Damage;
		}
		return Text + FString::Printf(TEXT("Total: %d"), FMath::RoundToInt(Total));
	}

private:
	TFixedRing<FHitRecord> Recent{32};
};
```

:::

### Removing while you walk

Most iterator bugs in games come from changing a collection while a loop walks it: a projectile expiring during the update loop, an enemy dying and unregistering itself while the explosion damages everything in range. Each language fails differently, and each has a safe idiom.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public class LiveProjectile
{
    public float Age, Lifetime = 2f;
}

public class ProjectileTracker : MonoBehaviour
{
    readonly List<LiveProjectile> live = new();

    void Update()
    {
        // Removing inside foreach throws "Collection was modified". Walk backwards by index:
        // removing index i never moves an element that is still to be visited.
        for (int i = live.Count - 1; i >= 0; i--)
        {
            var p = live[i];
            p.Age += Time.deltaTime;
            if (p.Age > p.Lifetime) live.RemoveAt(i);
        }
        // Or in one pass, when no per-item work is needed: live.RemoveAll(p => p.Age > p.Lifetime);
    }

    // When the loop calls out to code that may change the collection (an explosion damages
    // enemies, an enemy dies and unregisters), copy the targets first, then act on the copy.
    readonly List<LiveProjectile> snapshot = new();
    public void ExpireAll()
    {
        snapshot.Clear();
        snapshot.AddRange(live);
        foreach (var p in snapshot) p.Age = p.Lifetime;
    }
}
```

```gdscript [Godot (GDScript)]
# projectile_tracker.gd
extends Node

class LiveProjectile:
	var age := 0.0
	var lifetime := 2.0

var _live: Array[LiveProjectile] = []


func _process(delta: float) -> void:
	# Erasing inside `for p in _live` shifts the array under the loop and skips the next
	# element, with no error. Walk backwards by index instead.
	for i in range(_live.size() - 1, -1, -1):
		var p: LiveProjectile = _live[i]
		p.age += delta
		if p.age > p.lifetime:
			_live.remove_at(i)

# Nodes are easier: get_children() and get_nodes_in_group() return a new array, and
# queue_free() waits until the end of the frame, so freeing nodes while looping is safe:
#   for enemy in get_tree().get_nodes_in_group("enemies"):
#       enemy.queue_free()
```

```cpp [Unreal (C++)]
// ProjectileTrackerComponent.h
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "ProjectileTrackerComponent.generated.h"

struct FLiveProjectile
{
	float Age = 0.f;
	float Lifetime = 2.f;
};

UCLASS(ClassGroup = (Gameplay), meta = (BlueprintSpawnableComponent))
class UProjectileTrackerComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UProjectileTrackerComponent() { PrimaryComponentTick.bCanEverTick = true; }

	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override
	{
		Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

		// Removing inside a range-based for over a TArray trips its "array has changed during
		// ranged-for iteration" check. Walk backwards; RemoveAtSwap only moves an already-visited element.
		for (int32 i = Live.Num() - 1; i >= 0; --i)
		{
			Live[i].Age += DeltaTime;
			if (Live[i].Age > Live[i].Lifetime) Live.RemoveAtSwap(i);
		}

		// TMap and TSet: the iterator can remove the element it is on.
		for (auto It = Cooldowns.CreateIterator(); It; ++It)
		{
			It.Value() -= DeltaTime;
			if (It.Value() <= 0.f) It.RemoveCurrent();
		}
	}

private:
	TArray<FLiveProjectile> Live;
	TMap<FName, float> Cooldowns;
};
```

:::

**Engine notes**

- **Unity:** `foreach` over a `List<T>`, `Dictionary` or array does not allocate, because their enumerators are structs; `foreach` over a variable typed `IEnumerable<T>`, LINQ, and `yield` methods do. `foreach (Transform child in transform)` walks direct children through the non-generic `IEnumerable`; `GetComponentsInChildren<T>(list)` fills a list you reuse for a whole subtree. `List<T>` throws on modification during `foreach`, as the ring buffer above does.
- **Godot:** any object with `_iter_init`, `_iter_next` and `_iter_get` works in a `for` loop. Arrays do not detect changes during iteration, so erasing silently skips elements. `get_children()`, `find_children()` and `get_tree().get_nodes_in_group()` return new arrays, and `queue_free()` defers deletion to the end of the frame, which makes most node loops safe to mutate.
- **Unreal:** any type with `begin()`/`end()` works in range-based `for`. `TArray`, `TMap` and `TSet` also have `CreateIterator()` / `CreateConstIterator()`, whose iterators support `RemoveCurrent()`. `TActorIterator<T>(GetWorld())` walks every actor of a class and `TObjectIterator<T>` walks every loaded object, including class default objects and editor objects; both scan a lot, so keep them for tools and startup, not per-frame code. `TRingBuffer` (`Containers/RingBuffer.h`) is a growable ring buffer.

## When to use

- A collection's storage is not a plain list (a ring buffer, a grid, a tree, a sparse set) and more than one place needs to read it.
- You want to change the storage later without touching every loop.
- Callers should read but not modify: hand out an iterator, not the array.
- Large or infinite sequences that should be produced lazily, one element at a time (a spatial query, an inventory filter, a generated path).

## When not to use

- The collection is a plain array or list that callers loop over by index. Expose a read-only view (`IReadOnlyList<T>`, a returned copy in GDScript, a `const TArray<T>&` in C++) and use the language's normal `for`.
- The walk happens in one place. Write the loop there.
- Performance-critical inner loops where a C# iterator method or `IEnumerable<T>` would allocate every frame. Use a struct enumerator, or a method that fills a list you pass in, as the [Spatial Partition](./spatial-partition) query does.

## Pitfalls

- **Changing the collection while iterating.** Removing, adding or reordering during a loop throws (C# collections), trips an assertion (Unreal's ranged-for over `TArray`) or silently skips elements (GDScript arrays). Walk backwards by index, use the container's remove-current or remove-all API, defer removals to after the loop, or iterate over a copy. This includes indirect changes: damaging an enemy that dies and unregisters itself from the list you are walking.
- **Hidden allocations.** In C#, `yield` methods, LINQ and iterating through an interface allocate; once per frame per object adds up to GC spikes. Prefer struct enumerators in hot paths.
- **Iterator state stored on the collection.** If the position lives on the collection itself, two loops over it at once (nested, or one triggered by a signal inside the other) corrupt each other. Keep the position in the iterator (C#, C++) or in GDScript's `iter` argument.
- **Holding an iterator or element reference across frames.** The collection can change in between: elements move when a `TArray` reallocates, and freed nodes become invalid. Store an index or ID and look it up again, or check validity first.
- **Order assumptions.** Dictionaries, hash sets and `TMap` make no promise about order, even if it looks stable in testing. Sort, or use an ordered structure, when order matters (replays, [determinism](./determinism)).

## Related

- [Composite](./composite) — trees of objects are the classic thing to iterate, depth-first or breadth-first.
- [Spatial Partition](./spatial-partition) — its queries are iterators over the cells near a point.
- [Visitor](./visitor) — pushes an operation to every element; an iterator lets the caller pull elements one by one.
- [Inventory](./inventory) — a typical collection whose storage (slots, grids, stacks) callers shouldn't depend on.
- [Coroutines](./coroutines) — Unity's coroutines are C# iterator methods: the engine calls `MoveNext()` once per frame instead of a loop walking a collection.
