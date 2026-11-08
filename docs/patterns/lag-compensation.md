# Lag Compensation

> The server rewinds hitboxes to what the shooter saw when validating hits.

**Category:** Networking & Multiplayer

## Problem

With [Entity Interpolation](./entity-interpolation), you see other players about 100 ms in the past, plus your own latency. You aim perfectly at an enemy's head and click. By the time your shot reaches the server, that enemy has moved on, so the server's raycast misses. Players must "lead" every target by an amount that depends on their ping, and hit registration feels broken.

## Solution

The server **remembers recent history** and judges each shot **in the shooter's past**:

1. Every tick, the server records the hitbox positions of every player in a **history buffer** (for example, the last 1 second).
2. The client sends each shot with the **time it saw the world at**: its interpolation render time, as a server tick or timestamp.
3. On receiving the shot, the server **rewinds** every other player's hitboxes to that time, interpolating between the two stored ticks around it, performs the raycast, and **restores** the present positions.
4. **Cap the rewind** (for example, at 200–250 ms). Players with very high ping must lead targets a bit, rather than everyone else being shot from far in the past.

The trade-off is unavoidable: lag compensation favours the **shooter**. A victim can be hit "behind cover", because in the shooter's slightly older view they were not behind it yet.

## Example

Server side, transport-agnostic, using simple sphere hitboxes for clarity. None of the three engines has a general-purpose lag compensation system, so this is engine-free logic in every tab. The Unity and Godot tabs record by fixed tick; Unreal's server ticks at a variable rate, so its tab records by server time instead.

### History buffer

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public struct HitboxFrame
{
    public int Tick;
    public Vector3 Position;    // e.g. the chest centre; real games store several boxes per player
}

public class HitboxHistory
{
    readonly HitboxFrame[] frames;
    int newest = -1, count;

    public HitboxHistory(int capacity) => frames = new HitboxFrame[capacity];

    public void Record(int tick, Vector3 position)
    {
        newest = (newest + 1) % frames.Length;
        frames[newest] = new HitboxFrame { Tick = tick, Position = position };
        count = Mathf.Min(count + 1, frames.Length);
    }

    // Position at a fractional tick, interpolated between the two recorded ticks around it.
    public bool TrySample(float tick, out Vector3 position)
    {
        for (int i = 0; i < count - 1; i++)
        {
            var later = frames[(newest - i + frames.Length) % frames.Length];
            var earlier = frames[(newest - i - 1 + frames.Length) % frames.Length];
            if (earlier.Tick <= tick && tick <= later.Tick)
            {
                float t = later.Tick == earlier.Tick ? 0f : (tick - earlier.Tick) / (later.Tick - earlier.Tick);
                position = Vector3.Lerp(earlier.Position, later.Position, t);
                return true;
            }
        }
        position = default;
        return false;            // older than the buffer, or in the future
    }
}
```

```gdscript [Godot (GDScript)]
# hitbox_history.gd: a ring buffer of one player's hitbox positions, one entry per physics tick.
class_name HitboxHistory
extends RefCounted

var _ticks: PackedInt64Array
var _positions: PackedVector3Array  # e.g. the chest centre; real games store several boxes per player
var _newest := -1
var _count := 0


func _init(capacity: int) -> void:
	_ticks.resize(capacity)
	_positions.resize(capacity)


func record(tick: int, pos: Vector3) -> void:
	_newest = (_newest + 1) % _ticks.size()
	_ticks[_newest] = tick
	_positions[_newest] = pos
	_count = mini(_count + 1, _ticks.size())


# Position at a fractional tick, interpolated between the two recorded ticks around it.
# Returns null when the tick is older than the buffer, or in the future.
func sample(tick: float) -> Variant:
	var n := _ticks.size()
	for i in _count - 1:
		var later := (_newest - i + n) % n
		var earlier := (_newest - i - 1 + n) % n
		if _ticks[earlier] <= tick and tick <= _ticks[later]:
			var span := float(_ticks[later] - _ticks[earlier])
			var t := 0.0 if span == 0.0 else (tick - _ticks[earlier]) / span
			return _positions[earlier].lerp(_positions[later], t)
	return null
