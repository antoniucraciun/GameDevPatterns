# Wave Function Collapse

> Generate tile layouts that respect local adjacency rules learned from examples.

**Category:** Data, Content & Procedural Generation

## Problem

You have a tileset: grass, sand, water, road pieces, building walls. You want endless maps that look *designed*: roads connect, water has shores, buildings have walls on every side. Random tile placement produces nonsense, and noise produces natural terrain but not structured content. Writing explicit generation rules for every tile combination is fragile, and every new tile means rewriting the generator.

## Solution

Describe only **local rules**, meaning which tiles may sit next to which in each direction, and let a constraint solver fill the grid. (The name borrows loosely from quantum physics. The algorithm is a constraint solver.)

1. **Rules.** For each tile and each direction, the set of tiles allowed next to it. They can be authored by hand, derived from edge "sockets" (a road edge must meet a road edge), or **learned from an example map**.
2. **Superposition.** Every cell starts with *all* tiles possible.
3. **Observe.** Pick the undecided cell with the **fewest** remaining options (lowest entropy) and **collapse** it to one tile, chosen at random and weighted by tile frequency.
4. **Propagate.** Remove options from neighbours that are no longer compatible, then from their neighbours, and so on until nothing changes.
5. **Repeat** until every cell is collapsed. If a cell runs out of options (a **contradiction**), restart with another seed, or backtrack.

Choosing the lowest-entropy cell first is what makes the result coherent: the most constrained decisions are made before they become impossible.

## Pseudocode

```text
Tile:
    weight
    sockets[up, right, down, left]   // two tiles fit if the touching sockets match

// Built once from the tiles: may tile b sit in direction d of tile a?
allowed[a, d, b] ← a.sockets[d] = b.sockets[opposite of d]

generate(seed, max attempts):
    for attempt from 0 to max attempts - 1:
        random ← generator seeded with seed + attempt
        if try_run() succeeds: return the one tile left in each cell
    return failure                   // every attempt hit a contradiction

try_run():
    options[cell] ← every tile, for every cell        // superposition
    loop:
        if any cell has no options: return failure    // contradiction
        cell ← the cell with fewest options above 1, random among ties
        if there is none: return success              // every cell collapsed
        keep one option in cell, picked at random by weight   // collapse
        if not propagate(cell): return failure

propagate(start):
    stack ← [start]
    while stack is not empty:
        c ← pop stack
        for each direction d, with neighbour n inside the grid:
            for each option b still in n:
                if no option a in c has allowed[a, d, b]:
                    remove b from n
            if n lost any option:
                if n has no options left: return false
                push n             // its own neighbours may lose options now
    return true
```

## Example

A compact tiled WFC on a 2D grid, with socket-based rules and seeded randomness. The **core** has no scene types and returns the same map for the same seed every run; the **engine wiring** turns tile indices into tiles or objects.

### Core

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

[System.Serializable]
public class WfcTile
{
    public string name;
    public float weight = 1f;
    // Edge sockets in order: up, right, down, left. Two tiles fit if the touching sockets match.
    public string up, right, down, left;
    public string Socket(int dir) => dir switch { 0 => up, 1 => right, 2 => down, _ => left };
}

public class WaveFunctionCollapse
{
    static readonly Vector2Int[] Dirs = { new(0, 1), new(1, 0), new(0, -1), new(-1, 0) };   // up, right, down, left

    readonly WfcTile[] tiles;
    readonly bool[,,] allowed;          // allowed[a, dir, b]: tile b may sit in direction dir of tile a
    readonly int width, height;
    bool[,][] options;                  // options[x, y][t]: is tile t still possible here?
    System.Random rng;

    public WaveFunctionCollapse(WfcTile[] tiles, int width, int height)
    {
        this.tiles = tiles; this.width = width; this.height = height;
        allowed = new bool[tiles.Length, 4, tiles.Length];
        for (int a = 0; a < tiles.Length; a++)
        for (int d = 0; d < 4; d++)
        for (int b = 0; b < tiles.Length; b++)
            allowed[a, d, b] = tiles[a].Socket(d) == tiles[b].Socket((d + 2) % 4);   // facing edges must match
    }

