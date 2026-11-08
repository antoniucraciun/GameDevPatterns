# BSP Dungeon Generation

> Recursively split space into rooms and connect them with corridors.

**Category:** Data, Content & Procedural Generation

## Problem

A roguelike needs a new dungeon every run: rectangular rooms that do not overlap, spread across the map, all reachable, with corridors between them. Placing rooms at random positions leads to overlaps, clusters and empty areas, and connecting arbitrary rooms produces corridors that cross everywhere. You want a layout that feels *architectural*, varies every time, and is guaranteed connected.

## Solution

Use **binary space partitioning (BSP)**: recursively split the map into smaller rectangles, put one room in each final rectangle, and connect rooms following the split tree.

1. **Split.** Start with the whole map as one rectangle. Split it horizontally or vertically at a random position, giving two children. Repeat for each child until rectangles are near a minimum size. Splitting along the longer side keeps proportions reasonable.
2. **Rooms.** In each leaf rectangle, place a room of random size and position *inside* it, with a margin. Because leaves never overlap, rooms never overlap.
3. **Corridors.** Walking back up the tree, connect each pair of siblings: one room from the left subtree to one from the right, with an L-shaped corridor. Because every split gets one connection, the whole dungeon is connected.
4. **Decorate.** Choose the start and exit rooms (for example, the two furthest apart), then place enemies, loot and keys.

The tree is also useful afterwards. Siblings are near each other, so sections of the tree make natural "areas" or difficulty zones.

<BspDungeonViz />

## Pseudocode

```text
Node:
    area                   // the rectangle this node covers
    left, right            // children; none for a leaf
    room                   // leaves only

generate(width, height):   // one random stream, seeded once
    root ← Node(area = whole map)
    split(root); create_rooms(root); connect(root)

split(node):
    can split horizontally ← node.area.height ≥ 2 × min leaf size
    can split vertically   ← node.area.width  ≥ 2 × min leaf size
    if neither: return     // small enough: a leaf
    choose the longer side if both are possible (random if square)
    cut ← random between min leaf size and that side - min leaf size
    left, right ← the two halves of node.area on either side of cut
    split(left); split(right)

create_rooms(node):
    if node is not a leaf: create_rooms(left); create_rooms(right); return
    w ← random from area.width / 2  to area.width  - 2 × margin
    h ← random from area.height / 2 to area.height - 2 × margin
    node.room ← a w × h rectangle at a random spot inside area, margin from its edges
    add node.room to rooms             // leaves never overlap, so rooms never do

connect(node):             // returns one room from this subtree
    if node is a leaf: return node.room
    a ← connect(left)      // left first: a fixed order of random draws
    b ← connect(right)
    add a corridor from a's centre to b's centre    // one link per split
    return a or b, at random            // vary which room links upward

to_grid():
    mark every cell of every room as floor
    for each corridor (from, to):       // L-shaped
        mark floor along row from.y, between from.x and to.x
        mark floor along column to.x, between from.y and to.y
```

## Example

The **core** splits the map, places a room in each leaf and connects sibling subtrees, all from one seeded random stream, so the same seed always gives the same dungeon. The **engine wiring** paints the floor grid into a tilemap or instanced meshes.

