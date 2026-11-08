# Seeded Randomness

> Use explicit, seeded RNG streams so generation and replays are reproducible.

**Category:** Data, Content & Procedural Generation

## Problem

A player shares the seed of an amazing procedurally generated world, but their friend gets a different world from the same seed. A replay diverges because a particle effect consumed a random number. Your daily challenge generates a different level on Android than on PC. All three bugs have the same cause: every system draws from one shared, global random sequence, so *anything* that uses randomness shifts what *everything else* gets.

## Solution

Treat randomness as **explicit, owned state**:

1. **Seeded generators.** The same seed always produces the same sequence.
2. **Separate streams per system.** World generation, loot, AI and VFX each own a generator. Adding a sparkle effect cannot change which sword drops.
3. **Derived seeds.** Do not store one seed per chunk, room or enemy. *Derive* them by hashing the parent seed with a stable key: `Hash(worldSeed, chunkX, chunkY)`. Each chunk is then reproducible on its own, in any generation order.
4. **A generator you own.** Built-in generators make no such promise: `System.Random`'s algorithm may change between .NET versions, Unity's `UnityEngine.Random` and Godot's global `randf()` are shared global state, and Unreal's `FMath::Rand` depends on the platform's C runtime. For seeds that must work across game versions and platforms, such as shared world seeds or daily challenges, ship your own small PRNG.
5. **Saveable state.** Store the generator's internal state in save files and replays, not just the original seed.

## Example

### Core: a portable generator

A small, fast generator (SplitMix64) that behaves identically on every platform. The three versions produce the **same numbers for the same seed**, bit for bit, so a seed shared between a C# server and a C++ client (or a Godot tool) gives the same results.

::: code-group

```csharp [Unity (C#)]
public sealed class Rng
{
    public ulong State;                                   // save/restore this for save files and replays

    public Rng(ulong seed) => State = seed;

    // new Rng(42).NextULong() == 0xBDD732262FEB6E95: a quick check for ports.
    public ulong NextULong()
    {
        ulong z = State += 0x9E3779B97F4A7C15UL;
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
        return z ^ (z >> 31);
    }

    // [0, 1) with 24 bits of precision: exactly representable as float.
    public float NextFloat() => (NextULong() >> 40) * (1f / (1 << 24));

    // [min, max): multiply-shift instead of modulo, so there is no bias.
    public int Range(int min, int max) =>
        min + (int)(((NextULong() >> 32) * (ulong)(uint)(max - min)) >> 32);

    public float Range(float min, float max) => min + NextFloat() * (max - min);

    // Stateless: a stable seed derived from a parent seed and a key.
    public static ulong Derive(ulong seed, int a, int b = 0, int c = 0)
    {
        ulong h = seed;
        h = Mix(h ^ (uint)a);
        h = Mix(h ^ ((ulong)(uint)b << 32));
        h = Mix(h ^ (uint)c * 0x9E3779B97F4A7C15UL);
        return h;
    }

    static ulong Mix(ulong z)
    {
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
        return z ^ (z >> 31);
    }
}
```

```gdscript [Godot (GDScript)]
# rng.gd: GDScript ints are signed 64-bit and wrap around on overflow, so the arithmetic matches
# the C# and C++ versions bit for bit. Two differences need care: hex literals above
# 0x7FFFFFFFFFFFFFFF don't fit, so the constants are written as signed decimals, and >> is an
# arithmetic shift, so _shr masks off the copied sign bits.
class_name Rng
extends RefCounted

const GOLDEN := -7046029254386353131  # 0x9E3779B97F4A7C15
const MIX_1 := -4658895280553007687   # 0xBF58476D1CE4E5B9
const MIX_2 := -7723592293110705685   # 0x94D049BB133111EB

var state: int  # save/restore this for save files and replays


func _init(seed_value: int) -> void:
	state = seed_value


## All 64 bits, as a signed int. Rng.new(42).next_int() == -4767286540954276203 (0xBDD732262FEB6E95).
func next_int() -> int:
	state += GOLDEN
	return _mix(state)


## [0, 1) with 24 bits of precision: the same values as the C# and C++ versions.
func next_float() -> float:
	return _shr(next_int(), 40) / 16777216.0


## [min_value, max_value): multiply-shift instead of modulo, so there is no bias.
## The span must be below 2^31, as in the other versions.
func next_range(min_value: int, max_value: int) -> int:
	return min_value + ((_shr(next_int(), 32) * (max_value - min_value)) >> 32)


func next_range_f(min_value: float, max_value: float) -> float:
	return min_value + next_float() * (max_value - min_value)


## Stateless: a stable seed derived from a parent seed and a key.
static func derive(seed_value: int, a: int, b := 0, c := 0) -> int:
	var h := seed_value
	h = _mix(h ^ (a & 0xFFFFFFFF))
	h = _mix(h ^ ((b & 0xFFFFFFFF) << 32))
	h = _mix(h ^ ((c & 0xFFFFFFFF) * GOLDEN))
	return h


static func _mix(z: int) -> int:
	z = (z ^ _shr(z, 30)) * MIX_1
	z = (z ^ _shr(z, 27)) * MIX_2
	return z ^ _shr(z, 31)


static func _shr(z: int, bits: int) -> int:  # logical (unsigned) right shift
	return (z >> bits) & ((1 << (64 - bits)) - 1)
```

