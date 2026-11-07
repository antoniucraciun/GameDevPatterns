# Coyote Time

> Allow jumping for a few frames after walking off a ledge.

**Category:** Game Feel & Input

## Problem

The player runs toward a gap and presses Jump at what *looks* like the edge. On the exact frame of the press, the character's collider has already left the platform, so the ground check fails and the character falls. Players perceive this as the game cheating them, because human reaction time and visual perception cannot resolve single frames.

## Solution

Record **when the character was last grounded**. Allow a jump as long as that moment was within a short grace period, typically 0.08–0.15 s. Once a jump is used, invalidate the grace period so it cannot be used for a second jump in mid-air.

<JumpTimingViz mode="coyote" />

## Example (Unity C#)

Combined with an [Input Buffer](./input-buffer), this covers both early and late presses:

```csharp
public class PlatformerController : MonoBehaviour
{
    [SerializeField] float coyoteTime = 0.1f;
    [SerializeField] float jumpBufferTime = 0.15f;
    [SerializeField] float jumpVelocity = 12f;

    Rigidbody2D body;
    float lastGroundedTime = float.NegativeInfinity;
    float lastJumpPressedTime = float.NegativeInfinity;

    void Awake() => body = GetComponent<Rigidbody2D>();

    void Update()
    {
        if (IsGrounded()) lastGroundedTime = Time.time;
        if (Input.GetButtonDown("Jump")) lastJumpPressedTime = Time.time;

        bool canCoyoteJump = Time.time - lastGroundedTime <= coyoteTime;
        bool jumpBuffered  = Time.time - lastJumpPressedTime <= jumpBufferTime;

        if (canCoyoteJump && jumpBuffered)
        {
            body.linearVelocity = new Vector2(body.linearVelocity.x, jumpVelocity);
            lastGroundedTime = float.NegativeInfinity;     // no second jump from the same grace period
            lastJumpPressedTime = float.NegativeInfinity;  // consume the buffered press
        }
    }

    bool IsGrounded() => /* ground check */ false;
}
```

`linearVelocity` is the Unity 6 name. In earlier versions, use `velocity`.

## When to use

- Any platformer or action game with ledges and jumps.
- More generally, any timing check where the player's intent is clear but the frame-perfect state disagrees, such as wall jumps or grabbing ledges.

## When not to use

- Games without platforming or ledges.
- Precision platformers where exact edges are part of the challenge. Keep it very short, if you use it at all.

## Pitfalls

- **Double jumps.** Forgetting to invalidate the grace period after jumping lets the player jump again in mid-air.
- **Jumping while rising.** Your ground check may report "grounded" for a frame after takeoff. Ignore it while vertical velocity is positive.
- **A grace period that is too long** feels floaty and lets players walk on air. Players should never notice this mechanic exists.

## Related

- [Input Buffer](./input-buffer) — tolerates presses that come too early. Coyote time tolerates presses that come too late.
- [State](./state) — grounded and airborne states make the grace period easy to track.
