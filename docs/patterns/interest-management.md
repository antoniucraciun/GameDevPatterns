# Interest Management

> Only replicate entities that are relevant to each client.

**Also known as:** Relevancy, Area of Interest · **Category:** Networking & Multiplayer

## Problem

A battle royale has 100 players and 5,000 networked objects (loot, doors, vehicles, projectiles). Sending every object's state to every client means 100 × 5,000 updates per snapshot: bandwidth explodes, server CPU is spent serialising things nobody can see, and clients waste memory and time on entities on the other side of the map. It also leaks information, because a cheater's client knows where everyone is.

## Solution

For each client, the server decides which entities are **relevant**, and replicates **only those**:

- **Relevance rules.** Within a radius of the player, on the same team, always-relevant objects (the game mode, the scoreboard), or the owner of the client.
- **Spatial queries.** A [Spatial Partition](./spatial-partition) (grid) answers "what is near this player?" without checking all 5,000 objects for each of 100 players.
- **Enter and leave events.** When an entity becomes relevant, the server sends a **spawn** with its full state. When it stops being relevant, a **despawn**. In between, it sends updates (often delta-compressed).
- **Hysteresis.** Use a larger *leave* radius than *enter* radius, so entities at the boundary do not flicker in and out.
- **Priority and frequency.** Relevant entities are not equal. Nearby enemies update every snapshot, while distant vehicles update every fourth one. This is a bandwidth budget per client.

## Example (Unity C#)

A grid-based relevancy system on the server:

```csharp
using System.Collections.Generic;
using UnityEngine;

public class NetEntity
{
    public int Id;
    public Vector3 Position;
    public bool AlwaysRelevant;        // game state, scoreboard
    public int OwnerClientId = -1;
}

public class InterestManager
{
    readonly float cellSize;
    readonly float enterRadius, leaveRadius;
    readonly Dictionary<Vector2Int, List<NetEntity>> grid = new();
    readonly Dictionary<int, HashSet<int>> relevantByClient = new();   // client -> entity ids it knows about
    readonly List<NetEntity> scratch = new();

    public InterestManager(float enterRadius, float leaveRadius)
    {
        this.enterRadius = enterRadius;
        this.leaveRadius = leaveRadius;
        cellSize = enterRadius;        // a query then touches at most 3x3 cells (plus a margin for leave)
    }

    Vector2Int Cell(Vector3 p) => new(Mathf.FloorToInt(p.x / cellSize), Mathf.FloorToInt(p.z / cellSize));

    public void RebuildGrid(IEnumerable<NetEntity> entities)       // once per network tick
    {
        foreach (var list in grid.Values) list.Clear();
        foreach (var e in entities)
        {
            var c = Cell(e.Position);
            if (!grid.TryGetValue(c, out var list)) grid[c] = list = new List<NetEntity>();
            list.Add(e);
        }
    }

    // Computes what to spawn and despawn for one client, given its player's position.
    public void Update(int clientId, Vector3 viewer, IReadOnlyList<NetEntity> alwaysRelevant,
                       List<NetEntity> toSpawn, List<int> toDespawn)
    {
        toSpawn.Clear(); toDespawn.Clear();
        if (!relevantByClient.TryGetValue(clientId, out var known))
            relevantByClient[clientId] = known = new HashSet<int>();

        // 1. Gather candidates in the leave radius (the larger one).
        scratch.Clear();
        int r = Mathf.CeilToInt(leaveRadius / cellSize);
        var centre = Cell(viewer);
        for (int x = -r; x <= r; x++)
        for (int y = -r; y <= r; y++)
            if (grid.TryGetValue(new Vector2Int(centre.x + x, centre.y + y), out var list))
                scratch.AddRange(list);
        scratch.AddRange(alwaysRelevant);

        // 2. Enter: unknown entities inside the enter radius (or always relevant / owned).
        var stillRelevant = new HashSet<int>();
        foreach (var e in scratch)
        {
            float d = Vector3.Distance(viewer, e.Position);
            bool relevant = e.AlwaysRelevant || e.OwnerClientId == clientId
                            || d <= enterRadius
                            || (known.Contains(e.Id) && d <= leaveRadius);   // hysteresis
            if (!relevant) continue;
            stillRelevant.Add(e.Id);
            if (known.Add(e.Id)) toSpawn.Add(e);
        }

        // 3. Leave: known entities that are no longer relevant.
        foreach (int id in known)
            if (!stillRelevant.Contains(id)) toDespawn.Add(id);
        foreach (int id in toDespawn) known.Remove(id);
    }

    public IReadOnlyCollection<int> KnownBy(int clientId) =>
        relevantByClient.TryGetValue(clientId, out var s) ? s : (IReadOnlyCollection<int>)System.Array.Empty<int>();
}

// Each network tick, per client:
//   interest.Update(client.Id, client.Player.Position, globals, spawns, despawns);
//   send spawns (full state) and despawns; then send state updates only for interest.KnownBy(client.Id),
//   updating far entities less often (e.g. every 4th tick beyond 60 m).
```

The `stillRelevant` set is allocated per call for clarity. Reuse one per client in production. Netcode for GameObjects exposes this as **network visibility** (`CheckObjectVisibility` / `NetworkShow` / `NetworkHide`), and Netcode for Entities has relevancy and importance scaling built in.

## When to use

- Any multiplayer game with large worlds or many networked objects: battle royales, MMOs, open-world co-op, large RTS matches.
- Competitive games, to stop clients receiving information they should not have (enemies behind walls far away).

## Pitfalls

- **Pop-in.** Entities appearing suddenly at the radius edge looks bad. Make the radius larger than the visible distance, or fade in, and use hysteresis to stop flicker.
- **Events about irrelevant entities.** An RPC like "entity 4512 exploded" sent to a client that never spawned 4512 breaks the client. Route events through the same relevancy filter.
- **Expensive relevancy checks.** Checking every entity for every client is the O(n²) problem again. Use a spatial grid, and rebuild it once per tick, not once per client.
- **Line-of-sight relevancy.** Hiding enemies behind walls (anti-wallhack) needs visibility tests on the server, which cost far more than distance checks. Do it only for players, at a lower rate, and be conservative: never hide something the player might see a frame later.
- **Late joiners and teleports.** A player who teleports needs everything around their new position spawned in one tick, which spikes bandwidth. Spread spawns over a few ticks by priority.

## Related

- [Spatial Partition](./spatial-partition) — the grid behind relevancy queries.
- [Entity Interpolation](./entity-interpolation) — how relevant entities are shown smoothly.
- [Object Pool](./object-pool) — clients spawn and despawn entities constantly as relevancy changes.
- Snapshot & Delta Compression — reduces the cost of each relevant entity's updates.
