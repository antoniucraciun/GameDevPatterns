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

## Pseudocode

Every peer runs the same session; there is no server.

```text
input delay ← 3                  // commands execute 3 turns after they are issued
turn ← 0
inputs[t][player]                // one command per player per turn, "none" included
local pending ← queue of the local player's orders
scheduled ← input delay - 1      // last turn our own command was scheduled for

start:
    for each turn t in 0 … input delay - 1, for each player p:
        store("none" from p for turn t)    // nobody could send these in time

store(cmd):                      // our own commands and every received one
    if cmd.turn < turn: ignore it                         // late: already simulated
    if inputs[cmd.turn][cmd.player] is filled: ignore it  // duplicate: keep the first
    inputs[cmd.turn][cmd.player] ← cmd

every turn interval (e.g. 10 per second):
    // 1. Schedule one local command per turn, input delay turns ahead.
    if scheduled < turn + input delay:
        cmd ← next order from local pending, or "none"
        cmd.player ← local player;  cmd.turn ← turn + input delay
        store(cmd);  send cmd to every peer (reliable, in order)
        scheduled ← cmd.turn
    // 2. Lock: simulate only with every player's input for this turn.
    if any player's input for turn is missing:
        show "waiting for players";  return     // stall, never guess
    // 3. Apply in a fixed order, then step the deterministic simulation.
    for each player p in id order: apply inputs[turn][p]
    step the simulation;  forget inputs[turn]
    // 4. Detect desyncs early: a mismatch with any peer is a bug.
    if turn is a multiple of 30: send checksum of the state to every peer
    turn ← turn + 1
```

## Example

The lockstep session is engine-free logic in every tab: it decides **when** a turn may run and **which** commands it applies. The simulation itself and its checksum are on the [Determinism](./determinism) page; the network layer only has to deliver commands reliably and in order.

::: code-group

```csharp [Unity (C#)]
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
    int scheduledTurn = InputDelay - 1;  // the last turn our own command was scheduled for
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
        //    Once per turn: while stalled, Turn stays put, and a second command would be dropped.
        if (scheduledTurn < Turn + InputDelay)
        {
            var cmd = localPending.Count > 0 ? localPending.Dequeue() : new PlayerCommand();
            cmd.PlayerId = localPlayer;
            cmd.Turn = Turn + InputDelay;
            Store(cmd);
            Network.SendToAll(cmd);
            scheduledTurn = cmd.Turn;
        }

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

```gdscript [Godot (GDScript)]
# lockstep_session.gd: plain logic. The network layer connects send_command to a reliable RPC that
# reaches every peer (sending cmd.to_array(), since RPCs can't carry script objects) and calls
# receive() for every command that arrives, including our own echo.
class_name LockstepSession
extends RefCounted

signal send_command(cmd: PlayerCommand)
signal waiting_for_players
signal checksum_ready(turn: int, checksum: int)

const INPUT_DELAY := 3  # commands execute 3 turns after they are issued
const CHECKSUM_EVERY := 30


class PlayerCommand:
	var player_id := 0
	var turn := 0  # the turn on which it executes
	var kind := 0  # 0 = none, 1 = move, 2 = attack, ...
	var target_id := 0
	var x := 0  # fixed-point coordinates: integers, never floats
	var y := 0

	func to_array() -> PackedInt64Array:
		return PackedInt64Array([player_id, turn, kind, target_id, x, y])

	static func from_array(a: PackedInt64Array) -> PlayerCommand:
		var c := PlayerCommand.new()
		c.player_id = a[0]
		c.turn = a[1]
		c.kind = a[2]
		c.target_id = a[3]
		c.x = a[4]
		c.y = a[5]
		return c


var turn := 0
var _player_count: int
var _local_player: int
var _sim: Simulation  # deterministic: integer math, seeded RNG, ordered iteration
var _inputs := {}  # turn -> Array of one PlayerCommand per player
var _received := {}  # turn -> Array[bool]: which players' input arrived
var _local_pending: Array[PlayerCommand] = []
var _scheduled_turn := INPUT_DELAY - 1  # the last turn our own command was scheduled for


