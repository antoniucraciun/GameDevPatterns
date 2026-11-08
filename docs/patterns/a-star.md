# A* Pathfinding

> Find the shortest path on a graph using a heuristic to guide the search.

**Category:** AI & Decision Making

## Problem

An enemy needs to reach the player through a maze of walls. Moving straight toward the target gets stuck on the first obstacle. Trying every possible route is far too slow. Breadth-first search finds a path, but explores in all directions, wasting time on tiles behind the enemy, and ignores terrain costs such as swamps or roads.

## Solution

Represent the world as a **graph**: grid cells, waypoints or navmesh polygons as nodes, with edges between walkable neighbours and a **cost** per edge. A* explores nodes in order of

```
f(n) = g(n) + h(n)
```

- **g(n)**: the actual cost from the start to `n`, so far.
- **h(n)**: a **heuristic** estimate of the cost from `n` to the goal.

It keeps an **open set** (nodes discovered but not expanded, ordered by `f` in a priority queue) and a **closed set** (nodes already expanded). It repeatedly expands the lowest-`f` node, updating neighbours whose `g` improves, until it reaches the goal. Following each node's **parent** back from the goal gives the path.

If `h` never overestimates the true cost (it is **admissible**), A* returns a shortest path. The better `h` is, the fewer nodes it explores.

<AStarViz />

| Grid movement | Heuristic |
| --- | --- |
| 4 directions | Manhattan: `dx + dy` |
| 8 directions (diagonal cost √2) | Octile: `max(dx, dy) + (√2 − 1) · min(dx, dy)` |
| Any direction | Euclidean distance |

## Pseudocode

The search works on any graph; the Example below runs it on a grid.

```text
open      = priority queue of (node, f), lowest f first
            // nodes discovered but not yet expanded
g[n]      = cheapest known cost from start to n, ∞ until found
parent[n] = the node that cheapest path came from

find_path(start, goal):
    g[start] ← 0
    add (start, h(start)) to open

    while open is not empty:
        (current, f) ← take the lowest-f entry out of open
        if current is goal:
            return follow_parents(goal)
        if f > g[current] + h(current):
            skip it        // stale: a cheaper copy was expanded already

        for each neighbour n of current:
            tentative ← g[current] + cost(current, n)
            if tentative < g[n]:       // a cheaper way to reach n
                g[n] ← tentative
                parent[n] ← current
                add (n, g[n] + h(n)) to open

    return no path         // every reachable node was expanded

follow_parents(goal):
    path ← [goal]
    while the first node of path is not start:
        put parent[first node of path] at the front of path
    return path
```

## Example

A* on a grid with 8-way movement, terrain costs and no corner cutting. The **core** is the search itself, with no scene or engine types, so it can be unit tested on its own. The **engine wiring** builds the cost grid from the level and draws the path.

### Core

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;

public class GridPathfinder
{
    readonly int width, height;
    readonly float[,] cost;                     // movement cost per cell; float.PositiveInfinity = wall

    // Reused between searches to avoid allocations.
    readonly float[,] g;
    readonly (int x, int y)[,] parent;
    readonly int[,] visitedStamp;
    int stamp;

    // Unity has no PriorityQueue, so a SortedSet serves as one. The counter keeps equal f values distinct.
    readonly SortedSet<(float f, int order, (int x, int y) cell)> open = new();
    int order;

    static readonly (int x, int y)[] Directions =
    {
        (1, 0), (-1, 0), (0, 1), (0, -1),
        (1, 1), (1, -1), (-1, 1), (-1, -1),
    };

    public GridPathfinder(float[,] cost)
    {
        this.cost = cost;
        width = cost.GetLength(0); height = cost.GetLength(1);
        g = new float[width, height];
        parent = new (int x, int y)[width, height];
        visitedStamp = new int[width, height];
    }

