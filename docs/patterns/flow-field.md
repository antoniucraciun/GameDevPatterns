# Flow Field

> Precompute a direction per cell so thousands of units can share one path.

**Category:** AI & Decision Making

## Problem

An RTS player selects 800 units and clicks across the map. Running [A*](./a-star) 800 times is expensive, and every unit gets the same narrow optimal line, so they queue single file through the same tiles. In a horde game, 3,000 zombies chase one player. They all need a path to the same goal, and that goal moves every frame.

## Solution

Flip the problem: instead of one path per unit, compute **one field for the goal**, and let every unit read it.

1. **Cost field.** Each grid cell has a movement cost (1 for floor, 3 for mud, impassable for walls).
2. **Integration field.** Starting from the goal, a breadth-first or Dijkstra flood fills every cell with its total cost to reach the goal.
3. **Flow field.** Each cell stores a direction toward its cheapest neighbour.
4. **Movement.** Each unit looks up the direction of the cell it stands on, and steers that way, combined with separation so the crowd spreads naturally.

The cost depends on the **size of the map, not the number of units**. 10 units or 10,000, the field is computed once. When the goal moves, recompute the field, possibly at a lower rate or only in the area around the goal.

## Example (Unity C#)

```csharp
using System.Collections.Generic;
using UnityEngine;

public class FlowField
{
    public readonly int Width, Height;
    public readonly float CellSize;
    public readonly Vector3 Origin;

    readonly byte[] cost;             // 1..254 = cost, 255 = impassable
    readonly ushort[] integration;    // total cost to the goal
    readonly Vector2[] direction;     // per cell: normalised direction toward the goal

    static readonly Vector2Int[] Neighbours =
    {
        new(1, 0), new(-1, 0), new(0, 1), new(0, -1),
        new(1, 1), new(1, -1), new(-1, 1), new(-1, -1),
    };

    public FlowField(int width, int height, float cellSize, Vector3 origin)
    {
        Width = width; Height = height; CellSize = cellSize; Origin = origin;
        cost = new byte[width * height];
        integration = new ushort[width * height];
        direction = new Vector2[width * height];
        for (int i = 0; i < cost.Length; i++) cost[i] = 1;
    }

    int Index(int x, int y) => y * Width + x;
    bool InBounds(int x, int y) => x >= 0 && y >= 0 && x < Width && y < Height;

    public void SetCost(int x, int y, byte value) => cost[Index(x, y)] = value;

    public Vector2Int CellOf(Vector3 world) =>
        new(Mathf.FloorToInt((world.x - Origin.x) / CellSize), Mathf.FloorToInt((world.z - Origin.z) / CellSize));

    // Rebuild the whole field toward a goal. Cost depends on map size, not unit count.
    public void Build(Vector3 goalWorld)
    {
        for (int i = 0; i < integration.Length; i++) integration[i] = ushort.MaxValue;

        var goal = CellOf(goalWorld);
        if (!InBounds(goal.x, goal.y)) return;

        // 1. Integration field: Dijkstra-like flood from the goal (a simple queue is fine for small costs).
        var open = new Queue<Vector2Int>();
        integration[Index(goal.x, goal.y)] = 0;
        open.Enqueue(goal);
        while (open.Count > 0)
        {
            var c = open.Dequeue();
            int here = integration[Index(c.x, c.y)];
            for (int n = 0; n < 4; n++)                            // 4-way flood keeps costs simple
            {
                int nx = c.x + Neighbours[n].x, ny = c.y + Neighbours[n].y;
                if (!InBounds(nx, ny)) continue;
                int i = Index(nx, ny);
                if (cost[i] == 255) continue;                       // wall
                int total = here + cost[i];
                if (total < integration[i])
                {
                    integration[i] = (ushort)total;
                    open.Enqueue(new Vector2Int(nx, ny));            // re-queue when improved
                }
            }
        }

        // 2. Flow field: point each cell at its cheapest neighbour (8-way for smoother motion).
        for (int y = 0; y < Height; y++)
        for (int x = 0; x < Width; x++)
        {
            int i = Index(x, y);
            if (cost[i] == 255 || integration[i] == ushort.MaxValue) { direction[i] = Vector2.zero; continue; }

            int best = integration[i];
            Vector2 dir = Vector2.zero;
            foreach (var d in Neighbours)
            {
                int nx = x + d.x, ny = y + d.y;
                if (!InBounds(nx, ny)) continue;
                // Don't cut diagonally between two walls.
                if (d.x != 0 && d.y != 0 && (cost[Index(x + d.x, y)] == 255 || cost[Index(x, y + d.y)] == 255)) continue;
                int v = integration[Index(nx, ny)];
                if (v < best) { best = v; dir = ((Vector2)d).normalized; }
            }
            direction[i] = dir;
        }
    }

    public Vector3 DirectionAt(Vector3 world)
    {
        var c = CellOf(world);
        if (!InBounds(c.x, c.y)) return Vector3.zero;
        var d = direction[Index(c.x, c.y)];
        return new Vector3(d.x, 0f, d.y);
    }
}

// Each unit, every frame (or in a job, for thousands):
// Vector3 desired = field.DirectionAt(transform.position) * maxSpeed;
// velocity += (desired - velocity) + separation;   // see Steering Behaviors / Flocking
```

Rebuild the field when the goal moves to a different cell, a few times per second at most. For moving targets in big maps, compute the field only within a radius of the goal, and have far units use a coarse field.

## When to use

- RTS games: large groups ordered to one destination.
- Horde and swarm games: thousands of enemies converging on the player.
- Crowd simulation: evacuations, stadiums, cities, where many agents share a few destinations.

## When not to use

- Few agents, or agents with different destinations. Separate [A*](./a-star) paths are cheaper.
- Very large maps at high resolution. A field per destination costs memory and time; use coarse fields or hierarchical paths.
- When agents need exact paths, such as along roads. A flow field gives directions, not routes.

## Pitfalls

- **One field per goal.** Fifty different destinations need fifty fields. Group units by destination, cache fields per goal, and fall back to individual A* for lone units.
- **Unit clumping at choke points.** Every unit follows the same gradient into the same doorway. Add separation, and let costs include crowd density (cells with many units cost more).
- **Grid resolution.** Coarse cells produce blocky movement and ignore thin gaps. Fine cells cost memory and time. Choose a cell size near the unit size, and smooth the sampled direction (bilinear interpolation between cells).
- **Moving goals.** Rebuilding the full field every frame for a moving player is wasteful. Rebuild when the goal changes cells, at a capped rate, possibly on a [Job](./job-system).
- **Unreachable areas.** Cells cut off from the goal have no direction. Units there need a fallback (wander, or move toward the nearest reachable cell).

## Related

- [A* Pathfinding](./a-star) — one path for one unit. Flow fields are one field for many units.
- [Steering Behaviors](./steering-behaviors) and [Flocking](./flocking) — combine the flow direction with separation.
- [Navigation Mesh](./navigation-mesh) — for individual agents in irregular 3D spaces.
- [Influence Map](./influence-map) — another grid of values that agents read.
- [Job System](./job-system) — building fields and moving thousands of units in parallel.