```cpp [Unreal (C++)]
// Rng.h: plain C++. uint64 arithmetic wraps by definition, so this matches the C# version exactly.
#pragma once

#include "CoreMinimal.h"

struct FRng
{
	uint64 State;                                         // save/restore this for save files and replays

	explicit FRng(uint64 Seed) : State(Seed) {}

	// FRng(42).NextU64() == 0xBDD732262FEB6E95: a quick check for ports.
	uint64 NextU64() { return Mix(State += 0x9E3779B97F4A7C15ull); }

	// [0, 1) with 24 bits of precision: exactly representable as float.
	float NextFloat() { return float(NextU64() >> 40) * (1.f / 16777216.f); }

	// [Min, Max): multiply-shift instead of modulo, so there is no bias.
	int32 Range(int32 Min, int32 Max)
	{
		return Min + int32(((NextU64() >> 32) * uint64(uint32(Max - Min))) >> 32);
	}

	float Range(float Min, float Max) { return Min + NextFloat() * (Max - Min); }

	// Stateless: a stable seed derived from a parent seed and a key.
	static uint64 Derive(uint64 Seed, int32 A, int32 B = 0, int32 C = 0)
	{
		uint64 H = Seed;
		H = Mix(H ^ uint32(A));
		H = Mix(H ^ (uint64(uint32(B)) << 32));
		H = Mix(H ^ uint32(C) * 0x9E3779B97F4A7C15ull);
		return H;
	}

	static uint64 Mix(uint64 Z)
	{
		Z = (Z ^ (Z >> 30)) * 0xBF58476D1CE4E5B9ull;
		Z = (Z ^ (Z >> 27)) * 0x94D049BB133111EBull;
		return Z ^ (Z >> 31);
	}
};
```

:::

### Separate and derived streams

One stream per system, and per-chunk streams derived from the world seed. Godot's `RandomNumberGenerator` and Unreal's `FRandomStream` are already seedable and repeatable on every platform, so they can take the derived seeds directly; only the numbers they produce differ between engines.

::: code-group

```csharp [Unity (C#)]
public class World
{
    public readonly ulong Seed;
    public readonly Rng Loot;      // one stream per system
    public readonly Rng Ai;

    public World(ulong seed)
    {
        Seed = seed;
        Loot = new Rng(Rng.Derive(seed, 1));
        Ai   = new Rng(Rng.Derive(seed, 2));
    }

    // Each chunk is reproducible on its own, whatever order chunks are generated in.
    public void GenerateChunk(int chunkX, int chunkY)
    {
        var rng = new Rng(Rng.Derive(Seed, chunkX, chunkY, 100));
        int trees = rng.Range(3, 12);
        for (int i = 0; i < trees; i++)
        {
            float x = chunkX * 16 + rng.Range(0f, 16f);
            float y = chunkY * 16 + rng.Range(0f, 16f);
            // place tree at (x, y)
        }
    }
}

// Cosmetic effects use UnityEngine.Random freely: they never touch gameplay streams.
```

