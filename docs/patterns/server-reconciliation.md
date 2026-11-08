# Server Reconciliation

> Rewind to the server state and replay unacknowledged inputs to fix mispredictions.

**Category:** Networking & Multiplayer

## Problem

With [Client-Side Prediction](./client-side-prediction), the client moves the player immediately. The server's state updates are always one round trip *behind* the client. When an update says "you are at x = 10", the client has already predicted x = 14 from the inputs it sent since. Snapping to 10 throws the player backwards every update, which is constant rubber-banding, even though nothing went wrong. And when something *did* go wrong (another player blocked you, or you were stunned), the client must correct without losing the inputs still in flight.

## Solution

Both sides number inputs, and the server says which ones it has applied.

**Server:**
1. Keep a queue of received inputs per client, ordered by sequence number.
2. Each server tick, apply the next input(s) through the *same* simulation code the client uses.
3. Send state updates that include `lastProcessedInput`, the highest sequence number already applied.

**Client:**
1. On receiving an update, **rewind**: set the local state to the server's state.
2. **Discard** pending inputs with sequence ≤ `lastProcessedInput`. They are already included in that state.
3. **Replay** the remaining pending inputs on top. The result is the new predicted present.
4. If the replayed state differs from what was displayed, **smooth** the visible difference over a few frames instead of snapping.

If prediction was correct, the replay lands exactly where the client already was, and nothing visible happens. Corrections appear only when the server knew something the client did not.

<NetSyncViz mode="prediction" />

## Pseudocode

```text
// Shared: simulate(state, input) is the same pure step on both sides.
// Sequence numbers start at 1, so 0 means "nothing processed yet".

// ── Server, per client ──
queue ← inputs ordered by sequence
state
last processed ← 0

on input packet (the client's last few inputs):    // redundancy against loss
    for each input in the packet:
        if input.sequence > last processed and it is not queued yet:
            add input to queue                     // duplicates are expected

every server tick:
    if queue is empty: do nothing                  // starved: inputs are late
    input ← take the lowest sequence out of queue  // one input per tick
    state ← simulate(state, input)
    last processed ← input.sequence
    // state updates carry (state, last processed) back to the client

// ── Owning client ──
predicted; pending ← empty list
visual offset ← 0                    // shown = predicted + offset

every fixed step, after sending input:
    predicted ← simulate(predicted, input);  add input to pending

on server update (server state, ack):
    before ← predicted.position
    predicted ← server state                        // 1. rewind
    remove from pending every input with sequence ≤ ack   // 2. discard
    for each input in pending, oldest first:        // 3. replay the rest
        predicted ← simulate(predicted, input)
    error ← before - predicted.position
    if error is longer than 2 m: visual offset ← 0  // a teleport: snap
    else: visual offset ← visual offset + error     // 4. smooth it out

every frame:
    visual offset ← visual offset × e^(-15 × frame time)   // decays to zero
    place the body at predicted.position
    draw the mesh at predicted.position + visual offset
```

## Example

Shared types and simulation, as in [Client-Side Prediction](./client-side-prediction). Sequence numbers start at 1, so 0 can mean "nothing processed yet":

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public struct InputCmd { public uint Sequence; public Vector2 Move; }
public struct PlayerState { public Vector3 Position; }

public static class Movement
{
    public const float Step = 1f / 60f;
    public static PlayerState Simulate(PlayerState s, InputCmd i)
    {
        s.Position += new Vector3(i.Move.x, 0f, i.Move.y) * (6f * Step);
        return s;
    }
}
```

```gdscript [Godot (GDScript)]
# movement.gd
class_name Movement

const STEP := 1.0 / 60.0


class InputCmd:
	var sequence: int
	var move: Vector2

	func _init(seq: int, m: Vector2) -> void:
		sequence = seq
		move = m


class PlayerState:
	var position := Vector3.ZERO


# Returns a new state: never modify one that a buffer or the server still holds.
static func simulate(s: PlayerState, i: InputCmd) -> PlayerState:
	var next := PlayerState.new()
	next.position = s.position + Vector3(i.move.x, 0.0, -i.move.y) * (6.0 * STEP)
	return next