    static float Octile((int x, int y) a, (int x, int y) b)
    {
        int dx = Math.Abs(a.x - b.x), dy = Math.Abs(a.y - b.y);
        return Math.Max(dx, dy) + 0.41421356f * Math.Min(dx, dy);
    }

    bool Walkable(int x, int y) => x >= 0 && y >= 0 && x < width && y < height && !float.IsInfinity(cost[x, y]);

    public bool FindPath((int x, int y) start, (int x, int y) goal, List<(int x, int y)> path)
    {
        path.Clear();
        if (!Walkable(goal.x, goal.y)) return false;

        stamp++;                                 // "clears" g/parent without touching every cell
        open.Clear();
        Touch(start, 0f, start);
        open.Add((Octile(start, goal), order++, start));

        while (open.Count > 0)
        {
            var (f, _, current) = open.Min;
            open.Remove(open.Min);
            if (current == goal) { Reconstruct(start, goal, path); return true; }
            if (f > g[current.x, current.y] + Octile(current, goal) + 0.0001f) continue;   // stale entry

            foreach (var d in Directions)
            {
                var next = (x: current.x + d.x, y: current.y + d.y);
                if (!Walkable(next.x, next.y)) continue;
                bool diagonal = d.x != 0 && d.y != 0;
                if (diagonal && (!Walkable(current.x + d.x, current.y) || !Walkable(current.x, current.y + d.y)))
                    continue;                    // don't cut corners through walls

                float step = (diagonal ? 1.41421356f : 1f) * cost[next.x, next.y];
                float tentative = g[current.x, current.y] + step;

                if (visitedStamp[next.x, next.y] != stamp || tentative < g[next.x, next.y])
                {
                    Touch(next, tentative, current);
                    open.Add((tentative + Octile(next, goal), order++, next));   // duplicates are skipped as stale
                }
            }
        }
        return false;                            // no path
    }

    void Touch((int x, int y) n, float gValue, (int x, int y) from)
    {
        visitedStamp[n.x, n.y] = stamp;
        g[n.x, n.y] = gValue;
        parent[n.x, n.y] = from;
    }

    void Reconstruct((int x, int y) start, (int x, int y) goal, List<(int x, int y)> path)
    {
        for (var n = goal; n != start; n = parent[n.x, n.y]) path.Add(n);
        path.Add(start);
        path.Reverse();
    }
}
```

```gdscript [Godot (GDScript)]
# grid_pathfinder.gd
class_name GridPathfinder
extends RefCounted

const DIRECTIONS: Array[Vector2i] = [
	Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1),
	Vector2i(1, 1), Vector2i(1, -1), Vector2i(-1, 1), Vector2i(-1, -1),
]

var _width: int
var _height: int
var _cost: PackedFloat32Array  # movement cost per cell, row-major; INF = wall


func _init(cost: PackedFloat32Array, width: int, height: int) -> void:
	_cost = cost
	_width = width
	_height = height


func find_path(start: Vector2i, goal: Vector2i) -> Array[Vector2i]:
	var path: Array[Vector2i] = []
	if not _walkable(goal):
		return path

	var g := {start: 0.0}
	var parent := {start: start}
	var open := MinHeap.new()
	open.push(start, _octile(start, goal))

	while not open.is_empty():
		var entry: Array = open.pop()  # [cell, f]
		var current: Vector2i = entry[0]
		if current == goal:
			while current != start:
				path.push_front(current)
				current = parent[current]
			path.push_front(start)
			return path
		if entry[1] > g[current] + _octile(current, goal) + 0.0001:
			continue  # stale entry

		for d: Vector2i in DIRECTIONS:
			var next := current + d
			if not _walkable(next):
				continue
			var diagonal := d.x != 0 and d.y != 0
			if diagonal and (not _walkable(Vector2i(current.x + d.x, current.y)) \
					or not _walkable(Vector2i(current.x, current.y + d.y))):
				continue  # don't cut corners through walls

			var step := (1.41421356 if diagonal else 1.0) * _cost[next.y * _width + next.x]
			var tentative: float = g[current] + step
			if not g.has(next) or tentative < g[next]:
				g[next] = tentative
				parent[next] = current
				open.push(next, tentative + _octile(next, goal))  # duplicates are skipped as stale
	return path  # empty: no path


