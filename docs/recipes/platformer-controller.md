# Tight Platformer Controller

> A responsive 2D character controller with forgiving jump timing and clean movement states.

## Goal

A platformer character that feels good to control:

- Jumps fire even when Jump is pressed slightly **before** landing or slightly **after** leaving a ledge.
- Holding Jump jumps higher, and tapping it gives a short hop.
- Ground and air movement behave differently, and the character can never be "grounded and jumping" at once.
- Physics is stable at any frame rate, without lost or doubled inputs.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [State](../patterns/state) | Separates *Grounded* and *Airborne* behaviour and makes illegal combinations impossible. |
| [Fixed Timestep](../patterns/fixed-timestep) | Runs movement physics in constant steps. Inputs are captured every frame and consumed per step. |
| [Input Buffer](../patterns/input-buffer) | Remembers a Jump press for a short window, so an early press still jumps on landing. |
| [Coyote Time](../patterns/coyote-time) | Remembers when the character was last grounded, so a late press still jumps after leaving a ledge. |

## How they fit together

```
Update (every rendered frame)            FixedUpdate (every physics step)
────────────────────────────             ─────────────────────────────────────
read devices                             ground check ─► lastGroundedAt   (coyote)
  move axis      ──► moveInput ────────► current state.FixedTick()
  Jump down      ──► jumpPressedAt ───►    ├─ Grounded: run, TryConsumeJump?
  Jump released  ──► jumpReleased  ───►    └─ Airborne: air control, jump cut,
                     (input buffer)                     TryConsumeJump? (coyote)
                                         TryConsumeJump = buffered AND within coyote
```

The joins are what make this work:

- **Input buffer ↔ fixed timestep.** One-frame events (`GetButtonDown`) are recorded in `Update` as *timestamps*, not booleans. The physics step consumes them, so a press is never lost when a frame has no physics step, and never doubled when a frame has two.
- **Input buffer ↔ coyote time.** Both are "recent enough" checks against timestamps. A jump happens when *both* hold, and it consumes *both*, so one press cannot cause two jumps.
- **State ↔ everything.** Only the states decide when a jump is allowed and what movement means. Buffering and coyote time are queries they make, not separate code paths.

## Example (Unity C#)

