# Replays & Ghost Races

> Record a run as inputs and play it back exactly, as a replay or as a ghost to race against.

## Goal

A time-trial racing game, or any game with a "beat your best run" mode:

- Every run is recorded, and the best one becomes a **ghost** that races alongside the player.
- A three-minute run fits in **a few kilobytes**, small enough to upload to a leaderboard.
- Playback is **exact**. The ghost crosses the line at the recorded time, to the step.
- If a replay ever diverges, the game **detects it** immediately instead of showing a wrong ghost.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Replay System](../patterns/replay-system) | Records each step's input, and plays it back by feeding the recording to the simulation instead of the devices. |
| [Command](../patterns/command) | Each step's input is a small value (`RaceInput`) describing intent, not a call that already happened. It can be stored, compared and compressed. |
| [Fixed Timestep](../patterns/fixed-timestep) | Simulation advances in constant, numbered steps. Recordings are indexed by step, never by time. |
| [Seeded Randomness](../patterns/seeded-randomness) | The only randomness in the simulation (here, gusts of wind) comes from a generator seeded per run, and the seed is saved in the recording. |
| [Determinism](../patterns/determinism) | Same seed + same inputs → same run. Checksums stored in the recording verify it during playback. |

## How they fit together

```
Update (every frame)         FixedUpdate (every 1/50 s)                          On finish
──────────────────────       ───────────────────────────────────────────────     ──────────────
read devices ─► latched ───► playerSim.Advance(latched)  ─► recorder.Record ───► Recording
                             ghostSim.Advance(recorded)  ◄─ playback.Next        { version, seed,
                             every 50 steps: compare ghost checksum ◄─────────     input runs,
                                                                                   checksums }
Views interpolate between the previous and current sim state (Double Buffer)
```

- **Command ↔ Replay System.** Because input is a small value type, recording it is just storing it. Consecutive steps usually have identical input, so storing *runs* (input × count) compresses a three-minute race to a few hundred entries.
- **Fixed Timestep ↔ Determinism.** The simulation never sees `Time.deltaTime`. Step *n* of the ghost is computed exactly as step *n* of the original run was.
- **Seeded Randomness ↔ Replay System.** The recording stores the seed, so wind gusts replay identically. VFX and audio use `UnityEngine.Random` freely, because they never touch the simulation's generator.
- **Determinism ↔ Replay System.** Checksums saved every 50 steps turn "the ghost looks a bit off" into "desync at step 3,150", which is reproducible and debuggable.

## Example (Unity C#)

### The deterministic simulation

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

// Command: one step's intent. Small, comparable, serialisable.
[Serializable]
public struct RaceInput : IEquatable<RaceInput>
{
    public sbyte Steer;          // -100..100
    public bool Throttle, Brake;

    public bool Equals(RaceInput o) => Steer == o.Steer && Throttle == o.Throttle && Brake == o.Brake;
}

// Pure simulation: no Time, no Input, no UnityEngine.Random, no physics engine.
public sealed class RaceSim
{
    public const int StepsPerSecond = 50;
    const float Dt = 1f / StepsPerSecond;

    public int Step { get; private set; }
    public Vector2 Position, PreviousPosition;   // previous/current for interpolated rendering
    public float Heading, Speed;

    readonly Rng rng;                            // Seeded Randomness (see that pattern's page)
    float gust;

    public RaceSim(ulong seed, Vector2 start)
    {
        rng = new Rng(seed);
        Position = PreviousPosition = start;
    }

    public void Advance(RaceInput input)
    {
        PreviousPosition = Position;

        if (Step % StepsPerSecond == 0)          // a new wind gust every second
            gust = rng.Range(-0.6f, 0.6f);

        float accel = input.Throttle ? 12f : input.Brake ? -20f : -3f;
        Speed = Mathf.Clamp(Speed + accel * Dt, 0f, 40f);
        Heading += input.Steer * 0.01f * 2.5f * Dt * Mathf.Min(Speed / 10f, 1f);

        var forward = new Vector2(Mathf.Sin(Heading), Mathf.Cos(Heading));
        Position += (forward * Speed + new Vector2(gust, 0f)) * Dt;
        Step++;
    }

    // Determinism: FNV-1a over the exact bits of the state.
    public uint Checksum()
    {
        uint h = 2166136261;
        void Mix(float f) { h = (h ^ (uint)BitConverter.SingleToInt32Bits(f)) * 16777619; }
        Mix(Position.x); Mix(Position.y); Mix(Heading); Mix(Speed);
        return (h ^ (uint)Step) * 16777619;
    }
}
```

This simulation uses floats, so it is deterministic for the **same build on the same platform**, which is enough for local ghosts. Ghosts shared across platforms on a leaderboard need fixed-point math. See [Determinism](../patterns/determinism).

### Recording and playback

```csharp
[Serializable]
public class Recording
{
    public string gameVersion;
    public ulong seed;
    public int totalSteps;
    public List<RaceInput> inputs = new();     // run-length encoded:
    public List<int> counts = new();           // inputs[i] repeated counts[i] times
    public List<uint> checksums = new();       // one per ChecksumInterval steps

    public const int ChecksumInterval = 50;
}

public class InputRecorder
{
    public readonly Recording Recording;

    public InputRecorder(ulong seed) =>
        Recording = new Recording { gameVersion = Application.version, seed = seed };