func _walkable(c: Vector2i) -> bool:
	return c.x >= 0 and c.y >= 0 and c.x < _width and c.y < _height \
			and not is_inf(_cost[c.y * _width + c.x])


static func _octile(a: Vector2i, b: Vector2i) -> float:
	var dx := absi(a.x - b.x)
	var dy := absi(a.y - b.y)
	return maxi(dx, dy) + 0.41421356 * mini(dx, dy)


# GDScript has no priority queue, so a small binary min-heap of [cell, priority] pairs.
class MinHeap:
	var _items: Array = []

	func is_empty() -> bool:
		return _items.is_empty()

	func push(cell: Vector2i, priority: float) -> void:
		_items.append([cell, priority])
		var i := _items.size() - 1
		while i > 0:
			var p := (i - 1) >> 1
			if _items[p][1] <= _items[i][1]:
				break
			_swap(i, p)
			i = p

	func pop() -> Array:
		var top: Array = _items[0]
		var last: Array = _items.pop_back()
		if not _items.is_empty():
			_items[0] = last
			var i := 0
			while true:
				var smallest := i
				for child in [i * 2 + 1, i * 2 + 2]:
					if child < _items.size() and _items[child][1] < _items[smallest][1]:
						smallest = child
				if smallest == i:
					break
				_swap(i, smallest)
				i = smallest
		return top

	func _swap(a: int, b: int) -> void:
		var tmp: Array = _items[a]
		_items[a] = _items[b]
		_items[b] = tmp
```

```cpp [Unreal (C++)]
// GridPathfinder.h: plain C++ with no UObject, so it can be unit tested with automation tests.
#pragma once

#include "CoreMinimal.h"

class FGridPathfinder
{
public:
	static constexpr float Wall = TNumericLimits<float>::Max();

	// Cost per cell, row-major (index = Y * Width + X). Wall marks a blocked cell.
	FGridPathfinder(TArray<float> InCost, int32 InWidth, int32 InHeight);

	bool FindPath(FIntPoint Start, FIntPoint Goal, TArray<FIntPoint>& OutPath);

private:
	struct FOpenNode { FIntPoint Cell; float F; };

	int32 Index(FIntPoint C) const { return C.Y * Width + C.X; }
	bool Walkable(FIntPoint C) const
	{
		return C.X >= 0 && C.Y >= 0 && C.X < Width && C.Y < Height && Cost[Index(C)] != Wall;
	}
	static float Octile(FIntPoint A, FIntPoint B)
	{
		const int32 DX = FMath::Abs(A.X - B.X), DY = FMath::Abs(A.Y - B.Y);
		return FMath::Max(DX, DY) + 0.41421356f * FMath::Min(DX, DY);
	}
	void Touch(FIntPoint N, float GValue, FIntPoint From);

	TArray<float> Cost;
	int32 Width, Height;

	// Reused between searches to avoid allocations.
	TArray<float> G;
	TArray<FIntPoint> Parent;
	TArray<int32> Stamp;
	int32 CurrentStamp = 0;
	TArray<FOpenNode> Open;                    // binary heap via TArray::HeapPush / HeapPop
};

// GridPathfinder.cpp
#include "GridPathfinder.h"
#include "Algo/Reverse.h"

static const FIntPoint Directions[] = {
	{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1},
};

FGridPathfinder::FGridPathfinder(TArray<float> InCost, int32 InWidth, int32 InHeight)
	: Cost(MoveTemp(InCost)), Width(InWidth), Height(InHeight)
{
	G.SetNumUninitialized(Width * Height);
	Parent.SetNumUninitialized(Width * Height);
	Stamp.SetNumZeroed(Width * Height);
}

