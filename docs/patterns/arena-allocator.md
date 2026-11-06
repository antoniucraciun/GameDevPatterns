# Arena Allocator

> Allocate from a block that is freed all at once, e.g. per frame or per level.

**Also known as:** Linear Allocator, Frame Allocator · **Category:** Performance & Memory

## Problem

Every frame, gameplay code creates short-lived data: lists of nearby enemies, raycast hit buffers, path candidates, temporary arrays for sorting, strings for the debug overlay. In C#, each `new List<T>()` or array is a heap allocation that the garbage collector must later find and free. A few kilobytes per frame becomes megabytes per minute, and the collector pauses the game to clean up, which causes regular hitches. The data's lifetime is obvious ("only this frame"), but the allocator does not know it.

## Solution

Allocate from an **arena**: one large block of memory with a pointer to its first free byte.

- **Allocate** by moving the pointer forward: O(1), just an addition, with no search for a free block.
- **Never free individual allocations.**
- **Reset** the whole arena at once when its lifetime ends: every frame, every level or every job. Resetting is also O(1), moving the pointer back to the start.

Because everything in an arena dies together, there is nothing for a garbage collector to track and no fragmentation. The cost is a strict rule: **nothing allocated from the arena may be used after the reset.**

Common arenas in games:

| Arena | Lifetime | Examples |
| --- | --- | --- |
| **Frame** | One frame | Query results, temporary buffers, debug strings |
| **Level** | One level | Navigation data, level-specific tables |
| **Job** | One job | Scratch memory inside a Burst job |

In Unity, `Allocator.Temp` *is* a per-frame arena for native memory, and the Entities package exposes a rewindable world update allocator. In managed C#, the closest equivalent is a set of buffers allocated once and **reused** every frame.

## Example (Unity C#)

Native memory from Unity's frame arena, which is cheap and freed automatically at the end of the frame:

```csharp
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

A managed frame arena: typed buffers that are handed out during the frame, and all reclaimed by one `Reset`:

```csharp
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
            // Out of space: grow for next time (rare), and fall back to a heap array this time.
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

`Span<T>` cannot be stored in fields or captured by lambdas. The compiler enforces this, which helps prevent arena memory being kept beyond its lifetime.

The managed version resizes when it runs out of space, which allocates. Size it from profiling, so resizing happens at most once early on, never during play.

## When to use

- Short-lived data with a clear, shared lifetime: per-frame queries, per-job scratch space, per-level loading data.
- Hot paths where garbage collection pauses are visible: mobile, VR, consoles, high frame-rate games.
- Inside Burst jobs, which use `Allocator.Temp` for scratch memory.

## When not to use

- Typical gameplay code in C#. The garbage collector and pooling are usually enough.
- Data with mixed or unknown lifetimes. An arena frees everything at once, so a long-lived item leaks the whole arena.
- Teams unfamiliar with unsafe or native memory. Use-after-free bugs are hard to find.

## Pitfalls

- **Use after reset.** The classic arena bug: data from last frame read this frame looks valid, but has been overwritten. Never store arena data in fields. `Span<T>` helps, because the compiler rejects it.
- **Wrong lifetime.** Data that must outlive the frame (a path the unit keeps following) must be copied to persistent memory, not left in the frame arena.
- **Running out of space.** A fixed arena that fills up must either grow, which allocates and can hitch, or fail. Profile peak usage and size accordingly, and log growth in development builds.
- **Reset order.** Resetting before a late consumer runs (UI in `LateUpdate`, rendering callbacks) corrupts its data. Reset at one well-defined point, after all users.
- **Holding references in managed arenas.** Buffers of reference types keep objects alive until cleared. Clear them on reset, as above, or store only value types.

## Related

- [Object Pool](./object-pool) — reuses individual objects. An arena reuses whole blocks at once.
- [Data Locality](./data-locality) — arenas give contiguous memory for free.
- [Job System](./job-system) — `Allocator.Temp` and `TempJob` are arena-style allocators for jobs.
- [Spatial Partition](./spatial-partition) — grids rebuilt every frame are natural arena users.
