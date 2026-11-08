# Rollback Netcode

> Predict remote inputs, then roll back and resimulate when the real ones arrive.

**Also known as:** GGPO-style · **Category:** Networking & Multiplayer

## Problem

A fighting game needs frame-perfect timing: a 3-frame window to punish, a 1-frame link. With [lockstep](./deterministic-lockstep), each input waits for the opponent's input of the same frame. At 100 ms ping, that is a 6-frame delay on every button press, which ruins the game. An authoritative server does not help with two players who are equally entitled to the truth. The game must respond **instantly** to local input, *and* both players must agree on what happened.

## Solution

Do not wait for remote input. **Guess it**, and fix the guess later:

1. Every frame, apply your **local input immediately**.
2. For the remote player, **predict** their input, usually "the same as their last known input". People mostly keep holding the same buttons.
3. **Save the game state** each frame (into a ring buffer), and simulate forward.
4. When the real remote input for an earlier frame *F* arrives:
   - If it matches the prediction, nothing happens. This is the usual case.
   - If it differs, **roll back**: restore the saved state of frame *F*, apply the correct input, and **resimulate** every frame from *F* to the present, in one rendered frame.
5. Visual and audio effects that were wrong get corrected on the next rendered frame.

A small **input delay** (1–3 frames) is often combined with rollback. It reduces how often and how far the game rolls back, trading a tiny, consistent delay for fewer visible corrections.

Requirements: a fully **deterministic** simulation, **cheap state saving and restoring**, and a simulation **fast enough to resimulate** several frames within one rendered frame.

## Example

A two-player rollback session, engine-free in every tab. `Simulation.Step` is the deterministic, pure game update (see [Determinism](./determinism)); the network layer delivers each side's inputs, unreliably and redundantly (the last few frames in every packet).

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public struct FrameInput : System.IEquatable<FrameInput>
{
    public sbyte X, Y;        // stick direction
    public byte Buttons;      // bitmask
    public bool Equals(FrameInput o) => X == o.X && Y == o.Y && Buttons == o.Buttons;
}

public struct GameState                        // plain data: copied by value to save/restore
{
    public int Frame;
    public FighterState P0, P1;                // positions as fixed-point ints, health, current move, frame counters...
}

public class RollbackSession
{
    const int MaxRollback = 8;                 // frames; beyond this, stall instead of rolling back further
    const int BufferSize = 32;

    readonly GameState[] savedStates = new GameState[BufferSize];
    readonly FrameInput[,] inputs = new FrameInput[BufferSize, 2];
    readonly int[] confirmedRemoteFrame = new int[BufferSize];  // which frame's REAL remote input is in this slot
    readonly int local, remote;

    GameState state;
    int lastConfirmedRemoteFrame = -1;
    FrameInput lastRemoteInput;
    int pendingRollbackFrom = -1;              // earliest frame with a wrong prediction

    public RollbackSession(int localPlayer, GameState initial)
    {
        local = localPlayer; remote = 1 - localPlayer; state = initial;
        for (int i = 0; i < BufferSize; i++) confirmedRemoteFrame[i] = -1;
    }

    bool IsConfirmed(int frame) => confirmedRemoteFrame[frame % BufferSize] == frame;

    // Network: the real remote input for some frame arrived (usually a past frame, sometimes a future one).
    public void OnRemoteInput(int frame, FrameInput input)
    {
        if (IsConfirmed(frame)) return;                              // duplicate packet
        int slot = frame % BufferSize;

        // Already simulated this frame with a prediction, and the prediction was wrong: roll back to it.
        if (frame < state.Frame && !inputs[slot, remote].Equals(input))
            pendingRollbackFrom = pendingRollbackFrom < 0 ? frame : Mathf.Min(pendingRollbackFrom, frame);

        inputs[slot, remote] = input;
        confirmedRemoteFrame[slot] = frame;
        if (frame > lastConfirmedRemoteFrame)
        {
            lastConfirmedRemoteFrame = frame;
            lastRemoteInput = input;                                 // basis for future predictions
        }
    }