bool FGridPathfinder::FindPath(FIntPoint Start, FIntPoint Goal, TArray<FIntPoint>& OutPath)
{
	OutPath.Reset();
	if (!Walkable(Goal)) return false;

	++CurrentStamp;                          // "clears" G/Parent without touching every cell
	Open.Reset();
	auto ByF = [](const FOpenNode& A, const FOpenNode& B) { return A.F < B.F; };
	Touch(Start, 0.f, Start);
	Open.HeapPush({Start, Octile(Start, Goal)}, ByF);

	while (Open.Num() > 0)
	{
		FOpenNode Node;
		Open.HeapPop(Node, ByF, EAllowShrinking::No);
		const FIntPoint Current = Node.Cell;
		if (Current == Goal)
		{
			for (FIntPoint N = Goal; N != Start; N = Parent[Index(N)]) OutPath.Add(N);
			OutPath.Add(Start);
			Algo::Reverse(OutPath);
			return true;
		}
		if (Node.F > G[Index(Current)] + Octile(Current, Goal) + 0.0001f) continue;   // stale entry

		for (const FIntPoint& D : Directions)
		{
			const FIntPoint Next = Current + D;
			if (!Walkable(Next)) continue;
			const bool bDiagonal = D.X != 0 && D.Y != 0;
			if (bDiagonal && (!Walkable({Current.X + D.X, Current.Y}) || !Walkable({Current.X, Current.Y + D.Y})))
				continue;                        // don't cut corners through walls

			const float Step = (bDiagonal ? 1.41421356f : 1.f) * Cost[Index(Next)];
			const float Tentative = G[Index(Current)] + Step;
			if (Stamp[Index(Next)] != CurrentStamp || Tentative < G[Index(Next)])
			{
				Touch(Next, Tentative, Current);
				Open.HeapPush({Next, Tentative + Octile(Next, Goal)}, ByF);   // duplicates are skipped as stale
			}
		}
	}
	return false;                            // no path
}

void FGridPathfinder::Touch(FIntPoint N, float GValue, FIntPoint From)
{
	const int32 I = Index(N);
	Stamp[I] = CurrentStamp;
	G[I] = GValue;
	Parent[I] = From;
}
```

:::

### Engine wiring

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Tilemaps;

// Builds the cost grid from Tilemaps and draws the path between two markers in the Scene view.
public class TilemapPathfinder : MonoBehaviour
{
    [SerializeField] Tilemap walls;
    [SerializeField] Tilemap mud;                // optional: cells painted here cost 3
    [SerializeField] Transform start, goal;

    GridPathfinder pathfinder;
    BoundsInt bounds;
    readonly List<(int x, int y)> path = new();

    void Awake()
    {
        bounds = walls.cellBounds;
        var cost = new float[bounds.size.x, bounds.size.y];
        for (int x = 0; x < bounds.size.x; x++)
            for (int y = 0; y < bounds.size.y; y++)
            {
                var cell = new Vector3Int(bounds.xMin + x, bounds.yMin + y, 0);
                cost[x, y] = walls.HasTile(cell) ? float.PositiveInfinity
                           : mud != null && mud.HasTile(cell) ? 3f : 1f;
            }
        pathfinder = new GridPathfinder(cost);
    }

    (int x, int y) ToGrid(Vector3 world)
    {
        var cell = walls.WorldToCell(world);
        return (cell.x - bounds.xMin, cell.y - bounds.yMin);
    }

    Vector3 ToWorld((int x, int y) p) =>
        walls.GetCellCenterWorld(new Vector3Int(p.x + bounds.xMin, p.y + bounds.yMin, 0));

    void OnDrawGizmos()
    {
        if (pathfinder == null || start == null || goal == null) return;
        if (!pathfinder.FindPath(ToGrid(start.position), ToGrid(goal.position), path)) return;
        Gizmos.color = Color.yellow;
        for (int i = 1; i < path.Count; i++) Gizmos.DrawLine(ToWorld(path[i - 1]), ToWorld(path[i]));
    }
}
```

