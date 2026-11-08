# Replay System

> Record inputs (or snapshots) and play them back for replays, bug reports and tests.

**Category:** Tooling, Debugging & Testing

## Problem

A tester reports "the boss fell through the floor after I dashed into the corner during phase 2". Nobody can reproduce it. Players want to watch their best runs again, share ghost replays and see kill-cams. Recording video is huge and cannot be inspected or re-simulated, so it does not help with any of this.

## Solution

There are two strategies, and many games combine them:

| Strategy | Records | Size | Requirement |
| --- | --- | --- | --- |
| **Input recording** | The random seed and initial state, then each step's inputs | Tiny (bytes per step) | The simulation must be **deterministic** |
| **Snapshot recording** | The state of relevant objects every N steps, interpolated on playback | Larger | None. Works with non-deterministic physics. |

**Input recording.** Every simulation step consumes inputs from an `IInputSource`. In live play, that source reads the devices and writes each step's input to the recording. During playback, a source reads from the recording instead. The game code cannot tell the difference. Replaying the same inputs from the same seed reproduces the session exactly, which makes the recording a bug report that runs.

**Snapshot recording.** Every few steps, store the position, rotation and animation state of tracked objects. Playback interpolates between snapshots. Seeking is easy, but you cannot change anything and re-simulate.

## Pseudocode

Input recording, as in the Example:

```text
FrameInput:
    move, jump, fire        // what one simulation step consumes

// Both sources answer the same question; gameplay can't tell them apart.
LiveInput:
    recorded ← empty list
    get_input(step):
        input ← read the devices
        append input to recorded
        return input

ReplayInput:
    frames
    get_input(step):
        if step ≥ number of frames: return finished
        return frames[step]

Replay:
    game_version, seed, frames

Simulation:
    start_live(seed):     reset(seed); source ← new LiveInput
    start_replay(replay): reset(replay.seed); source ← ReplayInput(replay.frames)

    reset(seed):
        step ← 0
        seed every gameplay random stream with seed
        put the world back in its initial state

    every fixed step:
        input ← source.get_input(step)
        if finished: stop
        tick(input)         // the same gameplay code for live play and replays
        step ← step + 1

    save(): return Replay(game version, seed, live source's recorded inputs)
```

## Example

Input recording for a deterministic, fixed-step simulation. The **core** is the input source: live play records what it reads, a replay feeds back what was recorded, and gameplay can't tell the difference. The **engine wiring** drives it from the fixed step and saves the replay. Unreal also has a built-in replay system that records replicated state instead.

### Core

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

[System.Serializable]
public struct FrameInput
{
    public Vector2 Move;
    public bool Jump;
    public bool Fire;
}

public interface IInputSource
{
    bool TryGetInput(int step, out FrameInput input);
}

public class LiveInput : IInputSource
{
    public readonly List<FrameInput> Recorded = new();

    public bool TryGetInput(int step, out FrameInput input)
    {
        input = new FrameInput
        {
            Move = new Vector2(Input.GetAxisRaw("Horizontal"), Input.GetAxisRaw("Vertical")),
            Jump = Input.GetButton("Jump"),
            Fire = Input.GetButton("Fire1"),
        };
        Recorded.Add(input);
        return true;
    }
}

public class ReplayInput : IInputSource
{
    readonly IReadOnlyList<FrameInput> frames;
    public ReplayInput(IReadOnlyList<FrameInput> frames) => this.frames = frames;

    public bool TryGetInput(int step, out FrameInput input)
    {
        bool has = step < frames.Count;
        input = has ? frames[step] : default;
        return has;   // false = replay finished
    }
}

[System.Serializable]
public class Replay
{
    public string gameVersion;
    public int seed;
    public List<FrameInput> frames;
}
```

```gdscript [Godot (GDScript)]
# replay.gd: a Resource, so ResourceSaver / ResourceLoader can store it (.tres for diffs, .res for size).
class_name Replay
extends Resource

@export var game_version := ""
@export var seed_value := 0  # "seed" would shadow the global seed() function
@export var moves := PackedVector2Array()  # one entry per physics tick
@export var buttons := PackedByteArray()  # bit 0 = jump, bit 1 = fire


# input_sources.gd: live play records what it reads; a replay plays it back.
# Both have get_input(step) -> {move, buttons}, or {} when the replay has finished.
class_name InputSources


