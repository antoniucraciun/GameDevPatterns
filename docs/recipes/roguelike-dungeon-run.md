# Roguelike Dungeon Run

> A complete, playable level from one seed: layout, caves, navigation, enemies and loot, reproducible every time.

## Goal

The level generator of a roguelike:

- Every run gets a **new dungeon**: rooms, corridors and cave-like rough edges.
- The **same seed always produces the same dungeon**, with the same enemies and loot, for daily challenges, sharing seeds and reproducing bug reports.
- The level is **always completable**: every room is reachable, and the exit is far from the start.
- Enemies can **path through it** immediately, on a navmesh baked for this exact layout.
- **Difficulty rises with distance** from the start: easy rooms first, dangerous rooms near the exit.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Seeded Randomness](../patterns/seeded-randomness) | One run seed, split into separate streams for layout, caves, enemies and loot, so each stage is reproducible on its own. |
| [BSP Dungeon Generation](../patterns/bsp-dungeon) | The architectural skeleton: non-overlapping rooms, connected by corridors. |
| [Cellular Automata](../patterns/cellular-automata) | Roughens room edges into cave-like shapes, without touching corridors. |
| [Navigation Mesh](../patterns/navigation-mesh) | Baked at runtime once the geometry exists, so enemies can path through the new level. |
| [Spawner / Wave System](../patterns/spawner) | Populates rooms, with a threat budget that grows with distance from the start. |
| [Weighted Random & Loot Tables](../patterns/weighted-random) | Picks enemy types and loot, with weights that shift toward harder options deeper in. |

## How they fit together

```
run seed ──Derive──► layoutSeed ──► BSP rooms + corridors ──┐
         ├─Derive──► caveSeed   ──► CA roughening (rooms only, corridors protected)
         │                                                   ▼
         │                         flood fill: keep the region with the start room
         │                         BFS distances from start → exit = farthest room
         │                                                   ▼
         │                         build tiles + colliders ──► NavMeshSurface.BuildNavMesh()
         ├─Derive──► spawnSeed  ──► per room: budget = f(distance) → weighted enemy picks
         └─Derive──► lootSeed   ──► per room: weighted loot, better deeper in
```

The joins:

- **Seeded Randomness ↔ every stage.** Each stage gets its *own* stream derived from the run seed. Tweaking the cave rules changes only the caves: rooms, enemies and loot for that seed stay the same. With a single shared generator, any change would reshuffle everything after it.
- **BSP ↔ Cellular Automata.** BSP guarantees connectivity, and cellular automata destroy guarantees. Protect corridor cells and room centres from erosion, and *re-check* connectivity afterwards anyway.
- **Generation ↔ Navigation Mesh.** The navmesh can only be baked after geometry and colliders exist, and must finish before enemies spawn. Order the pipeline explicitly, behind the loading screen.
- **Distance ↔ Spawner and loot tables.** One BFS from the start room gives every room a depth. Difficulty, enemy weights and loot quality all key off that number, so pacing comes out consistent for every seed.

## Example (Unity C#)

This builds on the pattern pages: `BspDungeon` ([BSP](../patterns/bsp-dungeon)), `Rng.Derive` ([Seeded Randomness](../patterns/seeded-randomness)), `EnemyType` ([Type Object](../patterns/type-object)) and `LootTable` ([Weighted Random](../patterns/weighted-random)).

### The pipeline