### Core

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public class BspDungeon
{
    class Node
    {
        public RectInt Area;
        public Node Left, Right;
        public RectInt? Room;
        public bool IsLeaf => Left == null;
    }

    readonly System.Random rng;
    readonly int minLeafSize, roomMargin;

    public readonly List<RectInt> Rooms = new();
    public readonly List<(Vector2Int from, Vector2Int to)> Corridors = new();

    public BspDungeon(int seed, int minLeafSize = 10, int roomMargin = 2)
    {
        rng = new System.Random(seed);
        this.minLeafSize = minLeafSize;
        this.roomMargin = roomMargin;
    }

    public void Generate(int width, int height)
    {
        var root = new Node { Area = new RectInt(0, 0, width, height) };
        Split(root);
        CreateRooms(root);
        Connect(root);
    }

    void Split(Node node)
    {
        var a = node.Area;
        bool canSplitH = a.height >= minLeafSize * 2;
        bool canSplitV = a.width >= minLeafSize * 2;
        if (!canSplitH && !canSplitV) return;                    // small enough: this is a leaf

        // Prefer splitting the longer side, so leaves stay roughly square.
        bool horizontal = canSplitH && (!canSplitV || a.height > a.width || (a.height == a.width && rng.Next(2) == 0));

        if (horizontal)
        {
            int cut = rng.Next(minLeafSize, a.height - minLeafSize + 1);
            node.Left  = new Node { Area = new RectInt(a.x, a.y, a.width, cut) };
            node.Right = new Node { Area = new RectInt(a.x, a.y + cut, a.width, a.height - cut) };
        }
        else
        {
            int cut = rng.Next(minLeafSize, a.width - minLeafSize + 1);
            node.Left  = new Node { Area = new RectInt(a.x, a.y, cut, a.height) };
            node.Right = new Node { Area = new RectInt(a.x + cut, a.y, a.width - cut, a.height) };
        }
        Split(node.Left);
        Split(node.Right);
    }

    void CreateRooms(Node node)
    {
        if (!node.IsLeaf) { CreateRooms(node.Left); CreateRooms(node.Right); return; }

        var a = node.Area;
        int w = rng.Next(a.width / 2, a.width - roomMargin * 2 + 1);
        int h = rng.Next(a.height / 2, a.height - roomMargin * 2 + 1);
        int x = rng.Next(a.x + roomMargin, a.xMax - roomMargin - w + 1);
        int y = rng.Next(a.y + roomMargin, a.yMax - roomMargin - h + 1);
        node.Room = new RectInt(x, y, w, h);
        Rooms.Add(node.Room.Value);
    }

    // Connect the two subtrees of every internal node; returns a room from this subtree.
    RectInt Connect(Node node)
    {
        if (node.IsLeaf) return node.Room.Value;
        RectInt left = Connect(node.Left), right = Connect(node.Right);
        Corridors.Add((Vector2Int.FloorToInt(left.center), Vector2Int.FloorToInt(right.center)));
        return rng.Next(2) == 0 ? left : right;                  // vary which room links upward
    }

    // Rasterise into a grid: true = floor. Corridors are L-shaped (horizontal, then vertical).
    public bool[,] ToGrid(int width, int height)
    {
        var floor = new bool[width, height];
        foreach (var r in Rooms)
            for (int x = r.xMin; x < r.xMax; x++)
            for (int y = r.yMin; y < r.yMax; y++) floor[x, y] = true;

        foreach (var (from, to) in Corridors)
        {
            for (int x = Mathf.Min(from.x, to.x); x <= Mathf.Max(from.x, to.x); x++) floor[x, from.y] = true;
            for (int y = Mathf.Min(from.y, to.y); y <= Mathf.Max(from.y, to.y); y++) floor[to.x, y] = true;
        }
        return floor;
    }
}
```

```gdscript [Godot (GDScript)]
# bsp_dungeon.gd
class_name BspDungeon
extends RefCounted


class BspNode:  # not "Node", which would shadow Godot's Node class
	var area: Rect2i
	var left: BspNode
	var right: BspNode
	var room: Rect2i

	func is_leaf() -> bool:
		return left == null


var rooms: Array[Rect2i] = []
var corridors := []  # pairs: [from: Vector2i, to: Vector2i]

var _rng := RandomNumberGenerator.new()
var _min_leaf_size: int
var _room_margin: int


func _init(world_seed: int, min_leaf_size := 10, room_margin := 2) -> void:
	_rng.seed = world_seed
	_min_leaf_size = min_leaf_size
	_room_margin = room_margin


