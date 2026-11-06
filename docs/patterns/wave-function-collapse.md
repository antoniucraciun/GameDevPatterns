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

## Example (Unity C#)

A compact tiled WFC on a 2D grid, with socket-based rules and seeded randomness:

```csharp
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
// water ("w"), shore pieces ("g"/"w" per side). Then:
// var map = new WaveFunctionCollapse(tiles, 30, 30).Generate(seed: 42);
// Instantiate the prefab for tiles[map[x, y]] at each (x, y).
```

This version rescans the grid to find the next cell, which is O(n²) overall and fine for grids of a few thousand cells. Larger grids keep cells in a priority queue by entropy.

## When to use

- Tile-based maps, dungeons, towns, pixel-art backgrounds, 3D building modules: anything built from pieces with connection rules.
- When designers should control style through example maps or tile sockets, rather than generator code.

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