```

```cpp [Unreal (C++)]
// ReconciliationTypes.h
#pragma once

#include "CoreMinimal.h"
#include "ReconciliationTypes.generated.h"

USTRUCT()
struct FInputCmd
{
	GENERATED_BODY()
	UPROPERTY() int32 Sequence = 0;
	UPROPERTY() FVector2D Move = FVector2D::ZeroVector;     // X = right, Y = forward
};

USTRUCT()
struct FPredictedState
{
	GENERATED_BODY()
	UPROPERTY() FVector Position = FVector::ZeroVector;
};

namespace PredictedMovement
{
	constexpr float Step = 1.f / 60.f;

	inline FPredictedState Simulate(FPredictedState S, const FInputCmd& I)
	{
		S.Position += FVector(I.Move.Y, I.Move.X, 0.f) * (600.f * Step);
		return S;
	}
}
```

:::

**Server side:** apply queued inputs, acknowledge the last one.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;

public class ServerPlayer
{
    readonly SortedList<uint, InputCmd> queue = new();
    PlayerState state;
    uint lastProcessed;                         // 0 = nothing yet

    // Clients send their last few inputs in every packet (redundancy against packet loss),
    // so duplicates and already-processed inputs are expected and ignored here.
    public void Receive(InputCmd[] inputs)
    {
        foreach (var input in inputs)
            if (input.Sequence > lastProcessed && !queue.ContainsKey(input.Sequence))
                queue.Add(input.Sequence, input);
    }

    public void ServerTick()
    {
        // One input per tick keeps client and server stepping at the same rate.
        if (queue.Count == 0) return;   // starved: the client's inputs are late (see pitfalls)

        var input = queue.Values[0];
        queue.RemoveAt(0);
        state = Movement.Simulate(state, input);
        lastProcessed = input.Sequence;
    }

    public (PlayerState state, uint ack) Snapshot() => (state, lastProcessed);
}
```

```gdscript [Godot (GDScript)]
# server_player.gd: plain logic. The player node's RPC passes the received inputs to receive(),
# and the server calls server_tick() from _physics_process.
class_name ServerPlayer
extends RefCounted

var state := Movement.PlayerState.new()
var last_processed := 0  # 0 = nothing yet
var _queue := {}  # sequence -> Movement.InputCmd


# Clients send their last few inputs in every packet (redundancy against packet loss),
# so duplicates and already-processed inputs are expected and ignored here.
func receive(inputs: Array[Movement.InputCmd]) -> void:
	for input in inputs:
		if input.sequence > last_processed and not _queue.has(input.sequence):
			_queue[input.sequence] = input


func server_tick() -> void:
	# One input per tick keeps client and server stepping at the same rate.
	if _queue.is_empty():
		return  # starved: the client's inputs are late (see pitfalls)
	var sequence: int = _queue.keys().min()
	state = Movement.simulate(state, _queue[sequence])
	_queue.erase(sequence)
	last_processed = sequence
```

```cpp [Unreal (C++)]
// ServerInputQueue.h: plain C++ owned by the server's movement component. Its Server RPC passes
// received inputs to Receive(); its server-side tick calls ServerTick() once per fixed step.
#pragma once

#include "ReconciliationTypes.h"

class FServerInputQueue
{
public:
	// Clients send their last few inputs in every packet (redundancy against packet loss),
	// so duplicates and already-processed inputs are expected and ignored here.
	void Receive(TConstArrayView<FInputCmd> Inputs)
	{
		for (const FInputCmd& Input : Inputs)
		{
			if (Input.Sequence <= LastProcessed) continue;
			int32 Index = 0;                                  // keep Queue sorted by sequence
			while (Index < Queue.Num() && Queue[Index].Sequence < Input.Sequence) ++Index;
			if (Index < Queue.Num() && Queue[Index].Sequence == Input.Sequence) continue;   // duplicate
			Queue.Insert(Input, Index);
		}
	}

	void ServerTick()
	{
		// One input per tick keeps client and server stepping at the same rate.
		if (Queue.IsEmpty()) return;                         // starved: the client's inputs are late
		const FInputCmd Input = Queue[0];
		Queue.RemoveAt(0);
		State = PredictedMovement::Simulate(State, Input);
		LastProcessed = Input.Sequence;
	}

	const FPredictedState& GetState() const { return State; }
	int32 GetLastProcessed() const { return LastProcessed; }   // sent to the client as its ack

private:
	TArray<FInputCmd> Queue;
	FPredictedState State;
	int32 LastProcessed = 0;                                  // 0 = nothing yet
};
```

