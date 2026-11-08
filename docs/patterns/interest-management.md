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

## Pseudocode

All of this runs on the server; the client only spawns, updates and despawns what it is sent.

```text
enter radius < leave radius            // the gap is the hysteresis
grid ← cells of size enter radius, each listing the entities inside it
known[client] ← ids of the entities that client currently has

every network tick:
    rebuild grid from every entity's position         // once, not per client
    for each client:
        update(client, client's player position)
        send each spawn with full state, then each despawn
        send state updates only for known[client];
            far ones less often (e.g. every 4th tick beyond 60 m)

update(client, viewer):
    // 1. Candidates: grid cells within the leave radius, plus the always-relevant.
    candidates ← entities in cells within leave radius of viewer's cell
                 + always-relevant entities (game state, scoreboard)
    still relevant ← empty set
    // 2. Enter: decide each candidate.
    for each e in candidates:
        d ← distance(viewer, e.position)
        relevant ← e is always relevant
                   or e is owned by client
                   or d ≤ enter radius
                   or (e is in known[client] and d ≤ leave radius)   // hysteresis
        if relevant:
            add e to still relevant
            if e is not in known[client]: add it, and spawn e for client
    // 3. Leave: anything known but not still relevant.
    for each id in known[client] that is not in still relevant:
        remove id from known[client];  despawn it for client
```

## Example

The Unity tab is a grid-based relevancy system on the server, independent of any netcode package. Godot and Unreal already decide per peer what to replicate, so their tabs plug the same rules (radius, hysteresis, always relevant, owner) into the engine's own relevancy hooks.

::: code-group

```csharp [Unity (C#)]
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

```gdscript [Godot (GDScript)]
# relevancy.gd: a child of each replicated entity, next to its MultiplayerSynchronizer.
# A peer gets the entity's updates only while the filter returns true; when the synchronizer
# replicates the node a MultiplayerSpawner spawned, visibility also spawns and despawns it.
extends Node

@export var enter_radius := 50.0
@export var leave_radius := 60.0  # larger than enter: hysteresis
@export var always_relevant := false  # game state, scoreboard
@export var owner_peer_id := 0
@export var players: Node  # player bodies, named by peer id

@onready var _sync: MultiplayerSynchronizer = $"../MultiplayerSynchronizer"
@onready var _entity: Node3D = get_parent()

var _known := {}  # peer id -> true while that peer can see this entity


func _ready() -> void:
	if not multiplayer.is_server():
		return
	_sync.add_visibility_filter(_is_relevant)
	# Re-check visibility a few times per second instead of every frame.
	_sync.visibility_update_mode = MultiplayerSynchronizer.VISIBILITY_PROCESS_NONE
	var timer := Timer.new()
	timer.wait_time = 0.2
	timer.autostart = true
	timer.timeout.connect(func() -> void: _sync.update_visibility())
	add_child(timer)


func _is_relevant(peer_id: int) -> bool:
	if always_relevant or peer_id == owner_peer_id:
		return true
	var viewer := players.get_node_or_null(str(peer_id)) as Node3D
	if viewer == null:
		return false
	var d := viewer.global_position.distance_to(_entity.global_position)
	var relevant := d <= enter_radius or (_known.has(peer_id) and d <= leave_radius)  # hysteresis
	if relevant:
		_known[peer_id] = true
	else:
		_known.erase(peer_id)
	return relevant
```

```cpp [Unreal (C++)]
// TeamTrap.h: relevancy is built in. The defaults cover the distance rule, and IsNetRelevantFor
// adds a custom one (a trap only its own team can see).
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GenericTeamAgentInterface.h"
#include "TeamTrap.generated.h"

UCLASS()
class ATeamTrap : public AActor
{
	GENERATED_BODY()

public:
	ATeamTrap();
	virtual bool IsNetRelevantFor(const AActor* RealViewer, const AActor* ViewTarget, const FVector& SrcLocation) const override;

	UPROPERTY(EditAnywhere)
	uint8 TeamId = 0;
};

// TeamTrap.cpp
#include "TeamTrap.h"

ATeamTrap::ATeamTrap()
{
	bReplicates = true;
	NetCullDistanceSquared = FMath::Square(5000.f);       // relevant within 50 m of the viewer
	NetUpdateFrequency = 5.f;                             // a trap rarely changes: at most 5 updates per second
	NetPriority = 1.f;                                    // its share of bandwidth when the connection is saturated
	// Other built-in rules:
	// bAlwaysRelevant = true;        // game state, scoreboard
	// bOnlyRelevantToOwner = true;   // e.g. the owner's inventory actor
	// bNetUseOwnerRelevancy = true;  // a weapon is relevant whenever its owner is
}

bool ATeamTrap::IsNetRelevantFor(const AActor* RealViewer, const AActor* ViewTarget, const FVector& SrcLocation) const
{
	// RealViewer is usually the client's player controller; its team decides first.
	if (FGenericTeamId::GetTeamIdentifier(RealViewer) != FGenericTeamId(TeamId)) return false;
	return Super::IsNetRelevantFor(RealViewer, ViewTarget, SrcLocation);   // distance, owner, always-relevant
}
```

:::

The `stillRelevant` set in the Unity tab is allocated per call for clarity. Reuse one per client in production.

**Engine notes**

- **Unity:** Netcode for GameObjects exposes this as **network visibility** (`NetworkObject.CheckObjectVisibility` / `NetworkShow` / `NetworkHide`): feed it the spawn and despawn lists above. Netcode for Entities has relevancy (`GhostRelevancy`) and distance-based importance scaling built in.
- **Godot:** `MultiplayerSynchronizer` visibility (`add_visibility_filter`, `set_visibility_for`, `public_visibility`) is the built-in interest management, and a peer that can't see a spawned node's synchronizer doesn't get the node spawned. Each filter here measures every peer's distance itself, which is fine for hundreds of entities; for thousands, keep a grid like the Unity tab's in one server node and call `set_visibility_for(peer, visible)` on the synchronizers it changes.
- **Unreal:** Every replicated actor already has a relevancy test per connection (`IsNetRelevantFor`: always relevant, owner, then `NetCullDistanceSquared`). A connection keeps an actor that stops being relevant for a few seconds (the net driver's `RelevantTimeout`), which acts as hysteresis. At scale, the **Replication Graph** plugin replaces per-actor checks with a spatial grid (`UReplicationGraphNode_GridSpatialization2D`) and per-connection nodes; **Iris**, the newer replication system (experimental from UE 5.1), has its own filtering. In UE 5.5+ the `NetUpdateFrequency` and `NetCullDistanceSquared` fields are reached through `SetNetUpdateFrequency` / `SetNetCullDistanceSquared` instead.

## When to use

- Any multiplayer game with large worlds or many networked objects: battle royales, MMOs, open-world co-op, large RTS matches.
- Competitive games, to stop clients receiving information they should not have (enemies behind walls far away).

## When not to use

- Small arenas where every player can see everything. Filtering adds cost without savings.
- Small player counts with few networked objects.
- Competitive games that rely on it alone for anti-cheat. Clients still see what they're near; pair it with server-side checks.

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
- [Snapshot & Delta Compression](./snapshot-delta-compression) — reduces the cost of each relevant entity's updates.