```gdscript [Godot (GDScript)]
# world.gd
class_name World
extends RefCounted

var world_seed: int
var loot := RandomNumberGenerator.new()  # one stream per system; save `state` to resume it
var ai := RandomNumberGenerator.new()


func _init(p_seed: int) -> void:
	world_seed = p_seed
	loot.seed = Rng.derive(p_seed, 1)
	ai.seed = Rng.derive(p_seed, 2)


# Each chunk is reproducible on its own, whatever order chunks are generated in.
func generate_chunk(chunk_x: int, chunk_y: int) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = Rng.derive(world_seed, chunk_x, chunk_y, 100)
	var trees := rng.randi_range(3, 11)  # both bounds inclusive: 3..11 like Range(3, 12) in C#
	for i in trees:
		var x := chunk_x * 16 + rng.randf_range(0.0, 16.0)
		var y := chunk_y * 16 + rng.randf_range(0.0, 16.0)
		# place tree at (x, y)

# Cosmetic effects use the global randf()/randi() freely: they never touch gameplay streams.
```

```cpp [Unreal (C++)]
// SeededWorld.h
#pragma once

#include "CoreMinimal.h"
#include "Rng.h"

struct FSeededWorld
{
	uint64 Seed;
	FRandomStream Loot;   // one stream per system; GetCurrentSeed()/Initialize() save and restore it
	FRandomStream Ai;

	explicit FSeededWorld(uint64 InSeed)
		: Seed(InSeed)
		, Loot(int32(FRng::Derive(InSeed, 1)))   // FRandomStream takes a 32-bit seed
		, Ai(int32(FRng::Derive(InSeed, 2)))
	{
	}

	// Each chunk is reproducible on its own, whatever order chunks are generated in.
	void GenerateChunk(int32 ChunkX, int32 ChunkY) const
	{
		FRandomStream Rng(int32(FRng::Derive(Seed, ChunkX, ChunkY, 100)));
		const int32 Trees = Rng.RandRange(3, 11);   // both bounds inclusive
		for (int32 I = 0; I < Trees; ++I)
		{
			const float X = ChunkX * 16 + Rng.FRandRange(0.f, 16.f);
			const float Y = ChunkY * 16 + Rng.FRandRange(0.f, 16.f);
			// place tree at (X, Y)
		}
	}
};

// Cosmetic effects use FMath::FRand() freely: they never touch gameplay streams.
```

:::

A daily challenge becomes `new World(Rng.Derive(0xC0FFEE, year, dayOfYear))`, the same level for everyone that day.

**Engine notes**

- **Unity:** `UnityEngine.Random` is one global stream (its `state` can be saved, but every system shares it), and `System.Random`'s algorithm is not guaranteed to stay the same across .NET versions. Unity.Mathematics' `Random` struct (xorshift) is seedable, a value type and Burst-friendly.
- **Godot:** `RandomNumberGenerator` (PCG32) gives each system its own stream; set `seed` for a fixed start and save `state` to resume mid-stream. The global `randf()`/`randi()` share one generator seeded randomly at startup (`seed()` reseeds it). `randi_range` and `randf_range` include both bounds.
- **Unreal:** `FRandomStream` is a seedable, platform-independent stream (a simple 32-bit generator, fine for gameplay); `FMath::Rand`/`FRand` use the global C runtime generator and shouldn't drive anything that must reproduce. `RandRange` includes both bounds.

## When to use

## When to use

- Procedural generation that must be reproducible or shareable: worlds, dungeons, daily runs.
- Anything that must replay exactly: input replays, lockstep and rollback networking, regression tests.
- Debugging. Logging the seed of a failed run makes it reproducible.

## When not to use

- Randomness that should differ every run and never needs replaying, such as cosmetic particles.
- Security-sensitive randomness, such as loot that can be sold. Generate it on the server; clients can read a seed.

## Pitfalls

- **Copying generator state by accident.** If the generator were a `struct`, passing it by value would fork the stream, and two systems would get identical numbers. That is why `Rng` is a class here.
- **Consumption order changes.** Adding one extra `Range` call early in generation shifts everything after it, so old seeds change. Derive sub-seeds per feature, so changes stay local.
- **Weak seeds.** Seeds 1, 2 and 3 can produce correlated sequences with simple generators. Always run seeds through a mixing function, as `Derive` does.
- **Floats in derived logic.** Reproducible random numbers do not help if the code using them computes with floats differently across platforms. See [Determinism](./determinism).

## Related

- [Determinism](./determinism) — seeded randomness is one of its requirements.
- [Weighted Random & Loot Tables](./weighted-random) — consumes these streams.
- [Replay System](./replay-system) — stores seeds and generator state.
- [Noise-Based Generation](./noise-generation) — seeded offsets make generated worlds reproducible.
- [Wave Function Collapse](./wave-function-collapse) and [BSP Dungeon Generation](./bsp-dungeon) — other procedural techniques that rely on this.
