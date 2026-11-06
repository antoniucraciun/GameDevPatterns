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

## Example (Unity C#)

Server side. Transport-agnostic, using simple sphere hitboxes for clarity:

```csharp
using System.Collections.Generic;
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

The client stamps each shot with its interpolation time, converted to server ticks: `clientViewTick = (NetClock.EstimatedServerTime - interpolationDelay) * TickRate`, using the clock from [Entity Interpolation](./entity-interpolation).

Real implementations rewind actual collider transforms (often several per player: head, torso, limbs) and use the physics engine with `Physics.SyncTransforms` or a separate physics scene, then restore them.

## When to use

- Hitscan weapons and fast projectiles in server-authoritative shooters.
- Melee hit detection in online action games.
- Any server check of "could the player see or reach this?", judged from the player's view of the world.

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