class Live:
	var recorded := Replay.new()

	func get_input(_step: int) -> Dictionary:
		var move := Input.get_vector("move_left", "move_right", "move_back", "move_forward")
		var buttons := int(Input.is_action_pressed("jump")) | int(Input.is_action_pressed("fire")) << 1
		recorded.moves.append(move)
		recorded.buttons.append(buttons)
		return {move = move, buttons = buttons}


class Playback:
	var _replay: Replay

	func _init(replay: Replay) -> void:
		_replay = replay

	func get_input(step: int) -> Dictionary:
		if step >= _replay.moves.size():
			return {}  # replay finished
		return {move = _replay.moves[step], buttons = _replay.buttons[step]}
```

```cpp [Unreal (C++)]
// ReplayInput.h: plain C++ input recording (for a deterministic simulation of your own; see the notes).
#pragma once

#include "CoreMinimal.h"

struct FFrameInput
{
	FVector2f Move = FVector2f::ZeroVector;
	bool bJump = false;
	bool bFire = false;
};

class IInputSource
{
public:
	virtual ~IInputSource() = default;
	virtual bool TryGetInput(int32 Step, FFrameInput& OutInput) = 0;
};

// Reads the pawn's current input (set by its Enhanced Input handlers) and records it.
class FLiveInput : public IInputSource
{
public:
	FFrameInput Current;                                  // written by the input handlers
	TArray<FFrameInput> Recorded;

	virtual bool TryGetInput(int32 Step, FFrameInput& OutInput) override
	{
		OutInput = Current;
		Recorded.Add(Current);
		return true;
	}
};

class FReplayInput : public IInputSource
{
public:
	explicit FReplayInput(TArray<FFrameInput> InFrames) : Frames(MoveTemp(InFrames)) {}

	virtual bool TryGetInput(int32 Step, FFrameInput& OutInput) override
	{
		if (!Frames.IsValidIndex(Step)) return false;     // replay finished
		OutInput = Frames[Step];
		return true;
	}

private:
	TArray<FFrameInput> Frames;
};

struct FReplay
{
	FString GameVersion;
	int32 Seed = 0;
	TArray<FFrameInput> Frames;
};
```

:::

### Engine wiring

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class Simulation : MonoBehaviour
{
    IInputSource source;
    int step;

    public void StartLive(int seed)        { Init(seed); source = new LiveInput(); }
    public void StartReplay(Replay replay) { Init(replay.seed); source = new ReplayInput(replay.frames); }

    void Init(int seed)
    {
        step = 0;
        Rng.Reset(seed);   // every gameplay random number must come from seeded streams
        /* reset the world to its initial state */
    }

    void FixedUpdate()
    {
        if (source == null || !source.TryGetInput(step, out var input)) return;
        Tick(input);   // the same gameplay code for live play and replays
        step++;
    }

    void Tick(FrameInput input) { /* move, jump, fire... */ }

    public Replay Save(int seed) => new Replay
    {
        gameVersion = Application.version,
        seed = seed,
        frames = (source as LiveInput)?.Recorded,
    };
}
```

```gdscript [Godot (GDScript)]
# simulation.gd
extends Node

var _source  # InputSources.Live or InputSources.Playback
var _step := 0
var _rng := RandomNumberGenerator.new()  # every gameplay random number comes from seeded streams


func start_live(seed_value: int) -> void:
	_init_world(seed_value)
	var live := InputSources.Live.new()
	live.recorded.game_version = ProjectSettings.get_setting("application/config/version", "")
	live.recorded.seed_value = seed_value
	_source = live


func start_replay(replay: Replay) -> void:
	_init_world(replay.seed_value)
	_source = InputSources.Playback.new(replay)


func _init_world(seed_value: int) -> void:
	_step = 0
	_rng.seed = seed_value
	# reset the world to its initial state


func _physics_process(_delta: float) -> void:
	if _source == null:
		return
	var input: Dictionary = _source.get_input(_step)
	if input.is_empty():
		return  # replay finished
	_tick(input.move, input.buttons)  # the same gameplay code for live play and replays
	_step += 1


func _tick(_move: Vector2, _buttons: int) -> void:
	pass  # move, jump, fire...


func save(path: String) -> Error:
	var live := _source as InputSources.Live
	return ResourceSaver.save(live.recorded, path) if live else ERR_UNAVAILABLE
```

