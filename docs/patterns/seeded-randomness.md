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
4. **A generator you own.** `System.Random`'s algorithm is not guaranteed to stay the same across .NET versions, and `UnityEngine.Random` is global state. For seeds that must work across game versions and platforms, such as shared world seeds or daily challenges, ship your own small PRNG.
5. **Saveable state.** Store the generator's internal state in save files and replays, not just the original seed.

## Example (Unity C#)

A small, fast generator (SplitMix64) that behaves identically on every platform:

```csharp
public sealed class Rng
{
    public ulong State;                                   // save/restore this for save files and replays

    public Rng(ulong seed) => State = seed;

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

Using separate and derived streams:

```csharp
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

A daily challenge becomes `new World(Rng.Derive(0xC0FFEE, year, dayOfYear))`, the same level for everyone that day.

## When to use

- Procedural generation that must be reproducible or shareable: worlds, dungeons, daily runs.
- Anything that must replay exactly: input replays, lockstep and rollback networking, regression tests.
- Debugging. Logging the seed of a failed run makes it reproducible.

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
- Wave Function Collapse and BSP Dungeon Generation — other procedural techniques that rely on this.