    // Returns tile indices per cell, or null if every attempt hit a contradiction.
    public int[,] Generate(int seed, int maxAttempts = 10)
    {
        for (int attempt = 0; attempt < maxAttempts; attempt++)
        {
            rng = new System.Random(seed + attempt);
            if (TryRun(out var result)) return result;
        }
        return null;
    }

    bool TryRun(out int[,] result)
    {
        result = null;
        options = new bool[width, height][];
        for (int x = 0; x < width; x++)
        for (int y = 0; y < height; y++)
        {
            options[x, y] = new bool[tiles.Length];
            for (int t = 0; t < tiles.Length; t++) options[x, y][t] = true;
        }

        while (true)
        {
            // 1. Observe: the undecided cell with the fewest options (random tie-break).
            Vector2Int? cell = null;
            int fewest = int.MaxValue;
            for (int x = 0; x < width; x++)
            for (int y = 0; y < height; y++)
            {
                int n = Count(options[x, y]);
                if (n == 0) return false;                               // contradiction
                if (n > 1 && (n < fewest || (n == fewest && rng.NextDouble() < 0.5)))
                {
                    fewest = n;
                    cell = new Vector2Int(x, y);
                }
            }
            if (cell == null) break;                                    // every cell collapsed

            // 2. Collapse it to one tile, weighted.
            Collapse(cell.Value);

            // 3. Propagate constraints outward.
            if (!Propagate(cell.Value)) return false;
        }

        result = new int[width, height];
        for (int x = 0; x < width; x++)
        for (int y = 0; y < height; y++)
            result[x, y] = System.Array.IndexOf(options[x, y], true);
        return true;
    }

    void Collapse(Vector2Int c)
    {
        var o = options[c.x, c.y];
        float total = 0f;
        for (int t = 0; t < o.Length; t++) if (o[t]) total += tiles[t].weight;
        double roll = rng.NextDouble() * total;
        int chosen = -1;
        for (int t = 0; t < o.Length; t++)
        {
            if (!o[t]) continue;
            chosen = t;
            if ((roll -= tiles[t].weight) < 0) break;
        }
        for (int t = 0; t < o.Length; t++) o[t] = t == chosen;
    }

    bool Propagate(Vector2Int start)
    {
        var stack = new Stack<Vector2Int>();
        stack.Push(start);
        while (stack.Count > 0)
        {
            var c = stack.Pop();
            for (int d = 0; d < 4; d++)
            {
                var n = c + Dirs[d];
                if (n.x < 0 || n.y < 0 || n.x >= width || n.y >= height) continue;

                bool changed = false;
                var nOpts = options[n.x, n.y];
                for (int b = 0; b < tiles.Length; b++)
                {
                    if (!nOpts[b]) continue;
                    // Keep b only if some remaining tile in c allows it in direction d.
                    bool supported = false;
                    for (int a = 0; a < tiles.Length && !supported; a++)
                        supported = options[c.x, c.y][a] && allowed[a, d, b];
                    if (!supported) { nOpts[b] = false; changed = true; }
                }
                if (changed)
                {
                    if (Count(nOpts) == 0) return false;                // contradiction
                    stack.Push(n);
                }
            }
        }
        return true;
    }

    static int Count(bool[] o) { int n = 0; foreach (var b in o) if (b) n++; return n; }
}

// Example tiles: grass (all edges "g"), road pieces ("g" on grass sides, "r" on road sides),
// water ("w"), shore pieces ("g"/"w" per side).
```

```gdscript [Godot (GDScript)]
# wfc_tile.gd: one .tres per tile, so the rule set is edited in the inspector.
class_name WfcTile
extends Resource

@export var tile_name := ""
@export var weight := 1.0
## Edge sockets. Two tiles fit if the touching sockets match.
@export var up := ""
@export var right := ""
@export var down := ""
@export var left := ""


func socket(dir: int) -> String:
	match dir:
		0:
			return up
		1:
			return right
		2:
			return down
		_:
			return left


# wave_function_collapse.gd
class_name WaveFunctionCollapse
extends RefCounted

