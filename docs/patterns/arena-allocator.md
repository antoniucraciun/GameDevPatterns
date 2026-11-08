# Arena Allocator

> Allocate from a block that is freed all at once, e.g. per frame or per level.

**Also known as:** Linear Allocator, Frame Allocator · **Category:** Performance & Memory

## Problem

Every frame, gameplay code creates short-lived data: lists of nearby enemies, raycast hit buffers, path candidates, temporary arrays for sorting, strings for the debug overlay. In a garbage-collected language such as C# (Unity, Godot .NET), each `new List<T>()` or array is a heap allocation that the garbage collector must later find and free. In C++ each one is a call into the general-purpose allocator, which costs time and fragments memory. A few kilobytes per frame becomes megabytes per minute, and the collector pauses the game to clean up, which causes regular hitches. The data's lifetime is obvious ("only this frame"), but the allocator does not know it.

## Solution

Allocate from an **arena**: one large block of memory with a pointer to its first free byte.

- **Allocate** by moving the pointer forward: O(1), just an addition, with no search for a free block.
- **Never free individual allocations.**
- **Reset** the whole arena at once when its lifetime ends: every frame, every level or every job. Resetting is also O(1), moving the pointer back to the start.

Because everything in an arena dies together, there is nothing for a garbage collector or general-purpose allocator to track, and no fragmentation. The cost is a strict rule: **nothing allocated from the arena may be used after the reset.**

Common arenas in games:

| Arena | Lifetime | Examples |
| --- | --- | --- |
| **Frame** | One frame | Query results, temporary buffers, debug strings |
| **Level** | One level | Navigation data, level-specific tables |
| **Job** | One job | Scratch memory inside one worker-thread job |

Engines ship their own arenas: Unity's `Allocator.Temp` *is* a per-frame arena for native memory (and the Entities package exposes a rewindable world update allocator), and Unreal has `FMemStack` with `FMemMark`. GDScript has no manual memory management at all. In managed C# and GDScript, the closest equivalent is a set of buffers allocated once and **reused** every frame.

## Pseudocode

```text
FrameArena:
    buffer       // one large block, allocated once
    used ← 0     // offset of the first free byte

    allocate(count, item size, alignment):
        start ← used rounded up to a multiple of alignment
        end ← start + count × item size
        if end > size of buffer:
            grow the buffer, or fail loudly   // rare; size it from profiling
        used ← end                            // the whole cost: one addition
        return the slice buffer[start .. end)

    // No free(): single allocations are never given back.

    reset():                                  // everything dies together
        used ← 0                              // reference types: clear the used part too

    mark():          return used              // a scoped arena: remember a point...
    release_to(m):   used ← m                 // ...and pop everything after it at once

// One frame of use:
arena ← FrameArena(1 MB)

during the frame:
    nearby ← arena.allocate(64 enemy indices)
    for each enemy i:
        if distance(enemy i, me) < 10 m: append i to nearby
    ... use nearby this frame only; never store it in a field ...

after every system has finished with this frame's data:
    arena.reset()        // any slice still held now points at garbage
```

## Example

Only reach for an arena after the profiler shows allocation cost: GC spikes and `GC.Alloc` in the Unity Profiler, or allocator time and memory churn in Unreal Insights (with the memory trace channel). GDScript has no manual memory management at all; its tabs show the closest idiom, reusing preallocated packed arrays.

Scratch memory for one frame:

::: code-group

```csharp [Unity (C#)]
using Unity.Collections;
using UnityEngine;

public class NearbyEnemyQuery : MonoBehaviour
{
    void Update()
    {
        // Allocator.Temp: a bump allocation from Unity's per-frame arena. No GC, released at frame end.
        var nearby = new NativeList<int>(64, Allocator.Temp);
        for (int i = 0; i < EnemyRegistry.Count; i++)
            if ((EnemyRegistry.Positions[i] - (Vector3)transform.position).sqrMagnitude < 100f)
                nearby.Add(i);

        // ... use nearby this frame only ...
        // (Disposing Temp memory is optional; it's reclaimed when the frame ends.)
    }
}
```

