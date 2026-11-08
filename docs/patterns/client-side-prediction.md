# Client-Side Prediction

> Apply local input immediately instead of waiting for the server round trip.

**Category:** Networking & Multiplayer

## Problem

With an [authoritative server](./authoritative-server), the client sends "move forward" and waits for the server's updated position. At 100 ms round-trip time, every key press feels a tenth of a second late. Movement feels like steering through syrup, and it gets worse as latency grows. The server must stay authoritative, or clients could cheat by reporting any position they like.

## Solution

The client **runs the same movement code as the server**, on its own inputs, right away. It shows the predicted result while the input is still travelling to the server.

1. Each input gets an increasing **sequence number**. The client applies it locally, stores it in a **pending inputs** buffer, and sends it to the server.
2. The server applies inputs in order. Its state updates include the **last input sequence it processed**.
3. When an update arrives, the client **reconciles**. It sets its state to the server's authoritative state, drops pending inputs the server has already processed, and **re-applies the remaining ones** on top. If the prediction was right, nothing visibly changes. If it was wrong, for example because another player blocked the path, the client snaps or smoothly corrects to the truth.

Prediction requires the movement simulation to be **deterministic enough**. Given the same state and input, client and server must produce the same result, or every update triggers a correction.

<NetSyncViz mode="prediction" />

## Example

Transport-agnostic in Unity (`Send` stands in for your networking library); Godot and Unreal use their built-in RPCs. The **core** is the shared simulation, which client and server must both run. The **engine wiring** predicts with it and reconciles when the server answers.

### Core

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public struct InputCmd
{
    public uint Sequence;
    public Vector2 Move;
    public bool Jump;
}

public struct PlayerState
{
    public Vector3 Position;
    public Vector3 Velocity;
}

// Shared by client and server: the SAME code must run on both.
public static class Movement
{
    public const float Step = 1f / 60f;

    public static PlayerState Simulate(PlayerState s, InputCmd input)
    {
        s.Velocity.x = input.Move.x * 6f;
        s.Velocity.z = input.Move.y * 6f;
        s.Position += s.Velocity * Step;
        return s;
    }
}
```

```gdscript [Godot (GDScript)]
# movement.gd: shared by client and server. The SAME code must run on both.
class_name Movement

const STEP := 1.0 / 60.0  # matches the default 60 physics ticks per second


class InputCmd:
	var sequence: int
	var move: Vector2
	var jump: bool

	func _init(seq: int, m: Vector2, j: bool) -> void:
		sequence = seq
		move = m
		jump = j


class PlayerState:
	var position := Vector3.ZERO
	var velocity := Vector3.ZERO

	func copy() -> PlayerState:
		var c := PlayerState.new()
		c.position = position
		c.velocity = velocity
		return c


# Returns a NEW state: objects are shared by reference in GDScript, and the replay
# must never modify a state that something else still holds.
static func simulate(s: PlayerState, input: InputCmd) -> PlayerState:
	var next := s.copy()
	next.velocity.x = input.move.x * 6.0
	next.velocity.z = -input.move.y * 6.0  # forward is -Z in Godot
	next.position += next.velocity * STEP
	return next
```

```cpp [Unreal (C++)]
// PredictionTypes.h: shared by client and server. The SAME code must run on both.
#pragma once

#include "CoreMinimal.h"
#include "PredictionTypes.generated.h"

USTRUCT()
struct FInputCmd
{
	GENERATED_BODY()

	UPROPERTY() int32 Sequence = 0;
	UPROPERTY() FVector2D Move = FVector2D::ZeroVector;    // X = right, Y = forward
	UPROPERTY() bool bJump = false;
};

USTRUCT()
struct FPredictedState
{
	GENERATED_BODY()

	UPROPERTY() FVector Position = FVector::ZeroVector;
	UPROPERTY() FVector Velocity = FVector::ZeroVector;
};

namespace PredictedMovement
{
	constexpr float Step = 1.f / 60.f;

