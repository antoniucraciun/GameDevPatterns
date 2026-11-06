# Responsive Online Movement

> Server-authoritative movement that feels instant locally and smooth for remote players.

## Goal

Movement for an online action game with a server you trust and clients you do not:

- The **server** decides where everyone really is. Clients cannot teleport by lying.
- **Your own** character responds on the very frame you press a key, even at 150 ms ping.
- **Other** players move smoothly, with no 20 Hz stutter, even when packets arrive late or out of order.
- A misprediction (you were blocked, stunned or pushed) is corrected without visible rubber-banding.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Command](../patterns/command) | Each step's input is a numbered `InputCmd`: sent to the server, stored for replay, applied identically on both sides. |
| [Fixed Timestep](../patterns/fixed-timestep) | Client and server simulate in the same constant ticks, so one input means one tick everywhere. |
| [Client-Side Prediction](../patterns/client-side-prediction) | The owning client applies its inputs immediately, without waiting for the server. |
| [Server Reconciliation](../patterns/server-reconciliation) | When the server's state arrives, the client rewinds to it and replays the inputs the server has not seen yet. |
| [Entity Interpolation](../patterns/entity-interpolation) | Players you do not control are shown slightly in the past, blended between snapshots. |

## How they fit together

```
 OWNING CLIENT                               SERVER                                OTHER CLIENTS
 ─────────────                               ──────                                ─────────────
 every tick:                                 every tick:
   cmd = sample input (seq n)  ──[n-2..n]──►   queue cmds per player
   predicted = Simulate(predicted, cmd)        state = Simulate(state, next cmd)
   pending.Add(cmd)                            every 3rd tick: broadcast snapshot
                                 ◄──snapshot── { tick, per player: state, ack } ──►  buffer snapshot
 own player:  rewind to state,                                                       render at
              drop cmds ≤ ack, replay rest                                           now − 100 ms,
 others:      interpolation buffer                                                   interpolate
```

The joins:

- **Command ↔ Fixed Timestep.** An input is *one tick's worth of intent*. Because both sides step at the same rate, "apply input 812" means the same amount of movement on client and server.
- **Prediction ↔ Reconciliation.** Prediction alone drifts. Reconciliation alone lags. Together they show the present while staying anchored to the server. The shared `Simulate` function is what makes the replay land exactly where the prediction was.
- **Reconciliation ↔ Interpolation.** One snapshot message feeds both: the local player's entry goes to reconciliation, every other entry goes to an interpolation buffer. The same entity type takes one path or the other depending on **who owns it**.

## Example (Unity C#)

Transport-agnostic. `Send…` methods stand in for your networking library (Netcode for GameObjects custom messages, Mirror, Fish-Net, raw UDP).

### Shared: messages and the one simulation function

```csharp
using System.Collections.Generic;
using UnityEngine;

public static class NetConfig
{
    public const int TickRate = 60;                     // simulation ticks per second
    public const float TickDt = 1f / TickRate;
    public const int SnapshotEvery = 3;                 // 20 snapshots per second
    public const int RedundantInputs = 3;               // resend the last N inputs each tick
}

public struct InputCmd                                  // Command
{
    public uint Sequence;
    public sbyte MoveX, MoveY;                          // -100..100, compact and exact
}

public struct PlayerState
{
    public Vector3 Position;
    public Vector3 Velocity;
}

public struct PlayerSnapshot
{
    public int PlayerId;
    public PlayerState State;
    public uint Ack;                                    // last input applied for this player
}

public static class Movement                            // runs on client AND server
{
    const float Speed = 6f, Accel = 40f;

    public static PlayerState Simulate(PlayerState s, InputCmd cmd)
    {
        var wish = Vector3.ClampMagnitude(new Vector3(cmd.MoveX, 0f, cmd.MoveY) / 100f, 1f) * Speed;
        s.Velocity = Vector3.MoveTowards(s.Velocity, wish, Accel * NetConfig.TickDt);
        s.Position += s.Velocity * NetConfig.TickDt;
        return s;                                       // collisions would also go here, identically
    }
}
```

### Server: queue inputs, simulate, broadcast

```csharp
public class MovementServer
{
    class Player { public PlayerState State; public uint LastApplied; public SortedList<uint, InputCmd> Queue = new(); }

    readonly Dictionary<int, Player> players = new();
    int tick;

    public void OnPlayerJoined(int id, Vector3 spawn) => players[id] = new Player { State = new PlayerState { Position = spawn } };

    public void OnInputs(int playerId, InputCmd[] cmds)   // redundant: may contain old or duplicate inputs
    {
        var p = players[playerId];
        foreach (var c in cmds)
            if (c.Sequence > p.LastApplied && !p.Queue.ContainsKey(c.Sequence))
                p.Queue.Add(c.Sequence, c);
    }

    public void Tick()                                    // called every NetConfig.TickDt
    {
        foreach (var p in players.Values)
        {
            if (p.Queue.Count == 0) continue;             // no input yet: the player stands still
            var cmd = p.Queue.Values[0];
            p.Queue.RemoveAt(0);
            p.State = Movement.Simulate(p.State, cmd);
            p.LastApplied = cmd.Sequence;
        }

        if (++tick % NetConfig.SnapshotEvery != 0) return;

        var snapshot = new List<PlayerSnapshot>(players.Count);
        foreach (var (id, p) in players)
            snapshot.Add(new PlayerSnapshot { PlayerId = id, State = p.State, Ack = p.LastApplied });
        BroadcastSnapshot(tick * (double)NetConfig.TickDt, snapshot);
    }

    void BroadcastSnapshot(double serverTime, List<PlayerSnapshot> players) { /* send to all clients */ }
}
```

