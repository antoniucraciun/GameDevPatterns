# Determinism

> Same inputs always produce the same outputs — enabling replays, lockstep and tests.

**Category:** Tooling, Debugging & Testing

## Problem

You record a player's inputs to replay a bug. On playback the run diverges after ten seconds: an enemy turns slightly differently, a bullet misses, and soon the replay shows a different game. In a lockstep multiplayer RTS, the same divergence means two players' worlds silently disagree ("desync"). Without determinism, input-based replays, lockstep networking, rollback netcode and reproducible tests are all impossible.

## Solution

Make the **simulation** a pure function of its initial state and its inputs:

```
state(n + 1) = Step(state(n), inputs(n))
```

Every source of variation that is not an input must be removed or made explicit. The usual culprits:

| Source | Fix |
| --- | --- |
| Variable `deltaTime` | Simulate in constant steps. See [Fixed Timestep](./fixed-timestep). |
| Unseeded or shared random numbers | One explicitly seeded generator per system, owned by the simulation. See [Seeded Randomness](./seeded-randomness). |
| Iteration order of `Dictionary`/`HashSet`, `FindObjectsByType`, physics callbacks | Iterate in a defined order: sorted IDs, or lists in insertion order. |
| Wall-clock time, frame count, `Time.time` read inside logic | Use the simulation's own step counter. |
| Reading input directly inside logic | Feed recorded input structs into each step. |
| Engine physics | PhysX is not guaranteed deterministic across machines. Use your own simple physics, or Unity Physics (DOTS), which is deterministic only on the same platform and CPU architecture. |
| Floating-point differences across CPUs, compilers and platforms | Same binary on the same architecture is usually fine. For cross-platform guarantees, use fixed-point math. |
| Multithreading | Merge job results in a fixed order. Never let "whichever thread finishes first" decide anything. |

Then **verify** it. Compute a checksum of the simulation state every N steps, and compare it between runs or between peers. A mismatch pinpoints the first step where the runs diverged.

## Example (Unity C#)

Keep the simulation free of Unity's frame-dependent APIs, and verify it with a checksum:

```csharp
public struct SimInput { public sbyte MoveX, MoveY; public bool Fire; }

public sealed class Simulation
{
    public const int StepsPerSecond = 60;

    public int Step { get; private set; }
    readonly System.Random rng;                          // owned, seeded
    readonly List<Unit> units = new();                   // ordered list, never a HashSet

    public Simulation(int seed) => rng = new System.Random(seed);

    public void Advance(SimInput input)
    {
        foreach (var u in units)                         // defined order: insertion order
            u.Tick(input, rng);
        Step++;
    }

    // FNV-1a hash of the state that matters. Compare across runs or peers.
    public uint Checksum()
    {
        uint hash = 2166136261;
        void Mix(int v) { hash = (hash ^ (uint)v) * 16777619; }

        Mix(Step);
        foreach (var u in units)
        {
            Mix(u.Id);
            Mix(u.X);                                    // fixed-point ints hash exactly
            Mix(u.Y);
            Mix(u.Health);
        }
        return hash;
    }
}

public sealed class Unit
{
    public int Id, X, Y, Health;                          // positions in fixed point: 1 unit = 1/1000 m

    public void Tick(SimInput input, System.Random rng)
    {
        X += input.MoveX * 50;                            // integer math: identical on every machine
        Y += input.MoveY * 50;
        if (input.Fire && rng.Next(100) < 25) Health -= 1;
    }
}
```

A desync test that runs the same inputs twice and reports the first step where they diverge:

```csharp
public static int FindFirstDesync(int seed, IReadOnlyList<SimInput> inputs)
{
    var a = new Simulation(seed);
    var b = new Simulation(seed);
    for (int i = 0; i < inputs.Count; i++)
    {
        a.Advance(inputs[i]);
        b.Advance(inputs[i]);
        if (a.Checksum() != b.Checksum()) return i;
    }
    return -1;   // deterministic, at least on this machine
}
```

Run the same test on different platforms with recorded inputs and stored checksums to catch cross-platform divergence.

The view layer (MonoBehaviours, animation, VFX, audio) reads the simulation state and may use floats, `deltaTime` and `UnityEngine.Random` freely. It must never write back into the simulation.

## When to use

- Input-based replays and ghosts, [lockstep networking](./deterministic-lockstep) (RTS, fighting games), [rollback netcode](./rollback-netcode).
- Reproducing bugs from recorded sessions, and [automated regression tests](./automated-playtesting) that compare checksums.
- Not every game needs it. Snapshot-based replays and server-authoritative netcode work without it.

## When not to use

- Games without lockstep, rollback or input replays. Server-authoritative netcode and snapshot replays work without it.
- Projects that rely on engine physics or floating-point maths across different hardware. Making them deterministic is hard; use state sync instead.

## Pitfalls

- **"Deterministic on my machine."** Same-build, same-machine determinism is much easier than cross-platform determinism. Decide which one you need before designing the math.
- **The view leaking into the simulation.** A gameplay script that reads `transform.position` (interpolated, frame-dependent) instead of simulation state breaks everything. Keep a hard boundary between the two.
- **Hidden randomness.** `UnityEngine.Random` is shared global state. Any library or effect that calls it shifts your sequence. Use your own generator instances.
- **Checksumming too little.** If the checksum skips state that later affects gameplay, desyncs are detected late and far from their cause. Hash everything the simulation reads.

## Related

- [Fixed Timestep](./fixed-timestep) — the first requirement.
- [Seeded Randomness](./seeded-randomness) — the second requirement.
- [Replay System](./replay-system) and [Client-Side Prediction](./client-side-prediction) — depend on reproducible simulation.
- [Command](./command) — inputs as data are what a deterministic simulation consumes.
