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

## Example (Unity C#)

```csharp
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

// var cave = CaveGenerator.Generate(80, 50, seed: 1234);
// Paint walls into a Tilemap (Rule Tiles pick the right edge sprites automatically),
// or build a mesh with marching squares for smooth outlines.
```

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