```gdscript [Godot (GDScript)]
# nearby_enemy_query.gd: GDScript has no allocators to choose. The closest idiom is a buffer
# allocated once and reused every frame, with a separate count of how much is in use.
extends Node3D

var _nearby := PackedInt32Array()
var _nearby_count := 0


func _ready() -> void:
	_nearby.resize(256)  # allocated once; size it from profiling


func _process(_delta: float) -> void:
	_nearby_count = 0
	var here := global_position
	var positions: PackedVector3Array = EnemyRegistry.positions  # an autoload
	for i in positions.size():
		if positions[i].distance_squared_to(here) < 100.0 and _nearby_count < _nearby.size():
			_nearby[_nearby_count] = i
			_nearby_count += 1

	# ... use _nearby[0 .. _nearby_count - 1] this frame only ...
```

```cpp [Unreal (C++)]
// Built in: FMemStack is a per-thread arena, and FMemMark releases everything allocated after
// it in one step when it goes out of scope.
#include "Misc/MemStack.h"

void UNearbyEnemyQueryComponent::TickComponent(float DeltaTime, ELevelTick TickType,
	FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	FMemMark Mark(FMemStack::Get());
	TArray<int32, TMemStackAllocator<>> Nearby;           // memory comes from the thread's arena
	Nearby.Reserve(64);

	// Alternative: TArray<int32, TInlineAllocator<64>> keeps the first 64 elements inside the
	// array itself (on the stack here) and only touches the heap if it grows beyond that.

	const FVector Here = GetOwner()->GetActorLocation();
	const TArray<FVector>& Positions = GetWorld()->GetSubsystem<UEnemyRegistry>()->Positions;   // your world subsystem
	for (int32 i = 0; i < Positions.Num(); ++i)
		if (FVector::DistSquared(Positions[i], Here) < 1000.f * 1000.f)
			Nearby.Add(i);

	// ... use Nearby in this scope only ...
}   // Mark's destructor pops everything allocated since it was created
```

:::

A frame arena of your own: buffers handed out during the frame, and all reclaimed by one `Reset`:

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;

public sealed class FrameArena<T>
{
    T[] buffer;
    int used;

    public FrameArena(int capacity) => buffer = new T[capacity];

    // Hands out a slice of the shared buffer. Valid until Reset().
    public Span<T> Allocate(int count)
    {
        if (used + count > buffer.Length)
        {
            // Out of space: grow (rare; this allocates). Slices handed out earlier keep
            // pointing at the old array, which stays valid while they use it.
            Array.Resize(ref buffer, Math.Max(buffer.Length * 2, used + count));
        }
        var slice = new Span<T>(buffer, used, count);
        used += count;
        return slice;
    }

    public void Reset()
    {
        // Clear references so the arena doesn't keep objects alive (only matters for reference types).
        if (!typeof(T).IsValueType) Array.Clear(buffer, 0, used);
        used = 0;
    }
}

public class Arenas : UnityEngine.MonoBehaviour
{
    public static readonly FrameArena<UnityEngine.Vector3> Vectors = new(8192);
    public static readonly FrameArena<int> Ints = new(8192);

    // Run last in the frame (Script Execution Order), after everyone is done with this frame's data.
    void LateUpdate()
    {
        Vectors.Reset();
        Ints.Reset();
    }
}

// Usage: no allocation, no GC.
// Span<Vector3> corners = Arenas.Vectors.Allocate(4);
// corners[0] = ...;   // valid until the end of this frame
```

```gdscript [Godot (GDScript)]
# frame_scratch.gd: autoload "FrameScratch". GDScript has no spans or pointers, so this hands
# out index ranges in one buffer it owns, and callers read and write through it.
extends Node

var _vectors := PackedVector3Array()
var _used := 0


func _ready() -> void:
	_vectors.resize(8192)
	process_priority = 1000  # higher values run later: reset after everyone else's _process


func _process(_delta: float) -> void:
	_used = 0  # everything handed out this frame is free again


# Returns the first index of `count` slots, valid until the end of this frame.
func allocate(count: int) -> int:
	if _used + count > _vectors.size():
		_vectors.resize(maxi(_vectors.size() * 2, _used + count))  # rare: grow (allocates)
	var start := _used
	_used += count
	return start


func set_vector(i: int, v: Vector3) -> void:
	_vectors[i] = v


func get_vector(i: int) -> Vector3:
	return _vectors[i]


# Usage:
#   var corners := FrameScratch.allocate(4)
#   FrameScratch.set_vector(corners + 0, Vector3.ZERO)  # valid until the end of this frame
```

```cpp [Unreal (C++)]
// FrameArena.h: a fixed-size bump allocator for trivially destructible types.
#pragma once

