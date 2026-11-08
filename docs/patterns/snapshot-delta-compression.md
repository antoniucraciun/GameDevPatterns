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

## Example

A bit writer and reader. Unity and Godot need their own; Unreal already has `FBitWriter` and `FBitReader`, which its replication system uses:

::: code-group

```csharp [Unity (C#)]
using System;

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

```gdscript [Godot (GDScript)]
# bit_writer.gd
class_name BitWriter
extends RefCounted

var _buffer := PackedByteArray()
var _bit_pos := 0


func _init(capacity_bytes: int) -> void:
	_buffer.resize(capacity_bytes)  # zero-filled


func write(value: int, bits: int) -> void:
	for i in bits:
		if value & (1 << i):
			_buffer[_bit_pos >> 3] |= 1 << (_bit_pos & 7)
		_bit_pos += 1


func write_bool(b: bool) -> void:
	write(1 if b else 0, 1)


func to_bytes() -> PackedByteArray:  # send with put_packet() or as a PackedByteArray RPC argument
	return _buffer.slice(0, (_bit_pos + 7) >> 3)


# bit_reader.gd
class_name BitReader
extends RefCounted

var _buffer: PackedByteArray
var _bit_pos := 0


func _init(buffer: PackedByteArray) -> void:
	_buffer = buffer


func read(bits: int) -> int:
	var v := 0
	for i in bits:
		if _buffer[_bit_pos >> 3] & (1 << (_bit_pos & 7)):
			v |= 1 << i
		_bit_pos += 1
	return v


func read_bool() -> bool:
	return read(1) == 1
```

```cpp [Unreal (C++)]
// Built in: FBitWriter / FBitReader (Serialization/BitWriter.h, BitReader.h).
#include "Serialization/BitReader.h"
#include "Serialization/BitWriter.h"

void BitPackingExample()
{
	FBitWriter Writer(256 * 8, /*bAllowResize*/ true);  // capacity in bits

	uint32 Health = 87;
	Writer.SerializeInt(Health, 128);                     // a value in [0, 128): 7 bits
	Writer.WriteBit(1);                                   // one flag

	// Send Writer.GetData() / Writer.GetNumBits(), then on the other side:
	FBitReader Reader(Writer.GetData(), Writer.GetNumBits());
	uint32 ReadHealth = 0;
	Reader.SerializeInt(ReadHealth, 128);
	const bool bFlag = Reader.ReadBit() != 0;
	check(!Reader.IsError());                             // set if we read past the end
}
```

:::

Quantised state and delta encoding against a baseline:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

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

```gdscript [Godot (GDScript)]
# player_net_state.gd
class_name PlayerNetState
extends RefCounted

const MAP_MIN := -1024.0  # metres, within a 2 km map
const MAP_RANGE := 2048.0

var position := Vector3.ZERO
var yaw := 0.0  # degrees
var health := 100  # 0..100
var ammo := 0  # 0..255


func copy() -> PlayerNetState:
	var c := PlayerNetState.new()
	c.position = position
	c.yaw = yaw
	c.health = health
	c.ammo = ammo
	return c


# Quantisation: map ranges onto integers with just enough precision.
static func q_pos(v: float) -> int:  # 21 bits ≈ 1 mm
	return roundi((v - MAP_MIN) / MAP_RANGE * 0x1FFFFF)


static func d_pos(q: int) -> float:
	return q / float(0x1FFFFF) * MAP_RANGE + MAP_MIN


static func q_yaw(deg: float) -> int:  # 10 bits ≈ 0.35°
	return roundi(fposmod(deg, 360.0) / 360.0 * 1023.0) & 1023


static func d_yaw(q: int) -> float:
	return q / 1023.0 * 360.0


# delta_codec.gd
class_name DeltaCodec

const POS := 1  # field mask bits
const YAW := 2
const HEALTH := 4
const AMMO := 8


static func write_delta(w: BitWriter, baseline: PlayerNetState, current: PlayerNetState) -> void:
	var mask := 0
	for axis in 3:
		if PlayerNetState.q_pos(current.position[axis]) != PlayerNetState.q_pos(baseline.position[axis]):
			mask |= POS
	if PlayerNetState.q_yaw(current.yaw) != PlayerNetState.q_yaw(baseline.yaw):
		mask |= YAW
	if current.health != baseline.health:
		mask |= HEALTH
	if current.ammo != baseline.ammo:
		mask |= AMMO

	w.write_bool(mask != 0)  # 1 bit for an entity that didn't change at all
	if mask == 0:
		return
	w.write(mask, 4)
	if mask & POS:
		for axis in 3:
			w.write(PlayerNetState.q_pos(current.position[axis]), 21)
	if mask & YAW:
		w.write(PlayerNetState.q_yaw(current.yaw), 10)
	if mask & HEALTH:
		w.write(current.health, 7)
	if mask & AMMO:
		w.write(current.ammo, 8)


static func read_delta(r: BitReader, baseline: PlayerNetState) -> PlayerNetState:
	var s := baseline.copy()  # start from what the client already has; never modify the baseline itself
	if not r.read_bool():
		return s
	var mask := r.read(4)
	if mask & POS:
		for axis in 3:
			s.position[axis] = PlayerNetState.d_pos(r.read(21))
	if mask & YAW:
		s.yaw = PlayerNetState.d_yaw(r.read(10))
	if mask & HEALTH:
		s.health = r.read(7)
	if mask & AMMO:
		s.ammo = r.read(8)
	return s
```

```cpp [Unreal (C++)]
// PlayerNetState.h: plain C++ for a custom snapshot channel (see the notes for when to use replication instead).
#pragma once

#include "CoreMinimal.h"
#include "Serialization/BitReader.h"
#include "Serialization/BitWriter.h"

