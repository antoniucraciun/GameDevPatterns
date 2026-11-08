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

## Example

Keep the simulation free of the engine's frame-dependent APIs, and verify it with a checksum. This is engine-free logic in every tab: integer (fixed-point) state, an owned seeded random number generator, and a defined iteration order.

### Core

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;

public struct SimInput { public sbyte MoveX, MoveY; public bool Fire; }

public sealed class Simulation
{
    public const int StepsPerSecond = 60;

    public int Step { get; private set; }
    readonly System.Random rng;                          // owned, seeded
    readonly List<Unit> units = new();                   // ordered list, never a HashSet

    public Simulation(int seed) => rng = new System.Random(seed);

    public void Spawn(int x, int y) => units.Add(new Unit { Id = units.Count, X = x, Y = y, Health = 100 });

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

```gdscript [Godot (GDScript)]
# simulation.gd: no nodes, no delta, no global randi(). GDScript ints are 64-bit, so fixed point is easy.
class_name Simulation
extends RefCounted

const STEPS_PER_SECOND := 60


class SimInput:
	var move_x := 0  # -1, 0 or 1
	var move_y := 0
	var fire := false


class Unit:
	var id := 0
	var x := 0  # positions in fixed point: 1 unit = 1/1000 m
	var y := 0
	var health := 100

	func tick(input: SimInput, rng: RandomNumberGenerator) -> void:
		x += input.move_x * 50  # integer math: identical on every machine
		y += input.move_y * 50
		if input.fire and rng.randi_range(0, 99) < 25:
			health -= 1


var step := 0
var _rng := RandomNumberGenerator.new()  # owned, seeded: never the global randi()/randf()
var _units: Array[Unit] = []  # ordered array; never iterate a Dictionary you filled in varying order


func _init(seed_value: int) -> void:
	_rng.seed = seed_value


func spawn(x: int, y: int) -> void:
	var u := Unit.new()
	u.id = _units.size()
	u.x = x
	u.y = y
	_units.append(u)


func advance(input: SimInput) -> void:
	for u in _units:  # defined order: insertion order
		u.tick(input, _rng)
	step += 1


# FNV-1a hash (32-bit) of the state that matters. Compare across runs or peers.
func checksum() -> int:
	var h := _mix(2166136261, step)
	for u in _units:
		for v: int in [u.id, u.x, u.y, u.health]:  # fixed-point ints hash exactly
			h = _mix(h, v)
	return h


static func _mix(h: int, v: int) -> int:
	return ((h ^ (v & 0xFFFFFFFF)) * 16777619) & 0xFFFFFFFF  # 64-bit ints: mask back to 32 bits
```

```cpp [Unreal (C++)]
// Simulation.h: plain C++, no actors, no DeltaSeconds, no FMath::Rand().
#pragma once

#include "CoreMinimal.h"

struct FSimInput
{
	int8 MoveX = 0, MoveY = 0;
	bool bFire = false;
};

struct FUnit
{
	int32 Id = 0, X = 0, Y = 0, Health = 100;            // positions in fixed point: 1 unit = 1/1000 m

	void Tick(const FSimInput& Input, FRandomStream& Rng)
	{
		X += Input.MoveX * 50;                            // integer math: identical on every machine
		Y += Input.MoveY * 50;
		if (Input.bFire && Rng.RandRange(0, 99) < 25) Health -= 1;
	}
};

class FSimulation
{
public:
	static constexpr int32 StepsPerSecond = 60;

	explicit FSimulation(int32 Seed) : Rng(Seed) {}       // owned, seeded

	int32 GetStep() const { return Step; }
	void Spawn(int32 X, int32 Y) { Units.Add({ Units.Num(), X, Y, 100 }); }

	void Advance(const FSimInput& Input)
	{
		for (FUnit& Unit : Units) Unit.Tick(Input, Rng);  // defined order: array order, never a TSet
		++Step;
	}

	// FNV-1a hash of the state that matters. Compare across runs or peers.
	uint32 Checksum() const
	{
		uint32 Hash = 2166136261u;
		auto Mix = [&Hash](int32 V) { Hash = (Hash ^ uint32(V)) * 16777619u; };
		Mix(Step);
		for (const FUnit& Unit : Units)
		{
			Mix(Unit.Id);
			Mix(Unit.X);                                  // fixed-point ints hash exactly
			Mix(Unit.Y);
			Mix(Unit.Health);
		}
		return Hash;
	}

private:
	FRandomStream Rng;
	TArray<FUnit> Units;
	int32 Step = 0;
};
```

:::

### Desync test

Run the same inputs twice and report the first step where the runs diverge, as an ordinary unit test:

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using NUnit.Framework;

public static class DesyncCheck
{
    public static int FindFirstDesync(int seed, IReadOnlyList<SimInput> inputs)
    {
        var a = new Simulation(seed);
        var b = new Simulation(seed);
        a.Spawn(0, 0); b.Spawn(0, 0);
        for (int i = 0; i < inputs.Count; i++)
        {
            a.Advance(inputs[i]);
            b.Advance(inputs[i]);
            if (a.Checksum() != b.Checksum()) return i;
        }
        return -1;   // deterministic, at least on this machine
    }
}

public class DeterminismTests                              // Edit Mode test (Unity Test Framework)
{
    [Test]
    public void SameSeedAndInputsGiveSameChecksums()
    {
        var random = new System.Random(1);
        var inputs = new List<SimInput>();
        for (int i = 0; i < 10_000; i++)
            inputs.Add(new SimInput { MoveX = (sbyte)random.Next(-1, 2), MoveY = (sbyte)random.Next(-1, 2), Fire = random.Next(2) == 0 });

        Assert.AreEqual(-1, DesyncCheck.FindFirstDesync(42, inputs), "first desynced step");
    }
}
```

```gdscript [Godot (GDScript)]
# test_determinism.gd: a GUT test (the GUT add-on; GdUnit4 works the same way).
extends GutTest


func find_first_desync(seed_value: int, inputs: Array[Simulation.SimInput]) -> int:
	var a := Simulation.new(seed_value)
	var b := Simulation.new(seed_value)
	a.spawn(0, 0)
	b.spawn(0, 0)
	for i in inputs.size():
		a.advance(inputs[i])
		b.advance(inputs[i])
		if a.checksum() != b.checksum():
			return i
	return -1  # deterministic, at least on this machine


func test_same_seed_and_inputs_give_same_checksums() -> void:
	var random := RandomNumberGenerator.new()
	random.seed = 1
	var inputs: Array[Simulation.SimInput] = []
	for i in 10_000:
		var input := Simulation.SimInput.new()
		input.move_x = random.randi_range(-1, 1)
		input.move_y = random.randi_range(-1, 1)
		input.fire = random.randi_range(0, 1) == 0
		inputs.append(input)
	assert_eq(find_first_desync(42, inputs), -1, "first desynced step")
```

```cpp [Unreal (C++)]
// SimulationTests.cpp: an Automation test (Session Frontend > Automation, or the command line).
#include "Misc/AutomationTest.h"
#include "Simulation.h"

static int32 FindFirstDesync(int32 Seed, const TArray<FSimInput>& Inputs)
{
	FSimulation A(Seed), B(Seed);
	A.Spawn(0, 0);
	B.Spawn(0, 0);
	for (int32 i = 0; i < Inputs.Num(); ++i)
	{
		A.Advance(Inputs[i]);
		B.Advance(Inputs[i]);
		if (A.Checksum() != B.Checksum()) return i;
	}
	return INDEX_NONE;                                    // deterministic, at least on this machine
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSimulationDeterminismTest, "Game.Simulation.Determinism",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FSimulationDeterminismTest::RunTest(const FString& Parameters)
{
	FRandomStream Random(1);
	TArray<FSimInput> Inputs;
	for (int32 i = 0; i < 10000; ++i)
		Inputs.Add({ int8(Random.RandRange(-1, 1)), int8(Random.RandRange(-1, 1)), Random.RandRange(0, 1) == 0 });

	TestEqual(TEXT("first desynced step"), FindFirstDesync(42, Inputs), int32(INDEX_NONE));
	return true;
}
```

:::

Run the same test on different platforms with recorded inputs and stored checksums to catch cross-platform divergence: two runs on one machine agreeing proves only that nothing reads uninitialised or time-dependent state.

The view layer (MonoBehaviours, nodes or actors, animation, VFX, audio) reads the simulation state and may use floats, delta time and the engine's random functions freely. It must never write back into the simulation.

**Engine notes**

- **Unity:** `System.Random` with a seed gives the same sequence wherever Unity's class library is the same, but a tiny PRNG of your own (xorshift, PCG) removes even that dependency. Avoid floats in the simulation: Burst, Mono and IL2CPP may compile float math differently, and PhysX and Box2D are not deterministic across machines. `Unity.Mathematics` and Burst do not make float math deterministic across platforms.
- **Godot:** Use your own `RandomNumberGenerator` with a fixed `seed` (PCG32), never the global `randi()` / `randf()`, which other code also consumes. Its sequence is stable for a Godot version; pin the engine version for replays and lockstep. GDScript `float` is 64-bit and the C++ math behind it isn't guaranteed identical across platforms, so keep simulation state in `int`. Godot Physics and Jolt are not deterministic across machines.
- **Unreal:** `FRandomStream` is a seeded, deterministic generator; `FMath::Rand` and `FMath::FRand` are global and unseeded. Chaos physics, animation and the character movement component run on variable `DeltaSeconds` and floats, so they belong to the view, not the simulation. Run the automation test from the command line in CI (`-ExecCmds="Automation RunTests Game.Simulation"`).

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