:::

**Client side:** rewind, replay, and smooth the visible error.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public class ReconcilingPlayer : MonoBehaviour
{
    readonly List<InputCmd> pending = new();
    PlayerState predicted;
    Vector3 visualOffset;                       // shown position = predicted + offset, decays to zero

    public void OnLocalInput(InputCmd input)    // called every fixed step after sending the input
    {
        predicted = Movement.Simulate(predicted, input);
        pending.Add(input);
    }

    public void OnServerSnapshot(PlayerState serverState, uint ack)
    {
        Vector3 before = predicted.Position;

        predicted = serverState;                                  // 1. rewind
        pending.RemoveAll(i => i.Sequence <= ack);                // 2. discard acknowledged
        foreach (var input in pending)                            // 3. replay the rest
            predicted = Movement.Simulate(predicted, input);

        Vector3 error = before - predicted.Position;
        if (error.sqrMagnitude > 4f) visualOffset = Vector3.zero; // huge error (teleport): snap
        else visualOffset += error;                               // 4. small error: smooth it out
    }

    void Update()
    {
        visualOffset = Vector3.Lerp(visualOffset, Vector3.zero, 1f - Mathf.Exp(-15f * Time.deltaTime));
        transform.position = predicted.Position + visualOffset;
    }
}
```

```gdscript [Godot (GDScript)]
# reconciling_player.gd: the body sits at the predicted position; only the mesh shows the smoothed error.
extends Node3D

@onready var _visual: Node3D = $Visual

var _pending: Array[Movement.InputCmd] = []
var _predicted := Movement.PlayerState.new()
var _visual_offset := Vector3.ZERO  # shown position = predicted + offset, decays to zero


func on_local_input(input: Movement.InputCmd) -> void:  # every physics tick, after sending the input
	_predicted = Movement.simulate(_predicted, input)
	_pending.append(input)


func on_server_snapshot(server_state: Movement.PlayerState, ack: int) -> void:
	var before := _predicted.position

	_predicted = server_state                                                     # 1. rewind
	_pending = _pending.filter(func(i: Movement.InputCmd) -> bool: return i.sequence > ack)  # 2. discard acked
	for input in _pending:                                                        # 3. replay the rest
		_predicted = Movement.simulate(_predicted, input)

	var error := before - _predicted.position
	if error.length_squared() > 4.0:
		_visual_offset = Vector3.ZERO  # huge error (teleport): snap
	else:
		_visual_offset += error  # 4. small error: smooth it out


func _process(delta: float) -> void:
	_visual_offset = _visual_offset.lerp(Vector3.ZERO, 1.0 - exp(-15.0 * delta))
	global_position = _predicted.position
	_visual.global_position = _predicted.position + _visual_offset
```

```cpp [Unreal (C++)]
// ReconcilingMovementComponent.h: the actor (and its collision) sits at the predicted position;
// only the visual mesh shows the smoothed error.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "ReconciliationTypes.h"
#include "ReconcilingMovementComponent.generated.h"

UCLASS(ClassGroup = (Game), meta = (BlueprintSpawnableComponent))
class UReconcilingMovementComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UReconcilingMovementComponent() { PrimaryComponentTick.bCanEverTick = true; }

	void OnLocalInput(const FInputCmd& Input);                 // every fixed step, after sending the input
	void OnServerSnapshot(const FPredictedState& ServerState, int32 Ack);   // from a Client RPC
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	UPROPERTY(EditAnywhere)
	TObjectPtr<USceneComponent> Visual;                        // the mesh, attached to the actor

private:
	TArray<FInputCmd> Pending;
	FPredictedState Predicted;
	FVector VisualOffset = FVector::ZeroVector;                // shown = predicted + offset, decays to zero
};