	inline FPredictedState Simulate(FPredictedState S, const FInputCmd& Input)
	{
		S.Velocity.X = Input.Move.Y * 600.f;                // cm/s; Unreal's forward is +X
		S.Velocity.Y = Input.Move.X * 600.f;
		S.Position += S.Velocity * Step;
		return S;
	}
}
```

:::

### Engine wiring

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public class PredictedPlayer : MonoBehaviour
{
    readonly List<InputCmd> pending = new();
    PlayerState state;
    uint nextSequence;

    // Called once per fixed simulation step (Fixed Timestep set to 1/60 to match Movement.Step).
    void FixedUpdate()
    {
        var input = new InputCmd
        {
            Sequence = nextSequence++,
            Move = new Vector2(Input.GetAxisRaw("Horizontal"), Input.GetAxisRaw("Vertical")),
        };

        state = Movement.Simulate(state, input);   // 1. predict immediately
        pending.Add(input);                        //    remember it for reconciliation
        Send(input);                               //    and tell the server

        transform.position = state.Position;
    }

    // Called when an authoritative update for this player arrives.
    public void OnServerState(PlayerState serverState, uint lastProcessedSequence)
    {
        state = serverState;                                          // 2. accept the truth
        pending.RemoveAll(i => i.Sequence <= lastProcessedSequence);  // 3. drop acknowledged inputs
        foreach (var input in pending)                                // 4. replay the rest
            state = Movement.Simulate(state, input);

        transform.position = state.Position;
    }

    void Send(InputCmd input) { /* serialise and send to the server */ }
}
```

```gdscript [Godot (GDScript)]
# predicted_player.gd: the same scene on server and clients; owner_peer_id is set when it is spawned.
extends Node3D

@export var owner_peer_id := 1

var _pending: Array[Movement.InputCmd] = []
var _state := Movement.PlayerState.new()
var _next_sequence := 0


func _physics_process(_delta: float) -> void:
	if owner_peer_id != multiplayer.get_unique_id():
		return  # only the owning client predicts
	var input := Movement.InputCmd.new(_next_sequence,
			Input.get_vector("move_left", "move_right", "move_back", "move_forward"),
			Input.is_action_pressed("jump"))
	_next_sequence += 1

	_state = Movement.simulate(_state, input)  # 1. predict immediately
	_pending.append(input)                    #    remember it for reconciliation
	_receive_input.rpc_id(1, input.sequence, input.move, input.jump)  # and tell the server
	position = _state.position


# Server: simulate the input and acknowledge it (Server Reconciliation queues these per tick).
@rpc("any_peer", "call_remote", "unreliable_ordered")
func _receive_input(sequence: int, move: Vector2, jump: bool) -> void:
	if multiplayer.get_remote_sender_id() != owner_peer_id:
		return
	_state = Movement.simulate(_state, Movement.InputCmd.new(sequence, move, jump))
	position = _state.position
	_server_state.rpc_id(owner_peer_id, _state.position, _state.velocity, sequence)


# Owning client: an authoritative update arrived.
@rpc("authority", "call_remote", "unreliable_ordered")
func _server_state(server_position: Vector3, server_velocity: Vector3, last_processed: int) -> void:
	_state = Movement.PlayerState.new()  # 2. accept the truth
	_state.position = server_position
	_state.velocity = server_velocity
	_pending = _pending.filter(func(i: Movement.InputCmd) -> bool: return i.sequence > last_processed)  # 3. drop acked
	for input in _pending:                                                                            # 4. replay
		_state = Movement.simulate(_state, input)
	position = _state.position
```