func _init(player_count: int, local_player: int, sim: Simulation) -> void:
	_player_count = player_count
	_local_player = local_player
	_sim = sim
	for t in INPUT_DELAY:  # the first turns have no input yet: fill with "none"
		for p in player_count:
			var none := PlayerCommand.new()
			none.player_id = p
			none.turn = t
			_store(none)


func issue_command(cmd: PlayerCommand) -> void:  # UI calls this when the player issues an order
	_local_pending.append(cmd)


func receive(cmd: PlayerCommand) -> void:
	_store(cmd)


func _store(cmd: PlayerCommand) -> void:
	if cmd.turn < turn:
		return  # too late or duplicate: already simulated
	if not _inputs.has(cmd.turn):
		var commands := []
		commands.resize(_player_count)
		var flags: Array[bool] = []
		flags.resize(_player_count)
		flags.fill(false)
		_inputs[cmd.turn] = commands
		_received[cmd.turn] = flags
	var got: Array[bool] = _received[cmd.turn]
	if got[cmd.player_id]:
		return  # duplicate packet: keep the first
	_inputs[cmd.turn][cmd.player_id] = cmd
	got[cmd.player_id] = true


# Called at a fixed rate (e.g. a Timer at 10 turns per second for an RTS).
func try_advance() -> void:
	# 1. Schedule this turn's local command (or "none") for turn + INPUT_DELAY, and send it.
	#    Once per turn: while stalled, turn stays put, and a second command would be dropped.
	if _scheduled_turn < turn + INPUT_DELAY:
		var cmd: PlayerCommand = _local_pending.pop_front() if not _local_pending.is_empty() else PlayerCommand.new()
		cmd.player_id = _local_player
		cmd.turn = turn + INPUT_DELAY
		_store(cmd)
		send_command.emit(cmd)
		_scheduled_turn = cmd.turn

	# 2. Lock: only simulate when every player's input for this turn has arrived.
	if not _has_all_inputs(turn):
		waiting_for_players.emit()  # stall, don't guess
		return

	# 3. Apply inputs in a fixed order (by player id), then step the simulation.
	for c: PlayerCommand in _inputs[turn]:
		_sim.apply(c)
	_sim.step()
	_inputs.erase(turn)
	_received.erase(turn)

	# 4. Detect desyncs early.
	if turn % CHECKSUM_EVERY == 0:
		checksum_ready.emit(turn, _sim.checksum())
	turn += 1


func _has_all_inputs(t: int) -> bool:
	return _received.has(t) and not _received[t].has(false)
```

```cpp [Unreal (C++)]
// LockstepSession.h: plain C++. The network layer sets the callbacks (SendToAll needs a reliable,
// ordered path to every peer) and calls Receive() for every command that arrives, including our own echo.
#pragma once

#include "CoreMinimal.h"
#include "Containers/Queue.h"
#include "Simulation.h"                                   // FSimulation: see the Determinism page

struct FPlayerCommand
{
	int32 PlayerId = 0;
	int32 Turn = 0;                                       // the turn on which it executes
	uint8 Type = 0;                                       // 0 = none, 1 = move, 2 = attack, ...
	int32 TargetId = 0;
	int32 X = 0, Y = 0;                                   // fixed-point coordinates: integers, never floats
};

class FLockstepSession
{
public:
	static constexpr int32 InputDelay = 3;                // commands execute 3 turns after they are issued
	static constexpr int32 ChecksumEvery = 30;

	TFunction<void(const FPlayerCommand&)> SendToAll;
	TFunction<void()> OnWaitingForPlayers;
	TFunction<void(int32 Turn, uint32 Checksum)> SendChecksum;

	FLockstepSession(int32 InPlayerCount, int32 InLocalPlayer, FSimulation& InSim)
		: PlayerCount(InPlayerCount), LocalPlayer(InLocalPlayer), Sim(InSim)
	{
		for (int32 T = 0; T < InputDelay; ++T)            // the first turns have no input yet: fill with "none"
			for (int32 P = 0; P < PlayerCount; ++P) Store({ P, T });
	}

	int32 GetTurn() const { return Turn; }
	void IssueCommand(const FPlayerCommand& Cmd) { LocalPending.Enqueue(Cmd); }   // UI: the player issued an order
	void Receive(const FPlayerCommand& Cmd) { Store(Cmd); }

