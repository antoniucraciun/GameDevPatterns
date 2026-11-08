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

<SpatialPartitionViz />

## Example

### Core

A spatial hash grid for proximity queries, with no engine types beyond a vector:

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

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
```

```gdscript [Godot (GDScript)]
# spatial_hash.gd: cells on the XZ plane (Godot is Y-up).
class_name SpatialHash
extends RefCounted

var _cell_size: float
var _cells := {}  # Vector2i -> Array


func _init(cell_size: float) -> void:
	_cell_size = cell_size


func clear() -> void:
	for list in _cells.values():
		list.clear()  # keep the arrays to avoid reallocating


func insert(item: Variant, pos: Vector3) -> void:
	var key := _cell_of(pos)
	if not _cells.has(key):
		_cells[key] = []
	_cells[key].append(item)


# Appends candidates in the cells overlapping the query circle.
# The caller still does the exact distance check.
func query(center: Vector3, radius: float, results: Array) -> void:
	var lo := _cell_of(center - Vector3(radius, 0.0, radius))
	var hi := _cell_of(center + Vector3(radius, 0.0, radius))
	for x in range(lo.x, hi.x + 1):
		for y in range(lo.y, hi.y + 1):
			var key := Vector2i(x, y)
			if _cells.has(key):
				results.append_array(_cells[key])


func _cell_of(p: Vector3) -> Vector2i:
	return Vector2i(floori(p.x / _cell_size), floori(p.z / _cell_size))
```

```cpp [Unreal (C++)]
// SpatialHash.h: cells on the XY plane (Unreal is Z-up).
#pragma once

#include "CoreMinimal.h"

template <typename T>
class TSpatialHash
{
public:
	explicit TSpatialHash(float InCellSize) : CellSize(InCellSize) {}

	void Clear()
	{
		for (auto& Pair : Cells) Pair.Value.Reset();   // Reset keeps the allocation
	}

	void Insert(const T& Item, const FVector& Position)
	{
		Cells.FindOrAdd(CellOf(Position)).Add(Item);
	}

	// Appends candidates in the cells overlapping the query circle.
	// The caller still does the exact distance check.
	void Query(const FVector& Center, float Radius, TArray<T>& Results) const
	{
		const FIntPoint Min = CellOf(Center - FVector(Radius, Radius, 0.f));
		const FIntPoint Max = CellOf(Center + FVector(Radius, Radius, 0.f));
		for (int32 X = Min.X; X <= Max.X; ++X)
			for (int32 Y = Min.Y; Y <= Max.Y; ++Y)
				if (const TArray<T>* List = Cells.Find(FIntPoint(X, Y)))
					Results.Append(*List);
	}

private:
	FIntPoint CellOf(const FVector& P) const
	{
		return FIntPoint(FMath::FloorToInt32(P.X / CellSize), FMath::FloorToInt32(P.Y / CellSize));
	}

	float CellSize;
	TMap<FIntPoint, TArray<T>> Cells;
};
```

:::

### Engine wiring

Each frame: clear the grid, insert every unit, then let each unit query its neighbourhood. Cell size about equal to the query radius keeps each query to a 3×3 block of cells:

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public class Flock : MonoBehaviour
{
    [SerializeField] List<Transform> units = new();
    [SerializeField] float neighbourRadius = 5f;

    SpatialHash<Transform> grid;
    readonly List<Transform> candidates = new();

    void Awake() => grid = new SpatialHash<Transform>(neighbourRadius);

    void Update()
    {
        grid.Clear();
        foreach (var u in units) grid.Insert(u, u.position);

        float r2 = neighbourRadius * neighbourRadius;
        foreach (var u in units)
        {
            candidates.Clear();
            grid.Query(u.position, neighbourRadius, candidates);
            foreach (var other in candidates)
                if (other != u && (other.position - u.position).sqrMagnitude <= r2)
                    Separate(u, other);
        }
    }

    void Separate(Transform u, Transform other) { /* steer apart */ }
}
```

```gdscript [Godot (GDScript)]
# flock.gd
extends Node3D

@export var neighbour_radius := 5.0

var _grid: SpatialHash
var _candidates: Array = []


func _ready() -> void:
	_grid = SpatialHash.new(neighbour_radius)


func _physics_process(_delta: float) -> void:
	var units := get_children()
	_grid.clear()
	for u: Node3D in units:
		_grid.insert(u, u.global_position)

	var r2 := neighbour_radius * neighbour_radius
	for u: Node3D in units:
		_candidates.clear()
		_grid.query(u.global_position, neighbour_radius, _candidates)
		for other: Node3D in _candidates:
			if other != u and other.global_position.distance_squared_to(u.global_position) <= r2:
				_separate(u, other)


func _separate(u: Node3D, other: Node3D) -> void:
	pass  # steer apart
```

