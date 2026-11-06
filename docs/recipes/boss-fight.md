# Boss Fight

> A multi-phase boss with telegraphed attacks, readable feedback and fair, instant retries.

## Goal

The kind of boss fight action games are remembered for:

- **Phases:** at 70% and 35% health, the boss changes behaviour, gets new attacks and an arena change, with a short dramatic transition.
- **Readable attacks:** every attack has a **telegraph** (wind-up, glow, sound), an active window, and a **recovery** window in which the player can punish.
- **Variety without randomness that feels unfair:** the boss picks attacks based on distance and cooldowns, and never repeats the same attack three times in a row.
- **Stagger:** enough damage in a short time interrupts the boss, in any phase.
- **Fair retries:** dying puts the player back at the arena door with the boss fully reset, within two seconds.
- Music, UI and camera react to phase changes **without the boss knowing about them**.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Hierarchical State Machine](../patterns/hierarchical-state-machine) | Phases as super-states. Shared transitions like *Staggered* and *Dead* are handled once, above every phase. |
| [Behavior Tree](../patterns/behavior-tree) | Inside each phase: which attack next, by distance, cooldowns and repetition rules. |
| [Health / Damageable Interface](../patterns/health-component) | Damage events drive phase thresholds and stagger accumulation. |
| [Feedback Layering (Juice)](../patterns/juice) | Telegraphs, impacts, the stagger and phase transitions all play feedback assets. |
| [Event Bus](../patterns/event-bus) | `BossPhaseChanged` and `BossDefeated` for music, UI, camera and achievements. |
| [Checkpoint / Respawn](../patterns/checkpoint) | The arena door is a checkpoint, and the boss restores its initial state on respawn. |

## How they fit together

```
                        BossFight (HFSM)
  ┌───────────────────────────────────────────────────────────────┐
  │ Alive (super-state): handles stagger threshold, death          │
  │   ├── Phase1 ─┐  each phase: attack Behavior Tree               │
  │   ├── Phase2  │    Selector by distance / cooldown / no-repeat  │
  │   └── Phase3 ─┘    Attack = Telegraph → Active → Recover        │
  │   ├── PhaseTransition (invulnerable, cinematic, arena change)   │
  │   └── Staggered (from any phase, returns to the same phase)     │
  │ Dead                                                            │
  └───────────────────────────────────────────────────────────────┘
        ▲ Health.Damaged: thresholds + stagger meter        │ EventBus: BossPhaseChanged, BossDefeated
        │                                                    ▼
   player hits                                   music · health bar · camera · achievements
   Checkpoint.Respawn ──► boss.Restore(initial state)
```

The joins:

- **HFSM ↔ Behavior Tree.** The state machine answers *which mode* the boss is in (phase, staggered, transitioning), and the tree answers *what to do* within a phase. Stagger and death live on the parent state, so no phase can forget them, and no tree needs a "check for stagger" branch.
- **Health ↔ HFSM.** Damage events, not polling, drive phase changes. Thresholds are checked once per hit, and a transition happens at most once per threshold, even if one big hit crosses two.
- **Juice ↔ attack states.** Each attack's telegraph, impact and recovery play feedback assets. Readability is data that designers tune, not code.
- **Event Bus ↔ everything else.** Music, UI and camera subscribe to boss events. The boss can be reused in a boss-rush mode with different music and no code changes.
- **Checkpoint ↔ boss state.** The boss implements `ICheckpointRestorable`: full health, phase 1, cooldowns cleared, arena reset. A retry is identical to the first attempt.

## Example (Unity C#)

This builds on the pattern pages: `Health` and `DamageInfo` ([Health](../patterns/health-component)), `Feedback` ([Juice](../patterns/juice)), `EventBus` ([Event Bus](../patterns/event-bus)) and `ICheckpointRestorable` ([Checkpoint](../patterns/checkpoint)).

### Phases and attacks as data