    // Called once per rendered frame (fixed 60 Hz for a fighting game).
    public void Tick(FrameInput localInput)
    {
        // Don't run too far ahead of what the other side has confirmed: wait a frame instead.
        if (state.Frame - lastConfirmedRemoteFrame > MaxRollback) return;

        // 1. Correct the past if a prediction was wrong.
        if (pendingRollbackFrom >= 0)
        {
            int current = state.Frame;
            state = savedStates[pendingRollbackFrom % BufferSize];   // restore
            while (state.Frame < current) Advance();                 // resimulate with corrected inputs
            pendingRollbackFrom = -1;
        }

        // 2. Record this frame's inputs: real local, predicted remote (unless already known).
        int slot = state.Frame % BufferSize;
        inputs[slot, local] = localInput;
        if (!IsConfirmed(state.Frame))
            inputs[slot, remote] = lastRemoteInput;                  // prediction: repeat last known input
        Network.SendInput(state.Frame, localInput);

        // 3. Simulate the new frame.
        Advance();
    }

    void Advance()
    {
        int slot = state.Frame % BufferSize;
        savedStates[slot] = state;                                   // save BEFORE simulating this frame
        state = Simulation.Step(state, inputs[slot, 0], inputs[slot, 1]);   // deterministic, pure
    }

    public GameState Current => state;                               // the renderer draws this
}
```

```gdscript [Godot (GDScript)]
# rollback_session.gd: plain logic, driven from _physics_process at a fixed 60 Hz.
# A frame's input is packed into one int (stick x/y and buttons), so it compares with ==
# and travels as a single RPC argument. GameState is an object: saving MUST copy it.
class_name RollbackSession
extends RefCounted

signal send_input(frame: int, input: int)

const MAX_ROLLBACK := 8  # frames; beyond this, stall instead of rolling back further
const BUFFER_SIZE := 32

var _saved_states: Array[GameState] = []
var _inputs := PackedInt32Array()  # slot * 2 + player
var _confirmed_remote_frame := PackedInt32Array()  # which frame's REAL remote input is in this slot
var _local: int
var _remote: int
var _state: GameState
var _last_confirmed_remote_frame := -1
var _last_remote_input := 0
var _pending_rollback_from := -1  # earliest frame with a wrong prediction


func _init(local_player: int, initial: GameState) -> void:
	_local = local_player
	_remote = 1 - local_player
	_state = initial
	_saved_states.resize(BUFFER_SIZE)
	_inputs.resize(BUFFER_SIZE * 2)
	_confirmed_remote_frame.resize(BUFFER_SIZE)
	_confirmed_remote_frame.fill(-1)


func current() -> GameState:  # the renderer draws this
	return _state


func _is_confirmed(frame: int) -> bool:
	return _confirmed_remote_frame[frame % BUFFER_SIZE] == frame


# Network: the real remote input for some frame arrived (usually a past frame, sometimes a future one).
func on_remote_input(frame: int, input: int) -> void:
	if _is_confirmed(frame):
		return  # duplicate packet
	var slot := frame % BUFFER_SIZE

	# Already simulated this frame with a prediction, and the prediction was wrong: roll back to it.
	if frame < _state.frame and _inputs[slot * 2 + _remote] != input:
		_pending_rollback_from = frame if _pending_rollback_from < 0 else mini(_pending_rollback_from, frame)

	_inputs[slot * 2 + _remote] = input
	_confirmed_remote_frame[slot] = frame
	if frame > _last_confirmed_remote_frame:
		_last_confirmed_remote_frame = frame
		_last_remote_input = input  # basis for future predictions


func tick(local_input: int) -> void:
	# Don't run too far ahead of what the other side has confirmed: wait a frame instead.
	if _state.frame - _last_confirmed_remote_frame > MAX_ROLLBACK:
		return

	# 1. Correct the past if a prediction was wrong.
	if _pending_rollback_from >= 0:
		var current_frame := _state.frame
		_state = _saved_states[_pending_rollback_from % BUFFER_SIZE].copy()  # restore a COPY
		while _state.frame < current_frame:
			_advance()  # resimulate with corrected inputs
		_pending_rollback_from = -1

	# 2. Record this frame's inputs: real local, predicted remote (unless already known).
	var slot := _state.frame % BUFFER_SIZE
	_inputs[slot * 2 + _local] = local_input
	if not _is_confirmed(_state.frame):
		_inputs[slot * 2 + _remote] = _last_remote_input  # prediction: repeat last known input
	send_input.emit(_state.frame, local_input)

	# 3. Simulate the new frame.
	_advance()