#include "CoreMinimal.h"
#include <type_traits>

class FFrameArena
{
public:
	explicit FFrameArena(int32 CapacityBytes) { Buffer.SetNumUninitialized(CapacityBytes); }

	// Hands out a view into the shared buffer. Valid until Reset().
	template <typename T>
	TArrayView<T> Allocate(int32 Count)
	{
		static_assert(std::is_trivially_destructible_v<T>, "Reset() runs no destructors");
		const int64 Start = Align(Used, alignof(T));
		const int64 End = Start + int64(Count) * sizeof(T);
		// It can't grow without moving memory that callers point into: fail loudly instead.
		if (!ensureMsgf(End <= Buffer.Num(), TEXT("Frame arena full: size it from profiling"))) return {};

		T* Data = reinterpret_cast<T*>(Buffer.GetData() + Start);
		for (int32 i = 0; i < Count; ++i) new (Data + i) T();
		Used = End;
		return TArrayView<T>(Data, Count);
	}

	void Reset() { Used = 0; }

private:
	TArray<uint8> Buffer;
	int64 Used = 0;
};

// Owner, e.g. a game instance subsystem:
//   FFrameArena Arena{1 << 20};
//   EndFrameHandle = FCoreDelegates::OnEndFrame.AddLambda([this] { Arena.Reset(); });
//
// Usage: TArrayView<FVector> Corners = Arena.Allocate<FVector>(4);   // valid until the end of this frame
```

:::

**Engine notes**

- **Unity:** `Allocator.Temp` is the built-in frame arena; `Allocator.TempJob` lasts up to four frames and must be disposed. `Span<T>` cannot be stored in fields or captured by lambdas; the compiler enforces this, which helps prevent arena memory being kept beyond its lifetime. The managed version resizes when it runs out of space, which allocates, so size it from profiling.
- **Godot:** GDScript has no manual memory management: objects are reference-counted or freed with `free()`/`queue_free()`, and there is no garbage collector to pause the game. Arenas only appear in GDExtension (C++) code; in GDScript the gain comes from reusing preallocated packed arrays instead of creating new Arrays every frame.
- **Unreal:** `FMemStack`/`FMemMark` are the engine's arena, used heavily by the renderer; `TMemStackAllocator` and `TInlineAllocator` plug into any `TArray`. Nothing in an `FMemStack` allocation runs destructors when the mark pops, so store only types that don't need them, and never keep pointers past the mark's scope.

## When to use

- Short-lived data with a clear, shared lifetime: per-frame queries, per-job scratch space, per-level loading data.
- Hot paths where allocation cost or garbage collection pauses are visible: mobile, VR, consoles, high frame-rate games.
- Scratch memory inside worker-thread jobs: `Allocator.Temp` in Unity's Burst jobs, an `FMemMark` on the thread's `FMemStack` in Unreal.

## When not to use

- Typical gameplay code. The engine's allocator or garbage collector, plus pooling, is usually enough.
- Data with mixed or unknown lifetimes. An arena frees everything at once, so a long-lived item leaks the whole arena.
- Teams unfamiliar with unsafe or native memory. Use-after-free bugs are hard to find.

## Pitfalls

- **Use after reset.** The classic arena bug: data from last frame read this frame looks valid, but has been overwritten. Never store arena data in fields. `Span<T>` helps, because the compiler rejects it.
- **Wrong lifetime.** Data that must outlive the frame (a path the unit keeps following) must be copied to persistent memory, not left in the frame arena.
- **Running out of space.** A fixed arena that fills up must either grow, which allocates and can hitch, or fail. Profile peak usage and size accordingly, and log growth in development builds.
- **Reset order.** Resetting before a late consumer runs (UI that updates after gameplay, rendering callbacks) corrupts its data. Reset at one well-defined point, after all users.
- **Holding references in managed arenas.** Buffers of reference types keep objects alive until cleared. Clear them on reset, as above, or store only value types.

## Related

- [Object Pool](./object-pool) — reuses individual objects. An arena reuses whole blocks at once.
- [Data Locality](./data-locality) — arenas give contiguous memory for free.
- [Job System](./job-system) — jobs need short-lived scratch memory, which arenas provide (Unity's `Allocator.Temp` and `TempJob` are arena-style allocators for jobs).
- [Spatial Partition](./spatial-partition) — grids rebuilt every frame are natural arena users.