```csharp
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[Serializable]
public class BossAttack
{
    public string name;
    public float minRange, maxRange;
    public float telegraphSeconds = 0.8f, activeSeconds = 0.3f, recoverSeconds = 1.2f;
    public float cooldown = 4f;
    public float damage = 25f;
    public string animation;
    public Feedback telegraphFeedback, impactFeedback;
}

[CreateAssetMenu(menuName = "Boss/Phase")]
public class BossPhase : ScriptableObject
{
    [Range(0f, 1f)] public float startsBelowHealth = 1f;    // 1.0, 0.7, 0.35
    public List<BossAttack> attacks = new();
    public float moveSpeed = 3f;
    public Feedback transitionFeedback;
}

public readonly struct BossPhaseChanged : IEvent { public readonly int Phase; public BossPhaseChanged(int p) => Phase = p; }
public readonly struct BossDefeated : IEvent { }
```

### The boss: HFSM on the outside, attack choice on the inside

```csharp
public class Boss : MonoBehaviour, ICheckpointRestorable
{
    [SerializeField] List<BossPhase> phases;                   // ordered by threshold
    [SerializeField] Health health;
    [SerializeField] Transform player;
    [SerializeField] Animator animator;
    [SerializeField] float staggerThreshold = 120f;            // damage within the window
    [SerializeField] float staggerWindow = 3f;
    [SerializeField] Feedback staggerFeedback;

    enum Mode { Fighting, Attacking, Transition, Staggered, Dead }
    Mode mode;
    int phase;
    readonly Dictionary<BossAttack, float> readyAt = new();
    readonly Queue<(float time, float amount)> recentDamage = new();
    BossAttack last, beforeLast;
    Coroutine running;

    void OnEnable()  => health.Damaged += OnDamaged;
    void OnDisable() => health.Damaged -= OnDamaged;

    void Start() => EnterPhase(0);

    // ── Parent-level transitions: apply to every phase ──
    void OnDamaged(DamageInfo info)
    {
        if (mode == Mode.Dead || mode == Mode.Transition) return;

        if (!health.IsAlive)
        {
            Interrupt(); mode = Mode.Dead;
            animator.Play("Death");
            EventBus<BossDefeated>.Publish(default);
            return;
        }

        // Phase thresholds: at most one transition per hit, never backwards.
        int target = phase;
        while (target + 1 < phases.Count && health.Fraction < phases[target + 1].startsBelowHealth) target++;
        if (target != phase) { Interrupt(); running = StartCoroutine(PhaseTransition(target)); return; }

        // Stagger meter: enough damage within the window interrupts any attack.
        recentDamage.Enqueue((Time.time, info.Amount));
        while (recentDamage.Count > 0 && Time.time - recentDamage.Peek().time > staggerWindow) recentDamage.Dequeue();
        float sum = 0f; foreach (var d in recentDamage) sum += d.amount;
        if (sum >= staggerThreshold && mode != Mode.Staggered)
        {
            recentDamage.Clear();
            Interrupt(); running = StartCoroutine(Stagger());
        }
    }

    void Update()
    {
        if (mode != Mode.Fighting) return;
        var attack = ChooseAttack();                            // the phase's "behavior tree"
        if (attack != null) running = StartCoroutine(PerformAttack(attack));
        else MoveTowardPlayer();
    }

    // Selector: in-range attacks, off cooldown, not the same one three times in a row; weighted toward variety.
    BossAttack ChooseAttack()
    {
        float d = Vector3.Distance(transform.position, player.position);
        BossAttack best = null; float bestScore = float.MinValue;
        foreach (var a in phases[phase].attacks)
        {
            if (d < a.minRange || d > a.maxRange) continue;
            if (readyAt.TryGetValue(a, out var t) && Time.time < t) continue;
            if (a == last && a == beforeLast) continue;
            float score = UnityEngine.Random.value + (a == last ? -0.5f : 0f);
            if (score > bestScore) { bestScore = score; best = a; }
        }
        return best;
    }

    IEnumerator PerformAttack(BossAttack a)
    {
        mode = Mode.Attacking;
        beforeLast = last; last = a;
        readyAt[a] = Time.time + a.cooldown;

        animator.Play(a.animation);
        if (a.telegraphFeedback) a.telegraphFeedback.Play(transform.position, transform);   // the tell: glow, sound, wind-up
        yield return new WaitForSeconds(a.telegraphSeconds);

        if (a.impactFeedback) a.impactFeedback.Play(transform.position, transform);
        HitPlayerIfInside(a);                                          // active window
        yield return new WaitForSeconds(a.activeSeconds);

        yield return new WaitForSeconds(a.recoverSeconds);            // punish window
        mode = Mode.Fighting;
    }

    IEnumerator PhaseTransition(int next)
    {
        mode = Mode.Transition;                                        // boss logic ignores hits now...
        health.Invulnerable = true;                                    // ...and Health ignores the damage itself
        if (phases[next].transitionFeedback) phases[next].transitionFeedback.Play(transform.position, transform);
        animator.Play("Roar");
        yield return new WaitForSeconds(2f);
        health.Invulnerable = false;
        EnterPhase(next);
    }

    IEnumerator Stagger()
    {
        mode = Mode.Staggered;
        if (staggerFeedback) staggerFeedback.Play(transform.position, transform);
        animator.Play("Stagger");
        yield return new WaitForSeconds(2.5f);
        mode = Mode.Fighting;                                          // back to the SAME phase
    }

    void EnterPhase(int p)
    {
        phase = p;
        mode = Mode.Fighting;
        EventBus<BossPhaseChanged>.Publish(new BossPhaseChanged(p + 1));   // music, UI, arena
    }

    void Interrupt() { if (running != null) StopCoroutine(running); running = null; }

    // ── Fair retries ──
    public object Capture() => null;                                   // the boss always resets to its start
    public void Restore(object _)
    {
        Interrupt();
        health.Invulnerable = false;
        health.Revive();
        readyAt.Clear(); recentDamage.Clear(); last = beforeLast = null;
        transform.position = startPosition;
        EnterPhase(0);
    }

    Vector3 startPosition;
    void Awake() => startPosition = transform.position;

    void HitPlayerIfInside(BossAttack a) { /* overlap the attack's hitbox; damage via IDamageable */ }
    void MoveTowardPlayer() { /* steer at phases[phase].moveSpeed */ }
}
```

