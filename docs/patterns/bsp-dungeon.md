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

## Example (Unity C#)

```csharp
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

// var dungeon = new BspDungeon(seed: 7);
// dungeon.Generate(80, 50);
// var floor = dungeon.ToGrid(80, 50);       // paint into a Tilemap; walls wherever floor is false
// Start room = Rooms[0], exit = the room furthest from it (BFS over the floor grid).
```

## When to use

- Roguelikes and dungeon crawlers with rectangular rooms and corridors.
- Building interiors, space stations, office floors: any layout of non-overlapping rooms.
- As a base layout that other techniques decorate ([Cellular Automata](./cellular-automata) to roughen walls, [Wave Function Collapse](./wave-function-collapse) for room interiors).

## When not to use

- Organic spaces such as caves or forests. Use [Cellular Automata](./cellular-automata) or [Noise](./noise-generation).
- Open-world terrain.
- Dungeons that need non-rectangular or hand-crafted rooms. Place authored room prefabs instead.

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
