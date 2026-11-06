# Subclass Sandbox

> A base class offers a set of safe operations that subclasses compose into behaviour.

**Category:** Architecture & Structure

## Problem

A superhero game has dozens of powers: Sky Launch, Ground Slam, Lightning Arc, Phase Dash. Each is a subclass, and each one reaches into whatever systems it needs: it finds the audio manager, spawns particles its own way, applies physics forces directly, queries enemies with its own overlap code. Soon every power depends on every engine system, the same tasks are done ten different ways, and changing how particles spawn means editing forty classes. Power designers, often junior programmers or technical designers, need to touch dangerous parts of the codebase to add simple effects.

## Solution

Give the base class a **toolbox of protected operations**, the **sandbox**, and one abstract method that subclasses implement **using only those operations**:

- The base class provides `PlaySound`, `SpawnEffect`, `Launch`, `DamageInArea`, `Wait`: small, safe, consistent building blocks.
- Subclasses implement `Activate()` by **composing** those calls. They do not touch audio, physics or effects systems directly.
- All coupling to engine systems lives in the **one** base class. Change how effects spawn there, and every power changes with it.

It is the opposite of [Template Method](./template-method): instead of the base class calling the subclass's steps in a fixed order, the subclass freely calls the base class's tools.

## Example (Unity C#)

```csharp
using System.Collections;
using UnityEngine;

public abstract class Power : MonoBehaviour
{
    [SerializeField] protected float cooldown = 3f;
    float readyAt;

    // ── The sandbox: the ONLY operations powers may use ──

    protected Transform Owner => transform;

    protected void PlaySound(SoundCue cue) => Services.Get<IAudio>().PlaySfx(cue, Owner.position);

    protected void SpawnEffect(GameObject effect, Vector3 at, float lifetime = 2f) =>
        Destroy(Instantiate(effect, at, Quaternion.identity), lifetime);            // pooled in production

    protected void Launch(Vector3 velocity)
    {
        var body = Owner.GetComponent<Rigidbody>();
        body.linearVelocity = Vector3.zero;
        body.AddForce(velocity, ForceMode.VelocityChange);
    }

    protected int DamageInArea(Vector3 center, float radius, float damage)
    {
        int hits = 0;
        foreach (var c in Physics.OverlapSphere(center, radius))
        {
            if (c.transform.root == Owner.root) continue;                              // never hit yourself
            if (c.TryGetComponent(out IDamageable d))
            {
                d.TakeDamage(new DamageInfo { Amount = damage, Source = Owner.gameObject, Point = c.transform.position });
                hits++;
            }
        }
        return hits;
    }

    protected bool IsGrounded() => Physics.Raycast(Owner.position + Vector3.up * 0.1f, Vector3.down, 0.3f);

    protected IEnumerator Wait(float seconds) { yield return new WaitForSeconds(seconds); }

    // ── What subclasses implement ──
    protected abstract IEnumerator Activate();

    public bool TryUse()
    {
        if (Time.time < readyAt) return false;
        readyAt = Time.time + cooldown;
        StartCoroutine(Activate());
        return true;
    }
}

// Powers are short, readable, and touch nothing but the sandbox.
public class GroundSlam : Power
{
    [SerializeField] SoundCue jumpSound, slamSound;
    [SerializeField] GameObject shockwave;

    protected override IEnumerator Activate()
    {
        PlaySound(jumpSound);
        Launch(Vector3.up * 12f);
        yield return Wait(0.35f);
        Launch(Vector3.down * 30f);
        while (!IsGrounded()) yield return null;
        PlaySound(slamSound);
        SpawnEffect(shockwave, Owner.position);
        DamageInArea(Owner.position, radius: 5f, damage: 40f);
    }
}

public class SkyLaunch : Power
{
    [SerializeField] SoundCue whoosh;
    [SerializeField] GameObject trail;

    protected override IEnumerator Activate()
    {
        PlaySound(whoosh);
        SpawnEffect(trail, Owner.position, lifetime: 1f);
        Launch(Vector3.up * 20f);
        yield break;
    }
}
```

`IAudio`, `SoundCue`, `IDamageable` and `DamageInfo` come from [Facade](./facade) and [Health / Damageable](./health-component). Only the base class knows about them.

## When to use

- Many small subclasses of one concept (powers, spells, interactable props, enemy attacks, cutscene steps) that need the same engine services.
- When subclasses are written by people who should not need to know every engine system.
- When the base class is the right place to enforce consistency: the same sound routing, pooling and damage rules for every power.

## When not to use

- A few subclasses with little shared behaviour. Plain inheritance or composition is simpler.
- When the variations are mostly data. Use [Type Object](./type-object).
- Deep hierarchies. If the sandbox base class keeps growing to serve every subclass, split it into [Components](./component) or [Strategies](./strategy).

## Pitfalls

- **The sandbox grows without limit.** Every power wants one more tool, and the base class becomes huge. Group tools into helper objects (`Effects`, `Physics`, `Audio`) that the base class exposes, and add tools only when several subclasses need them.
- **Subclasses bypassing the sandbox.** Nothing in C# stops `FindFirstObjectByType<AudioManager>()` in a subclass. Code review, analysers, or putting subclasses in an assembly that cannot reference engine systems all help.
- **Inheritance limits.** A power that needs a second base class cannot have one. If powers need to mix and match many capabilities, consider data-driven composition (effects lists, as in the [Ability System](./ability-system)) instead.
- **Coupling moves to the base class.** That is the point, but the base class now depends on many systems. Keep its dependencies behind interfaces, so it stays testable.

## Related

- [Ability System](./ability-system) — the data-driven alternative: abilities as lists of effects instead of subclasses.
- [Template Method](./template-method) — the inverse: the base class defines the steps, and subclasses fill them in.
- [Facade](./facade) — sandbox operations often call facades.
- [Component](./component) — composition instead of inheritance, when subclass trees get awkward.
