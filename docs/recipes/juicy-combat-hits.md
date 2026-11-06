# Juicy Combat Hits

> Melee hits that feel heavy and readable, consistent across weapons, even when many land at once.

## Goal

The combat feel of a melee action game:

- A **light hit** is crisp and quick, a **heavy hit** lands with weight, a **critical** is unmistakable, and a **kill** feels final.
- Every weapon uses the same vocabulary of feedback, tuned per weapon by designers, without code.
- A sweeping attack that hits **eight enemies in one frame** feels *bigger*, not eight times louder, longer and shakier.
- The player can still read the fight: telegraphs and hitboxes stay visible through the effects.
- Players sensitive to motion can turn shake and flashes down.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Feedback Layering (Juice)](../patterns/juice) | `Feedback` assets per hit type (light, heavy, crit, kill), each a list of layers scaled by intensity. |
| [Hit Stop](../patterns/hit-stop) | The freeze that sells contact. It uses the longest stop when hits land together, instead of adding them up. |
| [Screen Shake (Trauma)](../patterns/screen-shake) | Trauma accumulates and is capped, so simultaneous hits intensify the shake without exploding it. |
| [Tweening & Easing](../patterns/tweening) | Squash and stretch on the victim, damage numbers that pop and float, the camera zoom punch. |
| [Event Queue](../patterns/event-queue) | Collects all hits in a frame and resolves them together: merge sounds, pick the strongest stop, budget particles. |
| [Camera Follow & Smoothing](../patterns/camera-smoothing) | The rig that shake and zoom punches act on, without disturbing the follow. |

## How they fit together

```
 weapon hitbox overlaps ──► HitQueue.Enqueue(HitEvent)        (no feedback yet: just record it)
                                     │
                           LateUpdate: drain the frame's hits
                                     │
              ┌──────────────────────┼─────────────────────────────┐
              ▼                      ▼                             ▼
   strongest hit this frame   every hit (budgeted)          all hits combined
   ├─ Hit Stop (max)          ├─ victim squash (Tween)      ├─ one sound per clip (merged)
   └─ camera zoom punch       ├─ sparks (≤ N per frame)     └─ shake trauma (sum, capped)
                              └─ damage number (Tween, unscaled)
```

The joins:

- **Event Queue ↔ Juice.** Feedback is not played at the moment of the hit. Hits are queued during the frame and resolved once. That is the only place that can see "eight hits happened", and decide that one hit stop, one merged sound and one stronger shake should play.
- **Hit Stop ↔ Tweening.** Choosing the *time base* per effect is the art. The victim's squash runs on **scaled** time, so it freezes during hit stop and then snaps, which looks great. Damage numbers run on **unscaled** time, so they keep rising during the freeze.
- **Screen Shake ↔ Camera Follow.** Shake and zoom live on a child of the camera rig. The follow logic never sees them, so a heavy hit cannot knock the camera off its target.
- **Juice ↔ data.** Gameplay code only reports *what happened* (type, intensity, position). *How it feels* is entirely in the `Feedback` assets.

## Example (Unity C#)

This builds on the pattern pages: `Feedback` ([Juice](../patterns/juice)), `HitStop` ([Hit Stop](../patterns/hit-stop)), `TraumaShake` ([Screen Shake](../patterns/screen-shake)), `Tweener` and `Ease` ([Tweening](../patterns/tweening)), and `RingQueue` ([Event Queue](../patterns/event-queue)).

### Hits are queued, not played