    public void Record(RaceInput input, RaceSim simAfterStep)
    {
        var r = Recording;
        int last = r.inputs.Count - 1;
        if (last >= 0 && r.inputs[last].Equals(input)) r.counts[last]++;   // extend the current run
        else { r.inputs.Add(input); r.counts.Add(1); }

        r.totalSteps++;
        if (simAfterStep.Step % Recording.ChecksumInterval == 0)
            r.checksums.Add(simAfterStep.Checksum());
    }
}

public class InputPlayback
{
    readonly Recording recording;
    int run, usedInRun;

    public InputPlayback(Recording recording) => this.recording = recording;

    public bool TryNext(out RaceInput input)
    {
        if (run >= recording.inputs.Count) { input = default; return false; }
        input = recording.inputs[run];
        if (++usedInRun == recording.counts[run]) { run++; usedInRun = 0; }
        return true;
    }

    // Returns false on desync: the ghost no longer matches the original run.
    public bool Verify(RaceSim sim)
    {
        if (sim.Step % Recording.ChecksumInterval != 0) return true;
        int index = sim.Step / Recording.ChecksumInterval - 1;
        return index >= recording.checksums.Count || recording.checksums[index] == sim.Checksum();
    }
}
```

### Running the player and the ghost side by side

```csharp
public class TimeTrial : MonoBehaviour
{
    [SerializeField] Transform playerView, ghostView;
    [SerializeField] Vector2 start;

    RaceSim player, ghost;
    InputRecorder recorder;
    InputPlayback playback;
    RaceInput latched;

    public void StartRun(Recording best)
    {
        Time.fixedDeltaTime = 1f / RaceSim.StepsPerSecond;

        ulong seed = (ulong)DateTime.UtcNow.Ticks;      // a fresh seed per run, saved in the recording
        player = new RaceSim(seed, start);
        recorder = new InputRecorder(seed);

        bool compatible = best != null && best.gameVersion == Application.version;
        ghost = compatible ? new RaceSim(best.seed, start) : null;   // the ghost replays ITS OWN seed
        playback = compatible ? new InputPlayback(best) : null;
        ghostView.gameObject.SetActive(compatible);
    }

    void Update()
    {
        // Sample devices every frame; the simulation consumes the latest value each step.
        latched = new RaceInput
        {
            Steer = (sbyte)Mathf.RoundToInt(Input.GetAxisRaw("Horizontal") * 100f),
            Throttle = Input.GetButton("Fire1"),
            Brake = Input.GetButton("Fire2"),
        };

        // Interpolate views between the last two simulation states.
        float alpha = (Time.time - Time.fixedTime) / Time.fixedDeltaTime;
        if (player != null) playerView.position = Vector2.Lerp(player.PreviousPosition, player.Position, alpha);
        if (ghost != null) ghostView.position = Vector2.Lerp(ghost.PreviousPosition, ghost.Position, alpha);
    }

    void FixedUpdate()
    {
        if (player == null) return;

        player.Advance(latched);
        recorder.Record(latched, player);

        if (ghost != null && playback.TryNext(out var ghostInput))
        {
            ghost.Advance(ghostInput);
            if (!playback.Verify(ghost))
            {
                Debug.LogError($"Ghost desync at step {ghost.Step}");
                ghost = null;
                ghostView.gameObject.SetActive(false);
            }
        }
    }

    public Recording FinishRun() => recorder.Recording;   // keep it if it beats the best time
}
```

`JsonUtility.ToJson(recording)` is enough to save a recording locally. For uploads, write the runs as bytes. A `RaceInput` fits in two bytes and a count in two more.

## Where the patterns meet: pitfalls

- **Reading time or input inside the simulation.** One `Time.deltaTime` or `Input.GetAxis` call inside `RaceSim` breaks every recording. Keep the simulation in a plain C# class that cannot reach those APIs easily.
- **Recording what the devices said instead of what the step consumed.** Record the exact `RaceInput` passed to `Advance`. Re-sampling devices for the recording, or recording in `Update`, misaligns steps.
- **The ghost using the player's seed.** Each run has its own seed, and the ghost must replay the seed *from its recording*, or its wind gusts differ and it drifts off course.
- **Old recordings after a gameplay change.** Any change to handling, track or gust timing invalidates saved ghosts. Store the game version, and re-verify or discard on mismatch. The checksums catch any mismatch the version check misses.
- **Physics engine in the loop.** Driving the car with a Rigidbody makes PhysX part of the simulation, and it is not guaranteed to replay identically. Use simple custom movement for anything that must replay.
- **Rendering without interpolation.** Views snapped to simulation positions stutter whenever the frame rate is not a multiple of 50 Hz. Keep the previous and current state, as `RaceSim` does.

## Variations

- **Kill-cams and instant replays:** keep a rolling buffer of the last N seconds of inputs, plus a periodic snapshot to start from. See [Memento](../patterns/memento).
- **Seeking and scrubbing:** store a full state snapshot every few seconds, and simulate forward from the nearest one.
- **Bug reports:** attach the current recording to crash and bug reports automatically. QA can replay the exact session.
- **Networked ghosts and lockstep multiplayer:** the same input stream sent live instead of saved. See [Client-Side Prediction](../patterns/client-side-prediction).