```cpp [Unreal (C++)]
// FlockManager.h: UPROPERTY(EditAnywhere) TArray<TObjectPtr<AActor>> Units;
//                 UPROPERTY(EditAnywhere) float NeighbourRadius = 500.f;
//                 TSpatialHash<AActor*> Grid{500.f};  TArray<AActor*> Candidates;

// FlockManager.cpp
void AFlockManager::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	Grid.Clear();
	for (AActor* Unit : Units) Grid.Insert(Unit, Unit->GetActorLocation());

	const float R2 = NeighbourRadius * NeighbourRadius;
	for (AActor* Unit : Units)
	{
		Candidates.Reset();
		Grid.Query(Unit->GetActorLocation(), NeighbourRadius, Candidates);
		for (AActor* Other : Candidates)
			if (Other != Unit && FVector::DistSquared(Other->GetActorLocation(), Unit->GetActorLocation()) <= R2)
				Separate(Unit, Other);
	}
}
```

:::

For colliders, the physics engine already maintains a partition (a BVH or similar), and querying it is usually better than building your own:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class Sensor : MonoBehaviour
{
    [SerializeField] float radius = 10f;
    [SerializeField] LayerMask mask;
    readonly Collider[] hits = new Collider[64];   // reused: no allocation per query

    public int Scan() => Physics.OverlapSphereNonAlloc(transform.position, radius, hits, mask);
}
```

```gdscript [Godot (GDScript)]
# sensor.gd: query the physics server directly. Call from _physics_process,
# when the space state is safe to access.
extends Node3D

@export var radius := 10.0
@export_flags_3d_physics var mask := 1

var _query := PhysicsShapeQueryParameters3D.new()


func _ready() -> void:
	var sphere := SphereShape3D.new()
	sphere.radius = radius
	_query.shape = sphere
	_query.collision_mask = mask


func scan() -> Array[Dictionary]:
	_query.transform = global_transform
	return get_world_3d().direct_space_state.intersect_shape(_query, 64)  # each has "collider"
```

```cpp [Unreal (C++)]
// Sensor.cpp
#include "Engine/World.h"
#include "Engine/OverlapResult.h"   // recent 5.x; older versions declare FOverlapResult in WorldCollision.h

int32 USensorComponent::Scan()
{
	Hits.Reset();                                   // TArray<FOverlapResult> member, reused
	FCollisionQueryParams Params(SCENE_QUERY_STAT(SensorScan), false, GetOwner());
	GetWorld()->OverlapMultiByObjectType(Hits, GetComponentLocation(), FQuat::Identity,
		FCollisionObjectQueryParams(ECC_Pawn), FCollisionShape::MakeSphere(Radius), Params);
	return Hits.Num();
}
```

:::

**Engine notes**

- **Unity:** `Physics.OverlapSphereNonAlloc` and the other `NonAlloc` queries fill a buffer you own. For thousands of agents, the same grid works in a Burst job with `NativeParallelMultiHashMap<int, int>` keyed by cell.
- **Godot:** `direct_space_state` queries (`intersect_shape`, `intersect_ray`, `intersect_point`) use the physics server's own broad phase. An `Area3D` gives you persistent overlap signals instead of one-off queries. Typed loop variables (`for u: Node3D in …`) need Godot 4.2+.
- **Unreal:** `OverlapMultiByObjectType`, `OverlapMultiByChannel` and the sweep queries use the physics scene's acceleration structure. For non-physics data, the engine's general octree is `TOctree2` (`Math/GenericOctree.h`), which needs a small semantics struct describing each element's bounds; the navigation system builds its navigation octree on it.

## When to use

- Proximity queries: AI target selection, flocking neighbours, area-of-effect damage, interest management for networking.
- Collision broad phase, culling and picking.

## When not to use

- A few dozen objects. A linear search is fast enough and has no bugs.
- When the physics engine's own queries (overlap tests, triggers) already do the job. They use their own broad phase.
- Objects that move so fast or so far that updating the structure costs more than the queries save.

## Pitfalls

- **Wrong cell size.** Cells that are too small make every query visit many cells. Cells that are too large return many false candidates.
- **Objects larger than a cell** must be inserted into every cell they overlap, or stored in a separate list.
- **Update cost.** For fast-moving objects, rebuilding the grid each frame is often cheaper than moving entries between cells.
- **Premature use.** For a few dozen objects, brute force is simpler and just as fast.

## Related

- [Interest Management](./interest-management), [Flocking](./flocking) and [Culling](./culling) are the main consumers.
- [Data Locality](./data-locality) — store cell contents contiguously for cache-friendly queries.
- [Iterator](./iterator) — a query can yield results cell by cell instead of filling a list.