struct FPlayerNetState
{
	FVector Position = FVector::ZeroVector;               // cm, within a 2 km map
	float Yaw = 0.f;                                      // degrees
	uint8 Health = 100;                                   // 0..100
	uint8 Ammo = 0;                                       // 0..255

	// Quantisation: map ranges onto integers with just enough precision.
	static constexpr double MapMin = -102400.0, MapRange = 204800.0;
	static uint32 QPos(double V) { return uint32(FMath::RoundToInt((V - MapMin) / MapRange * 0x1FFFFF)); }   // 21 bits ≈ 1 mm
	static double DPos(uint32 Q) { return Q / double(0x1FFFFF) * MapRange + MapMin; }
	static uint32 QYaw(float Deg) { return uint32(FMath::RoundToInt(FRotator::ClampAxis(Deg) / 360.f * 1023.f)) & 1023u; }
	static float DYaw(uint32 Q) { return Q / 1023.f * 360.f; }
};

namespace DeltaCodec
{
	enum : uint32 { Pos = 1, Yaw = 2, Health = 4, Ammo = 8 };   // field mask bits

	inline void WriteBits(FBitWriter& W, uint32 Value, int32 Bits) { W.SerializeInt(Value, 1u << Bits); }
	inline uint32 ReadBits(FBitReader& R, int32 Bits) { uint32 V = 0; R.SerializeInt(V, 1u << Bits); return V; }

	inline void WriteDelta(FBitWriter& W, const FPlayerNetState& Baseline, const FPlayerNetState& Current)
	{
		uint32 Mask = 0;
		for (int32 Axis = 0; Axis < 3; ++Axis)
			if (FPlayerNetState::QPos(Current.Position[Axis]) != FPlayerNetState::QPos(Baseline.Position[Axis])) Mask |= Pos;
		if (FPlayerNetState::QYaw(Current.Yaw) != FPlayerNetState::QYaw(Baseline.Yaw)) Mask |= Yaw;
		if (Current.Health != Baseline.Health) Mask |= Health;
		if (Current.Ammo != Baseline.Ammo) Mask |= Ammo;

		W.WriteBit(Mask != 0);                            // 1 bit for an entity that didn't change at all
		if (Mask == 0) return;
		WriteBits(W, Mask, 4);
		if (Mask & Pos)
			for (int32 Axis = 0; Axis < 3; ++Axis) WriteBits(W, FPlayerNetState::QPos(Current.Position[Axis]), 21);
		if (Mask & Yaw) WriteBits(W, FPlayerNetState::QYaw(Current.Yaw), 10);
		if (Mask & Health) WriteBits(W, Current.Health, 7);
		if (Mask & Ammo) WriteBits(W, Current.Ammo, 8);
	}

	inline FPlayerNetState ReadDelta(FBitReader& R, const FPlayerNetState& Baseline)
	{
		FPlayerNetState S = Baseline;                     // start from what the client already has
		if (!R.ReadBit()) return S;
		const uint32 Mask = ReadBits(R, 4);
		if (Mask & Pos)
			for (int32 Axis = 0; Axis < 3; ++Axis) S.Position[Axis] = FPlayerNetState::DPos(ReadBits(R, 21));
		if (Mask & Yaw) S.Yaw = FPlayerNetState::DYaw(ReadBits(R, 10));
		if (Mask & Health) S.Health = uint8(ReadBits(R, 7));
		if (Mask & Ammo) S.Ammo = uint8(ReadBits(R, 8));
		return S;
	}
}
```

:::

Per-client baselines on the server:

```text
The server keeps the last N snapshots (ring buffer) and, per client, the last acknowledged snapshot id.
Each tick, for each client:
  baseline = snapshots[client.LastAckedId] (or an all-zero state if none / too old)
  write header: { snapshotId, baselineId }
  for each relevant entity: WriteDelta(writer, baseline[entity], current[entity])
The client decodes against ITS copy of baselineId, stores the result as snapshotId, and acks it.
```

A full player update shrinks from about 60 bytes to about 9 when moving, and 1 bit when standing still.

**Engine notes**

- **Unity:** Netcode for GameObjects sends a `NetworkVariable` only when it changes, but has no per-client baselines or bit packing; serialise compact custom types with `INetworkSerializable` / `FastBufferWriter`. **Netcode for Entities** does exactly this pattern: ghost snapshots are delta-compressed against acknowledged baselines, and `[GhostField(Quantization = 100)]` sets the precision per field.
- **Godot:** `MultiplayerSynchronizer` properties set to *On Change* replication are sent only when they change, but as full Variants with no quantisation. For many entities, send your own packed snapshots as a `PackedByteArray` through an `unreliable` RPC, or with `put_packet()` on the `MultiplayerPeer`. `StreamPeerBuffer` is handy for byte-aligned (not bit-level) writing.
- **Unreal:** Property replication already deltas against what each connection last acknowledged, per property, and the quantised vector types (`FVector_NetQuantize`, `FVector_NetQuantize10`, `FVector_NetQuantize100`) and custom `NetSerialize` structs (with `WithNetSerializer` in `TStructOpsTypeTraits`) cover quantisation. `FFastArraySerializer` deltas large arrays item by item. Write a codec like the one above only for a custom snapshot channel; the replicated properties of an ordinary actor need none of it.

## When to use

- Server-authoritative games replicating many entities to many clients: shooters, battle royales, MMOs, sports games.
- Any bandwidth-constrained networking, especially mobile and console platforms with upload limits.

## When not to use

- Netcode libraries that already do it, such as Netcode for GameObjects or Mirror. Configure them instead of rolling your own.
- Low player counts with little state. Full snapshots fit in the bandwidth.
- Lockstep games. They send inputs, not state.

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