```csharp
using UnityEngine;

[RequireComponent(typeof(Rigidbody2D))]
public class PlatformerController : MonoBehaviour
{
    [Header("Run")]
    [SerializeField] float runSpeed = 8f;
    [SerializeField] float groundAcceleration = 90f;
    [SerializeField] float airAcceleration = 45f;

    [Header("Jump")]
    [SerializeField] float jumpVelocity = 14f;
    [SerializeField, Range(0f, 1f)] float jumpCutMultiplier = 0.5f;   // short hop on early release
    [SerializeField] float coyoteTime = 0.1f;
    [SerializeField] float jumpBufferTime = 0.15f;

    [Header("Ground check")]
    [SerializeField] Transform feet;
    [SerializeField] float feetRadius = 0.12f;
    [SerializeField] LayerMask groundMask;

    Rigidbody2D body;

    // Inputs captured in Update, consumed in FixedUpdate.
    float moveInput;
    float jumpPressedAt = float.NegativeInfinity;    // Input Buffer
    bool jumpReleased;

    float lastGroundedAt = float.NegativeInfinity;   // Coyote Time

    // State
    interface IMoveState
    {
        void Enter(PlatformerController c);
        void FixedTick(PlatformerController c);
    }

    readonly IMoveState grounded = new GroundedState();
    readonly IMoveState airborne = new AirborneState();
    IMoveState state;

    void Awake()
    {
        body = GetComponent<Rigidbody2D>();
        body.interpolation = RigidbodyInterpolation2D.Interpolate;   // smooth rendering between steps
        ChangeState(airborne);
    }

    void Update()
    {
        moveInput = Input.GetAxisRaw("Horizontal");
        if (Input.GetButtonDown("Jump")) jumpPressedAt = Time.time;
        if (Input.GetButtonUp("Jump")) jumpReleased = true;
    }

    void FixedUpdate()
    {
        if (IsGrounded()) lastGroundedAt = Time.fixedTime;
        state.FixedTick(this);
        jumpReleased = false;
    }

    void ChangeState(IMoveState next)
    {
        state = next;
        state.Enter(this);
    }

    // ── Shared helpers the states call ────────────────────────────────

    // Grounded only while not moving upwards, so the frame after take-off doesn't count.
    bool IsGrounded() =>
        body.linearVelocity.y <= 0.01f && Physics2D.OverlapCircle(feet.position, feetRadius, groundMask);

    bool TryConsumeJump()
    {
        bool buffered = Time.fixedTime - jumpPressedAt <= jumpBufferTime;
        bool coyote   = Time.fixedTime - lastGroundedAt <= coyoteTime;
        if (!buffered || !coyote) return false;

        jumpPressedAt  = float.NegativeInfinity;   // consume the press
        lastGroundedAt = float.NegativeInfinity;   // consume the grace period: no double jump
        return true;
    }

    void Run(float acceleration)
    {
        var v = body.linearVelocity;
        v.x = Mathf.MoveTowards(v.x, moveInput * runSpeed, acceleration * Time.fixedDeltaTime);
        body.linearVelocity = v;
    }

    void Jump()
    {
        body.linearVelocity = new Vector2(body.linearVelocity.x, jumpVelocity);
        ChangeState(airborne);
    }

    // ── States ────────────────────────────────────────────────────────

    class GroundedState : IMoveState
    {
        public void Enter(PlatformerController c) { /* landing dust, sound, squash */ }

        public void FixedTick(PlatformerController c)
        {
            c.Run(c.groundAcceleration);
            if (c.TryConsumeJump()) c.Jump();               // a buffered press fires on landing
            else if (!c.IsGrounded()) c.ChangeState(c.airborne);
        }
    }

    class AirborneState : IMoveState
    {
        public void Enter(PlatformerController c) { }

        public void FixedTick(PlatformerController c)
        {
            c.Run(c.airAcceleration);

            if (c.TryConsumeJump()) { c.Jump(); return; }   // coyote jump after leaving a ledge

            if (c.jumpReleased && c.body.linearVelocity.y > 0f)   // variable jump height
                c.body.linearVelocity = new Vector2(c.body.linearVelocity.x,
                                                    c.body.linearVelocity.y * c.jumpCutMultiplier);

            if (c.IsGrounded()) c.ChangeState(c.grounded);
        }
    }
}
```

Unity 6 renamed `Rigidbody2D.velocity` to `linearVelocity`. In earlier versions, use `velocity`.

## Where the patterns meet: pitfalls

- **Checking `GetButtonDown` in `FixedUpdate`.** This breaks the buffer and the fixed step at once: presses are lost on frames with no physics step. Always timestamp in `Update`.
- **Consuming only one of the two timestamps.** If only the press is consumed, the coyote window allows a second jump in mid-air. If only the coyote window is consumed, a buffered press can fire again on landing.
- **Ground check while rising.** Without the `linearVelocity.y <= 0` guard, the step right after take-off still reports grounded, which refreshes coyote time and allows a double jump.
- **Releasing Jump before the jump starts.** If Jump is tapped and released inside the buffer window, the jump fires at full height after the release has already been handled. To fix it, record whether Jump is still held, and cut the jump right away if it is not.
- **Tuning in the wrong place.** All the feel numbers are serialised fields, so designers can adjust them while the game runs in the editor.

## Variations

- **Wall slide and wall jump:** add a `WallSlideState`, with its own "coyote" timestamp for leaving the wall.
- **Dash:** a `DashState` with a timer. Buffer the dash input the same way as jump.
- **Rebindable controls:** replace the `Input` calls with Input System actions. The rest of the controller does not change.