`Health.Invulnerable` is a small addition to the [Health](../patterns/health-component) component: `TakeDamage` returns early while it is set. `Restore` should also clear it.

The attack choice is a compact, inline version of a behavior-tree selector. For bosses with many conditional attacks (only when the player is airborne, only after a combo), use a real [Behavior Tree](../patterns/behavior-tree) per phase.

## Where the patterns meet: pitfalls

- **Crossing two thresholds with one hit.** A huge hit from 72% to 30% should go to phase 3 once, not play two transitions or skip phase-3 setup. Compute the target phase from health, and transition once.
- **Damage during transitions.** Hits during the roar can push the boss into the next phase, or kill it before the cutscene ends. Make the boss invulnerable while transitioning (in `Health`, not just in the boss logic, or the damage still lands), and show it with a shield effect so players do not feel cheated.
- **Interrupting attacks without cleanup.** Stagger or a phase change mid-attack must cancel the hitbox, stop the telegraph effects and reset the animation. Otherwise an invisible hitbox lingers. One `Interrupt` path for all of them.
- **Restore missing something.** Retries must reset everything: phase, cooldowns, stagger meter, arena hazards, spawned adds, music. Anything forgotten makes the second attempt different from the first. Raise a `Respawned` event, and let arena objects reset themselves.
- **Telegraphs that don't read.** If the tell is shorter than human reaction time (about 250 ms), or hidden by effects, the attack feels unfair. Tune telegraphs per difficulty, and test with players who have never seen the fight.

## Variations

- **Enrage timer:** after N minutes, a final phase with faster telegraphs. One more `BossPhase` asset, entered by time instead of health.
- **Multiple targets in co-op:** choose targets by threat ([Influence Map](../patterns/influence-map)), or rotate between players.
- **Boss rush:** reuse bosses with different music and arenas. Everything outside the boss is driven by the bus events.
- **Accessibility:** longer telegraphs, damage multipliers and a "practice phase" selector, all as data on the phase assets.