func _advance() -> void:
	var slot := _state.frame % BUFFER_SIZE
	_saved_states[slot] = _state.copy()  # save BEFORE simulating; a reference would change with the game
	_state = Simulation.step(_state, _inputs[slot * 2], _inputs[slot * 2 + 1])  # deterministic, returns a new state

# GameState: frame plus plain fighter data, with copy() duplicating every field (no shared sub-objects).
```

```cpp [Unreal (C++)]
// RollbackSession.h: plain C++. FGameState must be plain data (no UObject pointers),
// so saving and restoring are plain copies.
#pragma once

#include "CoreMinimal.h"
#include "Simulation.h"                                   // FGameState, FSimulation::Step: deterministic, pure

struct FFrameInput
{
	int8 X = 0, Y = 0;                                    // stick direction
	uint8 Buttons = 0;                                    // bitmask
	bool operator==(const FFrameInput& O) const { return X == O.X && Y == O.Y && Buttons == O.Buttons; }
	bool operator!=(const FFrameInput& O) const { return !(*this == O); }
};

class FRollbackSession
{
public:
	static constexpr int32 MaxRollback = 8;               // frames; beyond this, stall instead of rolling back
	static constexpr int32 BufferSize = 32;

	TFunction<void(int32 Frame, FFrameInput Input)> SendInput;

	FRollbackSession(int32 LocalPlayer, const FGameState& Initial)
		: Local(LocalPlayer), Remote(1 - LocalPlayer), State(Initial)
	{
		for (int32& F : ConfirmedRemoteFrame) F = -1;
	}

	const FGameState& GetCurrent() const { return State; }   // the renderer draws this

	// Network: the real remote input for some frame arrived (usually a past frame, sometimes a future one).
	void OnRemoteInput(int32 Frame, FFrameInput Input)
	{
		if (IsConfirmed(Frame)) return;                   // duplicate packet
		const int32 Slot = Frame % BufferSize;

		// Already simulated this frame with a prediction, and the prediction was wrong: roll back to it.
		if (Frame < State.Frame && Inputs[Slot][Remote] != Input)
			PendingRollbackFrom = PendingRollbackFrom < 0 ? Frame : FMath::Min(PendingRollbackFrom, Frame);

		Inputs[Slot][Remote] = Input;
		ConfirmedRemoteFrame[Slot] = Frame;
		if (Frame > LastConfirmedRemoteFrame)
		{
			LastConfirmedRemoteFrame = Frame;
			LastRemoteInput = Input;                      // basis for future predictions
		}
	}

	// Called once per fixed 60 Hz step (accumulate DeltaTime in Tick: Unreal's frame rate isn't fixed).
	void Step(FFrameInput LocalInput)
	{
		// Don't run too far ahead of what the other side has confirmed: wait a frame instead.
		if (State.Frame - LastConfirmedRemoteFrame > MaxRollback) return;

		// 1. Correct the past if a prediction was wrong.
		if (PendingRollbackFrom >= 0)
		{
			const int32 CurrentFrame = State.Frame;
			State = SavedStates[PendingRollbackFrom % BufferSize];   // restore
			while (State.Frame < CurrentFrame) Advance();             // resimulate with corrected inputs
			PendingRollbackFrom = -1;
		}

		// 2. Record this frame's inputs: real local, predicted remote (unless already known).
		const int32 Slot = State.Frame % BufferSize;
		Inputs[Slot][Local] = LocalInput;
		if (!IsConfirmed(State.Frame)) Inputs[Slot][Remote] = LastRemoteInput;   // repeat last known input
		if (SendInput) SendInput(State.Frame, LocalInput);

		// 3. Simulate the new frame.
		Advance();
	}

private:
	bool IsConfirmed(int32 Frame) const { return ConfirmedRemoteFrame[Frame % BufferSize] == Frame; }

