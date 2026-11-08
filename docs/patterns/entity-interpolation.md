# Entity Interpolation

> Render remote entities slightly in the past, smoothing between received snapshots.

**Category:** Networking & Multiplayer

## Problem

The server sends the positions of other players 20 times a second, but the client renders at 60–144 FPS. Applying each update as it arrives makes remote players teleport in 50 ms jumps. Packets also arrive unevenly: two at once, then nothing for 80 ms. Predicting other players the way you predict yourself does not work, because you do not have their inputs.

## Solution

Do not show remote entities where they are *now*. Show where they were a short, fixed time **in the past**, a moment for which you already have snapshots on *both sides*.

1. **Buffer** incoming snapshots with their server timestamp.
2. Each frame, compute a **render time**: `estimated server time − interpolation delay`. A typical delay is 2–3 snapshot intervals, for example 100 ms at 20 Hz.
3. Find the two buffered snapshots that bracket the render time, and **interpolate** between them.
4. Drop snapshots older than the earlier one.

Because the delay covers more than one interval, a single late or lost packet does not cause a hitch. There is still a newer snapshot to interpolate towards.

```
snapshots:    t=1.00      t=1.05      t=1.10      t=1.15 (latest)
                           ▲───── render time = 1.15 − 0.10 = 1.05…1.10
                         interpolate between these two
```

<NetSyncViz mode="interpolation" />

## Example

A snapshot buffer on each remote entity, rendered a fixed delay behind the estimated server time. Unity and Godot estimate the server clock themselves; Unreal's game state already provides one.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public struct Snapshot
{
    public double ServerTime;
    public Vector3 Position;
    public Quaternion Rotation;
}

public class InterpolatedEntity : MonoBehaviour
{
    [SerializeField] double interpolationDelay = 0.1;   // seconds; ~2–3 snapshot intervals
    [SerializeField] double maxExtrapolation = 0.25;     // how long to keep moving if packets stop

    readonly List<Snapshot> buffer = new();

    // Called by the networking layer when a state update for this entity arrives.
    public void AddSnapshot(Snapshot s)
    {
        // Packets can arrive out of order: insert sorted, ignore duplicates and stale ones.
        if (buffer.Count > 0 && s.ServerTime <= buffer[0].ServerTime) return;
        int i = buffer.Count;
        while (i > 0 && buffer[i - 1].ServerTime > s.ServerTime) i--;
        if (i > 0 && buffer[i - 1].ServerTime == s.ServerTime) return;
        buffer.Insert(i, s);
    }

    void Update()
    {
        if (buffer.Count == 0) return;

        double renderTime = NetClock.EstimatedServerTime - interpolationDelay;

        // Drop snapshots we have moved past, keeping one before renderTime.
        while (buffer.Count >= 2 && buffer[1].ServerTime <= renderTime)
            buffer.RemoveAt(0);

        if (buffer.Count >= 2 && buffer[0].ServerTime <= renderTime)
        {
            // Normal case: interpolate between the two bracketing snapshots.
            Snapshot a = buffer[0], b = buffer[1];
            float t = (float)((renderTime - a.ServerTime) / (b.ServerTime - a.ServerTime));
            transform.SetPositionAndRotation(
                Vector3.Lerp(a.Position, b.Position, t),
                Quaternion.Slerp(a.Rotation, b.Rotation, t));
        }
        else if (buffer.Count >= 2)
        {
            // renderTime is before our oldest snapshot (just connected): show the oldest.
            transform.SetPositionAndRotation(buffer[0].Position, buffer[0].Rotation);
        }
        else
        {
            // Starved: only one snapshot left. Extrapolate briefly, then hold still.
            Snapshot last = buffer[0];
            transform.SetPositionAndRotation(last.Position, last.Rotation);
            // For a short extrapolation, keep the last known velocity per entity and
            // add velocity * Min(renderTime - last.ServerTime, maxExtrapolation).
        }
    }
}

// Estimated server time: local clock plus an offset measured from pings and smoothed.
public static class NetClock
{
    static double offset;   // serverTime - localTime, updated from time-sync messages

    public static double EstimatedServerTime => Time.realtimeSinceStartupAsDouble + offset;