```

```cpp [Unreal (C++)]
// HitboxHistory.h: plain C++, a ring buffer of one player's hitbox positions by server time.
#pragma once

#include "CoreMinimal.h"

class FHitboxHistory
{
public:
	explicit FHitboxHistory(int32 Capacity = 64) { Frames.SetNum(Capacity); }   // ~1 s at 60 Hz

	void Record(double Time, const FVector& Position)  // e.g. the chest centre; real games store several boxes
	{
		Newest = (Newest + 1) % Frames.Num();
		Frames[Newest] = { Time, Position };
		Count = FMath::Min(Count + 1, Frames.Num());
	}

	// Position at a past time, interpolated between the two recorded frames around it.
	bool TrySample(double Time, FVector& OutPosition) const
	{
		const int32 N = Frames.Num();
		for (int32 i = 0; i < Count - 1; ++i)
		{
			const FFrame& Later = Frames[(Newest - i + N) % N];
			const FFrame& Earlier = Frames[(Newest - i - 1 + N) % N];
			if (Earlier.Time <= Time && Time <= Later.Time)
			{
				const double Span = Later.Time - Earlier.Time;
				OutPosition = FMath::Lerp(Earlier.Position, Later.Position, Span > 0.0 ? (Time - Earlier.Time) / Span : 0.0);
				return true;
			}
		}
		return false;                                     // older than the buffer, or in the future
	}

private:
	struct FFrame { double Time = 0.0; FVector Position = FVector::ZeroVector; };
	TArray<FFrame> Frames;
	int32 Newest = -1;
	int32 Count = 0;
};
```

:::

### Validating a shot

The server rewinds every other player to the moment the shooter saw, clamped to a maximum rewind:

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public class LagCompensator
{
    const int TickRate = 60;
    const float MaxRewindSeconds = 0.25f;
    const float HitRadius = 0.4f;

    readonly Dictionary<int, HitboxHistory> history = new();   // per player id
    readonly Dictionary<int, Vector3> current = new();
    int serverTick;

    // Called every server tick after simulation.
    public void RecordTick(int tick, IReadOnlyDictionary<int, Vector3> playerPositions)
    {
        serverTick = tick;
        foreach (var (id, pos) in playerPositions)
        {
            if (!history.TryGetValue(id, out var h)) history[id] = h = new HitboxHistory(TickRate);   // 1 s
            h.Record(tick, pos);
            current[id] = pos;
        }
    }

    // A client reports a shot, stamped with the (fractional) tick it was rendering.
    public bool TryValidateShot(int shooterId, Ray ray, float range, float clientViewTick, out int victimId)
    {
        victimId = -1;

        // Never rewind further than allowed; clamp instead of trusting the client blindly.
        float oldestAllowed = serverTick - MaxRewindSeconds * TickRate;
        float tick = Mathf.Clamp(clientViewTick, oldestAllowed, serverTick);

        float best = range;
        foreach (var (id, h) in history)
        {
            if (id == shooterId) continue;
            if (!h.TrySample(tick, out var pastPosition)) pastPosition = current[id];

            // Ray vs sphere at the REWOUND position.
            if (RaySphere(ray, pastPosition, HitRadius, out float distance) && distance < best)
            {
                best = distance;
                victimId = id;
            }
        }
        // A real server also checks level geometry along the ray in the present (walls don't move).
        return victimId >= 0;
    }

    static bool RaySphere(Ray ray, Vector3 centre, float radius, out float distance)
    {
        Vector3 oc = ray.origin - centre;
        float b = Vector3.Dot(oc, ray.direction);
        float c = oc.sqrMagnitude - radius * radius;
        float disc = b * b - c;
        distance = disc < 0f ? 0f : -b - Mathf.Sqrt(disc);
        return disc >= 0f && distance >= 0f;
    }
}
```

