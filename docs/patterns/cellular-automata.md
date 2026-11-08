# Cellular Automata

> Iterate simple neighbour rules over a grid to grow caves and organic shapes.

**Category:** Data, Content & Procedural Generation

## Problem

A roguelike or mining game needs caves: organic, irregular, connected spaces. Random noise produces speckled static rather than chambers. Hand-carving rooms and corridors looks too architectural. Noise-based terrain gives smooth hills, not enclosed tunnels. You want something that *looks* eroded and natural, in a few lines of code.

## Solution

Start with a random grid, then repeatedly apply a **local rule** to every cell based on its neighbours, all cells at once. Over a few iterations, noise **smooths into blobs** of wall and open space.

The classic cave rule:

1. **Random fill.** Each cell is a wall with probability around 45%, and the borders are always walls.
2. **Smooth.** For each cell, count walls among its 8 neighbours. If 5 or more are walls, it becomes a wall. If 3 or fewer, it becomes floor. Otherwise it stays the same.
3. **Repeat** step 2 four to six times. Each pass works from the *previous* grid ([Double Buffer](./double-buffer)).
4. **Post-process.** Find connected regions with a flood fill, remove tiny ones, and either keep the largest cave or connect the regions with tunnels.

Tuning the fill percentage, the thresholds and the iteration count changes the character: open caverns, narrow tunnels or isolated pockets.

<CellularAutomataViz />

## Pseudocode

```text
// true = wall, false = floor
generate(width, height, seed, fill chance ← 0.45, iterations ← 5, min region size ← 30):
    for each attempt, with seed + attempt:      // too small a cave: try the next seed
        random ← generator seeded with seed + attempt

        // 1. Random fill, with solid borders.
        for each cell:
            map[cell] ← cell is on the border, or random value < fill chance

        // 2–3. Smooth with the 4-5 rule, reading only the previous grid.
        repeat iterations times:
            for each cell:
                if cell is on the border: next[cell] ← wall; continue
                walls ← walls among the 8 neighbours of cell in map
                next[cell] ← walls ≥ 5, or (walls = 4 and map[cell] is wall)
            swap map and next                   // double buffer

        // 4. Keep only the largest cave.
        regions ← floor_regions(map)
        fill every region except the largest with wall
        if the largest region has at least min region size cells:
            return map

floor_regions(map):        // flood fill, 4-connected
    for each floor cell s not yet seen:
        region ← [s]; mark s seen
        for each cell c in region, as region grows:
            for each up/down/left/right neighbour n of c:
                if n is inside, floor and not seen: mark n seen; add n to region
        add region to regions
    return regions
```

## Example

Cave generation with the 4-5 rule. The **core** fills the grid from a seed, smooths it, and keeps only the largest cave, so the same seed always gives the same cave. The **engine wiring** paints the walls into a tilemap or instanced meshes.