    public static void OnTimeSync(double serverTime, double roundTripTime)
    {
        double sample = serverTime + roundTripTime / 2 - Time.realtimeSinceStartupAsDouble;
        offset = offset == 0 ? sample : offset + (sample - offset) * 0.1;   // smooth out jitter
    }
}
```

```gdscript [Godot (GDScript)]
# interpolated_entity.gd: on remote entities. The server sends snapshots with
# _receive_snapshot.rpc(NetClock.now(), global_position, quaternion) at its network rate.
extends Node3D

@export var interpolation_delay := 0.1  # seconds; ~2–3 snapshot intervals
@export var max_extrapolation := 0.25  # how long to keep moving if packets stop


class Snapshot:
	var server_time: float
	var pos: Vector3
	var rot: Quaternion

	func _init(t: float, p: Vector3, r: Quaternion) -> void:
		server_time = t
		pos = p
		rot = r


var _buffer: Array[Snapshot] = []


@rpc("authority", "call_remote", "unreliable")
func _receive_snapshot(server_time: float, pos: Vector3, rot: Quaternion) -> void:
	# Packets can arrive out of order: insert sorted, ignore duplicates and stale ones.
	if not _buffer.is_empty() and server_time <= _buffer[0].server_time:
		return
	var i := _buffer.size()
	while i > 0 and _buffer[i - 1].server_time > server_time:
		i -= 1
	if i > 0 and _buffer[i - 1].server_time == server_time:
		return
	_buffer.insert(i, Snapshot.new(server_time, pos, rot))


func _process(_delta: float) -> void:
	if _buffer.is_empty():
		return
	var render_time := NetClock.estimated_server_time() - interpolation_delay

	# Drop snapshots we have moved past, keeping one before render_time.
	while _buffer.size() >= 2 and _buffer[1].server_time <= render_time:
		_buffer.pop_front()

	var a := _buffer[0]
	if _buffer.size() >= 2 and a.server_time <= render_time:
		# Normal case: interpolate between the two bracketing snapshots.
		var b := _buffer[1]
		var t := (render_time - a.server_time) / (b.server_time - a.server_time)
		global_position = a.pos.lerp(b.pos, t)
		quaternion = a.rot.slerp(b.rot, t)
	else:
		# Just connected (render_time before the oldest) or starved (one snapshot left): hold it.
		# To extrapolate, keep a velocity and add it * minf(render_time - a.server_time, max_extrapolation).
		global_position = a.pos
		quaternion = a.rot


# net_clock.gd: autoload named NetClock.
extends Node

var _offset := 0.0  # server_time - local_time, updated from time-sync messages


func now() -> float:  # the local clock, in seconds
	return Time.get_ticks_usec() / 1_000_000.0


func estimated_server_time() -> float:
	return now() + _offset


func on_time_sync(server_time: float, round_trip_time: float) -> void:
	var sample := server_time + round_trip_time / 2.0 - now()
	_offset = sample if _offset == 0.0 else _offset + (sample - _offset) * 0.1  # smooth out jitter
```

```cpp [Unreal (C++)]
// InterpolationComponent.h: replaces the actor's own movement replication (turn off Replicate Movement).
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "InterpolationComponent.generated.h"

USTRUCT()
struct FNetSnapshot
{
	GENERATED_BODY()

	UPROPERTY() double ServerTime = 0.0;
	UPROPERTY() FVector Position = FVector::ZeroVector;
	UPROPERTY() FQuat Rotation = FQuat::Identity;
};

UCLASS(ClassGroup = (Game), meta = (BlueprintSpawnableComponent))
class UInterpolationComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UInterpolationComponent();
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	UPROPERTY(EditAnywhere)
	double InterpolationDelay = 0.1;                        // seconds; ~2–3 net updates

protected:
	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

private:
	UPROPERTY(ReplicatedUsing = OnRep_Snapshot)
	FNetSnapshot Snapshot;                                  // the server writes it; each update reaches OnRep

	UFUNCTION()
	void OnRep_Snapshot();

	TArray<FNetSnapshot> Buffer;
};

// InterpolationComponent.cpp
#include "InterpolationComponent.h"
#include "GameFramework/GameStateBase.h"
#include "Net/UnrealNetwork.h"

UInterpolationComponent::UInterpolationComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	SetIsReplicatedByDefault(true);
}

void UInterpolationComponent::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);
	DOREPLIFETIME(UInterpolationComponent, Snapshot);
}

void UInterpolationComponent::OnRep_Snapshot()
{
	// Property replication sends the latest value and can skip intermediate ones: fine for interpolation.
	if (Buffer.IsEmpty() || Snapshot.ServerTime > Buffer.Last().ServerTime) Buffer.Add(Snapshot);
}

void UInterpolationComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	AActor* Owner = GetOwner();
	const AGameStateBase* GameState = GetWorld()->GetGameState();
	if (!GameState) return;

	// Built in: the game state keeps clients' estimate of the server's clock in sync.
	const double ServerTime = GameState->GetServerWorldTimeSeconds();
	if (Owner->HasAuthority())
	{
		Snapshot.ServerTime = ServerTime;
		Snapshot.Position = Owner->GetActorLocation();
		Snapshot.Rotation = Owner->GetActorQuat();
		return;
	}
	if (Buffer.IsEmpty()) return;

	const double RenderTime = ServerTime - InterpolationDelay;
	while (Buffer.Num() >= 2 && Buffer[1].ServerTime <= RenderTime) Buffer.RemoveAt(0);   // moved past

	const FNetSnapshot& A = Buffer[0];
	if (Buffer.Num() >= 2 && A.ServerTime <= RenderTime)
	{
		const FNetSnapshot& B = Buffer[1];
		const float T = float((RenderTime - A.ServerTime) / (B.ServerTime - A.ServerTime));
		Owner->SetActorLocationAndRotation(FMath::Lerp(A.Position, B.Position, T), FQuat::Slerp(A.Rotation, B.Rotation, T));
	}
	else
	{
		Owner->SetActorLocationAndRotation(A.Position, A.Rotation);   // just connected, or starved
	}
}
```

:::

**Engine notes**

- **Unity:** Netcode for GameObjects' `NetworkTransform` (with *Interpolate* on) and most networking libraries interpolate this way out of the box. The value of knowing the pattern is in tuning the delay and handling the edge cases. NGO's `NetworkManager.ServerTime` is a ready-made server clock estimate.
- **Godot:** `MultiplayerSynchronizer` sets synchronized properties as soon as they arrive, with no timestamp and no interpolation, so remote objects stutter at the network rate unless you buffer them like this. You can also keep the synchronizer and point it at a hidden property whose setter calls the buffer. The **netfox** add-on has a tick interpolator for this.
- **Unreal:** Remote characters (simulated proxies) are already smoothed by `UCharacterMovementComponent` (*Network Smoothing Mode*: exponential or linear). For other actors, *Replicate Movement* applies each update directly, so add a component like the one above. `AGameStateBase::GetServerWorldTimeSeconds()` is kept in sync by the engine, but only corrected periodically; a game that needs tighter timing measures its own offset from round trips, as the Unity and Godot tabs do. Set the actor's net update frequency to the snapshot rate you tuned the delay for.

## When to use

- Every entity the local player does *not* control: other players, server-driven NPCs, projectiles fired by others.
- Any time state arrives at a lower or less regular rate than you render.

## When not to use

- The locally controlled player. Interpolating your own character adds input lag; use [Client-Side Prediction](./client-side-prediction).
- Objects that must react instantly, such as an object the local player just hit. Show a predicted local effect first.
- Turn-based games with discrete moves. Animate the move instead.

## Pitfalls

- **Remote players are in the past.** At 100 ms of delay plus latency, you see others where they were well over 100 ms ago. Shooters fix this for hit detection with [Lag Compensation](./lag-compensation) on the server.
- **Wrong delay.** Too short, and every jittery packet causes a stall or extrapolation. Too long, and the game feels laggy. Adapt the delay to measured jitter, or make it at least 2× the snapshot interval.
- **Teleports get smoothed.** A respawn or teleport interpolates across the map. Mark snapshots with a "teleported" flag, and snap instead of interpolating across it.
- **Extrapolation overshoots.** Guessing forward when packets stop makes entities run through walls, then snap back. Keep extrapolation short and capped.
- **Using `Time.time`.** Interpolation needs a clock that does not stop or scale. Use real time, synchronised with the server's clock.

## Related

- [Client-Side Prediction](./client-side-prediction) and [Server Reconciliation](./server-reconciliation) — for the *local* player, who runs ahead instead of behind.
- [Fixed Timestep](./fixed-timestep) — the same "render between two states" idea, applied locally.
- [Double Buffer](./double-buffer) — previous and current state, generalised here to a buffer of many.
- [Interest Management](./interest-management) — send only the entities each client needs.
- [Snapshot & Delta Compression](./snapshot-delta-compression) — reduces the cost of each update.
