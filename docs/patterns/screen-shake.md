# Screen Shake (Trauma)

> Drive camera shake from a decaying trauma value and smooth noise.

**Category:** Game Feel & Input

## Problem

The typical first screen shake offsets the camera by a random amount every frame for half a second. It looks like a broken video signal rather than an impact. Repeated explosions either do nothing extra or stack into chaos. Shakes cut off abruptly, and every shake looks the same whether it came from a pistol or a building collapsing.

## Solution

Separate **how much** shaking from **how it moves**:

1. **Trauma** is a value from 0 to 1. Events *add* to it: a pistol shot adds 0.1, an explosion 0.6. It is clamped at 1, so overlapping events intensify shake without exploding it.
2. Trauma **decays** at a constant rate, for example 1.0 per second, so shakes fade out smoothly instead of stopping.
3. Shake **intensity = trauma²** (or trauma³). Squaring makes small trauma barely noticeable and large trauma dramatic, which matches how impacts feel.
4. Offsets come from **smooth noise** (Perlin), not white noise, sampled at a speed of roughly 10–25 Hz. The camera wobbles rather than jitters.
5. **Rotation** shake (a few degrees of roll, pitch and yaw) sells impacts more than translation does, especially in 3D.
6. Apply the shake to a **child** of the camera rig, so follow, look-at and game logic never see the offset.

## Example

A trauma-based shake: hits add trauma, the shake strength is trauma squared, and smooth noise drives the offset and rotation. Unreal has this built in, so its tab configures and plays the engine's camera shakes instead.

::: code-group

```csharp [Unity (C#)]
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

```gdscript [Godot (GDScript)]
# trauma_shake.gd: on a Node3D between the camera rig and the Camera3D;
# the follow logic moves the rig.
class_name TraumaShake
extends Node3D

@export var max_offset := 0.5  # metres
@export var max_angle_deg := 4.0
@export var frequency := 18.0  # noise samples per second
@export var decay_per_second := 1.2
@export_range(0.0, 1.0) var user_scale := 1.0  # accessibility setting

var trauma := 0.0

var _noise := FastNoiseLite.new()
var _last_ticks := 0


func _ready() -> void:
	add_to_group("camera_shake")
	process_mode = Node.PROCESS_MODE_ALWAYS  # keeps shaking while the tree is paused (hit stop)
	_noise.seed = randi()
	_noise.frequency = 1.0  # we scale time ourselves
	_last_ticks = Time.get_ticks_usec()


func add_trauma(amount: float) -> void:
	trauma = clampf(trauma + amount, 0.0, 1.0)


func _process(_delta: float) -> void:
	# Real time, not delta: keeps shaking during hit stop and slow motion.
	var now := Time.get_ticks_usec()
	var real_delta := (now - _last_ticks) / 1_000_000.0
	_last_ticks = now

	var t := now / 1_000_000.0 * frequency
	var shake := trauma * trauma * user_scale
	position = Vector3(_sample(0, t), _sample(1, t), 0.0) * max_offset * shake
	rotation = Vector3(_sample(2, t), _sample(3, t), _sample(4, t)) * deg_to_rad(max_angle_deg) * shake

	trauma = maxf(0.0, trauma - decay_per_second * real_delta)


# One noise channel per axis, each a separate row of 2D noise, in about [-1, 1].
func _sample(channel: int, t: float) -> float:
	return _noise.get_noise_2d(channel * 100.0, t)


# Pistol:     get_tree().call_group("camera_shake", "add_trauma", 0.1)
# Explosion:  get_tree().call_group("camera_shake", "add_trauma", lerpf(0.6, 0.1, distance / blast_radius))
```

```cpp [Unreal (C++)]
// Built in: UCameraShakeBase with a shake pattern (Perlin noise, sine wave, sequence), played by
// the APlayerCameraManager. Shakes are usually Blueprint subclasses of CameraShakeBase with a
// Perlin Noise root pattern, assigned to these properties.

// Weapon.h (excerpt)
UPROPERTY(EditDefaultsOnly, Category = "Feedback")
TSubclassOf<UCameraShakeBase> FireShake;

UPROPERTY(EditDefaultsOnly, Category = "Feedback")
TSubclassOf<UCameraShakeBase> ExplosionShake;

// Weapon.cpp
#include "Camera/CameraShakeBase.h"
#include "Camera/PlayerCameraManager.h"
#include "Kismet/GameplayStatics.h"

void AWeapon::Fire()
{
	// One player's camera. Scale works like trauma: a small hit plays the same shake weaker.
	if (APlayerController* PC = Cast<APlayerController>(GetInstigatorController()))
	{
		const float UserScale = 1.f;                     // accessibility setting from your options
		PC->PlayerCameraManager->StartCameraShake(FireShake, 0.3f * UserScale);
	}
}

void AWeapon::Explode(float InnerRadius, float OuterRadius)
{
	// Every local player's camera, with full strength inside InnerRadius, fading out to OuterRadius.
	UGameplayStatics::PlayWorldCameraShake(this, ExplosionShake, GetActorLocation(),
		InnerRadius, OuterRadius, /*Falloff*/ 1.f);
}
```

:::

**Engine notes**

- **Unity:** Cinemachine offers the same idea as **Impulse** sources and listeners, with per-camera reactions and signal shapes, if you already use Cinemachine.
- **Godot:** there's no built-in camera shake. `FastNoiseLite` gives the smooth noise, and a group call reaches the shaker without a singleton. In 2D, apply the same values to `Camera2D.offset` and `Camera2D.rotation` (with **Ignore Rotation** off).
- **Unreal:** camera shakes add together, so ten hits play ten shakes at once. Tick **Single Instance** on a shake class to restart the running instance instead, which approximates trauma's cap. Scale every shake by a user setting for accessibility. To shake by trauma exactly as in the other tabs, write a `UCameraModifier` that offsets the view in `ModifyCamera`.

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
