# Rollback Fighting Game

> Frame-perfect online fighting where input buffering and hit stop still work correctly through rollbacks.

## Goal

Online play for a 2D fighting game:

- Inputs respond **on the same frame** locally, even at 100+ ms ping.
- Both players see the **same match**: hits, blocks and knockdowns agree exactly.
- **Input buffering** (press a special move slightly early, and it comes out on the first possible frame) and **hit stop** (the freeze on impact) behave identically online and offline, even when the game rolls back and replays frames.
- Sounds, sparks and screen shake **never play twice** because of a rollback.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Rollback Netcode](../patterns/rollback-netcode) | Predict the opponent's input, save state every frame, and resimulate when a prediction was wrong. |
| [Determinism](../patterns/determinism) | Integer math, no engine physics, fixed iteration order, so both machines compute identical frames. |
| [Fixed Timestep](../patterns/fixed-timestep) | The simulation advances exactly one frame (1/60 s) per step, numbered, on both machines. |
| [Command](../patterns/command) | Each frame's input is a tiny value, sent, stored, compared and replayed. |
| [Input Buffer](../patterns/input-buffer) | Remembers recent presses so special moves come out on the first legal frame, *as part of the simulation state*. |
| [Hit Stop](../patterns/hit-stop) | The impact freeze, as a frame counter *inside the simulation*, not as a change to `Time.timeScale`. |

## How they fit together

```
 local pad ──► FrameInput (Command, 2 bytes) ──► RollbackSession ◄── remote FrameInput (network)
                                                     │ save GameState each frame (ring buffer)
                                                     │ wrong prediction → restore & resimulate
                                                     ▼
                        Simulation.Step(GameState, p0Input, p1Input)   ← deterministic, pure
                        ├─ InputBuffer lives IN GameState (last 8 frames of presses per player)
                        ├─ HitStop lives IN GameState (frames remaining)
                        └─ positions, velocities, health: fixed-point ints
                                                     ▼
 Presentation (Update): compare rendered state with last rendered state
   ├─ new hit this frame? → spark, sound, shake         (never inside Step)
   └─ draw fighters at state positions
```

The joins:

- **Input Buffer ↔ Rollback.** The input buffer is *game state*. If it lived in a MonoBehaviour outside the simulation, a rollback would restore positions but not the buffered presses, and a buffered special move would come out on one machine and not the other. Store it in the `GameState` struct, so save/restore covers it automatically.
- **Hit Stop ↔ Rollback.** Freezing with `Time.timeScale` would freeze the *real* clock that rollback depends on, and could not be rolled back. In the simulation, hit stop is a counter: while it is above zero, `Step` skips movement and only decrements it. Rollback restores it like any other value.
- **Determinism ↔ everything.** Fixed-point positions, integer frame counters and no `UnityEngine.Random` or physics in `Step`. Any float drift shows up as a desync minutes into a match.
- **Command ↔ presentation.** Inputs are compact values sent every frame. Effects are derived from *state changes* during rendering, so resimulated frames never trigger them again.

## Example (Unity C#)

This builds on `RollbackSession` from [Rollback Netcode](../patterns/rollback-netcode). The key is that **everything the rules depend on lives in one copyable struct**.

