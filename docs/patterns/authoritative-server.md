# Authoritative Server

> The server owns the truth; clients send inputs and receive state.

**Category:** Networking & Multiplayer

## Problem

In the first multiplayer prototype, each client simulates its own player and tells the others "I'm at (10, 2, 5), I have 500 health, I hit player 3 for 9,999 damage". It works until someone edits memory or packets: they teleport, become immortal and kill everyone instantly. Even without cheating, two clients disagree about whether a shot hit, and both are "right" on their own screen. There is no single source of truth.

## Solution

One machine, the **server**, runs the real simulation and is the **only authority** on game state:

- **Clients send intentions, not results:** "I pressed forward", "I want to fire", "I want to buy item 12". Never "I'm at X" or "I dealt 50 damage".
- **The server validates** every request against its own state and the rules: is the move possible at this speed, is the weapon off cooldown, is the target in range and in sight, can the player afford the item?
- **The server simulates** and **sends state** to clients ([Snapshot & Delta Compression](./snapshot-delta-compression)).
- **Clients present** that state, and hide latency with [Client-Side Prediction](./client-side-prediction), [Server Reconciliation](./server-reconciliation), [Entity Interpolation](./entity-interpolation) and [Lag Compensation](./lag-compensation).

What may stay client-authoritative: purely cosmetic things that cannot affect others (camera, UI, particle effects, local footstep sounds).

The server can be **dedicated** (a headless build in a data centre: fair, scalable, costs money) or a **listen server/host** (one player's machine: free, but the host has zero latency and could cheat).

## Example (Unity C#)

Server-side request handling. The client asks, and the server checks everything with its own data:

```csharp
using UnityEngine;

public enum RejectReason { None, OnCooldown, OutOfRange, NoLineOfSight, NotEnoughGold, InvalidTarget, TooFast }

public readonly struct FireRequest
{
    public readonly int PlayerId, TargetId, WeaponSlot;
    public readonly uint InputSequence;
    public FireRequest(int playerId, int targetId, int weaponSlot, uint seq)
    { PlayerId = playerId; TargetId = targetId; WeaponSlot = weaponSlot; InputSequence = seq; }
}

public class ServerCombat
{
    readonly ServerWorld world;                     // the server's own, authoritative state

    public ServerCombat(ServerWorld world) => this.world = world;

    public RejectReason HandleFire(in FireRequest req)
    {
        // Never trust anything the client says about state: look it all up.
        if (!world.TryGetPlayer(req.PlayerId, out var shooter) || !shooter.IsAlive) return RejectReason.InvalidTarget;
        if (!world.TryGetPlayer(req.TargetId, out var target) || !target.IsAlive) return RejectReason.InvalidTarget;

        var weapon = shooter.Weapons[req.WeaponSlot];
        if (world.Time < weapon.ReadyAt) return RejectReason.OnCooldown;

        Vector3 from = shooter.EyePosition, to = target.CenterPosition;
        if (Vector3.Distance(from, to) > weapon.Range) return RejectReason.OutOfRange;
        if (world.Raycast(from, to, out _)) return RejectReason.NoLineOfSight;   // with lag compensation in shooters

        // Only now does the shot happen, with the server's own damage numbers.
        weapon.ReadyAt = world.Time + weapon.Cooldown;
        target.Health -= weapon.Damage;
        world.Broadcast(new HitEvent(req.PlayerId, req.TargetId, weapon.Damage));
        return RejectReason.None;
    }

    // Movement: the client sends inputs; the server simulates them, and also guards against impossible input.
    public void HandleMoveInput(ServerPlayer p, Vector2 move, float clientDt)
    {
        if (move.sqrMagnitude > 1.0001f) move.Normalize();                   // clamp tampered input
        float dt = Mathf.Min(clientDt, 1f / 20f);                            // can't claim huge time steps
        p.Position = world.MoveWithCollisions(p.Position, new Vector3(move.x, 0, move.y) * p.MoveSpeed * dt);
    }

    // Economy: transactions are checked and applied atomically on the server.
    public RejectReason HandleBuy(ServerPlayer p, int itemId)
    {
        var item = world.Shop.Find(itemId);
        if (item == null) return RejectReason.InvalidTarget;
        if (p.Gold < item.Price) return RejectReason.NotEnoughGold;
        p.Gold -= item.Price;
        p.Inventory.TryAdd(item.Definition, 1);
        return RejectReason.None;
    }
}

// ServerWorld / ServerPlayer: the server's simulation objects (not the client's MonoBehaviours).
```

In Unity's **Netcode for GameObjects**, the same idea appears as server RPCs (client → server requests), with `NetworkVariable`s written only by the server. **Netcode for Entities** is server-authoritative with prediction built in.

Rejected requests are normal, because latency makes honest clients occasionally ask for impossible things. Send the reason back so the client can correct its prediction (refund the predicted ammo, play a "click").

## When to use

- Any competitive multiplayer game, and any game with an economy, progression or leaderboards that cheating would spoil.
- Games with many players, where peer-to-peer trust and bandwidth do not scale.

## Pitfalls

- **Trusting client state "just for this one thing".** Client-reported positions, hit results, timestamps or inventory are the classic exploits. Treat every client message as a request that can be a lie.
- **Unbounded inputs.** A client can send 1,000 inputs per second, or a movement vector of length 100. Clamp, rate-limit and validate inputs as well as actions.
- **Latency without hiding it.** Pure server authority with no prediction feels unplayable above about 50 ms. Combine with prediction and interpolation from the start.
- **Host advantage.** On a listen server, the host has no latency and full access to server state. For competitive play, use dedicated servers.
- **Server cost and code split.** The server needs headless builds, hosting and scaling. Keep simulation code free of rendering and UI, so it runs on the server unchanged.

## Related

- [Client-Side Prediction](./client-side-prediction), [Server Reconciliation](./server-reconciliation), [Entity Interpolation](./entity-interpolation) and [Lag Compensation](./lag-compensation) — hiding latency on top of authority.
- [Snapshot & Delta Compression](./snapshot-delta-compression) — sending state efficiently.
- [Interest Management](./interest-management) — sending only relevant state, which also limits what cheaters can see.
- [Command](./command) — client requests are commands, validated before execution.
- [Responsive Online Movement](../recipes/responsive-online-movement) — the full movement stack built on an authoritative server.
