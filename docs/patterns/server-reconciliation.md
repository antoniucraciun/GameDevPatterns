# Server Reconciliation

> Rewind to the server state and replay unacknowledged inputs to fix mispredictions.

**Category:** Networking & Multiplayer

## Problem

With [Client-Side Prediction](./client-side-prediction), the client moves the player immediately. The server's state updates are always one round trip *behind* the client. When an update says "you are at x = 10", the client has already predicted x = 14 from the inputs it sent since. Snapping to 10 throws the player backwards every update, which is constant rubber-banding, even though nothing went wrong. And when something *did* go wrong (another player blocked you, or you were stunned), the client must correct without losing the inputs still in flight.

## Solution

Both sides number inputs, and the server says which ones it has applied.

**Server:**
1. Keep a queue of received inputs per client, ordered by sequence number.
2. Each server tick, apply the next input(s) through the *same* simulation code the client uses.
3. Send state updates that include `lastProcessedInput`, the highest sequence number already applied.

**Client:**
1. On receiving an update, **rewind**: set the local state to the server's state.
2. **Discard** pending inputs with sequence ≤ `lastProcessedInput`. They are already included in that state.
3. **Replay** the remaining pending inputs on top. The result is the new predicted present.
4. If the replayed state differs from what was displayed, **smooth** the visible difference over a few frames instead of snapping.

If prediction was correct, the replay lands exactly where the client already was, and nothing visible happens. Corrections appear only when the server knew something the client did not.

## Example (Unity C#)

Shared types and simulation, as in [Client-Side Prediction](./client-side-prediction):

```csharp
public struct InputCmd { public uint Sequence; public Vector2 Move; }
public struct PlayerState { public Vector3 Position; }

public static class Movement
{
    public const float Step = 1f / 60f;
    public static PlayerState Simulate(PlayerState s, InputCmd i)
    {
        s.Position += new Vector3(i.Move.x, 0f, i.Move.y) * (6f * Step);
        return s;
    }
}
```

**Server side:** apply queued inputs, acknowledge the last one.

```csharp
public class ServerPlayer
{
    readonly SortedList<uint, InputCmd> queue = new();
    PlayerState state;
    uint lastProcessed;

    // Clients send their last few inputs in every packet (redundancy against packet loss),
    // so duplicates and already-processed inputs are expected and ignored here.
    public void Receive(InputCmd[] inputs)
    {
        foreach (var input in inputs)
            if (input.Sequence > lastProcessed && !queue.ContainsKey(input.Sequence))
                queue.Add(input.Sequence, input);
    }

    public void ServerTick()
    {
        // One input per tick keeps client and server stepping at the same rate.
        if (queue.Count == 0) return;   // starved: the client's inputs are late (see pitfalls)

        var input = queue.Values[0];
        queue.RemoveAt(0);
        state = Movement.Simulate(state, input);
        lastProcessed = input.Sequence;
    }

    public (PlayerState state, uint ack) Snapshot() => (state, lastProcessed);
}
```

**Client side:** rewind, replay, and smooth the visible error.

```csharp
public class ReconcilingPlayer : MonoBehaviour
{
    readonly List<InputCmd> pending = new();
    PlayerState predicted;
    Vector3 visualOffset;                       // shown position = predicted + offset, decays to zero

    public void OnLocalInput(InputCmd input)    // called every fixed step after sending the input
    {
        predicted = Movement.Simulate(predicted, input);
        pending.Add(input);
    }

    public void OnServerSnapshot(PlayerState serverState, uint ack)
    {
        Vector3 before = predicted.Position;

        predicted = serverState;                                  // 1. rewind
        pending.RemoveAll(i => i.Sequence <= ack);                // 2. discard acknowledged
        foreach (var input in pending)                            // 3. replay the rest
            predicted = Movement.Simulate(predicted, input);

        Vector3 error = before - predicted.Position;
        if (error.sqrMagnitude > 4f) visualOffset = Vector3.zero; // huge error (teleport): snap
        else visualOffset += error;                               // 4. small error: smooth it out
    }

    void Update()
    {
        visualOffset = Vector3.Lerp(visualOffset, Vector3.zero, 1f - Mathf.Exp(-15f * Time.deltaTime));
        transform.position = predicted.Position + visualOffset;
    }
}
```

## When to use

- Every server-authoritative game that uses client-side prediction. The two always go together.
- Any predicted state, not just movement: ammo counts, ability cooldowns, stamina.

## Pitfalls

- **Simulation mismatch.** If client and server simulate differently (different code paths, variable `deltaTime`, physics that cannot be re-run), every update produces a correction. Share one pure simulation function, and see [Determinism](./determinism).
- **Replaying things that cannot be replayed.** Engine physics and animation-driven root motion cannot be rewound and re-stepped cheaply. Use kinematic, code-driven movement for predicted entities, or a physics engine that supports manual stepping (`Physics.Simulate`) and accept the cost.
- **Input starvation.** If the server runs out of queued inputs because of jitter, it either stalls the player or guesses. Keep a small input buffer on the server (a few ticks), and send recent inputs redundantly so one lost packet does not create a gap.
- **Replaying side effects.** Replay must not re-trigger sounds, particles or "you fired" events. Separate simulation from presentation, and only present the final result.
- **Unbounded pending lists.** If acknowledgements stop arriving, `pending` grows forever. Cap it, and treat a long silence as a disconnect.

## Related

- [Client-Side Prediction](./client-side-prediction) — the half that runs ahead. Reconciliation is the half that corrects it.
- [Entity Interpolation](./entity-interpolation) — how *other* players are shown, without prediction.
- [Command](./command) — inputs as numbered, replayable data.
- [Fixed Timestep](./fixed-timestep) — client and server must step at the same rate.
- Lag Compensation — the server-side counterpart for hit detection.
