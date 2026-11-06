# Spatial Partition

> Index objects by position so neighbour queries do not check everything.

**Also known as:** Grid, Quadtree, Octree, BVH · **Category:** Performance & Memory

## Problem

Five hundred units each need to find enemies within 10 metres. Checking every unit against every other is 250,000 distance checks per frame, O(n²). Double the unit count and the cost quadruples.

## Solution

Store objects in a data structure organised by **location**. A query then visits only the region of space it cares about and its contents.

| Structure | Best for | Notes |
| --- | --- | --- |
| **Uniform grid / spatial hash** | Many similar-sized, moving objects | Simplest and fastest to update. Pick cell size ≈ query radius. |
| **Quadtree / octree** | Uneven density, static or slow objects | Adapts to clustering. Rebuilding is more expensive. |
| **BVH** (bounding volume hierarchy) | Ray casts, varied object sizes | Used by physics engines and ray tracers. |
| **k-d tree** | Static points, nearest-neighbour queries | Rebuild when the data changes. |

## Example (Unity C#)

A spatial hash grid for proximity queries:

```csharp
public class SpatialHash<T>
{
    readonly float cellSize;
    readonly Dictionary<Vector2Int, List<T>> cells = new();

    public SpatialHash(float cellSize) => this.cellSize = cellSize;

    Vector2Int CellOf(Vector3 p) =>
        new(Mathf.FloorToInt(p.x / cellSize), Mathf.FloorToInt(p.z / cellSize));

    public void Clear()
    {
        foreach (var list in cells.Values) list.Clear();   // keep lists to avoid reallocating
    }

    public void Insert(T item, Vector3 position)
    {
        var key = CellOf(position);
        if (!cells.TryGetValue(key, out var list)) cells[key] = list = new List<T>();
        list.Add(item);
    }

    // Appends candidates in the cells overlapping the query circle.
    // The caller still does the exact distance check.
    public void Query(Vector3 center, float radius, List<T> results)
    {
        var min = CellOf(center - new Vector3(radius, 0, radius));
        var max = CellOf(center + new Vector3(radius, 0, radius));
        for (int x = min.x; x <= max.x; x++)
        for (int y = min.y; y <= max.y; y++)
            if (cells.TryGetValue(new Vector2Int(x, y), out var list))
                results.AddRange(list);
    }
}

// Each frame: grid.Clear(); insert every unit; then each unit queries its neighbourhood.
```

For colliders, the physics engine already maintains a partition. `Physics.OverlapSphereNonAlloc` queries it without allocating.

## When to use

- Proximity queries: AI target selection, flocking neighbours, area-of-effect damage, interest management for networking.
- Collision broad phase, culling and picking.

## Pitfalls

- **Wrong cell size.** Cells that are too small make every query visit many cells. Cells that are too large return many false candidates.
- **Objects larger than a cell** must be inserted into every cell they overlap, or stored in a separate list.
- **Update cost.** For fast-moving objects, rebuilding the grid each frame is often cheaper than moving entries between cells.
- **Premature use.** For a few dozen objects, brute force is simpler and just as fast.

## Related

- [Interest Management](./interest-management), [Flocking](./flocking) and [Culling](./culling) are the main consumers.
- [Data Locality](./data-locality) — store cell contents contiguously for cache-friendly queries.
