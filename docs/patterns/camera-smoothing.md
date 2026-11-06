# Camera Follow & Smoothing

> Dead zones, look-ahead and damping to keep the camera readable.

**Category:** Game Feel & Input

## Problem

`camera.position = player.position + offset` produces a camera glued to the player: every tiny movement and jump bob jerks the whole screen. Smoothing it with `Lerp(camera, target, 0.1f)` behaves differently at 30 and 144 FPS, and lags so far behind a sprinting player that they run off-screen. In a platformer, every jump drags the camera up and down, which is tiring to watch. The player cannot see what is ahead of them, which is exactly where the danger is.

## Solution

Treat the camera as a small system with several deliberate behaviours:

| Behaviour | What it does |
| --- | --- |
| **Dead zone** | The camera does not move while the target stays inside a central box. Small movements cause no camera motion. |
| **Look-ahead** | The camera leads in the direction of movement, so the player sees what is coming. |
| **Damping** | Frame-rate-independent smoothing toward the desired position (`SmoothDamp` or exponential damping), often with different speeds per axis. |
| **Platform snapping** | In platformers, vertical follow is relaxed while airborne and catches up on landing, so jumps do not bob the screen. |
| **Bounds** | Clamp to level limits, so the camera never shows outside the level. |
| **Separation from effects** | Shake and zoom punches apply to a child transform, so they never disturb the follow logic. |

Run the camera in `LateUpdate`, after all movement for the frame has finished. For Rigidbody targets, enable interpolation, so the camera follows a smooth position.

## Example (Unity C#)

A 2D platformer camera with a dead zone, look-ahead, grounded vertical snapping and level bounds:

```csharp
using UnityEngine;

public class PlatformerCamera : MonoBehaviour
{
    [SerializeField] Transform target;
    [SerializeField] Rigidbody2D targetBody;             // for velocity-based look-ahead
    [SerializeField] Vector2 offset = new(0f, 1.5f);

    [Header("Dead zone (world units)")]
    [SerializeField] Vector2 deadZone = new(1.5f, 1f);

    [Header("Look-ahead")]
    [SerializeField] float lookAheadDistance = 3f;
    [SerializeField] float lookAheadSmoothTime = 0.5f;

    [Header("Damping")]
    [SerializeField] float horizontalSmoothTime = 0.15f;
    [SerializeField] float verticalSmoothTime = 0.25f;

    [Header("Bounds")]
    [SerializeField] Rect levelBounds = new(-50f, -10f, 200f, 40f);

    Vector2 focus;                                       // the point the camera centres on
    float lookAhead, lookAheadVelocity;
    Vector2 smoothVelocity;
    float groundedY;
    Camera cam;

    void Start()
    {
        cam = GetComponent<Camera>();
        focus = (Vector2)target.position + offset;
        groundedY = focus.y;
    }

    public bool TargetGrounded { get; set; } = true;     // set by the player controller

    void LateUpdate()
    {
        Vector2 t = (Vector2)target.position + offset;

        // 1. Dead zone: move the focus only when the target pushes against the box edges.
        if (t.x > focus.x + deadZone.x) focus.x = t.x - deadZone.x;
        if (t.x < focus.x - deadZone.x) focus.x = t.x + deadZone.x;

        // 2. Vertical: follow the ground height while grounded; while airborne, only follow big drops or rises.
        if (TargetGrounded) groundedY = t.y;
        else if (t.y < groundedY - 2f || t.y > groundedY + 4f) groundedY = t.y;
        focus.y = groundedY;

        // 3. Look-ahead in the direction of horizontal movement.
        float vx = targetBody ? targetBody.linearVelocity.x : 0f;
        float desiredLookAhead = Mathf.Abs(vx) > 0.5f ? Mathf.Sign(vx) * lookAheadDistance : lookAhead;
        lookAhead = Mathf.SmoothDamp(lookAhead, desiredLookAhead, ref lookAheadVelocity, lookAheadSmoothTime);

        // 4. Damping, per axis: frame-rate independent.
        Vector2 desired = new(focus.x + lookAhead, focus.y);
        Vector2 current = transform.position;
        current.x = Mathf.SmoothDamp(current.x, desired.x, ref smoothVelocity.x, horizontalSmoothTime);
        current.y = Mathf.SmoothDamp(current.y, desired.y, ref smoothVelocity.y, verticalSmoothTime);

        // 5. Bounds: keep the whole view inside the level.
        float halfH = cam.orthographicSize, halfW = halfH * cam.aspect;
        current.x = Mathf.Clamp(current.x, levelBounds.xMin + halfW, levelBounds.xMax - halfW);
        current.y = Mathf.Clamp(current.y, levelBounds.yMin + halfH, levelBounds.yMax - halfH);

        transform.position = new Vector3(current.x, current.y, transform.position.z);
    }

#if UNITY_EDITOR
    void OnDrawGizmosSelected()                         // visualise the dead zone (see Debug Draw)
    {
        Gizmos.color = Color.yellow;
        Gizmos.DrawWireCube(new Vector3(focus.x, focus.y, 0f), new Vector3(deadZone.x * 2f, deadZone.y * 2f, 0f));
    }
#endif
}
```

Put the [Screen Shake](./screen-shake) component on a child of this camera, or on the camera with this script on a parent rig, so shake offsets never feed back into the follow logic.

**Cinemachine** provides dead zones, damping, look-ahead, confiners and multi-target framing as configurable components. For most 3D games it is the right starting point. The concepts above are what you tune inside it.

## When to use

- Every game with a moving camera.
- Platformers (dead zones, vertical snapping, look-ahead), top-down games (look-ahead toward aim or movement), third-person games (damping, collision) and multiplayer games on one screen (framing several targets).

## When not to use

- First-person cameras. Smoothing the view causes nausea; keep it locked to the head.
- When Cinemachine already provides it. Configure it instead of writing your own.
- Competitive games where any camera lag hurts aiming.

## Pitfalls

- **`Lerp` with a constant factor.** It depends on the frame rate and never fully arrives. Use `SmoothDamp` or exponential damping with `deltaTime`.
- **Following in `Update`.** If the camera updates before the player moves, it lags one frame, which causes jitter. Use `LateUpdate`, and interpolate Rigidbody targets.
- **Smoothing too much.** A floaty camera feels laggy and loses fast players. Keep horizontal damping tight in fast games, and use look-ahead rather than more smoothing.
- **Look-ahead flipping.** Quick direction changes swing the camera back and forth. Smooth the look-ahead separately and more slowly, and only change it above a velocity threshold, as above.
- **Pixel art shimmer.** Sub-pixel camera positions make pixel art crawl. Snap the final position to the pixel grid, or use the Pixel Perfect Camera.

## Related

- [Tweening & Easing](./tweening) — damping and easing functions.
- [Screen Shake (Trauma)](./screen-shake) — applied on top of the follow position.
- [Feedback Layering (Juice)](./juice) — zoom punches and camera kicks as feedback layers.
- [Tight Platformer Controller](../recipes/platformer-controller) — the controller this camera is designed to follow.
- [Debug Draw](./debug-draw) — visualising dead zones and targets while tuning.
