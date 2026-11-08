# Memoization / Caching

> Store the results of pure, expensive computations and reuse them.

**Category:** Performance & Memory

## Problem

The same expensive question is asked again and again with the same inputs. The pathfinder computes the route from the barracks to the gold mine every time a worker is sent, 200 times per game, and it is the same route each time. The damage formula evaluates a curve with a power function for every hit. A procedural generator re-samples identical noise for chunks it generated a minute ago. A UI formats `"1,250 G"` from the same number every frame. The work is correct, just repeated.

## Solution

Remember answers. Keep a **cache** keyed by the inputs. On a call, return the cached result if present, and otherwise compute it, store it and return it.

The pattern has several forms:

| Form | How | Example |
| --- | --- | --- |
| **Memoised function** | Dictionary from inputs to result | Path between two regions, a formatted string per value |
| **Lookup table** | Precompute every possible input up front | XP for each level 1–100, damage curve sampled at 256 points, sine table |
| **Bounded cache (LRU)** | Keep only the N most recently used results | Generated chunks, pathfinding between many points |
| **Versioned cache** | Store a version number with each result, and invalidate everything when the world changes | Paths invalidated when a wall is built |

Memoisation is only **correct for pure functions**: same inputs, same output, no side effects. If the answer also depends on hidden state (the current map, the time of day), that state must be part of the key or must invalidate the cache.

## Pseudocode

```text
// Bounded cache: keeps at most capacity results, drops the least recently used.
LruCache:
    capacity
    map        // key → result
    order      // keys, least recently used first

    get_or_add(key, compute):
        if key is in map:
            move key to the back of order       // now the most recently used
            return map[key]
        value ← compute(key)                    // the expensive part, only on a miss
        map[key] ← value
        put key at the back of order
        if size of map > capacity:
            oldest ← take the first key out of order
            remove oldest from map
        return value

// Versioned: the hidden state (the map) is part of the key.
PathCache:
    cache ← LruCache(capacity 512)
    map_version ← 0

    invalidate_all():          // a wall was built or destroyed
        map_version ← map_version + 1    // old keys are never asked for again

    get(from_region, to_region):
        return cache.get_or_add((from_region, to_region, map_version),
                                key → find_path(key.from, key.to))

// Lookup table: every possible input computed once, at load.
XpTable(max_level, curve):
    for level from 1 to max_level:
        xp_for_level[level] ← round(curve at level)
    required(level):
        return xp_for_level[level clamped to 1 .. max_level]
```

## Example

