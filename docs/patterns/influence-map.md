# Influence Map

> A grid of values (threat, control, interest) that agents use to reason about space.

**Category:** AI & Decision Making

## Problem

A tactical AI must answer spatial questions: *Where is it safe to retreat? Which part of the map does the enemy control? Where should the flanking squad attack from? Where is the front line?* Answering them by looping over every unit for every candidate position is slow, and each agent asking separately repeats the work. Hard-coding "retreat to waypoint 7" breaks as soon as the battle moves.

## Solution

Keep **grids of numbers over the map**. Each unit **stamps** its influence onto the grid, strongest at its position and falling off with distance. Agents then **query** the grid instead of the units.

- **Layers** for different meanings: *enemy threat*, *ally strength*, *visibility*, *interest* (loot, objectives).
- **Combining** layers answers questions: `control = ally − threat` shows who owns each area, the cells where control is near zero form the front line, and `safety = −threat + 0.5 × cover` picks retreat spots.
- **Decay and propagation** give memory: old influence fades over time, so the map remembers where enemies *were* recently, not just where they are.
- Maps are **updated once** (every few frames), then shared by every agent.

## Example (Unity C#)

```csharp
using UnityEngine;

public class InfluenceMap
{
    public readonly int Width, Height;
    public readonly float CellSize;
    readonly Vector3 origin;
    readonly float[] values;

    public InfluenceMap(int width, int height, float cellSize, Vector3 origin)
    {
        Width = width; Height = height; CellSize = cellSize; this.origin = origin;
        values = new float[width * height];
    }

    public Vector2Int CellOf(Vector3 p) =>
        new(Mathf.FloorToInt((p.x - origin.x) / CellSize), Mathf.FloorToInt((p.z - origin.z) / CellSize));

    public Vector3 CenterOf(int x, int y) =>
        origin + new Vector3((x + 0.5f) * CellSize, 0f, (y + 0.5f) * CellSize);

    public float this[int x, int y] => values[y * Width + x];

    // Multiply everything toward zero: old information fades instead of vanishing.
    public void Decay(float factor)
    {
        for (int i = 0; i < values.Length; i++) values[i] *= factor;
    }

    // Add influence with linear falloff, strongest at the centre.
    public void Stamp(Vector3 position, float strength, float radius)
    {
        var c = CellOf(position);
        int r = Mathf.CeilToInt(radius / CellSize);
        for (int y = Mathf.Max(0, c.y - r); y <= Mathf.Min(Height - 1, c.y + r); y++)
        for (int x = Mathf.Max(0, c.x - r); x <= Mathf.Min(Width - 1, c.x + r); x++)
        {
            float d = Vector2.Distance(new Vector2(x, y), c) * CellSize;
            if (d > radius) continue;
            values[y * Width + x] += strength * (1f - d / radius);
        }
    }
}

public class TacticalMaps : MonoBehaviour
{
    public InfluenceMap Threat { get; private set; }       // enemy danger
    public InfluenceMap Allies { get; private set; }       // friendly strength

    [SerializeField] float updateInterval = 0.25f;
    [SerializeField, Range(0f, 1f)] float decay = 0.8f;   // per update: 0.8 keeps a short memory
    float next;

    void Awake()
    {
        Threat = new InfluenceMap(100, 100, 2f, Vector3.zero);
        Allies = new InfluenceMap(100, 100, 2f, Vector3.zero);
    }

    void Update()
    {
        if (Time.time < next) return;
        next = Time.time + updateInterval;

        Threat.Decay(decay);
        Allies.Decay(decay);
        foreach (var u in Unit.All)                         // stamped once, read by every agent
        {
            var map = u.IsEnemyOfPlayerTeam ? Threat : Allies;
            map.Stamp(u.transform.position, u.CombatPower, u.ThreatRadius);
        }
    }

    // "Where should I retreat to?" The safest reachable cell near me, preferring friendly territory.
    public Vector3 BestRetreat(Vector3 from, float searchRadius)
    {
        var c = Threat.CellOf(from);
        int r = Mathf.CeilToInt(searchRadius / Threat.CellSize);
        float best = float.MinValue;
        Vector3 bestPos = from;

        for (int y = Mathf.Max(0, c.y - r); y <= Mathf.Min(Threat.Height - 1, c.y + r); y++)
        for (int x = Mathf.Max(0, c.x - r); x <= Mathf.Min(Threat.Width - 1, c.x + r); x++)
        {
            float score = Allies[x, y] * 0.5f - Threat[x, y];
            float travel = Vector2.Distance(new Vector2(x, y), c) * 0.05f;   // prefer closer options
            if (score - travel > best) { best = score - travel; bestPos = Threat.CenterOf(x, y); }
        }
        return bestPos;
    }

    // The front line: cells where the two sides are roughly balanced and both present.
    public bool IsFrontLine(int x, int y) =>
        Threat[x, y] > 0.5f && Allies[x, y] > 0.5f && Mathf.Abs(Allies[x, y] - Threat[x, y]) < 0.5f;
}

// Unit: a component with IsEnemyOfPlayerTeam, CombatPower and ThreatRadius, registered in Unit.All.
```

Draw the maps as a coloured overlay with [Debug Draw](./debug-draw) while tuning. Influence maps are much easier to reason about when you can see them.

## When to use

- Strategy and tactics games: territory control, front lines, flanking, choosing where to build or attack.
- Squad AI: retreat points, cover selection, avoiding kill zones, finding where the player was recently seen.
- Ambient or crowd behaviour: NPCs avoiding dangerous districts, animals avoiding hunters.

## Pitfalls

- **Ignoring walls.** Linear falloff spreads threat through walls, so "safe" spots may be right behind a wall from an enemy who has to walk around. Propagate influence with a flood fill that respects obstacles, or factor in line of sight.
- **Resolution.** Fine grids cost memory and stamping time. Coarse grids blur tactical detail. Use a cell size matched to the decisions being made (squad positions, not individual footsteps).
- **Update cost.** Stamping hundreds of units with large radii every frame adds up. Update every few frames, stamp only changed units, or run stamping in a [Job](./job-system).
- **Unnormalised layers.** Adding layers with very different scales makes one dominate. Normalise, or weight layers deliberately, and document the weights.
- **Agents all choosing the same cell.** Ten agents querying "best retreat" pick the same spot. Stamp *reservations* into an interest layer, or add each agent's own position into the scoring.

## Related

- [Utility AI](./utility-ai) — influence values make excellent inputs for utility considerations.
- [Flow Field](./flow-field) — another shared grid that agents read.
- [Spatial Partition](./spatial-partition) — a grid organising objects. An influence map is a grid of values.
- [Blackboard](./blackboard) — agents store chosen positions there.
- [AI Director](./director-ai) — reads aggregate threat to judge how intense the game is.
