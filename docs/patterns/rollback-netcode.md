# Rollback Netcode

> Predict remote inputs, then roll back and resimulate when the real ones arrive.

**Also known as:** GGPO-style · **Category:** Networking & Multiplayer

## Problem

A fighting game needs frame-perfect timing: a 3-frame window to punish, a 1-frame link. With [lockstep](./deterministic-lockstep), each input waits for the opponent's input of the same frame. At 100 ms ping, that is a 6-frame delay on every button press, which ruins the game. An authoritative server does not help with two players who are equally entitled to the truth. The game must respond **instantly** to local input, *and* both players must agree on what happened.

## Solution

Do not wait for remote input. **Guess it**, and fix the guess later:

1. Every frame, apply your **local input immediately**.
2. For the remote player, **predict** their input, usually "the same as their last known input". People mostly keep holding the same buttons.
3. **Save the game state** each frame (into a ring buffer), and simulate forward.
4. When the real remote input for an earlier frame *F* arrives:
   - If it matches the prediction, nothing happens. This is the usual case.
   - If it differs, **roll back**: restore the saved state of frame *F*, apply the correct input, and **resimulate** every frame from *F* to the present, in one rendered frame.
5. Visual and audio effects that were wrong get corrected on the next rendered frame.

A small **input delay** (1–3 frames) is often combined with rollback. It reduces how often and how far the game rolls back, trading a tiny, consistent delay for fewer visible corrections.

Requirements: a fully **deterministic** simulation, **cheap state saving and restoring**, and a simulation **fast enough to resimulate** several frames within one rendered frame.

## Example (Unity C#)

```csharp
using UnityEngine;

public struct FrameInput : System.IEquatable<FrameInput>
{
    public sbyte X, Y;        // stick direction
    public byte Buttons;      // bitmask
    public bool Equals(FrameInput o) => X == o.X && Y == o.Y && Buttons == o.Buttons;
}

public struct GameState                        // plain data: copied by value to save/restore
{
    public int Frame;
    public FighterState P0, P1;                // positions as fixed-point ints, health, current move, frame counters...
}

public class RollbackSession
{
    const int MaxRollback = 8;                 // frames; beyond this, stall instead of rolling back further
    const int BufferSize = 32;

    readonly GameState[] savedStates = new GameState[BufferSize];
    readonly FrameInput[,] inputs = new FrameInput[BufferSize, 2];
    readonly int[] confirmedRemoteFrame = new int[BufferSize];  // which frame's REAL remote input is in this slot
    readonly int local, remote;

    GameState state;
    int lastConfirmedRemoteFrame = -1;
    FrameInput lastRemoteInput;
    int pendingRollbackFrom = -1;              // earliest frame with a wrong prediction

    public RollbackSession(int localPlayer, GameState initial)
    {
        local = localPlayer; remote = 1 - localPlayer; state = initial;
        for (int i = 0; i < BufferSize; i++) confirmedRemoteFrame[i] = -1;
    }

    bool IsConfirmed(int frame) => confirmedRemoteFrame[frame % BufferSize] == frame;

    // Network: the real remote input for some frame arrived (usually a past frame, sometimes a future one).
    public void OnRemoteInput(int frame, FrameInput input)
    {
        if (IsConfirmed(frame)) return;                              // duplicate packet
        int slot = frame % BufferSize;

        // Already simulated this frame with a prediction, and the prediction was wrong: roll back to it.
        if (frame < state.Frame && !inputs[slot, remote].Equals(input))
            pendingRollbackFrom = pendingRollbackFrom < 0 ? frame : Mathf.Min(pendingRollbackFrom, frame);

        inputs[slot, remote] = input;
        confirmedRemoteFrame[slot] = frame;
        if (frame > lastConfirmedRemoteFrame)
        {
            lastConfirmedRemoteFrame = frame;
            lastRemoteInput = input;                                 // basis for future predictions
        }
    }

    // Called once per rendered frame (fixed 60 Hz for a fighting game).
    public void Tick(FrameInput localInput)
    {
        // Don't run too far ahead of what the other side has confirmed: wait a frame instead.
        if (state.Frame - lastConfirmedRemoteFrame > MaxRollback) return;

        // 1. Correct the past if a prediction was wrong.
        if (pendingRollbackFrom >= 0)
        {
            int current = state.Frame;
            state = savedStates[pendingRollbackFrom % BufferSize];   // restore
            while (state.Frame < current) Advance();                 // resimulate with corrected inputs
            pendingRollbackFrom = -1;
        }

        // 2. Record this frame's inputs: real local, predicted remote (unless already known).
        int slot = state.Frame % BufferSize;
        inputs[slot, local] = localInput;
        if (!IsConfirmed(state.Frame))
            inputs[slot, remote] = lastRemoteInput;                  // prediction: repeat last known input
        Network.SendInput(state.Frame, localInput);

        // 3. Simulate the new frame.
        Advance();
    }

    void Advance()
    {
        int slot = state.Frame % BufferSize;
        savedStates[slot] = state;                                   // save BEFORE simulating this frame
        state = Simulation.Step(state, inputs[slot, 0], inputs[slot, 1]);   // deterministic, pure
    }

    public GameState Current => state;                               // the renderer draws this
}
```

`GameState` is a struct, so saving and restoring are plain copies. That is why rollback games keep their simulation state small and free of object references. Effects (sounds, particles) are triggered by comparing the rendered state with the previous rendered state, so resimulated frames do not replay sounds.

Fighting-game rollback is commonly built with **GGPO** or its descendants. In Unity, Netcode for Entities supports prediction and rollback for server-authoritative games.

## When to use

- Fighting games, platform fighters, and other 1v1 or small-group games with tight timing.
- Any peer-to-peer game where input delay is unacceptable and the simulation is small and deterministic.

## When not to use

- Large simulations with many objects. Re-simulating several frames each tick becomes too expensive.
- Games with many players. Mispredictions multiply, and rollbacks become visible.
- Non-deterministic simulations. Rollback needs [Determinism](./determinism) or full state saving every frame.

## Pitfalls

- **Non-determinism.** If resimulating does not reproduce exactly what the other side computed, the games diverge. Same rules as [Deterministic Lockstep](./deterministic-lockstep): fixed-point math, no engine physics, no unordered iteration, checksums.
- **Expensive state.** Saving the whole state every frame, and resimulating 8 frames in one, requires a compact state and a fast simulation. Keep game logic separate from Unity objects, in plain data that can be copied.
- **Visible corrections.** A long rollback can make a character teleport, or a hit that seemed to land vanish. A small input delay reduces this, and so do animations with a few frames of startup that hide corrections.
- **Side effects during resimulation.** Sounds, particles, hit stop and controller rumble must not fire again for frames that are resimulated. Trigger presentation from rendered state changes, not from inside `Step`.
- **Rollback limit.** With very high latency, the game would need to roll back too far. Cap it, and slow down or pause when the opponent falls too far behind.

## Related

- [Deterministic Lockstep](./deterministic-lockstep) — the same input exchange, without prediction.
- [Client-Side Prediction](./client-side-prediction) and [Server Reconciliation](./server-reconciliation) — the server-authoritative cousin: predict yourself, correct from the server.
- [Determinism](./determinism) — the foundation.
- [Memento](./memento) and [Double Buffer](./double-buffer) — saved frames are snapshots of the state.
- [Replay System](./replay-system) — confirmed inputs form a replay.