	void Advance()
	{
		const int32 Slot = State.Frame % BufferSize;
		SavedStates[Slot] = State;                        // save BEFORE simulating this frame
		State = FSimulation::Step(State, Inputs[Slot][0], Inputs[Slot][1]);
	}

	FGameState SavedStates[BufferSize];
	FFrameInput Inputs[BufferSize][2];
	int32 ConfirmedRemoteFrame[BufferSize];               // which frame's REAL remote input is in this slot
	int32 Local, Remote;
	FGameState State;
	int32 LastConfirmedRemoteFrame = -1;
	FFrameInput LastRemoteInput;
	int32 PendingRollbackFrom = -1;                       // earliest frame with a wrong prediction
};
```

:::

The state is plain data, so saving and restoring are plain copies (in GDScript, an explicit `copy()`). That is why rollback games keep their simulation state small and free of object references. Effects (sounds, particles) are triggered by comparing the rendered state with the previous rendered state, so resimulated frames do not replay sounds.

**Engine notes**

- **Unity:** Fighting-game rollback is commonly built with **GGPO** or its descendants, with the game state outside `MonoBehaviour`s. **Netcode for Entities** supports prediction and rollback for server-authoritative games (predicted ghosts are rolled back and resimulated on every snapshot). Unity's built-in physics can't be rolled back to an arbitrary frame, so collision for the simulation is written in fixed point.
- **Godot:** The **netfox** add-on provides rollback (`RollbackSynchronizer`, a fixed network tick, input prediction) for nodes, and is the usual starting point for rollback games in Godot 4. Writing your own as above needs the state outside the scene tree: nodes are expensive to snapshot, and physics bodies can't be restored and resimulated on demand.
- **Unreal:** There is no general rollback system. The **Network Prediction** plugin (experimental) runs fixed-tick simulations with prediction and resimulation, and Chaos physics has resimulation support for networked physics in recent 5.x versions, but both are server-authoritative designs, not peer-to-peer fighting-game rollback. A GGPO-style session like the one above lives outside actors, with the actors only showing its state.

## When to use

- Fighting games, platform fighters, and other 1v1 or small-group games with tight timing.
- Any peer-to-peer game where input delay is unacceptable and the simulation is small and deterministic.

## When not to use

- Large simulations with many objects. Re-simulating several frames each tick becomes too expensive.
- Games with many players. Mispredictions multiply, and rollbacks become visible.
- Non-deterministic simulations. Rollback needs [Determinism](./determinism) or full state saving every frame.

## Pitfalls

- **Non-determinism.** If resimulating does not reproduce exactly what the other side computed, the games diverge. Same rules as [Deterministic Lockstep](./deterministic-lockstep): fixed-point math, no engine physics, no unordered iteration, checksums.
- **Expensive state.** Saving the whole state every frame, and resimulating 8 frames in one, requires a compact state and a fast simulation. Keep game logic separate from Unity objects, in plain data that can be copied.
- **Visible corrections.** A long rollback can make a character teleport, or a hit that seemed to land vanish. A small input delay reduces this, and so do animations with a few frames of startup that hide corrections.
- **Side effects during resimulation.** Sounds, particles, hit stop and controller rumble must not fire again for frames that are resimulated. Trigger presentation from rendered state changes, not from inside `Step`.
- **Rollback limit.** With very high latency, the game would need to roll back too far. Cap it, and slow down or pause when the opponent falls too far behind.

## Related

- [Deterministic Lockstep](./deterministic-lockstep) — the same input exchange, without prediction.
- [Client-Side Prediction](./client-side-prediction) and [Server Reconciliation](./server-reconciliation) — the server-authoritative cousin: predict yourself, correct from the server.
- [Determinism](./determinism) — the foundation.
- [Memento](./memento) and [Double Buffer](./double-buffer) — saved frames are snapshots of the state.
- [Replay System](./replay-system) — confirmed inputs form a replay.
