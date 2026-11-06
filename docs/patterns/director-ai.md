# AI Director

> A meta-AI that paces encounters by watching player stress and adjusting spawns.

**Category:** AI & Decision Making

## Problem

Encounters are scripted: the same 12 enemies spawn at the same doorway every time. Skilled players are bored, struggling players are overwhelmed, and on the second playthrough everyone knows what is coming. Pure random spawning is no better: sometimes three hordes in a row, sometimes nothing for five minutes. Neither responds to how the player is *actually doing* right now.

## Solution

Add an AI that controls **the game**, not a character. The director **observes** the player and **adjusts pacing**:

1. **Measure intensity.** Estimate how stressed the player is from signals: damage taken, health, nearby enemies, kills, ammo, recent deaths. Keep it as one number that rises quickly with danger and decays slowly when calm.
2. **Run a pacing cycle**, a small [state machine](./state):
   - **Build-up:** spawn pressure gradually rises.
   - **Peak:** when intensity crosses a threshold, hold the pressure briefly (the climax).
   - **Relax:** stop spawning, give breathing room, perhaps drop health or ammo. Return to build-up after a while.
3. **Act through existing systems.** The director never controls enemies directly. It changes the **spawn budget**, which spawn points are allowed (never in view), and item drops, using the [Spawner](./spawner) and loot tables.

The result is a rhythm: tension, release, tension. It adapts to skill, because skilled players spend less time at high intensity, so they get more frequent build-ups. Every session plays out differently.

## Example (Unity C#)

```csharp
using UnityEngine;

public class AIDirector : MonoBehaviour
{
    enum Phase { BuildUp, Peak, Relax }

    [Header("Intensity")]
    [SerializeField] float decayPerSecond = 0.05f;        // slow calm-down
    [SerializeField] float peakThreshold = 0.8f;

    [Header("Pacing (seconds)")]
    [SerializeField] float peakDuration = 6f;
    [SerializeField] float relaxDuration = 25f;

    [Header("Spawning")]
    [SerializeField] float maxSpawnBudgetPerSecond = 3f;   // threat points per second at full pressure

    [SerializeField] Health player;
    [SerializeField] DirectorSpawner spawner;              // spends budget on enemies, off-screen

    public float Intensity { get; private set; }           // 0..1
    Phase phase = Phase.BuildUp;
    float phaseUntil;
    float pressure;                                         // 0..1, rises during build-up
    float budget;

    void OnEnable()  => player.Damaged += OnPlayerDamaged;
    void OnDisable() => player.Damaged -= OnPlayerDamaged;

    // Stress signals push intensity up quickly.
    void OnPlayerDamaged(DamageInfo info) => Bump(info.Amount / player.Max * 2f);
    public void OnEnemyKilledNearPlayer() => Bump(0.03f);
    void Bump(float amount) => Intensity = Mathf.Clamp01(Intensity + amount);

    void Update()
    {
        float dt = Time.deltaTime;

        // Continuous signals: low health and many nearby enemies keep intensity up.
        float healthStress = 1f - player.Fraction;
        float crowdStress = Mathf.Clamp01(spawner.EnemiesNear(player.transform.position, 15f) / 12f);
        Intensity = Mathf.Clamp01(Mathf.Max(Intensity - decayPerSecond * dt, 0.5f * healthStress + 0.4f * crowdStress));

        switch (phase)
        {
            case Phase.BuildUp:
                pressure = Mathf.Min(1f, pressure + dt / 40f);            // ramp up over ~40 s
                if (Intensity >= peakThreshold) Enter(Phase.Peak, peakDuration);
                break;

            case Phase.Peak:
                pressure = 1f;                                            // hold the climax briefly
                if (Time.time >= phaseUntil) Enter(Phase.Relax, relaxDuration);
                break;

            case Phase.Relax:
                pressure = 0f;                                            // no new spawns: breathing room
                if (Time.time >= phaseUntil && Intensity < 0.3f) Enter(Phase.BuildUp, 0f);
                break;
        }

        // Spend a spawn budget proportional to pressure; the spawner decides what and where.
        budget += pressure * maxSpawnBudgetPerSecond * dt;
        budget -= spawner.SpendBudget(budget);
    }

    void Enter(Phase next, float duration)
    {
        phase = next;
        phaseUntil = Time.time + duration;
        if (next == Phase.Relax) spawner.MaybeDropSupplies(player.transform.position);   // reward surviving the peak
        if (next == Phase.BuildUp) pressure = 0.2f;
    }
}

// DirectorSpawner: EnemiesNear(...), SpendBudget(available) picks enemies whose cost fits
// (cheap fodder vs. expensive specials) at off-screen spawn points and returns what it spent,
// MaybeDropSupplies(...) places health or ammo near the player if they are low.
```

## When to use

- Co-op shooters, horde modes, survival and horror games, roguelikes: anywhere replayability and pacing matter more than authored set pieces.
- Open worlds that need ambient encounters at a sensible rate.
- Difficulty that should adapt without an explicit difficulty setting.

## Pitfalls

- **Rubber-banding players notice.** If the game always gets easier when you are losing and harder when you are winning, skilled play feels pointless. Keep the adjustments subtle, mostly in timing rather than in enemy strength.
- **Unfair spawns.** "Pressure" spawning enemies right next to or in view of the player feels cheap. Spawn only out of sight and at sensible distances (see [Spawner](./spawner)).
- **Badly chosen signals.** Intensity built only from damage ignores a player surrounded by enemies but dodging well. Combine several signals, and test with very different play styles.
- **Opaque behaviour.** Designers cannot tune what they cannot see. Graph intensity, phase and budget over time in a debug overlay.
- **Scripted beats get lost.** Story moments and boss fights still need authoring. Let scripted events pause or override the director.

## Related

- [Spawner / Wave System](./spawner) — what the director drives.
- [State](./state) — the build-up / peak / relax cycle.
- [Influence Map](./influence-map) — spatial threat as an input.
- [Utility AI](./utility-ai) — directors often score possible actions (spawn, drop, wait) the same way.
- [Weighted Random & Loot Tables](./weighted-random) — supply drops and enemy mixes.