```cpp [Unreal (C++)]
// PredictedMovementComponent.h: for a non-character pawn (hover vehicle, ball). ACharacter already has this.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "PredictionTypes.h"
#include "PredictedMovementComponent.generated.h"

UCLASS(ClassGroup = (Game), meta = (BlueprintSpawnableComponent))
class UPredictedMovementComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UPredictedMovementComponent();
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	void SetMoveInput(FVector2D Move) { MoveInput = Move; }   // from the pawn's Enhanced Input handler

private:
	UFUNCTION(Server, Unreliable)
	void ServerReceiveInput(const FInputCmd& Input);

	UFUNCTION(Client, Unreliable)
	void ClientReceiveState(const FPredictedState& ServerState, int32 LastProcessedSequence);

	TArray<FInputCmd> Pending;
	FPredictedState State;
	FVector2D MoveInput = FVector2D::ZeroVector;
	int32 NextSequence = 0;
	float Accumulator = 0.f;
};

// PredictedMovementComponent.cpp
#include "PredictedMovementComponent.h"

UPredictedMovementComponent::UPredictedMovementComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	SetIsReplicatedByDefault(true);
}

void UPredictedMovementComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	if (GetOwnerRole() != ROLE_AutonomousProxy) return;     // only the owning client predicts

	// Unreal ticks with a variable delta: step the shared simulation at its fixed rate.
	for (Accumulator += DeltaTime; Accumulator >= PredictedMovement::Step; Accumulator -= PredictedMovement::Step)
	{
		FInputCmd Input;
		Input.Sequence = NextSequence++;
		Input.Move = MoveInput;

		State = PredictedMovement::Simulate(State, Input);  // 1. predict immediately
		Pending.Add(Input);                                 //    remember it for reconciliation
		ServerReceiveInput(Input);                          //    and tell the server
	}
	GetOwner()->SetActorLocation(State.Position);
}

void UPredictedMovementComponent::ServerReceiveInput_Implementation(const FInputCmd& Input)
{
	// Server Reconciliation queues these and applies one per tick; here they are applied on arrival.
	State = PredictedMovement::Simulate(State, Input);
	GetOwner()->SetActorLocation(State.Position);
	ClientReceiveState(State, Input.Sequence);
}

void UPredictedMovementComponent::ClientReceiveState_Implementation(const FPredictedState& ServerState, int32 LastProcessedSequence)
{
	State = ServerState;                                                                     // 2. accept the truth
	Pending.RemoveAll([LastProcessedSequence](const FInputCmd& I) { return I.Sequence <= LastProcessedSequence; });  // 3.
	for (const FInputCmd& Input : Pending)                                                   // 4. replay the rest
		State = PredictedMovement::Simulate(State, Input);
	GetOwner()->SetActorLocation(State.Position);
}
```

:::

**Engine notes**

- **Unity:** **Netcode for Entities** provides prediction and reconciliation out of the box (predicted ghosts and the prediction loop). **Netcode for GameObjects** does not: `NetworkTransform` is either server- or owner-authoritative, so for predicted, server-authoritative movement you build it on top, much like the code above.
- **Godot:** The high-level multiplayer API has RPCs and `MultiplayerSynchronizer` but no prediction. The **netfox** add-on provides client-side prediction and rollback (`RollbackSynchronizer`) on a fixed network tick. Godot's physics engine isn't deterministic between machines, so predicted movement like this is usually written by hand, as here, rather than with rigid bodies.
- **Unreal:** `ACharacter`'s **`UCharacterMovementComponent` already predicts**: it saves moves, sends them to the server, replays unacknowledged moves when corrected, and smooths the result. Extend it (custom `FSavedMove_Character` flags for sprint or dash) before writing your own. The **Network Prediction** plugin (experimental) generalises the idea to other simulations. The component above is for simple non-character pawns; a listen-server host's own pawn has `ROLE_Authority` and simulates directly.

## When to use

- Anything the local player directly controls where latency is felt: movement, aiming, firing effects, ability activation.
- Server-authoritative games where clients are not trusted.

## When not to use

- Things the player doesn't control directly, such as other players or NPCs. Use [Entity Interpolation](./entity-interpolation).
- Slow-paced or turn-based games, where waiting for the server is barely noticeable.
- Outcomes that are hard to undo if the prediction is wrong, such as deaths, loot or purchases. Wait for the server and play an anticipation effect.

## Pitfalls

- **Non-deterministic simulation.** Different code paths, `Time.deltaTime` instead of a fixed step, or physics that is not replayable all cause constant corrections and rubber-banding. Keep predicted logic in pure functions driven by a [Fixed Timestep](./fixed-timestep).
- **Predicting things you do not control.** Other players and server-driven objects are usually interpolated, not predicted.
- **Hard snaps on correction.** Smooth the visual position toward the corrected state over a few frames, while the simulation state snaps instantly.
- **Irreversible side effects.** Kill confirmations and loot pickups should wait for the server, even if their effects are predicted.

## Related

- [Command](./command) — each input is a command, recorded so it can be replayed.
- [Fixed Timestep](./fixed-timestep) — prediction needs constant, numbered steps.
- [Server Reconciliation](./server-reconciliation) — the correction half of prediction, covered in depth.
- [Entity Interpolation](./entity-interpolation) — how *other* players are shown smoothly.
- [Lag Compensation](./lag-compensation) — the server-side counterpart for hit detection.