```csharp
using System.Collections.Generic;
using Unity.AI.Navigation;
using UnityEngine;
using UnityEngine.Tilemaps;

public class DungeonRun : MonoBehaviour
{
    const int Width = 96, Height = 64;

    [SerializeField] Tilemap floorMap, wallMap;
    [SerializeField] TileBase floorTile, wallTile;
    [SerializeField] NavMeshSurface navSurface;
    [SerializeField] DepthTable enemyTable;                // weights per depth, see below
    [SerializeField] LootTable[] lootByDepth;              // shallow → deep
    [SerializeField] Transform player;

    public bool[,] Floor { get; private set; }
    public RectInt StartRoom { get; private set; }
    public RectInt ExitRoom { get; private set; }

    public void Generate(ulong runSeed)
    {
        // 1. Independent, reproducible streams per stage.
        var layoutRng = new System.Random((int)Rng.Derive(runSeed, 1));
        var caveRng   = new System.Random((int)Rng.Derive(runSeed, 2));
        var spawnRng  = new System.Random((int)Rng.Derive(runSeed, 3));
        var lootRng   = new System.Random((int)Rng.Derive(runSeed, 4));

        // 2. Skeleton: rooms and corridors.
        var bsp = new BspDungeon(layoutRng.Next());
        bsp.Generate(Width, Height);
        Floor = bsp.ToGrid(Width, Height);
        var protectedCells = CorridorAndCenterCells(bsp);

        // 3. Organic edges: erode and grow room borders, never corridors.
        Roughen(Floor, protectedCells, caveRng, iterations: 3);

        // 4. Guarantee: only keep what is reachable from the start room.
        StartRoom = bsp.Rooms[0];
        var depth = DistancesFrom(Vector2Int.FloorToInt(StartRoom.center));   // BFS over floor cells
        RemoveUnreachable(depth);
        ExitRoom = FarthestRoom(bsp.Rooms, depth);

        // 5. Geometry, then navigation (needs colliders to exist).
        BuildTiles();
        navSurface.BuildNavMesh();                           // behind the loading screen

        // 6. Population, scaled by depth (0 at start, 1 at the farthest cell).
        int maxDepth = MaxOf(depth);
        foreach (var room in bsp.Rooms)
        {
            if (room.Equals(StartRoom)) continue;
            float d = depth[(int)room.center.x, (int)room.center.y] / (float)maxDepth;
            SpawnEnemies(room, d, spawnRng);
            SpawnLoot(room, d, lootRng);
        }

        player.position = CellToWorld(Vector2Int.FloorToInt(StartRoom.center));
    }

    // ── Cellular-automata roughening, restricted to unprotected cells ──
    static void Roughen(bool[,] floor, HashSet<Vector2Int> protectedCells, System.Random rng, int iterations)
    {
        int w = floor.GetLength(0), h = floor.GetLength(1);
        // Random noise only along room borders.
        for (int x = 1; x < w - 1; x++)
        for (int y = 1; y < h - 1; y++)
            if (!protectedCells.Contains(new Vector2Int(x, y)) && IsBorder(floor, x, y) && rng.NextDouble() < 0.4)
                floor[x, y] = !floor[x, y];

        var next = (bool[,])floor.Clone();
        for (int i = 0; i < iterations; i++)
        {
            for (int x = 1; x < w - 1; x++)
            for (int y = 1; y < h - 1; y++)
            {
                if (protectedCells.Contains(new Vector2Int(x, y))) { next[x, y] = true; continue; }
                int floorNeighbours = 0;
                for (int dx = -1; dx <= 1; dx++)
                for (int dy = -1; dy <= 1; dy++)
                    if ((dx != 0 || dy != 0) && floor[x + dx, y + dy]) floorNeighbours++;
                next[x, y] = floorNeighbours >= 5 || (floorNeighbours >= 4 && floor[x, y]);
            }
            System.Array.Copy(next, floor, next.Length);       // double buffered
        }
    }

    static bool IsBorder(bool[,] f, int x, int y) =>
        f[x, y] != f[x + 1, y] || f[x, y] != f[x - 1, y] || f[x, y] != f[x, y + 1] || f[x, y] != f[x, y - 1];

    // ── Population ──
    void SpawnEnemies(RectInt room, float depth01, System.Random rng)
    {
        int budget = Mathf.RoundToInt(Mathf.Lerp(2f, 9f, depth01));             // threat points
        while (budget > 0)
        {
            var type = enemyTable.Pick(depth01, rng);                            // weights shift with depth
            if (type.threatCost > budget) break;
            budget -= type.threatCost;
            var cell = RandomFloorCellIn(room, rng);
            if (cell.HasValue) type.Spawn(CellToWorld(cell.Value));
        }
    }

    void SpawnLoot(RectInt room, float depth01, System.Random rng)
    {
        var table = lootByDepth[Mathf.Min(lootByDepth.Length - 1, (int)(depth01 * lootByDepth.Length))];
        if (rng.NextDouble() < 0.5) return;                                      // not every room has loot
        var item = table.Roll(rng);
        var cell = RandomFloorCellIn(room, rng);
        if (item != null && cell.HasValue) LootDrop.Spawn(item, CellToWorld(cell.Value));
    }

    // CorridorAndCenterCells, DistancesFrom (BFS → int[,], -1 = unreachable), RemoveUnreachable,
    // FarthestRoom, MaxOf, BuildTiles, RandomFloorCellIn and CellToWorld are straightforward grid helpers.
}
```