### Core

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public static class CaveGenerator
{
    // true = wall, false = floor
    public static bool[,] Generate(int width, int height, int seed,
                                   float fillChance = 0.45f, int iterations = 5, int minRegionSize = 30)
    {
        var rng = new System.Random(seed);
        var map = new bool[width, height];

        // 1. Random fill, with solid borders.
        for (int x = 0; x < width; x++)
        for (int y = 0; y < height; y++)
            map[x, y] = IsBorder(x, y, width, height) || rng.NextDouble() < fillChance;

        // 2–3. Smooth with the 4-5 rule, double buffered.
        var next = new bool[width, height];
        for (int i = 0; i < iterations; i++)
        {
            for (int x = 0; x < width; x++)
            for (int y = 0; y < height; y++)
            {
                if (IsBorder(x, y, width, height)) { next[x, y] = true; continue; }
                int walls = WallNeighbours(map, x, y);
                next[x, y] = walls >= 5 || (walls > 3 && map[x, y]);
            }
            (map, next) = (next, map);                       // swap buffers
        }

        // 4. Keep only the largest cave: fill every smaller floor region with wall.
        var regions = FloorRegions(map);
        regions.Sort((a, b) => b.Count.CompareTo(a.Count));
        for (int r = 1; r < regions.Count; r++)
            foreach (var c in regions[r]) map[c.x, c.y] = true;

        if (regions.Count == 0 || regions[0].Count < minRegionSize)
            return Generate(width, height, seed + 1, fillChance, iterations, minRegionSize);   // too small: retry
        return map;
    }

    static bool IsBorder(int x, int y, int w, int h) => x == 0 || y == 0 || x == w - 1 || y == h - 1;

    static int WallNeighbours(bool[,] map, int cx, int cy)
    {
        int count = 0;
        for (int x = cx - 1; x <= cx + 1; x++)
        for (int y = cy - 1; y <= cy + 1; y++)
            if ((x != cx || y != cy) && map[x, y]) count++;
        return count;
    }

    // Flood fill every connected floor region (4-connected).
    static List<List<Vector2Int>> FloorRegions(bool[,] map)
    {
        int w = map.GetLength(0), h = map.GetLength(1);
        var seen = new bool[w, h];
        var regions = new List<List<Vector2Int>>();
        var queue = new Queue<Vector2Int>();

        for (int sx = 0; sx < w; sx++)
        for (int sy = 0; sy < h; sy++)
        {
            if (map[sx, sy] || seen[sx, sy]) continue;
            var region = new List<Vector2Int>();
            queue.Enqueue(new Vector2Int(sx, sy));
            seen[sx, sy] = true;
            while (queue.Count > 0)
            {
                var c = queue.Dequeue();
                region.Add(c);
                foreach (var d in new[] { Vector2Int.up, Vector2Int.down, Vector2Int.left, Vector2Int.right })
                {
                    var n = c + d;
                    if (n.x < 0 || n.y < 0 || n.x >= w || n.y >= h || map[n.x, n.y] || seen[n.x, n.y]) continue;
                    seen[n.x, n.y] = true;
                    queue.Enqueue(n);
                }
            }
            regions.Add(region);
        }
        return regions;
    }
}
```

```gdscript [Godot (GDScript)]
# cave_generator.gd
class_name CaveGenerator
extends RefCounted

const NEIGHBOURS: Array[Vector2i] = [Vector2i.UP, Vector2i.DOWN, Vector2i.LEFT, Vector2i.RIGHT]


## Row-major grid (index y * width + x): 1 = wall, 0 = floor.
static func generate(width: int, height: int, world_seed: int,
		fill_chance := 0.45, iterations := 5, min_region_size := 30) -> PackedByteArray:
	for attempt in 100:  # a cave that's too small retries with the next seed
		var rng := RandomNumberGenerator.new()
		rng.seed = world_seed + attempt
		var map := PackedByteArray()
		map.resize(width * height)

		# 1. Random fill, with solid borders.
		for x in width:
			for y in height:
				map[y * width + x] = 1 if _is_border(x, y, width, height) or rng.randf() < fill_chance else 0

		# 2-3. Smooth with the 4-5 rule, double buffered.
		var next := PackedByteArray()
		next.resize(width * height)
		for i in iterations:
			for x in width:
				for y in height:
					var index := y * width + x
					if _is_border(x, y, width, height):
						next[index] = 1
						continue
					var walls := _wall_neighbours(map, width, x, y)
					next[index] = 1 if walls >= 5 or (walls > 3 and map[index] == 1) else 0
			var swap := map  # packed arrays are copy-on-write values, so swapping is safe
			map = next
			next = swap

		# 4. Keep only the largest cave: fill every smaller floor region with wall.
		var regions := _floor_regions(map, width, height)
		var largest := -1
		for r in regions.size():
			if largest == -1 or regions[r].size() > regions[largest].size():
				largest = r
		for r in regions.size():
			if r != largest:
				for c: Vector2i in regions[r]:
					map[c.y * width + c.x] = 1

		if largest != -1 and regions[largest].size() >= min_region_size:
			return map
	push_error("No cave of %d cells after 100 seeds" % min_region_size)
	return PackedByteArray()


