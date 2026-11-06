# Client-Side Prediction

> Apply local input immediately instead of waiting for the server round trip.

**Category:** Networking & Multiplayer

## Problem

With an [authoritative server](./authoritative-server), the client sends "move forward" and waits for the server's updated position. At 100 ms round-trip time, every key press feels a tenth of a second late. Movement feels like steering through syrup, and it gets worse as latency grows. The server must stay authoritative, or clients could cheat by reporting any position they like.

## Solution

The client **runs the same movement code as the server**, on its own inputs, right away. It shows the predicted result while the input is still travelling to the server.

1. Each input gets an increasing **sequence number**. The client applies it locally, stores it in a **pending inputs** buffer, and sends it to the server.
2. The server applies inputs in order. Its state updates include the **last input sequence it processed**.
3. When an update arrives, the client **reconciles**. It sets its state to the server's authoritative state, drops pending inputs the server has already processed, and **re-applies the remaining ones** on top. If the prediction was right, nothing visibly changes. If it was wrong, for example because another player blocked the path, the client snaps or smoothly corrects to the truth.

Prediction requires the movement simulation to be **deterministic enough**. Given the same state and input, client and server must produce the same result, or every update triggers a correction.

## Example (Unity C#)

Transport-agnostic. `Send` stands in for your networking library.

```csharp
public struct InputCmd
{
    public uint Sequence;
    public Vector2 Move;
    public bool Jump;
}

public struct PlayerState
{
    public Vector3 Position;
    public Vector3 Velocity;
}

// Shared by client and server: the SAME code must run on both.
public static class Movement
{
    public const float Step = 1f / 60f;

    public static PlayerState Simulate(PlayerState s, InputCmd input)
    {
        s.Velocity.x = input.Move.x * 6f;
        s.Velocity.z = input.Move.y * 6f;
        s.Position += s.Velocity * Step;
        return s;
    }
}

public class PredictedPlayer : MonoBehaviour
{
    readonly List<InputCmd> pending = new();
    PlayerState state;
    uint nextSequence;

    // Called once per fixed simulation step.
    void FixedUpdate()
    {
        var input = new InputCmd
        {
            Sequence = nextSequence++,
            Move = new Vector2(Input.GetAxisRaw("Horizontal"), Input.GetAxisRaw("Vertical")),
        };

        state = Movement.Simulate(state, input);   // 1. predict immediately
        pending.Add(input);                        //    remember it for reconciliation
        Send(input);                               //    and tell the server

        transform.position = state.Position;
    }

    // Called when an authoritative update for this player arrives.
    public void OnServerState(PlayerState serverState, uint lastProcessedSequence)
    {
        state = serverState;                                          // 2. accept the truth
        pending.RemoveAll(i => i.Sequence <= lastProcessedSequence);  // 3. drop acknowledged inputs
        foreach (var input in pending)                                // 4. replay the rest
            state = Movement.Simulate(state, input);

        transform.position = state.Position;
    }

    void Send(InputCmd input) { /* serialise and send to the server */ }
}
```

Unity's Netcode for Entities provides prediction and reconciliation out of the box. Netcode for GameObjects does not, so you build it on top, much like the code above.

## When to use

- Anything the local player directly controls where latency is felt: movement, aiming, firing effects, ability activation.
- Server-authoritative games where clients are not trusted.

## Pitfalls

- **Non-deterministic simulation.** Different code paths, `Time.deltaTime` instead of a fixed step, or physics that is not replayable all cause constant corrections and rubber-banding. Keep predicted logic in pure functions driven by a [Fixed Timestep](./fixed-timestep).
- **Predicting things you do not control.** Other players and server-driven objects are usually interpolated, not predicted.
- **Hard snaps on correction.** Smooth the visual position toward the corrected state over a few frames, while the simulation state snaps instantly.
- **Irreversible side effects.** Kill confirmations and loot pickups should wait for the server, even if their effects are predicted.

## Related

- [Command](./command) — each input is a command, recorded so it can be replayed.
- [Fixed Timestep](./fixed-timestep) — prediction needs constant, numbered steps.
- [Server Reconciliation](./server-reconciliation) — the correction half of prediction, covered in depth.
- [Entity Interpolation](./entity-interpolation) — how *other* players are shown smoothly.
- [Lag Compensation](./lag-compensation) — the server-side counterpart for hit detection.
