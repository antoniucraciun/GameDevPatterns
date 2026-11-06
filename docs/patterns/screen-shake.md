# Screen Shake (Trauma)

> Drive camera shake from a decaying trauma value and smooth noise.

**Category:** Game Feel & Input

## Problem

The typical first screen shake offsets the camera by `Random.insideUnitSphere * 0.3f` for half a second. It looks like a broken video signal rather than an impact. Repeated explosions either do nothing extra or stack into chaos. Shakes cut off abruptly, and every shake looks the same whether it came from a pistol or a building collapsing.

## Solution

Separate **how much** shaking from **how it moves**:

1. **Trauma** is a value from 0 to 1. Events *add* to it: a pistol shot adds 0.1, an explosion 0.6. It is clamped at 1, so overlapping events intensify shake without exploding it.
2. Trauma **decays** at a constant rate, for example 1.0 per second, so shakes fade out smoothly instead of stopping.
3. Shake **intensity = trauma²** (or trauma³). Squaring makes small trauma barely noticeable and large trauma dramatic, which matches how impacts feel.
4. Offsets come from **smooth noise** (Perlin), not white noise, sampled at a speed of roughly 10–25 Hz. The camera wobbles rather than jitters.
5. **Rotation** shake (a few degrees of roll, pitch and yaw) sells impacts more than translation does, especially in 3D.
6. Apply the shake to a **child** of the camera rig, so follow, look-at and game logic never see the offset.

## Example (Unity C#)

```csharp
using UnityEngine;

// Put this on a child transform of the camera rig; the follow logic moves the parent.
public class TraumaShake : MonoBehaviour
{
    [SerializeField] float maxOffset = 0.5f;           // metres
    [SerializeField] float maxAngle = 4f;              // degrees
    [SerializeField] float frequency = 18f;            // noise samples per second
    [SerializeField] float decayPerSecond = 1.2f;
    [SerializeField, Range(0f, 1f)] float userScale = 1f;   // accessibility setting

    public static TraumaShake Instance { get; private set; }
    public float Trauma { get; private set; }

    float seed;

    void Awake()
    {
        Instance = this;
        seed = Random.value * 1000f;
    }

    public void AddTrauma(float amount) => Trauma = Mathf.Clamp01(Trauma + amount);

    void LateUpdate()
    {
        // Unscaled time: keeps shaking during hit stop and slow motion.
        float t = Time.unscaledTime * frequency;
        float shake = Trauma * Trauma * userScale;

        transform.localPosition = new Vector3(
            maxOffset * shake * Noise(seed, t),
            maxOffset * shake * Noise(seed + 1f, t),
            0f);

        transform.localRotation = Quaternion.Euler(
            maxAngle * shake * Noise(seed + 2f, t),
            maxAngle * shake * Noise(seed + 3f, t),
            maxAngle * shake * Noise(seed + 4f, t));

        Trauma = Mathf.Max(0f, Trauma - decayPerSecond * Time.unscaledDeltaTime);
    }

    // Perlin noise remapped from [0, 1] to [-1, 1].
    static float Noise(float channel, float t) => Mathf.PerlinNoise(channel, t) * 2f - 1f;
}

// Pistol:      TraumaShake.Instance.AddTrauma(0.1f);
// Explosion:   TraumaShake.Instance.AddTrauma(Mathf.Lerp(0.6f, 0.1f, distance / blastRadius));
```

Cinemachine offers the same idea as **Impulse** sources and listeners, with per-camera reactions and signal shapes, if you already use Cinemachine.

## When to use

- Explosions, heavy landings, powerful hits, recoil, earthquakes, large creatures stomping.
- Any game where impacts should be felt, not just seen.

## When not to use

- Constant small events. Shake loses meaning when it never stops.
- VR. Camera shake causes motion sickness; shake controllers or objects instead.
- Without an option to reduce or disable it. Players with motion sensitivity need one.

## Pitfalls

- **Motion sickness.** Strong or constant shake makes some players ill. Always provide a setting to reduce or disable it (`userScale`), and default to moderate values.
- **Shaking the main camera transform.** The follow script overwrites the offset, or the offset leaks into aiming and raycasts. Shake a child transform.
- **White noise.** `Random` per frame looks like a glitch and depends on frame rate. Use smooth noise sampled over time.
- **Everything shakes.** If every action adds trauma, nothing stands out. Budget trauma: small for frequent actions, large only for rare, important events.
- **2D pixel art.** Sub-pixel offsets cause shimmering. Round offsets to whole pixels, or use the pixel-perfect camera's snapping.

## Related

- [Hit Stop](./hit-stop) — usually triggered together with shake.
- [Time Scale](./time-scale) — why shake uses unscaled time.
- [Tweening & Easing](./tweening) — the other half of smooth camera motion.
- [Camera Follow & Smoothing](./camera-smoothing) and [Feedback Layering (Juice)](./juice) — the rest of the camera and feedback toolkit.