static func _is_border(x: int, y: int, w: int, h: int) -> bool:
	return x == 0 or y == 0 or x == w - 1 or y == h - 1


static func _wall_neighbours(map: PackedByteArray, width: int, cx: int, cy: int) -> int:
	var count := 0
	for x in range(cx - 1, cx + 2):
		for y in range(cy - 1, cy + 2):
			if (x != cx or y != cy) and map[y * width + x] == 1:
				count += 1
	return count


# Flood fill every connected floor region (4-connected). Returns an Array of Array[Vector2i].
static func _floor_regions(map: PackedByteArray, width: int, height: int) -> Array:
	var seen := PackedByteArray()
	seen.resize(map.size())
	var regions := []
	for sx in width:
		for sy in height:
			var start := sy * width + sx
			if map[start] == 1 or seen[start] == 1:
				continue
			var region: Array[Vector2i] = [Vector2i(sx, sy)]
			seen[start] = 1
			var head := 0
			while head < region.size():  # the region doubles as the flood-fill queue
				var c := region[head]
				head += 1
				for d: Vector2i in NEIGHBOURS:
					var n := c + d
					if n.x < 0 or n.y < 0 or n.x >= width or n.y >= height:
						continue
					var ni := n.y * width + n.x
					if map[ni] == 1 or seen[ni] == 1:
						continue
					seen[ni] = 1
					region.append(n)
			regions.append(region)
	return regions
```

```cpp [Unreal (C++)]
// CaveGenerator.h: plain C++, no UObject.
#pragma once

#include "CoreMinimal.h"

class FCaveGenerator
{
public:
	// Row-major grid (index Y * Width + X): true = wall, false = floor.
	static TArray<bool> Generate(int32 Width, int32 Height, int32 Seed,
	                             float FillChance = 0.45f, int32 Iterations = 5, int32 MinRegionSize = 30);

private:
	static bool IsBorder(int32 X, int32 Y, int32 W, int32 H) { return X == 0 || Y == 0 || X == W - 1 || Y == H - 1; }
	static int32 WallNeighbours(const TArray<bool>& Map, int32 Width, int32 CX, int32 CY);
	static TArray<TArray<FIntPoint>> FloorRegions(const TArray<bool>& Map, int32 Width, int32 Height);
};

// CaveGenerator.cpp
#include "CaveGenerator.h"

TArray<bool> FCaveGenerator::Generate(int32 Width, int32 Height, int32 Seed,
                                      float FillChance, int32 Iterations, int32 MinRegionSize)
{
	for (int32 Attempt = 0; Attempt < 100; ++Attempt)   // a cave that's too small retries with the next seed
	{
		FRandomStream Rng(Seed + Attempt);
		TArray<bool> Map;
		Map.SetNumUninitialized(Width * Height);

		// 1. Random fill, with solid borders.
		for (int32 X = 0; X < Width; ++X)
			for (int32 Y = 0; Y < Height; ++Y)
				Map[Y * Width + X] = IsBorder(X, Y, Width, Height) || Rng.FRand() < FillChance;

		// 2-3. Smooth with the 4-5 rule, double buffered.
		TArray<bool> Next;
		Next.SetNumUninitialized(Width * Height);
		for (int32 I = 0; I < Iterations; ++I)
		{
			for (int32 X = 0; X < Width; ++X)
				for (int32 Y = 0; Y < Height; ++Y)
				{
					const int32 Index = Y * Width + X;
					if (IsBorder(X, Y, Width, Height)) { Next[Index] = true; continue; }
					const int32 Walls = WallNeighbours(Map, Width, X, Y);
					Next[Index] = Walls >= 5 || (Walls > 3 && Map[Index]);
				}
			Swap(Map, Next);
		}

		// 4. Keep only the largest cave: fill every smaller floor region with wall.
		TArray<TArray<FIntPoint>> Regions = FloorRegions(Map, Width, Height);
		int32 Largest = INDEX_NONE;
		for (int32 R = 0; R < Regions.Num(); ++R)
			if (Largest == INDEX_NONE || Regions[R].Num() > Regions[Largest].Num()) Largest = R;
		for (int32 R = 0; R < Regions.Num(); ++R)
			if (R != Largest)
				for (const FIntPoint& C : Regions[R]) Map[C.Y * Width + C.X] = true;

		if (Largest != INDEX_NONE && Regions[Largest].Num() >= MinRegionSize) return Map;
	}
	UE_LOG(LogTemp, Error, TEXT("No cave of %d cells after 100 seeds"), MinRegionSize);
	return {};
}

