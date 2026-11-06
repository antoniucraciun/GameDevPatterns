# Snapshot & Delta Compression

> Send only what changed relative to a state the receiver already acknowledged.

**Category:** Networking & Multiplayer

## Problem

The server sends 64 players' state, 20 times per second, to 64 clients. Each player is a position (3 floats), rotation (4 floats), velocity (3 floats), health, ammo and animation state: about 60 bytes. That is 64 × 60 × 20 × 64 ≈ 5 MB/s of upload, far too much. Yet most of it repeats: a standing player's position did not change, health changes a few times a minute, ammo only when firing. Sending everything every time wastes nearly all the bandwidth.

## Solution

Combine three techniques:

1. **Snapshots and acknowledgements.** The server numbers each snapshot it sends. Clients acknowledge the latest snapshot they received. The server remembers, per client, the **last acknowledged snapshot**: the **baseline** that the client definitely has.
2. **Delta encoding against the baseline.** For each entity, compare current state with the baseline and send only the fields that **differ**, preceded by a bit mask saying which fields follow. Unchanged entities cost one bit ("no change"). Because the delta is relative to an *acknowledged* state, a lost packet never corrupts anything: the next delta is simply computed from the older baseline again.
3. **Quantisation and bit packing.** Do not send 32-bit floats when 16 bits are enough. Positions become integers on a 1 cm grid within the map bounds, angles become 10 bits, health fits in 7. Write values with exactly as many bits as they need.

Together, these typically reduce traffic by 5–20×.

## Example (Unity C#)

A bit writer and reader:

```csharp
using System;
using UnityEngine;

public class BitWriter
{
    readonly byte[] buffer;
    int bitPos;
    public BitWriter(int capacityBytes) => buffer = new byte[capacityBytes];

    public void Write(uint value, int bits)
    {
        for (int i = 0; i < bits; i++, bitPos++)
            if ((value & (1u << i)) != 0) buffer[bitPos >> 3] |= (byte)(1 << (bitPos & 7));
    }

    public void WriteBool(bool b) => Write(b ? 1u : 0u, 1);
    public ArraySegment<byte> ToSegment() => new(buffer, 0, (bitPos + 7) >> 3);
}

public class BitReader
{
    readonly byte[] buffer;
    int bitPos;
    public BitReader(byte[] buffer) => this.buffer = buffer;

    public uint Read(int bits)
    {
        uint v = 0;
        for (int i = 0; i < bits; i++, bitPos++)
            if ((buffer[bitPos >> 3] & (1 << (bitPos & 7))) != 0) v |= 1u << i;
        return v;
    }

    public bool ReadBool() => Read(1) == 1;
}
```

Quantised state and delta encoding against a baseline:

