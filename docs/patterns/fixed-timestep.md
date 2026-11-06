# Fixed Timestep

> Advance the simulation in constant increments for stable, reproducible physics.

**Also known as:** Fixed Update, Accumulator · **Category:** Game Loop & Timing

## Problem

When the simulation advances by a variable `deltaTime`, results depend on the frame rate. A jump reaches a different height at 30 FPS than at 144 FPS. A long frame can let a fast bullet tunnel through a wall, and stiff springs can explode. Replays and lockstep networking become impossible because two machines never take the same steps.

## Solution

Choose a constant step, for example 1/50 s. Keep an **accumulator** of real time not yet simulated. Each frame, add the elapsed real time, then run whole fixed steps while the accumulator holds at least one step. Render once, optionally **interpolating** between the last two simulation states using the leftover fraction.

```
accumulator += frameTime
while accumulator >= step:
    previous = current
    current  = simulate(current, step)
    accumulator -= step
alpha = accumulator / step
render(lerp(previous, current, alpha))
```

## Example (Unity C#)

Unity implements the accumulator for you. `FixedUpdate` runs at `Time.fixedDeltaTime` (Project Settings → Time). Put physics and force application there, and read input in `Update`:

```csharp
public class Thruster : MonoBehaviour
{
    [SerializeField] float force = 20f;
    Rigidbody body;
    bool thrustHeld;

    void Awake() => body = GetComponent<Rigidbody>();

    // Input is sampled every rendered frame...
    void Update() => thrustHeld = Input.GetKey(KeyCode.Space);

    // ...but applied in constant-size simulation steps.
    void FixedUpdate()
    {
        if (thrustHeld)
            body.AddForce(Vector3.up * force);
    }
}
```

Set **Interpolate** on the Rigidbody so rendering blends between physics steps and motion looks smooth at any display rate.

## When to use

- Physics, character controllers, anything integrated over time.
- Deterministic simulations: replays, lockstep, rollback.

## Pitfalls

- **One-frame inputs lost or doubled.** `GetKeyDown` checked in `FixedUpdate` can miss a press (zero steps this frame) or fire twice (two steps). Latch inputs in `Update` and consume them in the fixed step.
- **Spiral of death.** Clamp frame time (Unity's *Maximum Allowed Timestep*) so a hitch does not demand hundreds of catch-up steps.
- **Visible stutter without interpolation** when the display rate is not a multiple of the step rate.
- A fixed step alone does not make floating-point math deterministic across platforms. See [Determinism](./determinism).

## Related

- [Game Loop](./game-loop) — the outer loop that drives the accumulator.
- [Double Buffer](./double-buffer) — keeps the previous and current state for interpolation.
- Rollback Netcode and Deterministic Lockstep both depend on fixed steps.
