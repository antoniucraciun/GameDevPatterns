# Deterministic Lockstep

> Exchange only inputs; every peer runs the same deterministic simulation.

**Category:** Networking & Multiplayer

## Problem

An RTS match has 8 players and 2,000 units. Replicating 2,000 units' positions, health and orders with snapshots needs far too much bandwidth, even with [delta compression](./snapshot-delta-compression). But the *inputs* are tiny: a few clicks per player per second ("units 12–40 attack unit 900"). If every machine had the same starting state and the same inputs, and the simulation were perfectly reproducible, they could each compute the full game state themselves.

## Solution

Send **inputs only**, and run the **same deterministic simulation** on every machine:

1. The simulation advances in fixed **turns** (ticks).
2. Each player's commands for a turn are sent to everyone, scheduled a few turns **in the future** (the *input delay*), so they have time to arrive.
3. A machine may simulate turn *N* only when it has **every player's input for turn N**, even if that input is "nothing". This is the "lock" in lockstep.
4. Because everyone starts identically and applies identical inputs in an identical order, everyone computes **identical states**.
5. Peers exchange **checksums** of their state periodically. A mismatch is a **desync**, a bug that must be found and fixed.

Bandwidth no longer depends on the number of units. The trade-offs: the game runs at the speed of the **slowest connection** (everyone waits for the late player's input), every command takes the input delay to execute, and the simulation must be **bit-for-bit deterministic** ([Determinism](./determinism)).

## Example (Unity C#)

```csharp
using System.Collections.Generic;
using UnityEngine;

public struct PlayerCommand
{
    public int PlayerId;
    public int Turn;                  // the turn on which it executes
    public byte Type;                 // 0 = none, 1 = move, 2 = attack, ...
    public int TargetId;
    public int X, Y;                  // fixed-point coordinates: integers, never floats
}

public class LockstepSession
{
    const int InputDelay = 3;          // commands execute 3 turns after they are issued
    const int ChecksumEvery = 30;

    readonly int playerCount, localPlayer;
    readonly Simulation sim;           // deterministic: integer math, seeded RNG, ordered iteration
    readonly Dictionary<int, PlayerCommand[]> inputs = new();   // turn → one command per player
    readonly Dictionary<int, bool[]> received = new();          // turn → which players' input arrived
    readonly Queue<PlayerCommand> localPending = new();
    public int Turn { get; private set; }

    public LockstepSession(int playerCount, int localPlayer, Simulation sim)
    {
        this.playerCount = playerCount; this.localPlayer = localPlayer; this.sim = sim;
        for (int t = 0; t < InputDelay; t++)                       // the first turns have no input yet: fill with "none"
            for (int p = 0; p < playerCount; p++) Store(new PlayerCommand { PlayerId = p, Turn = t });
    }

    // UI calls this when the player issues an order.
    public void IssueCommand(PlayerCommand cmd) => localPending.Enqueue(cmd);

    // Called by the network layer for every command received from any peer (including our own echo).
    public void Receive(PlayerCommand cmd) => Store(cmd);

    void Store(PlayerCommand cmd)
    {
        if (cmd.Turn < Turn) return;                                   // too late or duplicate: already simulated
        if (!inputs.TryGetValue(cmd.Turn, out var arr))
        {
            inputs[cmd.Turn] = arr = new PlayerCommand[playerCount];
            received[cmd.Turn] = new bool[playerCount];
        }
        if (received[cmd.Turn][cmd.PlayerId]) return;                  // duplicate packet: keep the first
        arr[cmd.PlayerId] = cmd;
        received[cmd.Turn][cmd.PlayerId] = true;
    }

    // Called at a fixed rate (e.g. 10 turns per second for an RTS).
    public void TryAdvance()
    {
        // 1. Schedule this turn's local command (or "none") for Turn + InputDelay, and send it.
        var cmd = localPending.Count > 0 ? localPending.Dequeue() : new PlayerCommand();
        cmd.PlayerId = localPlayer;
        cmd.Turn = Turn + InputDelay;
        Store(cmd);
        Network.SendToAll(cmd);

        // 2. Lock: only simulate when every player's input for this turn has arrived.
        if (!HasAllInputs(Turn)) { Network.ShowWaitingForPlayers(); return; }   // stall, don't guess

        // 3. Apply inputs in a fixed order (by player id), then step the simulation.
        var turnInputs = inputs[Turn];
        for (int p = 0; p < playerCount; p++) sim.Apply(turnInputs[p]);
        sim.Step();
        inputs.Remove(Turn);
        received.Remove(Turn);

        // 4. Detect desyncs early.
        if (Turn % ChecksumEvery == 0) Network.SendChecksum(Turn, sim.Checksum());
        Turn++;
    }

    bool HasAllInputs(int turn)
    {
        if (!received.TryGetValue(turn, out var got)) return false;
        foreach (bool g in got) if (!g) return false;
        return true;
    }
}

// Simulation and checksums: see the Determinism page. Network: your transport (reliable, ordered channel).
// Remote checksum mismatch → log both states for that turn and stop: a desync is always a bug.
```

Each player sends exactly one command per turn, "none" included, so `HasAllInputs` can tell "nothing happened" apart from "not received yet". Storing ignores duplicates and late packets, so a resent packet can never change a turn that has already been decided.

## When to use

- RTS and other games with many units and few inputs: classic strategy games, city builders, large-scale simulations.
- Fighting games and other games with small player counts and perfectly deterministic simulations (often combined with [Rollback Netcode](./rollback-netcode)).
- Replays come for free: a match is its starting state plus the input log.

## When not to use

- Games with a lot of physics or third-party code you can't make deterministic. One mismatch desyncs the match.
- Games where players join mid-match or have unreliable connections. Everyone waits for the slowest player; use server-authoritative state sync.
- Small player counts with fast action. [Rollback Netcode](./rollback-netcode) hides latency better.

## Pitfalls

- **Desyncs.** Any non-determinism (floats across CPUs, unordered dictionaries, `UnityEngine.Random`, physics engines, frame-rate-dependent code) makes the simulations drift apart, often only after minutes. Fixed-point math, seeded RNG, ordered iteration and checksums are mandatory. See [Determinism](./determinism).
- **The slowest player sets the pace.** One player on a bad connection makes everyone stall. Show who everyone is waiting for, and adapt the input delay to measured latency.
- **Input latency.** Commands take effect after the input delay (100–300 ms). RTS players accept this, especially with immediate local feedback (an acknowledgement sound, a move marker). Action games usually do not.
- **Joining mid-game and reconnecting.** A late joiner must receive the full current state, or replay all inputs from the start. Both are complex. Plan for it early.
- **Cheating by information.** Every client simulates everything, including what fog of war hides, so map hacks can read it. Lockstep cannot prevent this.

## Related

- [Determinism](./determinism) and [Seeded Randomness](./seeded-randomness) — the foundation lockstep depends on.
- [Fixed Timestep](./fixed-timestep) — simulation advances in numbered turns.
- [Command](./command) — players exchange commands, not state.
- [Rollback Netcode](./rollback-netcode) — removes the input delay by predicting and correcting.
- [Replay System](./replay-system) — the input log is a replay.
