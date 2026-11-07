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

## Example (Unity C#)

A* on a grid with 8-way movement, terrain costs and no corner cutting:

```csharp
using System.Collections.Generic;
using UnityEngine;

public class GridPathfinder
{
    readonly int width, height;
    readonly float[,] cost;                     // movement cost per cell; float.PositiveInfinity = wall

    // Reused between searches to avoid allocations.
    readonly float[,] g;
    readonly Vector2Int[,] parent;
    readonly int[,] visitedStamp;
    int stamp;
    readonly PriorityQueue<Vector2Int, float> open = new();

    static readonly Vector2Int[] Directions =
    {
        new(1, 0), new(-1, 0), new(0, 1), new(0, -1),
        new(1, 1), new(1, -1), new(-1, 1), new(-1, -1),
    };

    public GridPathfinder(float[,] cost)
    {
        this.cost = cost;
        width = cost.GetLength(0); height = cost.GetLength(1);
        g = new float[width, height];
        parent = new Vector2Int[width, height];
        visitedStamp = new int[width, height];
    }

    static float Octile(Vector2Int a, Vector2Int b)
    {
        int dx = Mathf.Abs(a.x - b.x), dy = Mathf.Abs(a.y - b.y);
        return Mathf.Max(dx, dy) + 0.41421356f * Mathf.Min(dx, dy);
    }

    bool Walkable(int x, int y) => x >= 0 && y >= 0 && x < width && y < height && !float.IsInfinity(cost[x, y]);

    public bool FindPath(Vector2Int start, Vector2Int goal, List<Vector2Int> path)
    {
        path.Clear();
        if (!Walkable(goal.x, goal.y)) return false;

        stamp++;                                 // "clears" g/parent without touching every cell
        open.Clear();
        Touch(start, 0f, start);
        open.Enqueue(start, Octile(start, goal));

        while (open.TryDequeue(out var current, out float f))
        {
            if (current == goal) { Reconstruct(start, goal, path); return true; }
            if (f > g[current.x, current.y] + Octile(current, goal) + 0.0001f) continue;   // stale entry

            foreach (var d in Directions)
            {
                var next = current + d;
                if (!Walkable(next.x, next.y)) continue;
                bool diagonal = d.x != 0 && d.y != 0;
                if (diagonal && (!Walkable(current.x + d.x, current.y) || !Walkable(current.x, current.y + d.y)))
                    continue;                    // don't cut corners through walls

                float step = (diagonal ? 1.41421356f : 1f) * cost[next.x, next.y];
                float tentative = g[current.x, current.y] + step;

                if (visitedStamp[next.x, next.y] != stamp || tentative < g[next.x, next.y])
                {
                    Touch(next, tentative, current);
                    open.Enqueue(next, tentative + Octile(next, goal));   // duplicates are skipped as stale
                }
            }
        }
        return false;                            // no path
    }

    void Touch(Vector2Int n, float gValue, Vector2Int from)
    {
        visitedStamp[n.x, n.y] = stamp;
        g[n.x, n.y] = gValue;
        parent[n.x, n.y] = from;
    }

    void Reconstruct(Vector2Int start, Vector2Int goal, List<Vector2Int> path)
    {
        for (var n = goal; n != start; n = parent[n.x, n.y]) path.Add(n);
        path.Add(start);
        path.Reverse();
    }
}
```

`PriorityQueue<TElement, TPriority>` is part of .NET 6+. Unity's class libraries do not include it yet, so use a small binary heap of your own or one from a utility package. The stale-entry check means the queue never needs a "decrease key" operation.

For 3D worlds, Unity's **AI Navigation** package (NavMesh) runs A* over navmesh polygons for you. Knowing A* still matters for grids, tactics games, custom graphs and understanding why a path looks odd.

## When to use

- Point-to-point routes for a few to a few hundred agents: RTS units, enemies, NPCs, tactics games.
- Any graph search with costs: road networks, dialogue state spaces, puzzle solving.

## When not to use

- Thousands of agents heading to the same goal. One [Flow Field](./flow-field) serves them all.
- Unity projects with continuous 3D levels. The built-in [Navigation Mesh](./navigation-mesh) already runs A* on a better graph.
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