```gdscript [Godot (GDScript)]
# tilemap_pathfinder.gd: builds the cost grid from TileMapLayers and draws the path between two markers.
extends Node2D

@export var walls: TileMapLayer
@export var mud: TileMapLayer  # optional: cells painted here cost 3
@export var start_marker: Node2D
@export var goal_marker: Node2D

var _pathfinder: GridPathfinder
var _origin: Vector2i
var _path: Array[Vector2i] = []


func _ready() -> void:
	var rect := walls.get_used_rect()
	_origin = rect.position
	var cost := PackedFloat32Array()
	cost.resize(rect.size.x * rect.size.y)
	for y in rect.size.y:
		for x in rect.size.x:
			var cell := _origin + Vector2i(x, y)
			var c := 1.0
			if walls.get_cell_source_id(cell) != -1:
				c = INF
			elif mud and mud.get_cell_source_id(cell) != -1:
				c = 3.0
			cost[y * rect.size.x + x] = c
	_pathfinder = GridPathfinder.new(cost, rect.size.x, rect.size.y)


func _process(_delta: float) -> void:
	# Recomputed every frame so the markers can be dragged around; cache it in a real game.
	_path = _pathfinder.find_path(_to_grid(start_marker.global_position), _to_grid(goal_marker.global_position))
	queue_redraw()


func _draw() -> void:
	for i in range(1, _path.size()):
		draw_line(_to_local_point(_path[i - 1]), _to_local_point(_path[i]), Color.YELLOW, 2.0)


func _to_grid(world: Vector2) -> Vector2i:
	return walls.local_to_map(walls.to_local(world)) - _origin


func _to_local_point(cell: Vector2i) -> Vector2:
	return to_local(walls.to_global(walls.map_to_local(cell + _origin)))
```

```cpp [Unreal (C++)]
// GridPathActor.h: builds a cost grid by testing each cell for blocking geometry,
// then draws the path between two actors.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GridPathfinder.h"
#include "GridPathActor.generated.h"

UCLASS()
class AGridPathActor : public AActor
{
	GENERATED_BODY()

public:
	AGridPathActor() { PrimaryActorTick.bCanEverTick = true; }

	UPROPERTY(EditAnywhere, Category = "Grid") FIntPoint GridSize = {40, 40};
	UPROPERTY(EditAnywhere, Category = "Grid") float CellSize = 100.f;
	UPROPERTY(EditAnywhere, Category = "Grid") TObjectPtr<AActor> StartActor;
	UPROPERTY(EditAnywhere, Category = "Grid") TObjectPtr<AActor> GoalActor;

protected:
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

private:
	FIntPoint ToCell(const FVector& World) const;
	FVector ToWorld(FIntPoint Cell) const;

	TUniquePtr<FGridPathfinder> Pathfinder;
	TArray<FIntPoint> Path;
};

// GridPathActor.cpp
#include "GridPathActor.h"
#include "DrawDebugHelpers.h"

void AGridPathActor::BeginPlay()
{
	Super::BeginPlay();
	TArray<float> Cost;
	Cost.Init(1.f, GridSize.X * GridSize.Y);
	// A box a little smaller than the cell, raised off the floor so the floor itself doesn't count.
	const FCollisionShape Probe = FCollisionShape::MakeBox(FVector(CellSize * 0.45f, CellSize * 0.45f, 40.f));
	for (int32 Y = 0; Y < GridSize.Y; ++Y)
		for (int32 X = 0; X < GridSize.X; ++X)
			if (GetWorld()->OverlapBlockingTestByChannel(ToWorld({X, Y}), FQuat::Identity, ECC_WorldStatic, Probe))
				Cost[Y * GridSize.X + X] = FGridPathfinder::Wall;
	Pathfinder = MakeUnique<FGridPathfinder>(MoveTemp(Cost), GridSize.X, GridSize.Y);
}

void AGridPathActor::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!Pathfinder || !StartActor || !GoalActor) return;
	if (!Pathfinder->FindPath(ToCell(StartActor->GetActorLocation()), ToCell(GoalActor->GetActorLocation()), Path)) return;
	for (int32 I = 1; I < Path.Num(); ++I)
		DrawDebugLine(GetWorld(), ToWorld(Path[I - 1]), ToWorld(Path[I]), FColor::Yellow, false, -1.f, 0, 4.f);
}

FIntPoint AGridPathActor::ToCell(const FVector& World) const
{
	const FVector Local = World - GetActorLocation();
	return {FMath::FloorToInt(Local.X / CellSize), FMath::FloorToInt(Local.Y / CellSize)};
}

FVector AGridPathActor::ToWorld(FIntPoint Cell) const
{
	return GetActorLocation() + FVector((Cell.X + 0.5f) * CellSize, (Cell.Y + 0.5f) * CellSize, 100.f);
}
```