Profile first (Unity Profiler, Godot's profiler, Unreal Insights) to confirm the function is hot *and* is called repeatedly with the same inputs; a cache that never hits only costs memory.

A small bounded LRU cache:

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;

public class LruCache<TKey, TValue>
{
    readonly int capacity;
    readonly Dictionary<TKey, LinkedListNode<(TKey key, TValue value)>> map = new();
    readonly LinkedList<(TKey key, TValue value)> order = new();   // most recently used at the front

    public LruCache(int capacity) => this.capacity = capacity;

    public TValue GetOrAdd(TKey key, Func<TKey, TValue> compute)
    {
        if (map.TryGetValue(key, out var node))
        {
            order.Remove(node);
            order.AddFirst(node);                                  // mark as recently used
            return node.Value.value;
        }

        var value = compute(key);
        map[key] = order.AddFirst((key, value));
        if (map.Count > capacity)                                  // evict the least recently used
        {
            map.Remove(order.Last.Value.key);
            order.RemoveLast();
        }
        return value;
    }

    public void Clear() { map.Clear(); order.Clear(); }
}
```

```gdscript [Godot (GDScript)]
# lru_cache.gd: Dictionaries keep insertion order, so re-inserting a key makes it the newest
# and the first key in iteration order is always the least recently used.
class_name LruCache
extends RefCounted

var _capacity: int
var _map := {}


func _init(capacity: int) -> void:
	_capacity = capacity


func get_or_add(key: Variant, compute: Callable) -> Variant:
	if _map.has(key):
		var cached: Variant = _map[key]
		_map.erase(key)
		_map[key] = cached  # mark as recently used
		return cached

	var value: Variant = compute.call(key)
	_map[key] = value
	if _map.size() > _capacity:  # evict the least recently used
		var oldest: Variant
		for k in _map:
			oldest = k
			break
		_map.erase(oldest)
	return value


func clear() -> void:
	_map.clear()
```

```cpp [Unreal (C++)]
// MemoCache.h. Built in: TLruCache (Containers/LruCache.h) is a bounded cache that evicts
// the least recently used entry. A small wrapper adds get-or-compute.
#pragma once

#include "CoreMinimal.h"
#include "Containers/LruCache.h"

template <typename KeyType, typename ValueType>
class TMemoCache
{
public:
	explicit TMemoCache(int32 Capacity) : Cache(Capacity) {}

	template <typename ComputeType>
	ValueType GetOrAdd(const KeyType& Key, ComputeType&& Compute)
	{
		if (const ValueType* Found = Cache.FindAndTouch(Key))   // marks it as recently used
			return *Found;

		ValueType Value = Compute(Key);
		Cache.Add(Key, Value);                                  // evicts the oldest when full
		return Value;
	}

private:
	TLruCache<KeyType, ValueType> Cache;
};
```

:::

A versioned path cache: paths between regions are reused until the map changes.

::: code-group

```csharp [Unity (C#)]
using System;
using UnityEngine;

public class PathCache
{
    readonly LruCache<(int from, int to, int version), Vector3[]> cache = new(capacity: 512);
    readonly Func<int, int, Vector3[]> findPath;                    // the real (expensive) A* search
    int mapVersion;

    public PathCache(Func<int, int, Vector3[]> findPath) => this.findPath = findPath;

    // Call when a wall is built or destroyed: all cached paths become stale at once.
    public void InvalidateAll() => mapVersion++;

    public Vector3[] Get(int fromRegion, int toRegion) =>
        cache.GetOrAdd((fromRegion, toRegion, mapVersion), k => findPath(k.from, k.to));
}
```

```gdscript [Godot (GDScript)]
# path_cache.gd: a Vector3i (from, to, version) makes a cheap, hashable key.
class_name PathCache
extends RefCounted

var _cache := LruCache.new(512)
var _find_path: Callable  # (from: int, to: int) -> PackedVector3Array: the real (expensive) A* search
var _map_version := 0


func _init(find_path: Callable) -> void:
	_find_path = find_path


# Call when a wall is built or destroyed: all cached paths become stale at once.
func invalidate_all() -> void:
	_map_version += 1


func get_cached_path(from_region: int, to_region: int) -> PackedVector3Array:
	var key := Vector3i(from_region, to_region, _map_version)
	return _cache.get_or_add(key, func(k: Vector3i): return _find_path.call(k.x, k.y))
```

```cpp [Unreal (C++)]
// PathCache.h
#pragma once

#include "CoreMinimal.h"
#include "MemoCache.h"

class FPathCache
{
public:
	using FFindPath = TFunction<TArray<FVector>(int32 From, int32 To)>;   // the real (expensive) A* search

	explicit FPathCache(FFindPath InFindPath) : FindPath(MoveTemp(InFindPath)), Cache(512) {}

	// Call when a wall is built or destroyed: all cached paths become stale at once.
	void InvalidateAll() { ++MapVersion; }

	TArray<FVector> Get(int32 FromRegion, int32 ToRegion)
	{
		return Cache.GetOrAdd(FIntVector(FromRegion, ToRegion, MapVersion),
			[this](const FIntVector& Key) { return FindPath(Key.X, Key.Y); });
	}

private:
	FFindPath FindPath;
	TMemoCache<FIntVector, TArray<FVector>> Cache;
	int32 MapVersion = 0;
};
```

:::

Old entries with a previous version are never requested again, and the LRU evicts them naturally.

A lookup table for a curve that is evaluated thousands of times:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class XpTable
{
    readonly int[] xpForLevel;

    public XpTable(int maxLevel, AnimationCurve curve)
    {
        xpForLevel = new int[maxLevel + 1];
        for (int level = 1; level <= maxLevel; level++)
            xpForLevel[level] = Mathf.RoundToInt(curve.Evaluate(level));   // computed once, at load
    }

    public int Required(int level) => xpForLevel[Mathf.Clamp(level, 1, xpForLevel.Length - 1)];
}
```

```gdscript [Godot (GDScript)]
# xp_table.gd: a Curve is sampled over 0..1 here, so the level is normalised and the
# result scaled by the XP needed at the max level.
class_name XpTable
extends RefCounted

var _xp_for_level := PackedInt32Array()


func _init(max_level: int, curve: Curve, xp_at_max_level: int) -> void:
	_xp_for_level.resize(max_level + 1)
	for level in range(1, max_level + 1):
		var t := float(level) / max_level
		_xp_for_level[level] = roundi(curve.sample(t) * xp_at_max_level)  # computed once, at load


func required(level: int) -> int:
	return _xp_for_level[clampi(level, 1, _xp_for_level.size() - 1)]
```

```cpp [Unreal (C++)]
// XpTable.h: the curve is a UCurveFloat asset evaluated at the level.
#pragma once

#include "CoreMinimal.h"
#include "Curves/CurveFloat.h"

class FXpTable
{
public:
	FXpTable(int32 MaxLevel, const UCurveFloat& Curve)
	{
		XpForLevel.SetNumZeroed(MaxLevel + 1);
		for (int32 Level = 1; Level <= MaxLevel; ++Level)
			XpForLevel[Level] = FMath::RoundToInt(Curve.GetFloatValue(float(Level)));   // computed once, at load
	}

	int32 Required(int32 Level) const
	{
		return XpForLevel[FMath::Clamp(Level, 1, XpForLevel.Num() - 1)];
	}

private:
	TArray<int32> XpForLevel;
};
```

:::

**Engine notes**

- **Unity:** value-tuple keys like `(int, int, int)` hash without allocating. Cached arrays are shared, so callers must not modify a returned `Vector3[]`; return a read-only view or copy if they might.
- **Godot:** Dictionary order is insertion order (Godot 4), which the LRU relies on. `Vector2i`/`Vector3i` keys are cheaper than Arrays or Strings built per lookup. As in C#, treat a cached path as read-only (or `duplicate()` it) so callers can't change the cached copy. `Curve.sample()` is the Godot 4 name (`interpolate()` in Godot 3).
- **Unreal:** `TLruCache` is in Core; for a cache of loaded assets, the Asset Manager and soft references already handle residency. `UCurveFloat` assets can also be replaced by **Curve Tables** when there are many related curves.

## When to use

- A pure computation that is expensive and called repeatedly with a limited set of inputs: pathfinding between fixed points, procedural content by coordinate, formula curves, string formatting of common values.
- When profiling shows the same work repeated, not just expensive work.

## When not to use

- Cheap computations. The cache lookup can cost more than the work.
- Inputs that are rarely repeated. The cache grows without ever being hit.
- Results that depend on changing state. Invalidating the cache correctly is hard; recompute instead.

## Pitfalls

- **Caching impure functions.** If the result depends on state that is not in the key, the cache returns wrong answers. Include it in the key, or invalidate on change, as the map version does.
- **Unbounded growth.** A dictionary that only grows is a memory leak. Bound it (LRU), or clear it at natural points such as level load.
- **Float keys.** `0.1f + 0.2f` and `0.3f` are different keys. Quantise floats (round to a grid) before using them as keys, or use integer coordinates.
- **Mutable cached results.** Returning a cached array that the caller then modifies corrupts the cache for everyone. Return read-only views or copies, or document that results are shared and must not be changed.
- **Caching cheap work.** A dictionary lookup costs something too. If computing is cheaper than hashing the key, the cache makes things slower. Measure.
- **Stale caches after reload.** Static caches survive level loads, and editor play sessions in Unity with Domain Reload disabled or in Unreal's Play In Editor. Clear them when the data they depend on changes.

## Related

- [Dirty Flag](./dirty-flag) — caches one value with an invalidation flag, rather than many values by key.
- [A* Pathfinding](./a-star) — a classic candidate for path caching.
- [Flyweight](./flyweight) — shares data rather than computed results.
- [Data Locality](./data-locality) — lookup tables in arrays are cache-friendly.
- [Noise-Based Generation](./noise-generation) — cache generated chunks by coordinate.