```gdscript [Godot (GDScript)]
# lag_compensator.gd: owned by the server. record_tick() runs every physics tick after movement,
# with tick = Engine.get_physics_frames().
class_name LagCompensator
extends RefCounted

const TICK_RATE := 60
const MAX_REWIND_SECONDS := 0.25
const HIT_RADIUS := 0.4

var _history := {}  # peer id -> HitboxHistory
var _current := {}  # peer id -> Vector3
var _server_tick := 0


func record_tick(tick: int, player_positions: Dictionary) -> void:
	_server_tick = tick
	for id: int in player_positions:
		if not _history.has(id):
			_history[id] = HitboxHistory.new(TICK_RATE)  # 1 s
		_history[id].record(tick, player_positions[id])
		_current[id] = player_positions[id]


# A client reports a shot, stamped with the (fractional) tick it was rendering.
# Returns the victim's peer id, or -1 for a miss.
func validate_shot(shooter_id: int, origin: Vector3, direction: Vector3, max_distance: float,
		client_view_tick: float) -> int:
	# Never rewind further than allowed; clamp instead of trusting the client blindly.
	var oldest_allowed := _server_tick - MAX_REWIND_SECONDS * TICK_RATE
	var tick := clampf(client_view_tick, oldest_allowed, _server_tick)

	var best := max_distance
	var victim := -1
	for id: int in _history:
		if id == shooter_id:
			continue
		var past: Variant = _history[id].sample(tick)
		var centre: Vector3 = past if past != null else _current[id]
		var distance := _ray_sphere(origin, direction.normalized(), centre, HIT_RADIUS)  # at the REWOUND position
		if distance >= 0.0 and distance < best:
			best = distance
			victim = id
	# A real server also checks level geometry along the ray in the present (walls don't move).
	return victim


# Distance along the ray to the sphere, or -1 for a miss.
static func _ray_sphere(origin: Vector3, direction: Vector3, centre: Vector3, radius: float) -> float:
	var oc := origin - centre
	var b := oc.dot(direction)
	var disc := b * b - (oc.length_squared() - radius * radius)
	if disc < 0.0:
		return -1.0
	var distance := -b - sqrt(disc)
	return distance if distance >= 0.0 else -1.0
```

```cpp [Unreal (C++)]
// LagCompensator.h: owned by the server (a world subsystem or the game mode). RecordFrame() runs every
// server tick after movement, with Time = the game state's GetServerWorldTimeSeconds().
#pragma once

#include "CoreMinimal.h"
#include "HitboxHistory.h"

class FLagCompensator
{
public:
	static constexpr double MaxRewindSeconds = 0.25;
	static constexpr float HitRadius = 40.f;                // cm

	void RecordFrame(double Time, const TMap<int32, FVector>& PlayerPositions)
	{
		ServerTime = Time;
		for (const TPair<int32, FVector>& Pair : PlayerPositions)
		{
			History.FindOrAdd(Pair.Key).Record(Time, Pair.Value);
			Current.Add(Pair.Key, Pair.Value);
		}
	}

	// A client reports a shot, stamped with the server time it was rendering. Returns the victim or INDEX_NONE.
	int32 ValidateShot(int32 ShooterId, const FVector& Origin, const FVector& Direction, float Range, double ClientViewTime) const
	{
		// Never rewind further than allowed; clamp instead of trusting the client blindly.
		const double Time = FMath::Clamp(ClientViewTime, ServerTime - MaxRewindSeconds, ServerTime);

		float Best = Range;
		int32 Victim = INDEX_NONE;
		for (const TPair<int32, FHitboxHistory>& Pair : History)
		{
			if (Pair.Key == ShooterId) continue;
			FVector Past;
			if (!Pair.Value.TrySample(Time, Past)) Past = Current.FindChecked(Pair.Key);

			float Distance;
			if (RaySphere(Origin, Direction.GetSafeNormal(), Past, HitRadius, Distance) && Distance < Best)   // REWOUND
			{
				Best = Distance;
				Victim = Pair.Key;
			}
		}
		// A real server also traces level geometry in the present (walls don't move).
		return Victim;
	}

private:
	static bool RaySphere(const FVector& Origin, const FVector& Dir, const FVector& Centre, float Radius, float& OutDistance)
	{
		const FVector OC = Origin - Centre;
		const double B = FVector::DotProduct(OC, Dir);
		const double Disc = B * B - (OC.SizeSquared() - Radius * Radius);
		OutDistance = Disc < 0.0 ? 0.f : float(-B - FMath::Sqrt(Disc));
		return Disc >= 0.0 && OutDistance >= 0.f;
	}

	TMap<int32, FHitboxHistory> History;                    // per player id
	TMap<int32, FVector> Current;
	double ServerTime = 0.0;
};
```

