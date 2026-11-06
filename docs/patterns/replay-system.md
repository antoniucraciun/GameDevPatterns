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

## Example (Unity C#)

Input recording, driven from a fixed step:

```csharp
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

Serialise `Replay` with `JsonUtility`, or a compact binary format, and attach it to bug reports automatically.

## When to use

- Reproducing bugs: replays attached to crash reports or QA tickets.
- Player-facing replays, ghosts in racing games and time-trial games, kill-cams.
- Regression tests: replay a recorded session after each change and assert the final state.

## Pitfalls

- **Hidden non-determinism breaks input replays.** Common causes are `Time.deltaTime`, unseeded or shared `Random`, iterating a `Dictionary` or `HashSet` (order is not guaranteed), physics engines that are not deterministic, floating-point differences across platforms, and reading wall-clock time. Add periodic state checksums to the replay, so a desync is caught at the exact step it happens.
- **Version mismatches.** Any gameplay change invalidates old replays. Store the game version and refuse, or warn, on mismatch.
- **Seeking needs keyframes.** To jump to minute 10 of an input replay, you must simulate 10 minutes or store occasional full snapshots.
- **Inputs sampled in `Update`** but consumed in `FixedUpdate` are recorded at the wrong granularity. Record exactly what each simulation step consumed.

## Related

- [Command](./command) — inputs as data are what makes recording possible.
- [Fixed Timestep](./fixed-timestep) — replays index inputs by step number, not by time.
- [Client-Side Prediction](./client-side-prediction) — replays inputs over a corrected state, using the same machinery.
- [Determinism](./determinism) and [Seeded Randomness](./seeded-randomness) — the foundations input replays depend on.