```csharp
using System;

[Flags] public enum Btn : byte { None = 0, Light = 1, Heavy = 2, Special = 4, Block = 8 }

public struct FrameInput : IEquatable<FrameInput>          // Command: 2 bytes per player per frame
{
    public sbyte Dir;                                       // numpad notation 1..9, 5 = neutral
    public Btn Buttons;
    public bool Equals(FrameInput o) => Dir == o.Dir && Buttons == o.Buttons;
}

public unsafe struct InputBufferState                      // Input Buffer, INSIDE the simulation
{
    public const int Length = 8;                            // 8 frames ≈ 133 ms of leniency
    public fixed byte pressedAge[8];                        // per button bit: frames since pressed, 255 = never

    public void Tick(Btn pressedThisFrame)
    {
        for (int b = 0; b < 8; b++)
        {
            bool pressed = ((int)pressedThisFrame & (1 << b)) != 0;
            pressedAge[b] = pressed ? (byte)0 : (byte)Math.Min(255, pressedAge[b] + 1);
        }
    }

    public bool Buffered(Btn button)
    {
        for (int b = 0; b < 8; b++)
            if (((int)button & (1 << b)) != 0 && pressedAge[b] < Length) return true;
        return false;
    }

    public void Consume(Btn button)
    {
        for (int b = 0; b < 8; b++)
            if (((int)button & (1 << b)) != 0) pressedAge[b] = 255;
    }
}

public struct FighterState
{
    public int X, Y;                       // fixed point: 1 unit = 1/1000 px
    public int VelX, VelY;
    public int Health;
    public int MoveId, MoveFrame;          // current move and how far into it
    public int Facing;                     // +1 / -1
    public Btn PrevButtons;                // to detect presses (edges)
    public InputBufferState Buffer;
}

public struct GameState                    // everything rollback must restore: a plain copy
{
    public int Frame;
    public int HitStop;                    // Hit Stop: frames remaining, inside the simulation
    public int LastHitFrame;               // presentation reads this to spawn sparks/sounds once
    public FighterState P0, P1;
}

public static class Simulation
{
    public static GameState Step(GameState s, FrameInput in0, FrameInput in1)
    {
        s.Frame++;

        // Inputs are always recorded, even during hit stop, so presses during the freeze still buffer.
        Record(ref s.P0, in0);
        Record(ref s.P1, in1);

        if (s.HitStop > 0) { s.HitStop--; return s; }        // the freeze: nothing moves, deterministically

        Advance(ref s.P0, in0);
        Advance(ref s.P1, in1);
        ResolveHits(ref s);
        return s;
    }

    static void Record(ref FighterState f, FrameInput input)
    {
        var pressed = input.Buttons & ~f.PrevButtons;         // rising edges only
        f.Buffer.Tick(pressed);
        f.PrevButtons = input.Buttons;
    }

    static void Advance(ref FighterState f, FrameInput input)
    {
        bool canAct = f.MoveId == 0;                          // idle/walk: free to start a move
        if (canAct && f.Buffer.Buffered(Btn.Special) && input.Dir == 6)
        {
            f.Buffer.Consume(Btn.Special);                    // pressed up to 8 frames ago: still comes out
            f.MoveId = 3; f.MoveFrame = 0;                    // e.g. "forward special"
        }
        else if (canAct && f.Buffer.Buffered(Btn.Heavy)) { f.Buffer.Consume(Btn.Heavy); f.MoveId = 2; f.MoveFrame = 0; }
        else if (canAct && f.Buffer.Buffered(Btn.Light)) { f.Buffer.Consume(Btn.Light); f.MoveId = 1; f.MoveFrame = 0; }

        if (f.MoveId != 0 && ++f.MoveFrame >= MoveData.Duration(f.MoveId)) f.MoveId = 0;
        if (f.MoveId == 0) f.VelX = input.Dir is 4 or 7 or 1 ? -3000 : input.Dir is 6 or 9 or 3 ? 3000 : 0;
        f.X += f.VelX;                                        // integer math only
    }

    static void ResolveHits(ref GameState s)
    {
        if (MoveData.Hits(s.P0, s.P1, out int damage, out int stopFrames))
        {
            s.P1.Health -= damage;
            s.HitStop = Math.Max(s.HitStop, stopFrames);      // heavier moves freeze longer; take the max
            s.LastHitFrame = s.Frame;
        }
        // ... and the same for P1 hitting P0, in a fixed order
    }
}
```

The fixed-size buffer uses an `unsafe` fixed array so the whole state stays one blittable struct, cheap to copy every frame. Enable unsafe code in the assembly, or use eight separate `byte` fields. `MoveData` is static frame data (durations, hitboxes, damage, hit stop per move).

Presentation runs in `Update`, outside the simulation, and reacts to *changes*:

```csharp
public class FightPresenter : UnityEngine.MonoBehaviour
{
    int lastShownHitFrame;

    public void Render(in GameState s)
    {
        // A rollback may resimulate the hit frame several times; effects key off the state, so they play once.
        if (s.LastHitFrame != lastShownHitFrame && s.LastHitFrame > 0)
        {
            lastShownHitFrame = s.LastHitFrame;
            // spawn spark at the hit point, play the sound, add screen-shake trauma
        }
        // position sprites from s.P0.X / 1000f, etc.
    }
}
```

## Where the patterns meet: pitfalls

- **State outside the struct.** Anything the rules read that is not in `GameState` (a combo counter in a MonoBehaviour, an animator's normalised time) is not rolled back, and causes desyncs. Audit every input to `Step`.
- **`Time.timeScale` hit stop.** It freezes the real clock, breaks frame pacing with the opponent, and cannot be rolled back. Hit stop must be simulation frames.
- **Effects from inside `Step`.** Playing a sound in `ResolveHits` replays it on every resimulation. Derive effects from state changes when rendering.
- **Buffer leniency and fairness.** Buffers make moves come out "early" relative to the press. Both players get the same buffer, but tune its length per move type: a long buffer for specials, shorter or none for jumps.
- **Rollback visibly rewriting the buffer.** A wrongly predicted opponent input can move a special move by a few frames after rollback. Keep a small input delay (1–2 frames) to make this rare, and design animations with startup frames that hide corrections.
- **Float creep.** A single `float` in movement, or `Mathf.Sin` in a projectile arc, eventually desyncs the two machines. Integer and fixed-point math only, and checksums in development builds.

## Variations

- **Local versus mode and training mode:** the same `Simulation.Step` with both inputs from local pads. Training mode can show the buffer contents and hit stop counters.
- **Replays:** store the confirmed input stream and the starting state. Playback is `Step` in a loop.
- **Spectators:** send them confirmed inputs with a delay. They never roll back.
- **More players:** the same approach works for 3–4 player platform fighters, with more prediction (and more rollbacks).
