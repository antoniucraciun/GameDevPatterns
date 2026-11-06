# Input Buffer

> Remember inputs briefly so presses slightly too early still count.

**Category:** Game Feel & Input

## Problem

The player presses Jump a few frames before landing. The character is still airborne, so the jump is rejected. Then the character lands and stands still. To the player the game feels unresponsive and they "definitely pressed it". The same thing happens with attack combos pressed slightly before the previous swing ends, and with dodges pressed during hit-stun.

## Solution

When an action is pressed but cannot happen yet, **remember the press with a timestamp** instead of discarding it. Each frame, check whether the action has become possible. If it has, and the buffered press is still younger than the buffer window (typically 0.1–0.2 s), perform the action and **consume** the buffered press.

## Example (Unity C#)

```csharp
public class BufferedInput
{
    readonly float window;
    float pressedAt = float.NegativeInfinity;

    public BufferedInput(float window) => this.window = window;

    public void Press() => pressedAt = Time.time;

    public bool IsBuffered => Time.time - pressedAt <= window;

    public bool TryConsume()
    {
        if (!IsBuffered) return false;
        pressedAt = float.NegativeInfinity;   // consume so it fires only once
        return true;
    }
}

public class PlatformerJump : MonoBehaviour
{
    [SerializeField] float jumpBufferTime = 0.15f;
    BufferedInput jump;

    void Awake() => jump = new BufferedInput(jumpBufferTime);

    void Update()
    {
        if (Input.GetButtonDown("Jump"))
            jump.Press();

        if (IsGrounded() && jump.TryConsume())
            DoJump();
    }

    bool IsGrounded() => /* ground check */ true;
    void DoJump() { /* apply jump velocity */ }
}
```

For fighting or action games, generalise this to a queue of recent `(action, time)` entries. The combat system can then read a sequence of inputs, for example to recognise a special move.

## When to use

- Any action gated by a state that ends at an unpredictable moment: landing, recovering from an attack, leaving a stun, finishing a reload.
- Combo systems and fighting games.

## Pitfalls

- **A window that is too long** makes actions fire when the player has changed their mind. Keep it short and tune it per action.
- **Not consuming** the buffered input makes it trigger repeatedly.
- **Buffering in `FixedUpdate`.** Record presses in `Update`, where `GetButtonDown` is reliable. See [Fixed Timestep](./fixed-timestep).
- **Using `Time.time` while paused or slowed.** Decide whether the buffer should use scaled or unscaled time.

## Related

- [Coyote Time](./coyote-time) — the mirror image: a press slightly *late* still counts.
- [Command](./command) — buffered inputs are often stored as commands.