:::

**Engine notes**

- **Unity:** for 3D worlds, the **AI Navigation** package (NavMesh) runs A* over navmesh polygons for you. Grid positions are `(int x, int y)` tuples in the core so it needs no engine types; the wiring converts with `WorldToCell` and `GetCellCenterWorld`.
- **Godot:** `AStarGrid2D` is built in and covers this exact case (diagonal modes, per-cell weights, solid cells), and `NavigationServer` handles navmeshes. Writing it yourself, as above, is for custom rules or learning.
- **Unreal:** the **Navigation System** (Recast navmesh) handles most 3D pathfinding, and AIModule's `FGraphAStar` template runs A* over any graph you describe. `EAllowShrinking::No` needs Unreal Engine 5.4 or later; on older versions pass `false`.

Knowing A* still matters in every engine for grids, tactics games, custom graphs and understanding why a path looks odd.

## When to use

- Point-to-point routes for a few to a few hundred agents: RTS units, enemies, NPCs, tactics games.
- Any graph search with costs: road networks, dialogue state spaces, puzzle solving.

## When not to use

- Thousands of agents heading to the same goal. One [Flow Field](./flow-field) serves them all.
- Continuous 3D levels in Unity, Godot or Unreal. Each engine's built-in [Navigation Mesh](./navigation-mesh) already runs A* on a better graph.
- Open spaces with no obstacles. A straight line with [Steering](./steering-behaviors) is enough.

## Pitfalls

- **Inadmissible heuristics.** Overestimating (for example, Euclidean distance multiplied by 2) finds paths faster but not the shortest ones. Sometimes that is a useful trade-off ("weighted A*"), but make it a deliberate one.
- **Heuristics that do not match the costs.** If the cheapest terrain costs 0.5, a heuristic that assumes 1 per tile overestimates. Scale `h` by the minimum tile cost.
- **Allocation per search.** New dictionaries and lists per call create garbage. Reuse arrays, with stamps instead of clearing, as above.
- **Too many searches per frame.** Fifty units requesting paths in one frame cause a spike. Queue requests and spread them over frames ([Time Slicing](./time-slicing)), share paths for groups, or use a [flow field](./flow-field).
- **Zig-zag grid paths.** Raw grid paths look robotic. Smooth them by removing waypoints that are in direct line of sight of each other, and follow them with [Steering Behaviors](./steering-behaviors).
- **Unreachable goals.** A* explores the whole reachable area before giving up. Check connectivity first (precomputed region IDs), or cap the number of expanded nodes.

## Related

- [Steering Behaviors](./steering-behaviors) — follow the path smoothly, and avoid other agents locally.
- [Spatial Partition](./spatial-partition) — grids and hierarchies that A* searches over.
- [Navigation Mesh](./navigation-mesh) — A* over polygons instead of cells, for 3D worlds.
- [Flow Field](./flow-field) — one search shared by thousands of units heading to the same goal.
- [Enemy AI](../recipes/enemy-ai) — pathfinding inside a complete AI.