# up, right, down, left, with +y as "up" (the wiring flips rows for TileMapLayer).
const DIRS: Array[Vector2i] = [Vector2i(0, 1), Vector2i(1, 0), Vector2i(0, -1), Vector2i(-1, 0)]

var _tiles: Array[WfcTile]
var _count: int
var _width: int
var _height: int
var _allowed := PackedByteArray()  # [(a * 4 + dir) * count + b] = 1: b may sit in direction dir of a
var _options := PackedByteArray()  # [(y * width + x) * count + t] = 1: tile t still possible here
var _rng := RandomNumberGenerator.new()


func _init(tiles: Array[WfcTile], width: int, height: int) -> void:
	_tiles = tiles
	_count = tiles.size()
	_width = width
	_height = height
	_allowed.resize(_count * 4 * _count)
	for a in _count:
		for d in 4:
			for b in _count:
				# facing edges must match
				_allowed[(a * 4 + d) * _count + b] = 1 if tiles[a].socket(d) == tiles[b].socket((d + 2) % 4) else 0


## Tile index per cell (index y * width + x), or an empty array if every attempt hit a contradiction.
func generate(world_seed: int, max_attempts := 10) -> PackedInt32Array:
	for attempt in max_attempts:
		_rng.seed = world_seed + attempt  # setting the seed resets the generator's state
		var result := _try_run()
		if not result.is_empty():
			return result
	return PackedInt32Array()


func _try_run() -> PackedInt32Array:
	_options.resize(_width * _height * _count)
	_options.fill(1)

	while true:
		# 1. Observe: the undecided cell with the fewest options (random tie-break).
		var cell := Vector2i(-1, -1)
		var fewest := _count + 1
		for x in _width:
			for y in _height:
				var n := _option_count(Vector2i(x, y))
				if n == 0:
					return PackedInt32Array()  # contradiction
				if n > 1 and (n < fewest or (n == fewest and _rng.randf() < 0.5)):
					fewest = n
					cell = Vector2i(x, y)
		if cell.x < 0:
			break  # every cell collapsed

		# 2. Collapse it to one tile, weighted.
		_collapse(cell)

		# 3. Propagate constraints outward.
		if not _propagate(cell):
			return PackedInt32Array()

	var result := PackedInt32Array()
	result.resize(_width * _height)
	for i in _width * _height:
		result[i] = _options.find(1, i * _count) - i * _count
	return result


func _collapse(c: Vector2i) -> void:
	var base := _base(c)
	var total := 0.0
	for t in _count:
		if _options[base + t] == 1:
			total += _tiles[t].weight
	var roll := _rng.randf() * total
	var chosen := -1
	for t in _count:
		if _options[base + t] == 0:
			continue
		chosen = t
		roll -= _tiles[t].weight
		if roll < 0.0:
			break
	for t in _count:
		_options[base + t] = 1 if t == chosen else 0


func _propagate(start: Vector2i) -> bool:
	var stack: Array[Vector2i] = [start]
	while not stack.is_empty():
		var c: Vector2i = stack.pop_back()
		var c_base := _base(c)
		for d in 4:
			var n := c + DIRS[d]
			if n.x < 0 or n.y < 0 or n.x >= _width or n.y >= _height:
				continue
			var n_base := _base(n)
			var changed := false
			for b in _count:
				if _options[n_base + b] == 0:
					continue
				# Keep b only if some remaining tile in c allows it in direction d.
				var supported := false
				for a in _count:
					if _options[c_base + a] == 1 and _allowed[(a * 4 + d) * _count + b] == 1:
						supported = true
						break
				if not supported:
					_options[n_base + b] = 0
					changed = true
			if changed:
				if _option_count(n) == 0:
					return false  # contradiction
				stack.push_back(n)
	return true


func _base(c: Vector2i) -> int:
	return (c.y * _width + c.x) * _count


func _option_count(c: Vector2i) -> int:
	var base := _base(c)
	var n := 0
	for t in _count:
		n += _options[base + t]
	return n
```

```cpp [Unreal (C++)]
// WaveFunctionCollapse.h: the tile struct is a USTRUCT so the rule set can be edited on an actor;
// the solver is plain C++.
#pragma once

#include "CoreMinimal.h"
#include "WaveFunctionCollapse.generated.h"