```csharp
using System.Collections.Generic;
using UnityEngine;

public enum HitKind { Light, Heavy, Critical, Kill }

public readonly struct HitEvent
{
    public readonly HitKind Kind;
    public readonly Vector3 Point;
    public readonly Transform Victim;
    public readonly int Damage;
    public readonly bool ByPlayer;

    public HitEvent(HitKind kind, Vector3 point, Transform victim, int damage, bool byPlayer)
    {
        Kind = kind; Point = point; Victim = victim; Damage = damage; ByPlayer = byPlayer;
    }
}

public class CombatFeedback : MonoBehaviour
{
    public static CombatFeedback Instance { get; private set; }

    [Header("Feedback assets (designer-tuned)")]
    [SerializeField] Feedback light, heavy, critical, kill;

    [Header("Budgets")]
    [SerializeField] int maxPerHitEffectsPerFrame = 6;     // squash + sparks + numbers
    [SerializeField] float maxDamageForIntensity = 60f;

    [Header("Damage numbers")]
    [SerializeField] DamageNumber numberPrefab;

    readonly RingQueue<HitEvent> queue = new(128);
    readonly List<HitEvent> frameHits = new();

    void Awake() => Instance = this;

    // Called by weapon hitboxes. Cheap: nothing visible happens here.
    public void Report(in HitEvent hit)
    {
        if (!queue.TryEnqueue(hit)) Debug.LogWarning("Hit queue full");
    }

    void LateUpdate()
    {
        frameHits.Clear();
        while (queue.TryDequeue(out var h)) frameHits.Add(h);
        if (frameHits.Count == 0) return;

        // 1. Once per frame: the strongest hit drives the big, global feedback.
        HitEvent strongest = frameHits[0];
        foreach (var h in frameHits)
            if (h.Kind > strongest.Kind || (h.Kind == strongest.Kind && h.Damage > strongest.Damage)) strongest = h;

        float multiHitBonus = 1f + 0.15f * Mathf.Log(frameHits.Count, 2f);   // 8 hits ≈ +45%, not ×8
        float intensity = Mathf.Clamp01(strongest.Damage / maxDamageForIntensity * multiHitBonus);
        if (strongest.ByPlayer)                                              // enemies hitting each other: no freeze
            AssetFor(strongest.Kind).Play(strongest.Point, strongest.Victim, intensity);

        // 2. Per hit, within a budget: local effects on each victim.
        int budget = maxPerHitEffectsPerFrame;
        foreach (var h in frameHits)
        {
            if (budget-- <= 0) break;
            Squash(h.Victim, h.Kind);
            SpawnNumber(h);
        }
    }

    Feedback AssetFor(HitKind kind) => kind switch
    {
        HitKind.Kill => kill,
        HitKind.Critical => critical,
        HitKind.Heavy => heavy,
        _ => light,
    };

    // Scaled time: the squash freezes during hit stop, then snaps. That's intended.
    static void Squash(Transform victim, HitKind kind)
    {
        if (victim == null) return;
        float amount = kind >= HitKind.Heavy ? 0.35f : 0.18f;
        Vector3 squashed = new(1f + amount, 1f - amount, 1f + amount);
        Tweener.Run(victim, 0.3f, Ease.OutElastic,
            p => { if (victim) victim.localScale = Vector3.LerpUnclamped(squashed, Vector3.one, p); });
    }

    // Unscaled time: numbers keep moving during the freeze, so the hit reads instantly.
    void SpawnNumber(in HitEvent h)
    {
        var n = Instantiate(numberPrefab, h.Point + Vector3.up, Quaternion.identity);   // pool in production
        n.Show(h.Damage, h.Kind == HitKind.Critical);
        Vector3 from = n.transform.position, to = from + Vector3.up * 1.2f;
        Tweener.Run(n, 0.7f, Ease.OutCubic,
            p => { n.transform.position = Vector3.LerpUnclamped(from, to, p); n.SetAlpha(1f - p * p); },
            () => Destroy(n.gameObject), unscaled: true);
    }
}
```

`DamageNumber` is a small component with `Show(int amount, bool crit)` and `SetAlpha(float)` that sets a TextMeshPro label.

### Weapons only report what happened

```csharp
public class MeleeHitbox : MonoBehaviour
{
    [SerializeField] int baseDamage = 12;
    [SerializeField] bool heavyAttack;
    [Range(0f, 1f)] [SerializeField] float critChance = 0.1f;

    readonly HashSet<Collider> alreadyHit = new();          // one hit per target per swing

    public void BeginSwing() => alreadyHit.Clear();

    void OnTriggerEnter(Collider other)
    {
        if (!alreadyHit.Add(other) || !other.TryGetComponent(out Health health)) return;

        bool crit = Random.value < critChance;
        int damage = Mathf.RoundToInt(baseDamage * (crit ? 2f : 1f));
        health.TakeDamage(damage);

        var kind = health.Current <= 0 ? HitKind.Kill : crit ? HitKind.Critical : heavyAttack ? HitKind.Heavy : HitKind.Light;
        CombatFeedback.Instance.Report(new HitEvent(kind, other.ClosestPoint(transform.position), other.transform, damage, byPlayer: true));
    }
}
```

### What the designer tunes (no code)

| Feedback asset | Layers |
| --- | --- |
| **Light Hit** | Hit stop 30–50 ms · trauma 0.12 · "slash" sound ×3 variants · 6 sparks |
| **Heavy Hit** | Hit stop 70–110 ms · trauma 0.35 · camera zoom punch 3% · "thud" + "slash" · 15 sparks |
| **Critical** | Hit stop 120 ms · trauma 0.45 · white flash on victim · "crit" sting · 25 sparks |
| **Kill** | Hit stop 150 ms, then 0.3 s at ×0.3 slow motion · trauma 0.5 · "finisher" sound · debris burst |

## Where the patterns meet: pitfalls

- **Feedback at the hit site.** Calling `HitStop.Trigger` and `PlayOneShot` directly in `OnTriggerEnter` makes eight simultaneous hits produce eight sounds, eight particle bursts and repeated hit stops. Report, then resolve once per frame.
- **The wrong time base.** Damage numbers on scaled time freeze during hit stop and lag behind the action. Squash on unscaled time keeps wobbling through the freeze, which removes the impact. Choose per effect, deliberately.
- **Freezing for hits the player didn't cause.** Global hit stop when two enemies hit each other, or when the player is hit from off-screen, feels like lag. Only the player's own hits freeze the game. Hits on the player get shake and a flash instead.
- **Shake on the follow transform.** Shaking the transform that the camera follow writes to makes the follow fight the shake. Use a child transform.
- **Unbounded intensity.** Summing raw damage for multi-hits gives ten-second freezes and violent shakes. Use logarithmic bonuses and caps, as above.
- **Accessibility.** Shake, flashes and slow motion need user settings. Reduce or disable them without changing gameplay timing.

## Variations

- **Controller rumble:** a rumble layer in the `Feedback` asset, scaled by the same intensity.
- **Per-weapon materials:** a sound and spark set per surface (flesh, metal, stone), chosen from the victim's physics material.
- **Parry and perfect-block:** a distinct asset with a longer freeze and a brief colour shift, to reward timing.
- **Networked combat:** play predicted feedback for your own hits immediately, and the server-confirmed feedback (kill, crit) when it arrives. See [Client-Side Prediction](../patterns/client-side-prediction).