func generate(width: int, height: int) -> void:
	var root := BspNode.new()
	root.area = Rect2i(0, 0, width, height)
	_split(root)
	_create_rooms(root)
	_connect(root)


func _split(node: BspNode) -> void:
	var a := node.area
	var can_split_h := a.size.y >= _min_leaf_size * 2
	var can_split_v := a.size.x >= _min_leaf_size * 2
	if not can_split_h and not can_split_v:
		return  # small enough: this is a leaf

	# Prefer splitting the longer side, so leaves stay roughly square.
	var horizontal := can_split_h and (not can_split_v or a.size.y > a.size.x \
			or (a.size.y == a.size.x and _rng.randi_range(0, 1) == 0))

	node.left = BspNode.new()
	node.right = BspNode.new()
	if horizontal:
		var cut := _rng.randi_range(_min_leaf_size, a.size.y - _min_leaf_size)  # inclusive bounds
		node.left.area = Rect2i(a.position.x, a.position.y, a.size.x, cut)
		node.right.area = Rect2i(a.position.x, a.position.y + cut, a.size.x, a.size.y - cut)
	else:
		var cut := _rng.randi_range(_min_leaf_size, a.size.x - _min_leaf_size)
		node.left.area = Rect2i(a.position.x, a.position.y, cut, a.size.y)
		node.right.area = Rect2i(a.position.x + cut, a.position.y, a.size.x - cut, a.size.y)
	_split(node.left)
	_split(node.right)


func _create_rooms(node: BspNode) -> void:
	if not node.is_leaf():
		_create_rooms(node.left)
		_create_rooms(node.right)
		return

	var a := node.area
	var w := _rng.randi_range(floori(a.size.x / 2.0), a.size.x - _room_margin * 2)
	var h := _rng.randi_range(floori(a.size.y / 2.0), a.size.y - _room_margin * 2)
	var x := _rng.randi_range(a.position.x + _room_margin, a.end.x - _room_margin - w)
	var y := _rng.randi_range(a.position.y + _room_margin, a.end.y - _room_margin - h)
	node.room = Rect2i(x, y, w, h)
	rooms.append(node.room)


# Connect the two subtrees of every internal node; returns a room from this subtree.
func _connect(node: BspNode) -> Rect2i:
	if node.is_leaf():
		return node.room
	var left_room := _connect(node.left)
	var right_room := _connect(node.right)
	corridors.append([left_room.get_center(), right_room.get_center()])
	return left_room if _rng.randi_range(0, 1) == 0 else right_room  # vary which room links upward


## Row-major grid (index y * width + x): 1 = floor. Corridors are L-shaped (horizontal, then vertical).
func to_grid(width: int, height: int) -> PackedByteArray:
	var cells := PackedByteArray()  # not "floor", which would shadow the built-in floor()
	cells.resize(width * height)
	for r in rooms:
		for x in range(r.position.x, r.end.x):
			for y in range(r.position.y, r.end.y):
				cells[y * width + x] = 1

	for pair in corridors:
		var from: Vector2i = pair[0]
		var to: Vector2i = pair[1]
		for x in range(mini(from.x, to.x), maxi(from.x, to.x) + 1):
			cells[from.y * width + x] = 1
		for y in range(mini(from.y, to.y), maxi(from.y, to.y) + 1):
			cells[y * width + to.x] = 1
	return cells
```

```cpp [Unreal (C++)]
// BspDungeon.h: plain C++, no UObject.
#pragma once

#include "CoreMinimal.h"

class FBspDungeon
{
public:
	explicit FBspDungeon(int32 Seed, int32 InMinLeafSize = 10, int32 InRoomMargin = 2)
		: Rng(Seed), MinLeafSize(InMinLeafSize), RoomMargin(InRoomMargin) {}

	void Generate(int32 Width, int32 Height);