USTRUCT(BlueprintType)
struct FWfcTile
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "WFC") FName Name;
	UPROPERTY(EditAnywhere, Category = "WFC") float Weight = 1.f;
	// Edge sockets. Two tiles fit if the touching sockets match.
	UPROPERTY(EditAnywhere, Category = "WFC") FName Up;
	UPROPERTY(EditAnywhere, Category = "WFC") FName Right;
	UPROPERTY(EditAnywhere, Category = "WFC") FName Down;
	UPROPERTY(EditAnywhere, Category = "WFC") FName Left;

	FName Socket(int32 Dir) const
	{
		switch (Dir) { case 0: return Up; case 1: return Right; case 2: return Down; default: return Left; }
	}
};

class FWaveFunctionCollapse
{
public:
	FWaveFunctionCollapse(TArray<FWfcTile> InTiles, int32 InWidth, int32 InHeight);

	// Tile index per cell (Y * Width + X), or empty if every attempt hit a contradiction.
	TArray<int32> Generate(int32 Seed, int32 MaxAttempts = 10);

private:
	bool TryRun(TArray<int32>& OutResult);
	void Collapse(FIntPoint C);
	bool Propagate(FIntPoint Start);
	int32 Base(FIntPoint C) const { return (C.Y * Width + C.X) * NumTiles; }
	int32 CountOptions(FIntPoint C) const;

	TArray<FWfcTile> Tiles;
	int32 NumTiles, Width, Height;
	TArray<bool> Allowed;   // [(A * 4 + Dir) * NumTiles + B]: B may sit in direction Dir of A
	TArray<bool> Options;   // [Base(Cell) + T]: tile T still possible in Cell
	FRandomStream Rng;
};

// WaveFunctionCollapse.cpp
#include "WaveFunctionCollapse.h"

static const FIntPoint Dirs[] = {{0, 1}, {1, 0}, {0, -1}, {-1, 0}};   // up, right, down, left

FWaveFunctionCollapse::FWaveFunctionCollapse(TArray<FWfcTile> InTiles, int32 InWidth, int32 InHeight)
	: Tiles(MoveTemp(InTiles)), NumTiles(Tiles.Num()), Width(InWidth), Height(InHeight)
{
	Allowed.SetNumZeroed(NumTiles * 4 * NumTiles);
	for (int32 A = 0; A < NumTiles; ++A)
		for (int32 D = 0; D < 4; ++D)
			for (int32 B = 0; B < NumTiles; ++B)
				Allowed[(A * 4 + D) * NumTiles + B] = Tiles[A].Socket(D) == Tiles[B].Socket((D + 2) % 4);
}

TArray<int32> FWaveFunctionCollapse::Generate(int32 Seed, int32 MaxAttempts)
{
	TArray<int32> Result;
	for (int32 Attempt = 0; Attempt < MaxAttempts; ++Attempt)
	{
		Rng.Initialize(Seed + Attempt);
		if (TryRun(Result)) return Result;
	}
	return {};
}

bool FWaveFunctionCollapse::TryRun(TArray<int32>& OutResult)
{
	Options.Init(true, Width * Height * NumTiles);

	while (true)
	{
		// 1. Observe: the undecided cell with the fewest options (random tie-break).
		FIntPoint Cell(-1, -1);
		int32 Fewest = MAX_int32;
		for (int32 X = 0; X < Width; ++X)
			for (int32 Y = 0; Y < Height; ++Y)
			{
				const int32 N = CountOptions({X, Y});
				if (N == 0) return false;                                 // contradiction
				if (N > 1 && (N < Fewest || (N == Fewest && Rng.FRand() < 0.5f)))
				{
					Fewest = N;
					Cell = {X, Y};
				}
			}
		if (Cell.X < 0) break;                                            // every cell collapsed

		Collapse(Cell);                                                   // 2. weighted pick
		if (!Propagate(Cell)) return false;                               // 3. propagate
	}

	OutResult.SetNum(Width * Height);
	for (int32 I = 0; I < Width * Height; ++I)
		for (int32 T = 0; T < NumTiles; ++T)
			if (Options[I * NumTiles + T]) { OutResult[I] = T; break; }
	return true;
}