:::

The client stamps each shot with its interpolation time: `clientViewTick = (NetClock.EstimatedServerTime - interpolationDelay) * TickRate` in ticks, or the render time itself in Unreal, using the clock from [Entity Interpolation](./entity-interpolation).

**Engine notes**

- **Unity:** Real implementations rewind actual collider transforms (often several per player: head, torso, limbs) and use the physics engine with `Physics.SyncTransforms` or a separate physics scene, then restore them. **Netcode for Entities** has lag compensation built in (it keeps a history of physics collision worlds that server raycasts can query in the past); **Netcode for GameObjects** has none.
- **Godot:** To rewind real colliders, move the hitbox `Area3D`s or bodies to their past transforms, query with `PhysicsDirectSpaceState3D.intersect_ray`, then move them back. Physics state updates only on the next physics step, so a manual sphere or capsule test as above is often simpler and more reliable.
- **Unreal:** No built-in rewind for hitscan. The usual approach stores past bone or capsule transforms per character, as above, and tests the shot against those shapes with plain math, as above, rather than moving the real skeletal mesh. Validate the shot in the `Server` RPC that carries it, after clamping the client's timestamp.

## When to use

- Hitscan weapons and fast projectiles in server-authoritative shooters.
- Melee hit detection in online action games.
- Any server check of "could the player see or reach this?", judged from the player's view of the world.

## When not to use

- Slow projectiles that the server simulates. Rewinding is for hitscan and very fast shots.
- Games without an authoritative server.
- When high-ping players already have too much advantage. Cap the rewind so low-ping players don't get shot behind cover.

## Pitfalls

- **Unbounded rewind.** Trusting any client timestamp lets cheaters (or players on terrible connections) shoot far into the past. Clamp it.
- **Shot behind cover.** It is inherent and cannot be removed, only limited by capping rewind and keeping interpolation delay small. Explain it in design, and accept it.
- **Rewinding too much.** Rewinding moving platforms, doors and vehicles too gets complicated. Most games rewind only player hitboxes and treat static geometry as present-time.
- **Interpolated rewinds.** Snapping to the nearest stored tick instead of interpolating causes misses at high movement speeds. Interpolate, as above.
- **Not restoring state.** Forgetting to restore rewound colliders corrupts the present simulation. Rewind, test and restore in one tight block, or use a separate physics scene.

## Related

- [Entity Interpolation](./entity-interpolation) — the client-side delay that this compensates for.
- [Client-Side Prediction](./client-side-prediction) and [Server Reconciliation](./server-reconciliation) — the other half of the latency toolkit.
- [Fixed Timestep](./fixed-timestep) — history is indexed by server tick.
- [Responsive Online Movement](../recipes/responsive-online-movement) — the movement side that pairs with lag-compensated shooting.