	// Row-major grid (index Y * Width + X): true = floor. Corridors are L-shaped (horizontal, then vertical).
	TArray<bool> ToGrid(int32 Width, int32 Height) const;

	TArray<FIntRect> Rooms;                              // Min inclusive, Max exclusive
	TArray<TPair<FIntPoint, FIntPoint>> Corridors;

private:
	struct FNode
	{
		FIntRect Area;
		TUniquePtr<FNode> Left, Right;
		FIntRect Room;
		bool IsLeaf() const { return !Left; }
	};

	void Split(FNode& Node);
	void CreateRooms(FNode& Node);
	FIntRect Connect(const FNode& Node);
	static FIntPoint Center(const FIntRect& R) { return {R.Min.X + R.Width() / 2, R.Min.Y + R.Height() / 2}; }

	FRandomStream Rng;
	int32 MinLeafSize, RoomMargin;
};

// BspDungeon.cpp
#include "BspDungeon.h"

void FBspDungeon::Generate(int32 Width, int32 Height)
{
	FNode Root;
	Root.Area = FIntRect(0, 0, Width, Height);
	Split(Root);
	CreateRooms(Root);
	Connect(Root);
}

void FBspDungeon::Split(FNode& Node)
{
	const FIntRect A = Node.Area;
	const bool bCanSplitH = A.Height() >= MinLeafSize * 2;
	const bool bCanSplitV = A.Width() >= MinLeafSize * 2;
	if (!bCanSplitH && !bCanSplitV) return;              // small enough: this is a leaf

	// Prefer splitting the longer side, so leaves stay roughly square.
	const bool bHorizontal = bCanSplitH && (!bCanSplitV || A.Height() > A.Width()
		|| (A.Height() == A.Width() && Rng.RandRange(0, 1) == 0));

	Node.Left = MakeUnique<FNode>();
	Node.Right = MakeUnique<FNode>();
	if (bHorizontal)
	{
		const int32 Cut = A.Min.Y + Rng.RandRange(MinLeafSize, A.Height() - MinLeafSize);   // inclusive bounds
		Node.Left->Area = FIntRect(A.Min.X, A.Min.Y, A.Max.X, Cut);
		Node.Right->Area = FIntRect(A.Min.X, Cut, A.Max.X, A.Max.Y);
	}
	else
	{
		const int32 Cut = A.Min.X + Rng.RandRange(MinLeafSize, A.Width() - MinLeafSize);
		Node.Left->Area = FIntRect(A.Min.X, A.Min.Y, Cut, A.Max.Y);
		Node.Right->Area = FIntRect(Cut, A.Min.Y, A.Max.X, A.Max.Y);
	}
	Split(*Node.Left);
	Split(*Node.Right);
}

void FBspDungeon::CreateRooms(FNode& Node)
{
	if (!Node.IsLeaf()) { CreateRooms(*Node.Left); CreateRooms(*Node.Right); return; }

	const FIntRect A = Node.Area;
	const int32 W = Rng.RandRange(A.Width() / 2, A.Width() - RoomMargin * 2);
	const int32 H = Rng.RandRange(A.Height() / 2, A.Height() - RoomMargin * 2);
	const int32 X = Rng.RandRange(A.Min.X + RoomMargin, A.Max.X - RoomMargin - W);
	const int32 Y = Rng.RandRange(A.Min.Y + RoomMargin, A.Max.Y - RoomMargin - H);
	Node.Room = FIntRect(X, Y, X + W, Y + H);
	Rooms.Add(Node.Room);
}

FIntRect FBspDungeon::Connect(const FNode& Node)
{
	if (Node.IsLeaf()) return Node.Room;
	// Two statements, not one expression: C++ doesn't fix the order of evaluation inside one,
	// and the order of random draws must be fixed for the seed to reproduce the dungeon.
	const FIntRect Left = Connect(*Node.Left);
	const FIntRect Right = Connect(*Node.Right);
	Corridors.Emplace(Center(Left), Center(Right));
	return Rng.RandRange(0, 1) == 0 ? Left : Right;      // vary which room links upward
}