void FWaveFunctionCollapse::Collapse(FIntPoint C)
{
	const int32 B = Base(C);
	float Total = 0.f;
	for (int32 T = 0; T < NumTiles; ++T) if (Options[B + T]) Total += Tiles[T].Weight;
	float Roll = Rng.FRand() * Total;
	int32 Chosen = -1;
	for (int32 T = 0; T < NumTiles; ++T)
	{
		if (!Options[B + T]) continue;
		Chosen = T;
		if ((Roll -= Tiles[T].Weight) < 0.f) break;
	}
	for (int32 T = 0; T < NumTiles; ++T) Options[B + T] = T == Chosen;
}

bool FWaveFunctionCollapse::Propagate(FIntPoint Start)
{
	TArray<FIntPoint> Stack{Start};
	while (Stack.Num() > 0)
	{
		const FIntPoint C = Stack.Pop();
		for (int32 D = 0; D < 4; ++D)
		{
			const FIntPoint N = C + Dirs[D];
			if (N.X < 0 || N.Y < 0 || N.X >= Width || N.Y >= Height) continue;

			bool bChanged = false;
			for (int32 B = 0; B < NumTiles; ++B)
			{
				if (!Options[Base(N) + B]) continue;
				// Keep B only if some remaining tile in C allows it in direction D.
				bool bSupported = false;
				for (int32 A = 0; A < NumTiles && !bSupported; ++A)
					bSupported = Options[Base(C) + A] && Allowed[(A * 4 + D) * NumTiles + B];
				if (!bSupported) { Options[Base(N) + B] = false; bChanged = true; }
			}
			if (bChanged)
			{
				if (CountOptions(N) == 0) return false;                   // contradiction
				Stack.Push(N);
			}
		}
	}
	return true;
}

int32 FWaveFunctionCollapse::CountOptions(FIntPoint C) const
{
	int32 N = 0;
	for (int32 T = 0; T < NumTiles; ++T) N += Options[Base(C) + T] ? 1 : 0;
	return N;
}
```

:::

This version rescans the grid to find the next cell, which is O(n²) overall and fine for grids of a few thousand cells. Larger grids keep cells in a priority queue by entropy.

### Engine wiring

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class WfcMap : MonoBehaviour
{
    [SerializeField] WfcTile[] tiles;
    [SerializeField] GameObject[] prefabs;                  // one per tile, same order
    [SerializeField] int width = 30, height = 30, seed = 42;
    [SerializeField] float cellSize = 1f;

    void Start()
    {
        var map = new WaveFunctionCollapse(tiles, width, height).Generate(seed);
        if (map == null) { Debug.LogError("WFC failed: try another seed or looser rules"); return; }

        for (int x = 0; x < width; x++)
        for (int y = 0; y < height; y++)                    // grid "up" (+y) becomes world +z
            Instantiate(prefabs[map[x, y]], transform.position + new Vector3(x, 0f, y) * cellSize,
                        Quaternion.identity, transform);
    }
}
```

```gdscript [Godot (GDScript)]
# wfc_map.gd: writes the result into a TileMapLayer (Godot 4.3+).
extends TileMapLayer

@export var tiles: Array[WfcTile] = []
@export var atlas_coords: Array[Vector2i] = []  # one per tile, same order, in atlas source 0
@export var width := 30
@export var height := 30
@export var world_seed := 42


func _ready() -> void:
	var map := WaveFunctionCollapse.new(tiles, width, height).generate(world_seed)
	if map.is_empty():
		push_error("WFC failed: try another seed or looser rules")
		return
	clear()
	for y in height:
		for x in width:
			# The core's "up" is +y, but TileMapLayer rows grow downwards: flip y.
			set_cell(Vector2i(x, height - 1 - y), 0, atlas_coords[map[y * width + x]])
```