### Client: one component, two modes

```csharp
public class NetPlayer : MonoBehaviour
{
    public int PlayerId;
    public bool IsLocalOwner;                                  // decided by the server on spawn

    // ── Owner: prediction + reconciliation ──
    readonly List<InputCmd> pending = new();
    PlayerState predicted, previousPredicted;
    Vector3 correctionOffset;
    uint nextSequence = 1;

    // ── Others: interpolation ──
    readonly List<(double time, Vector3 pos)> snapshots = new();
    const double InterpolationDelay = 0.1;

    void FixedUpdate()                                         // Time.fixedDeltaTime = NetConfig.TickDt
    {
        if (!IsLocalOwner) return;

        var cmd = new InputCmd
        {
            Sequence = nextSequence++,
            MoveX = (sbyte)Mathf.RoundToInt(Input.GetAxisRaw("Horizontal") * 100f),
            MoveY = (sbyte)Mathf.RoundToInt(Input.GetAxisRaw("Vertical") * 100f),
        };

        previousPredicted = predicted;
        predicted = Movement.Simulate(predicted, cmd);         // predict now
        pending.Add(cmd);

        int start = Mathf.Max(0, pending.Count - NetConfig.RedundantInputs);
        SendInputs(pending.GetRange(start, pending.Count - start).ToArray());
    }

    // Called by the client's network layer for this player's entry in each snapshot.
    public void OnSnapshot(double serverTime, PlayerSnapshot s)
    {
        if (IsLocalOwner) Reconcile(s.State, s.Ack);
        else snapshots.Add((serverTime, s.State.Position));   // (sorting/dedupe: see Entity Interpolation)
    }

    void Reconcile(PlayerState server, uint ack)
    {
        Vector3 shownBefore = predicted.Position;

        predicted = server;                                    // rewind
        pending.RemoveAll(c => c.Sequence <= ack);
        foreach (var c in pending) predicted = Movement.Simulate(predicted, c);   // replay
        previousPredicted = predicted;

        Vector3 error = shownBefore - predicted.Position;
        correctionOffset = error.sqrMagnitude > 4f ? Vector3.zero : correctionOffset + error;
    }

    void Update()
    {
        if (IsLocalOwner)
        {
            // Interpolate between fixed ticks, and fade out any correction.
            float alpha = (Time.time - Time.fixedTime) / Time.fixedDeltaTime;
            correctionOffset = Vector3.Lerp(correctionOffset, Vector3.zero, 1f - Mathf.Exp(-15f * Time.deltaTime));
            transform.position = Vector3.Lerp(previousPredicted.Position, predicted.Position, alpha) + correctionOffset;
            return;
        }

        double renderTime = NetClock.EstimatedServerTime - InterpolationDelay;
        while (snapshots.Count >= 3 && snapshots[1].time <= renderTime) snapshots.RemoveAt(0);
        if (snapshots.Count < 2) return;

        var (t0, p0) = snapshots[0];
        var (t1, p1) = snapshots[1];
        float t = Mathf.Clamp01((float)((renderTime - t0) / (t1 - t0)));
        transform.position = Vector3.Lerp(p0, p1, t);
    }

    void SendInputs(InputCmd[] cmds) { /* unreliable channel to the server */ }
}
```

`NetClock` is the server-time estimate from [Entity Interpolation](../patterns/entity-interpolation).

## Where the patterns meet: pitfalls

- **Two simulations.** If the client moves with a `CharacterController` and the server with custom code, every snapshot causes a correction. There must be exactly one `Simulate`, called by both.
- **Inputs on a reliable, ordered channel.** One lost packet then delays every later input (head-of-line blocking), and the server starves. Send inputs unreliably, with the last few repeated in every packet.
- **Ticks that do not match.** If the client sends 60 inputs per second and the server ticks at 50 Hz, the server's queue grows without bound and latency creeps up. Use the same tick rate, and have the server drop or merge inputs when the queue is too long.
- **Predicting what you do not own.** Other players are never predicted from your guesses about their input. They are interpolated. Only the owner predicts.
- **Collisions with interpolated players.** Your predicted present collides with others' *past* positions, so client and server disagree on contacts between players. Most games avoid hard player-to-player collision, or accept small corrections there.
- **Corrections hidden too well.** Smoothing a large correction slowly makes the player feel like they are sliding on ice. Snap large errors and smooth only small ones.

## Variations

- **Lag compensation for shooting:** the server rewinds other players' hitboxes to what the shooter saw (render time) when validating hits.
- **[Delta-compressed snapshots](../patterns/snapshot-delta-compression):** send only what changed since the last snapshot the client acknowledged.
- **Interest management:** send each client only the players near it.
- **Rollback for everything:** fighting games predict *remote* inputs too, and resimulate the whole world when the real ones arrive. That needs a fully deterministic simulation. See [Determinism](../patterns/determinism).