TArray<bool> FBspDungeon::ToGrid(int32 Width, int32 Height) const
{
	TArray<bool> Floor;
	Floor.Init(false, Width * Height);
	for (const FIntRect& R : Rooms)
		for (int32 X = R.Min.X; X < R.Max.X; ++X)
			for (int32 Y = R.Min.Y; Y < R.Max.Y; ++Y) Floor[Y * Width + X] = true;

	for (const TPair<FIntPoint, FIntPoint>& C : Corridors)
	{
		const FIntPoint From = C.Key, To = C.Value;
		for (int32 X = FMath::Min(From.X, To.X); X <= FMath::Max(From.X, To.X); ++X) Floor[From.Y * Width + X] = true;
		for (int32 Y = FMath::Min(From.Y, To.Y); Y <= FMath::Max(From.Y, To.Y); ++Y) Floor[Y * Width + To.X] = true;
	}
	return Floor;
}
```

:::

### Engine wiring

::: code-group

```csharp [Unity (C#)]
using UnityEngine;
using UnityEngine.Tilemaps;

public class DungeonTilemap : MonoBehaviour
{
    [SerializeField] Tilemap tilemap;
    [SerializeField] TileBase floorTile, wallTile;
    [SerializeField] int width = 80, height = 50, seed = 7;

    public BspDungeon Dungeon { get; private set; }

    void Start()
    {
        Dungeon = new BspDungeon(seed);
        Dungeon.Generate(width, height);
        var floor = Dungeon.ToGrid(width, height);

        tilemap.ClearAllTiles();
        for (int x = 0; x < width; x++)
        for (int y = 0; y < height; y++)
            tilemap.SetTile(new Vector3Int(x, y, 0), floor[x, y] ? floorTile : wallTile);
        // Start room = Dungeon.Rooms[0], exit = the room furthest from it (BFS over the floor grid).
    }
}
```

```gdscript [Godot (GDScript)]
# dungeon_map.gd: writes the dungeon into a TileMapLayer (Godot 4.3+).
extends TileMapLayer

@export var width := 80
@export var height := 50
@export var world_seed := 7
@export var floor_tile := Vector2i(0, 0)  # atlas coords in source 0
@export var wall_tile := Vector2i(1, 0)

var dungeon: BspDungeon


func _ready() -> void:
	dungeon = BspDungeon.new(world_seed)
	dungeon.generate(width, height)
	var cells := dungeon.to_grid(width, height)

	clear()
	for y in height:
		for x in width:
			set_cell(Vector2i(x, y), 0, floor_tile if cells[y * width + x] == 1 else wall_tile)
	# Start room = dungeon.rooms[0], exit = the room furthest from it (BFS over the floor grid).
```

```cpp [Unreal (C++)]
// DungeonActor.h: floors and walls as two instanced static meshes.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DungeonActor.generated.h"

class UInstancedStaticMeshComponent;

UCLASS()
class ADungeonActor : public AActor
{
	GENERATED_BODY()

public:
	ADungeonActor();

	UPROPERTY(VisibleAnywhere, Category = "Dungeon") TObjectPtr<UInstancedStaticMeshComponent> Floors;
	UPROPERTY(VisibleAnywhere, Category = "Dungeon") TObjectPtr<UInstancedStaticMeshComponent> Walls;
	UPROPERTY(EditAnywhere, Category = "Dungeon") int32 Width = 80;
	UPROPERTY(EditAnywhere, Category = "Dungeon") int32 Height = 50;
	UPROPERTY(EditAnywhere, Category = "Dungeon") int32 Seed = 7;
	UPROPERTY(EditAnywhere, Category = "Dungeon") float CellSize = 100.f;

protected:
	virtual void BeginPlay() override;
};

// DungeonActor.cpp
#include "DungeonActor.h"
#include "BspDungeon.h"
#include "Components/InstancedStaticMeshComponent.h"

ADungeonActor::ADungeonActor()
{
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	Floors = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("Floors"));
	Floors->SetupAttachment(RootComponent);
	Walls = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("Walls"));
	Walls->SetupAttachment(RootComponent);
}