```cpp [Unreal (C++)]
// WfcMapActor.h: spawns one actor per cell.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WaveFunctionCollapse.h"
#include "WfcMapActor.generated.h"

UCLASS()
class AWfcMapActor : public AActor
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "WFC") TArray<FWfcTile> Tiles;
	UPROPERTY(EditAnywhere, Category = "WFC") TArray<TSubclassOf<AActor>> TileActors;   // one per tile, same order
	UPROPERTY(EditAnywhere, Category = "WFC") int32 Width = 30;
	UPROPERTY(EditAnywhere, Category = "WFC") int32 Height = 30;
	UPROPERTY(EditAnywhere, Category = "WFC") int32 Seed = 42;
	UPROPERTY(EditAnywhere, Category = "WFC") float CellSize = 400.f;

protected:
	virtual void BeginPlay() override;
};

// WfcMapActor.cpp
#include "WfcMapActor.h"

void AWfcMapActor::BeginPlay()
{
	Super::BeginPlay();
	const TArray<int32> Map = FWaveFunctionCollapse(Tiles, Width, Height).Generate(Seed);
	if (Map.IsEmpty())
	{
		UE_LOG(LogTemp, Error, TEXT("WFC failed: try another seed or looser rules"));
		return;
	}
	for (int32 Y = 0; Y < Height; ++Y)
		for (int32 X = 0; X < Width; ++X)
		{
			const int32 Tile = Map[Y * Width + X];
			if (!TileActors.IsValidIndex(Tile) || !TileActors[Tile]) continue;
			const FVector Location = GetActorLocation() + FVector(X * CellSize, Y * CellSize, 0.f);
			GetWorld()->SpawnActor<AActor>(TileActors[Tile], Location, FRotator::ZeroRotator);
		}
}
```

:::

**Engine notes**

- **Unity:** no built-in WFC. `System.Random(seed)` gives the same sequence for the same seed on a given .NET runtime; for guarantees across platforms and versions, use your own generator (see [Seeded Randomness](./seeded-randomness)). For many tiles, a Tilemap with `SetTilesBlock` is much cheaper than one GameObject per cell.
- **Godot:** no built-in WFC. Flat `PackedByteArray`s keep the solver reasonably fast in GDScript, but large grids are still slow; move the solver to C# or a GDExtension if generation time matters. Setting `RandomNumberGenerator.seed` restarts its sequence, which is what each attempt needs.
- **Unreal:** an experimental **Wave Function Collapse** plugin ships with Unreal Engine 5 for 3D modules, and **PCG** graphs can drive placement; the hand-written solver is still useful for 2D rules and learning. `FRandomStream` is deterministic on every platform. `FName` comparison ignores case, so sockets `g` and `G` match.

## When to use

- Tile-based maps, dungeons, towns, pixel-art backgrounds, 3D building modules: anything built from pieces with connection rules.
- When designers should control style through example maps or tile sockets, rather than generator code.

## When not to use

- Large maps that must be generated fast. WFC can be slow and may need backtracking or restarts.
- Layouts that need global structure, such as a path from start to exit. WFC only enforces local rules; add constraints or another generator.
- Small tile sets with simple rules. Simpler generators do the job.

## Pitfalls

- **Contradictions.** Restrictive tilesets often fail mid-generation. Restart with a new seed (cheap for small grids), add backtracking, or add "connector" tiles that make the rules less tight.
- **Locally right, globally wrong.** WFC guarantees local consistency only. Roads may form disconnected loops, and there is no guarantee of a path from start to exit. Add global constraints (pre-place the path, then fill around it), or validate and regenerate.
- **Repetitive output.** With few tiles, results look samey. Add variants with weights, and pre-seed some cells with authored features.
- **Performance.** Propagation is expensive on large grids with many tiles. Use bitsets for options, cache compatible-tile lists, and generate in chunks with fixed borders.
- **Rule authoring.** Hand-writing adjacency for 100 tiles is error-prone. Use edge sockets, as above, or learn rules from an example map.

## Related

- [Seeded Randomness](./seeded-randomness) — reproducible maps from a seed.
- [Noise-Based Generation](./noise-generation) — natural terrain, often combined with WFC for detail.
- [Cellular Automata](./cellular-automata) and [BSP Dungeon Generation](./bsp-dungeon) — other layout generators.
- [Weighted Random & Loot Tables](./weighted-random) — weighted choice when collapsing.
- [Time Slicing](./time-slicing) — spread generation over frames to avoid a hitch.