```csharp
public struct PlayerNetState
{
    public Vector3 Position;   // within a 2 km map
    public float Yaw;          // degrees
    public byte Health;        // 0..100
    public byte Ammo;          // 0..255

    // Quantisation: map ranges onto integers with just enough precision.
    const float MapMin = -1024f, MapRange = 2048f;                 // metres
    public static uint QPos(float v) => (uint)Mathf.RoundToInt((v - MapMin) / MapRange * 0x1FFFFF);   // 21 bits ≈ 1 mm
    public static float DPos(uint q) => q / (float)0x1FFFFF * MapRange + MapMin;
    public static uint QYaw(float deg) => (uint)Mathf.RoundToInt(Mathf.Repeat(deg, 360f) / 360f * 1023f) & 1023u;  // 10 bits ≈ 0.35°
    public static float DYaw(uint q) => q / 1023f * 360f;
}

public static class DeltaCodec
{
    // Field mask bits.
    const int Pos = 1, Yaw = 2, Health = 4, Ammo = 8;

    public static void WriteDelta(BitWriter w, in PlayerNetState baseline, in PlayerNetState current)
    {
        int mask = 0;
        if (PlayerNetState.QPos(current.Position.x) != PlayerNetState.QPos(baseline.Position.x) ||
            PlayerNetState.QPos(current.Position.y) != PlayerNetState.QPos(baseline.Position.y) ||
            PlayerNetState.QPos(current.Position.z) != PlayerNetState.QPos(baseline.Position.z)) mask |= Pos;
        if (PlayerNetState.QYaw(current.Yaw) != PlayerNetState.QYaw(baseline.Yaw)) mask |= Yaw;
        if (current.Health != baseline.Health) mask |= Health;
        if (current.Ammo != baseline.Ammo) mask |= Ammo;

        w.WriteBool(mask != 0);                     // 1 bit for an entity that didn't change at all
        if (mask == 0) return;
        w.Write((uint)mask, 4);

        if ((mask & Pos) != 0)
        {
            w.Write(PlayerNetState.QPos(current.Position.x), 21);
            w.Write(PlayerNetState.QPos(current.Position.y), 21);
            w.Write(PlayerNetState.QPos(current.Position.z), 21);
        }
        if ((mask & Yaw) != 0) w.Write(PlayerNetState.QYaw(current.Yaw), 10);
        if ((mask & Health) != 0) w.Write(current.Health, 7);
        if ((mask & Ammo) != 0) w.Write(current.Ammo, 8);
    }

    public static PlayerNetState ReadDelta(BitReader r, in PlayerNetState baseline)
    {
        var s = baseline;                           // start from what the client already has
        if (!r.ReadBool()) return s;
        int mask = (int)r.Read(4);

        if ((mask & Pos) != 0)
            s.Position = new Vector3(PlayerNetState.DPos(r.Read(21)), PlayerNetState.DPos(r.Read(21)), PlayerNetState.DPos(r.Read(21)));
        if ((mask & Yaw) != 0) s.Yaw = PlayerNetState.DYaw(r.Read(10));
        if ((mask & Health) != 0) s.Health = (byte)r.Read(7);
        if ((mask & Ammo) != 0) s.Ammo = (byte)r.Read(8);
        return s;
    }
}
```

Per-client baselines on the server:

```csharp
// The server keeps the last N snapshots (ring buffer) and, per client, the last acknowledged snapshot id.
// Each tick, for each client:
//   baseline = snapshots[client.LastAckedId] (or an all-zero state if none / too old)
//   write header: { snapshotId, baselineId }
//   for each relevant entity: DeltaCodec.WriteDelta(writer, baseline[entity], current[entity])
// The client decodes against ITS copy of baselineId, stores the result as snapshotId, and acks it.
```

A full player update shrinks from about 60 bytes to about 9 when moving, and 1 bit when standing still.

## When to use

- Server-authoritative games replicating many entities to many clients: shooters, battle royales, MMOs, sports games.
- Any bandwidth-constrained networking, especially mobile and console platforms with upload limits.

## Pitfalls

- **Delta against unacknowledged state.** Encoding against "the last thing I sent" breaks as soon as one packet is lost, because the client never had it. Always encode against an *acknowledged* baseline.
- **Too much precision lost.** Coarse quantisation causes visible jitter, or prediction mismatches when the client simulates with quantised values. Quantise state the same way on the server before simulating, so both sides agree exactly.
- **Baseline memory.** Keeping snapshots per client for a long time costs memory. Cap the history (about 1 second), and fall back to a full update if the client's ack is older.
- **Bit-packing bugs.** Writer and reader must agree on every field and bit count. Generate both from one schema, or test with round-trip checks.
- **Deltas for reliable events.** One-off events (a door opened, a chat message) are not state. Send them on a reliable channel, rather than hoping a field change survives.

## Related

- [Authoritative Server](./authoritative-server) — the server that produces snapshots.
- [Interest Management](./interest-management) — send fewer entities. Delta compression sends fewer bytes per entity.
- [Entity Interpolation](./entity-interpolation) — clients render between decoded snapshots.
- [Dirty Flag](./dirty-flag) — the per-field change mask is a dirty flag relative to the baseline.
- [Memento](./memento) — snapshots are mementos of the world.