void ADungeonActor::BeginPlay()
{
	Super::BeginPlay();
	FBspDungeon Dungeon(Seed);
	Dungeon.Generate(Width, Height);
	const TArray<bool> Floor = Dungeon.ToGrid(Width, Height);

	for (int32 Y = 0; Y < Height; ++Y)
		for (int32 X = 0; X < Width; ++X)
		{
			const FTransform Cell(FVector(X * CellSize, Y * CellSize, 0.f));
			(Floor[Y * Width + X] ? Floors : Walls)->AddInstance(Cell);
		}
	// Start room = Dungeon.Rooms[0], exit = the room furthest from it (BFS over the floor grid).
}
```

:::

**Engine notes**

- **Unity:** `RectInt` and `Vector2Int` cover the geometry. For big maps, fill a `TileBase[]` and call `Tilemap.SetTilesBlock` once instead of `SetTile` per cell, and use a Rule Tile for walls. `System.Random(seed)` is repeatable on a given .NET runtime; see [Seeded Randomness](./seeded-randomness) for a generator that is identical everywhere.
- **Godot:** `Rect2i` has `end` (exclusive) and `get_center()` (integer, rounds down). `randi_range` includes both bounds, unlike C#'s `Random.Next`, so the `+ 1`s disappear. `TileMapLayer` is Godot 4.3+; terrains can autotile the walls.
- **Unreal:** `FIntRect` stores `Min`/`Max` corners rather than position and size, and `FRandomStream::RandRange` includes both bounds. In C++, keep each random draw in its own statement: the order in which function arguments are evaluated is unspecified, which silently breaks seed reproducibility.

## When to use

- Roguelikes and dungeon crawlers with rectangular rooms and corridors.
- Building interiors, space stations, office floors: any layout of non-overlapping rooms.
- As a base layout that other techniques decorate ([Cellular Automata](./cellular-automata) to roughen walls, [Wave Function Collapse](./wave-function-collapse) for room interiors).

## When not to use

- Organic spaces such as caves or forests. Use [Cellular Automata](./cellular-automata) or [Noise](./noise-generation).
- Open-world terrain.
- Dungeons that need non-rectangular or hand-crafted rooms. Place authored room templates (prefabs or scenes) instead.

## Pitfalls

- **Grid-like sameness.** Pure BSP gives a recognisable "boxes and corridors" look. Vary room shapes, skip some leaves (no room), merge neighbouring leaves, or add extra loops by connecting a few non-sibling rooms.
- **Corridors through rooms.** L-shaped corridors can cut through other rooms. Usually this is acceptable, or even desirable, because it adds doors. Otherwise route corridors with A* that avoids rooms.
- **Room size bounds.** If `minLeafSize` is smaller than twice the margin plus the minimum room size, `rng.Next` gets an invalid range. Validate parameters up front.
- **Only tree connections.** Tree connections guarantee reachability but no loops, and a dungeon without loops feels linear. Add a few extra corridors between nearby rooms.
- **Gameplay placement.** A layout is not a level. Place the start, exit, keys and difficulty deliberately, for example using distance from the start along the floor grid.

## Related

- [Seeded Randomness](./seeded-randomness) — reproducible dungeons and daily runs.
- [Cellular Automata](./cellular-automata) and [Wave Function Collapse](./wave-function-collapse) — combined with BSP for detail.
- [A* Pathfinding](./a-star) — routing corridors, and checking distances between rooms.
- [Spatial Partition](./spatial-partition) — BSP is also a spatial partition, used for rendering and queries.