int32 FCaveGenerator::WallNeighbours(const TArray<bool>& Map, int32 Width, int32 CX, int32 CY)
{
	int32 Count = 0;
	for (int32 X = CX - 1; X <= CX + 1; ++X)
		for (int32 Y = CY - 1; Y <= CY + 1; ++Y)
			if ((X != CX || Y != CY) && Map[Y * Width + X]) ++Count;
	return Count;
}

TArray<TArray<FIntPoint>> FCaveGenerator::FloorRegions(const TArray<bool>& Map, int32 Width, int32 Height)
{
	static const FIntPoint Neighbours[] = {{0, 1}, {0, -1}, {-1, 0}, {1, 0}};
	TArray<bool> Seen;
	Seen.Init(false, Map.Num());
	TArray<TArray<FIntPoint>> Regions;

	for (int32 SX = 0; SX < Width; ++SX)
		for (int32 SY = 0; SY < Height; ++SY)
		{
			if (Map[SY * Width + SX] || Seen[SY * Width + SX]) continue;
			TArray<FIntPoint>& Region = Regions.AddDefaulted_GetRef();
			Region.Add({SX, SY});
			Seen[SY * Width + SX] = true;
			for (int32 Head = 0; Head < Region.Num(); ++Head)   // the region doubles as the flood-fill queue
				for (const FIntPoint& D : Neighbours)
				{
					const FIntPoint N = Region[Head] + D;
					if (N.X < 0 || N.Y < 0 || N.X >= Width || N.Y >= Height) continue;
					const int32 NI = N.Y * Width + N.X;
					if (Map[NI] || Seen[NI]) continue;
					Seen[NI] = true;
					Region.Add(N);
				}
		}
	return Regions;
}
```

:::

### Engine wiring

::: code-group

```csharp [Unity (C#)]
using UnityEngine;
using UnityEngine.Tilemaps;

public class CaveTilemap : MonoBehaviour
{
    [SerializeField] Tilemap tilemap;
    [SerializeField] TileBase wallTile;           // a Rule Tile picks the right edge sprites automatically
    [SerializeField] int width = 80, height = 50, seed = 1234;

    void Start()
    {
        var cave = CaveGenerator.Generate(width, height, seed);
        tilemap.ClearAllTiles();
        for (int x = 0; x < width; x++)
        for (int y = 0; y < height; y++)
            if (cave[x, y]) tilemap.SetTile(new Vector3Int(x, y, 0), wallTile);
    }
}
```

```gdscript [Godot (GDScript)]
# cave_map.gd: writes the walls into a TileMapLayer (Godot 4.3+) using terrain autotiling.
extends TileMapLayer

@export var width := 80
@export var height := 50
@export var world_seed := 1234
@export var terrain_set := 0
@export var terrain := 0


func _ready() -> void:
	var cave := CaveGenerator.generate(width, height, world_seed)
	var walls: Array[Vector2i] = []
	for y in height:
		for x in width:
			if cave[y * width + x] == 1:
				walls.append(Vector2i(x, y))
	clear()
	# Terrains are Godot's Rule Tiles: each wall gets the edge tile that matches its neighbours.
	set_cells_terrain_connect(walls, terrain_set, terrain)
```

```cpp [Unreal (C++)]
// CaveActor.h: one instanced static mesh for all walls (a single draw call per mesh).
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "CaveActor.generated.h"

class UInstancedStaticMeshComponent;

UCLASS()
class ACaveActor : public AActor
{
	GENERATED_BODY()

public:
	ACaveActor();

	UPROPERTY(VisibleAnywhere, Category = "Cave") TObjectPtr<UInstancedStaticMeshComponent> Walls;   // set its mesh in the editor
	UPROPERTY(EditAnywhere, Category = "Cave") int32 Width = 80;
	UPROPERTY(EditAnywhere, Category = "Cave") int32 Height = 50;
	UPROPERTY(EditAnywhere, Category = "Cave") int32 Seed = 1234;
	UPROPERTY(EditAnywhere, Category = "Cave") float CellSize = 100.f;

protected:
	virtual void BeginPlay() override;
};

// CaveActor.cpp
#include "CaveActor.h"
#include "CaveGenerator.h"
#include "Components/InstancedStaticMeshComponent.h"

ACaveActor::ACaveActor()
{
	Walls = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("Walls"));
	RootComponent = Walls;
}

void ACaveActor::BeginPlay()
{
	Super::BeginPlay();
	const TArray<bool> Cave = FCaveGenerator::Generate(Width, Height, Seed);
	Walls->ClearInstances();
	for (int32 Y = 0; Y < Height; ++Y)
		for (int32 X = 0; X < Width; ++X)
			if (Cave.IsValidIndex(Y * Width + X) && Cave[Y * Width + X])
				Walls->AddInstance(FTransform(FVector(X * CellSize, Y * CellSize, 0.f)));   // local space
}
```

:::

For smooth outlines instead of blocks, build a mesh from the grid with marching squares.

**Engine notes**

- **Unity:** Rule Tiles (2D Tilemap Extras package) choose edge sprites from neighbours; `Tilemap.SetTilesBlock` is faster than `SetTile` per cell for big maps. `System.Random(seed)` is repeatable on a given .NET runtime; use your own generator (see [Seeded Randomness](./seeded-randomness)) if results must match across platforms or versions.
- **Godot:** `TileMapLayer` (4.3+; earlier versions use layers of a single `TileMap`) with **terrains** does the autotiling, and `set_cells_terrain_connect` applies it from code. `RandomNumberGenerator` with an explicit `seed` is repeatable on every platform.
- **Unreal:** no built-in cellular automaton. Instanced or hierarchical instanced static meshes keep thousands of wall blocks cheap, and **PCG** graphs can place props in the generated cave. `FRandomStream` is repeatable on every platform.

## When to use

- Caves, mines, organic dungeons, islands, forests and lakes in tile-based games.
- Simulations that are themselves cellular: fire spread, liquid flow, plant growth, Game-of-Life-like mechanics.
- As a post-process on other generators, to roughen geometric layouts into natural ones.

## When not to use

- Levels with rooms, corridors or a clear structure. Use [BSP](./bsp-dungeon) or hand-made pieces.
- Large simulations updated every frame. Use the [Job System](./job-system) or update only active regions.
- When connectivity matters. Caves can come out disconnected; add a flood fill or corridor pass.

## Pitfalls

- **Disconnected caves.** Smoothing produces separate pockets. Keep the largest region, or connect regions by carving tunnels between their nearest cells, as in the post-process step.
- **Updating in place.** Reading cells that were already updated this pass skews the result in the scan direction. Always read from the previous grid.
- **No guaranteed layout.** You cannot guarantee "the exit is reachable and at least 50 cells away". Validate after generation, and retry with a new seed if the result fails.
- **Same look everywhere.** One rule set gives one style. Vary parameters per biome, or seed the initial grid with structure (authored rooms, noise) instead of pure randomness.
- **Size.** Each iteration touches every cell. Very large maps should be generated in chunks, on a background thread or with the [Job System](./job-system).

## Related

- [Double Buffer](./double-buffer) — every iteration reads the old grid and writes a new one.
- [Seeded Randomness](./seeded-randomness) — reproducible caves.
- [Noise-Based Generation](./noise-generation), [Wave Function Collapse](./wave-function-collapse) and [BSP Dungeon Generation](./bsp-dungeon) — other generators, often combined.
- [A* Pathfinding](./a-star) — validate that key points are connected.