// ReconcilingMovementComponent.cpp
#include "ReconcilingMovementComponent.h"

void UReconcilingMovementComponent::OnLocalInput(const FInputCmd& Input)
{
	Predicted = PredictedMovement::Simulate(Predicted, Input);
	Pending.Add(Input);
}

void UReconcilingMovementComponent::OnServerSnapshot(const FPredictedState& ServerState, int32 Ack)
{
	const FVector Before = Predicted.Position;

	Predicted = ServerState;                                                       // 1. rewind
	Pending.RemoveAll([Ack](const FInputCmd& I) { return I.Sequence <= Ack; });    // 2. discard acknowledged
	for (const FInputCmd& Input : Pending)                                         // 3. replay the rest
		Predicted = PredictedMovement::Simulate(Predicted, Input);

	const FVector Error = Before - Predicted.Position;
	if (Error.SizeSquared() > FMath::Square(200.f)) VisualOffset = FVector::ZeroVector;   // > 2 m: snap
	else VisualOffset += Error;                                                    // 4. small error: smooth it
}

void UReconcilingMovementComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	VisualOffset *= FMath::Exp(-15.f * DeltaTime);
	GetOwner()->SetActorLocation(Predicted.Position);
	if (Visual) Visual->SetWorldLocation(Predicted.Position + VisualOffset);
}
```

:::

**Engine notes**

- **Unity:** **Netcode for Entities** reconciles predicted ghosts for you: it rolls back to the last server snapshot and re-runs the prediction systems each frame, and its prediction smoothing handles the visible error. With **Netcode for GameObjects** you write this yourself, sending inputs through RPCs and the authoritative state back to the owner.
- **Godot:** Nothing built in reconciles. Send the inputs with an `unreliable_ordered` RPC (last few sequences and moves as `PackedInt32Array` / `PackedVector2Array`, since RPC arguments can't be script objects) and the snapshot back with `rpc_id(owner, ...)`. The **netfox** add-on implements this loop, including rollback of several nodes together.
- **Unreal:** `UCharacterMovementComponent` already does all of this for characters: `ServerMove` carries the client's saved moves, the server answers with an acknowledgement or a correction (`ClientAdjustPosition`), and the client replays its unacknowledged `FSavedMove_Character`s. Mesh smoothing hides small corrections. Write your own only for non-character simulations, or use the experimental **Network Prediction** plugin.

## When to use

- Every server-authoritative game that uses client-side prediction. The two always go together.
- Any predicted state, not just movement: ammo counts, ability cooldowns, stamina.

## When not to use

- Games without client-side prediction. There is nothing to reconcile.
- Purely cosmetic state, such as particle effects or footstep sounds. Let small differences go.

## Pitfalls

- **Simulation mismatch.** If client and server simulate differently (different code paths, variable `deltaTime`, physics that cannot be re-run), every update produces a correction. Share one pure simulation function, and see [Determinism](./determinism).
- **Replaying things that cannot be replayed.** Engine physics and animation-driven root motion cannot be rewound and re-stepped cheaply. Use kinematic, code-driven movement for predicted entities, or a physics engine that supports manual stepping (such as Unity's `Physics.Simulate`) and accept the cost.
- **Input starvation.** If the server runs out of queued inputs because of jitter, it either stalls the player or guesses. Keep a small input buffer on the server (a few ticks), and send recent inputs redundantly so one lost packet does not create a gap.
- **Replaying side effects.** Replay must not re-trigger sounds, particles or "you fired" events. Separate simulation from presentation, and only present the final result.
- **Unbounded pending lists.** If acknowledgements stop arriving, `pending` grows forever. Cap it, and treat a long silence as a disconnect.

## Related

- [Client-Side Prediction](./client-side-prediction) — the half that runs ahead. Reconciliation is the half that corrects it.
- [Entity Interpolation](./entity-interpolation) — how *other* players are shown, without prediction.
- [Command](./command) — inputs as numbered, replayable data.
- [Fixed Timestep](./fixed-timestep) — client and server must step at the same rate.
- [Lag Compensation](./lag-compensation) — the server-side counterpart for hit detection.