### Depth-weighted enemy picks

```csharp
[CreateAssetMenu(menuName = "Dungeon/Depth Table")]
public class DepthTable : ScriptableObject
{
    [System.Serializable]
    public class Entry
    {
        public EnemyType type;
        public AnimationCurve weightByDepth = AnimationCurve.Linear(0, 1, 1, 1);   // x = depth 0..1
    }

    public List<Entry> entries = new();

    public EnemyType Pick(float depth01, System.Random rng)
    {
        float total = 0f;
        foreach (var e in entries) total += Mathf.Max(0f, e.weightByDepth.Evaluate(depth01));
        double roll = rng.NextDouble() * total;
        foreach (var e in entries)
        {
            float w = Mathf.Max(0f, e.weightByDepth.Evaluate(depth01));
            if (roll < w) return e.type;
            roll -= w;
        }
        return entries[^1].type;
    }
}

// Designers draw curves: rats fade out with depth, ogres fade in, the elite only appears past 0.7.
```

`EnemyType` here also needs a `threatCost` field, for the room budget.

## Where the patterns meet: pitfalls

- **One random stream for everything.** Adding a single extra `Next()` call in cave generation changes every enemy and loot drop for every seed. Derive a stream per stage, as above.
- **Iterating unordered collections.** Looping over a `HashSet` or `Dictionary` while consuming random numbers makes generation non-reproducible, even with seeds. Iterate in a fixed order (sorted lists, grid order).
- **Erosion breaking connectivity.** Cellular automata can seal a corridor or split a room. Protect key cells, and always recompute reachability after roughening.
- **Spawning before the navmesh exists.** Agents spawned before the bake fail to find the navmesh, and stand still or log errors. Bake first, then spawn, all behind the loading screen.
- **Unity's physics and navmesh are not seed-deterministic.** The *layout* is reproducible, but runtime behaviour (AI paths, physics) can differ slightly between runs. For daily-challenge leaderboards, that is usually acceptable. For replays, see [Determinism](../patterns/determinism).
- **Generation time.** Large dungeons with several CA passes and a navmesh bake can take hundreds of milliseconds. Do it during a loading screen, or spread it across frames ([Time Slicing](../patterns/time-slicing)).

## Variations

- **Room templates:** stamp hand-authored rooms (shops, shrines, boss rooms) into specific BSP leaves, chosen by depth.
- **Wave Function Collapse interiors:** fill each room's floor with props and terrain using [WFC](../patterns/wave-function-collapse).
- **Keys and locks:** place a locked door between depth bands and the key in a room before it. The depth map already tells you which rooms come first.
- **Daily seed:** `Rng.Derive(dailySalt, year, dayOfYear)` (with a fixed `dailySalt` constant) gives everyone the same dungeon for 24 hours.
