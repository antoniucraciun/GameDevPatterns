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

## Example (Unity C#)

```csharp
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

Netcode for GameObjects' `NetworkTransform` and most networking libraries interpolate this way out of the box. The value of knowing the pattern is in tuning the delay and handling the edge cases.

## When to use

- Every entity the local player does *not* control: other players, server-driven NPCs, projectiles fired by others.
- Any time state arrives at a lower or less regular rate than you render.

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
- Snapshot & Delta Compression — reduces the cost of each update.