```cpp [Unreal (C++)]
// Built in: Unreal's replay system (the DemoNetDriver) records replicated actors and properties,
// so it works without a deterministic simulation. Recorded actors must replicate.
// MyGameInstance.h
#pragma once

#include "CoreMinimal.h"
#include "Engine/GameInstance.h"
#include "MyGameInstance.generated.h"

UCLASS()
class UMyGameInstance : public UGameInstance
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable) void StartMatchRecording();
	UFUNCTION(BlueprintCallable) void StopMatchRecording();
	UFUNCTION(BlueprintCallable) void WatchLastMatch();
	UFUNCTION(BlueprintCallable) void SkipTo(float Seconds);
};

// MyGameInstance.cpp
#include "MyGameInstance.h"
#include "Engine/DemoNetDriver.h"

void UMyGameInstance::StartMatchRecording()
{
	StartRecordingReplay(TEXT("LastMatch"), TEXT("Last match"));     // also works in standalone games
}

void UMyGameInstance::StopMatchRecording()
{
	StopRecordingReplay();
}

void UMyGameInstance::WatchLastMatch()
{
	PlayReplay(TEXT("LastMatch"));                                    // loads the map and plays it back
}

void UMyGameInstance::SkipTo(float Seconds)
{
	if (UDemoNetDriver* Demo = GetWorld()->GetDemoNetDriver())
		Demo->GotoTimeInSeconds(FMath::Clamp(Seconds, 0.f, Demo->GetDemoTotalTime()));   // scrubbing
}

// For an input replay instead, drive your own fixed-step simulation from a timer with
// FLiveInput / FReplayInput, as in the other tabs, and save FReplay with FArchive or JSON.
```

:::

Serialise the replay (`JsonUtility` in Unity, a `.tres`/`.res` resource in Godot, or a compact binary format) and attach it to bug reports automatically.

**Engine notes**

- **Unity:** Unity has no built-in gameplay replay. Input replays need the simulation to be deterministic ([Determinism](./determinism)): PhysX and `Time.deltaTime`-driven code are not, so keep gameplay on the fixed step with its own seeded random numbers. Otherwise record state snapshots instead. The legacy `Input` class is used here for brevity; with the Input System, read the actions in `TryGetInput`.
- **Godot:** No built-in replay either. `_physics_process` runs at a fixed rate, which is what an input replay needs, but neither Godot Physics nor Jolt is designed to be deterministic, so physics-heavy games record state (transforms per tick) instead of input.
- **Unreal:** The built-in replay system: `StartRecordingReplay` / `StopRecordingReplay` / `PlayReplay` on the game instance, the `demorec`, `demostop` and `demoplay` console commands, and `UDemoNetDriver` for scrubbing (`GotoTimeInSeconds`) and slow motion. It records replication, so anything not replicated (local-only effects, UI) is not in the replay, and its files are tied to the build they were recorded with.

## When to use

- Reproducing bugs: replays attached to crash reports or QA tickets.
- Player-facing replays, ghosts in racing games and time-trial games, kill-cams.
- Regression tests: replay a recorded session after each change and assert the final state.

## When not to use

- Games where replays aren't a feature and bugs are easy to reproduce.
- Non-deterministic games, if you plan to record only inputs. Record snapshots, or make the game [deterministic](./determinism) first.

## Pitfalls

- **Hidden non-determinism breaks input replays.** Common causes are the variable frame delta, unseeded or shared `Random`, iterating a `Dictionary` or `HashSet` (order is not guaranteed), physics engines that are not deterministic, floating-point differences across platforms, and reading wall-clock time. Add periodic state checksums to the replay, so a desync is caught at the exact step it happens.
- **Version mismatches.** Any gameplay change invalidates old replays. Store the game version and refuse, or warn, on mismatch.
- **Seeking needs keyframes.** To jump to minute 10 of an input replay, you must simulate 10 minutes or store occasional full snapshots.
- **Inputs sampled per frame** but consumed in the fixed step are recorded at the wrong granularity. Record exactly what each simulation step consumed.

## Related

- [Command](./command) — inputs as data are what makes recording possible.
- [Fixed Timestep](./fixed-timestep) — replays index inputs by step number, not by time.
- [Client-Side Prediction](./client-side-prediction) — replays inputs over a corrected state, using the same machinery.
- [Determinism](./determinism) and [Seeded Randomness](./seeded-randomness) — the foundations input replays depend on.