	// Called at a fixed rate (a looping timer at e.g. 10 turns per second), never from a variable Tick.
	void TryAdvance()
	{
		// 1. Schedule this turn's local command (or "none") for Turn + InputDelay, and send it.
		//    Once per turn: while stalled, Turn stays put, and a second command would be dropped.
		if (ScheduledTurn < Turn + InputDelay)
		{
			FPlayerCommand Cmd;
			LocalPending.Dequeue(Cmd);                    // leaves Cmd as "none" if nothing is pending
			Cmd.PlayerId = LocalPlayer;
			Cmd.Turn = Turn + InputDelay;
			Store(Cmd);
			if (SendToAll) SendToAll(Cmd);
			ScheduledTurn = Cmd.Turn;
		}

		// 2. Lock: only simulate when every player's input for this turn has arrived.
		const FTurnInputs* Current = Inputs.Find(Turn);
		if (!Current || Current->Received.Contains(false))
		{
			if (OnWaitingForPlayers) OnWaitingForPlayers();   // stall, don't guess
			return;
		}

		// 3. Apply inputs in a fixed order (by player id), then step the simulation.
		for (const FPlayerCommand& C : Current->Commands) Sim.Apply(C);
		Sim.Step();
		Inputs.Remove(Turn);

		// 4. Detect desyncs early.
		if (Turn % ChecksumEvery == 0 && SendChecksum) SendChecksum(Turn, Sim.Checksum());
		++Turn;
	}

private:
	struct FTurnInputs
	{
		TArray<FPlayerCommand> Commands;                  // one per player
		TArray<bool> Received;
	};

	void Store(const FPlayerCommand& Cmd)
	{
		if (Cmd.Turn < Turn) return;                      // too late or duplicate: already simulated
		FTurnInputs* TurnInputs = Inputs.Find(Cmd.Turn);
		if (!TurnInputs)
		{
			TurnInputs = &Inputs.Add(Cmd.Turn);
			TurnInputs->Commands.SetNum(PlayerCount);
			TurnInputs->Received.Init(false, PlayerCount);
		}
		if (TurnInputs->Received[Cmd.PlayerId]) return;   // duplicate packet: keep the first
		TurnInputs->Commands[Cmd.PlayerId] = Cmd;
		TurnInputs->Received[Cmd.PlayerId] = true;
	}

	int32 PlayerCount;
	int32 LocalPlayer;
	FSimulation& Sim;                                     // deterministic: integer math, seeded RNG, ordered iteration
	TMap<int32, FTurnInputs> Inputs;                      // turn -> commands
	TQueue<FPlayerCommand> LocalPending;
	int32 Turn = 0;
	int32 ScheduledTurn = InputDelay - 1;                 // the last turn our own command was scheduled for
};
```

:::

Each player sends exactly one command per turn, "none" included, so `HasAllInputs` can tell "nothing happened" apart from "not received yet". Storing ignores duplicates and late packets, so a resent packet can never change a turn that has already been decided.

**Engine notes**

- **Unity:** None of Unity's netcode packages is lockstep; send commands over **Unity Transport** (a reliable, sequenced pipeline) or any reliable channel. Keep the simulation out of `MonoBehaviour`s and physics: built-in PhysX and Box2D aren't deterministic across machines, and float results can differ between Mono and IL2CPP, compilers and CPUs. Use fixed-point integers, or check the DOTS **Unity Physics** package's determinism guarantees (same build and platform) before relying on it.
- **Godot:** Send `cmd.to_array()` with an `@rpc("any_peer", "call_local", "reliable")` function; ENet delivers reliable packets on a channel in order. GDScript `int` is 64-bit and `float` is 64-bit, but neither Godot Physics nor Jolt is deterministic across machines, so units must move with your own integer math. Drive `try_advance` from a `Timer` or a turn counter in `_physics_process`, not from `_process`.
- **Unreal:** Unreal's networking is built around a server replicating state, not peers exchanging inputs. Relay commands through the server (a `Server` RPC on the player controller that the server forwards with a reliable `NetMulticast` or `Client` RPC), or use your own sockets. Chaos physics and `float` math across compilers and platforms aren't deterministic, so the simulation needs fixed-point integers and its own update loop driven by a looping `FTimerHandle`.

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
