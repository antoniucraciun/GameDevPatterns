# Health / Damageable Interface

> One interface lets anything take damage without the attacker knowing its type.

**Category:** Gameplay Systems

## Problem

The sword script checks `if (other.GetComponent<Enemy>()) ... else if (other.GetComponent<Player>()) ... else if (other.GetComponent<Crate>())`. Every new destructible type means editing every weapon. The player can die twice in one frame, playing the death animation twice and awarding two game-overs. Hits on a child collider (the head) do not find the health on the root object. Enemies keep taking damage while their death animation plays, and nobody can tell *who* dealt the killing blow.

## Solution

Two small pieces:

- **`IDamageable`**: the contract every damage source uses. `TakeDamage(DamageInfo)` is all a weapon needs to know.
- **`Health`**: the standard implementation. It holds current and max health, handles **invulnerability windows** (i-frames), guarantees **exactly one death**, and raises **events** (`Damaged`, `Healed`, `Died`) for UI, audio, AI and loot to react to.

`DamageInfo` is a small struct describing the hit: amount, type, source and point. Listeners know who did what, and later a [Damage Pipeline](./damage-pipeline) can transform it.

**Hurtboxes** on child colliders forward hits to the `Health` on the root, optionally with a multiplier (head ×2, armour plate ×0.5).

## Example (Unity C#)

```csharp
using System;
using UnityEngine;

public enum DamageType { Physical, Fire, Ice, Poison, True }

public struct DamageInfo
{
    public float Amount;
    public DamageType Type;
    public GameObject Source;        // who caused it: kill credit, aggro, thorns
    public Vector3 Point;            // where: hit effects, knockback direction
    public bool IsCritical;
}

public interface IDamageable
{
    bool IsAlive { get; }
    void TakeDamage(DamageInfo info);
}

public class Health : MonoBehaviour, IDamageable
{
    [SerializeField] float max = 100f;
    [SerializeField] float invulnerableAfterHit = 0f;      // i-frames, e.g. 0.5 s for the player

    public float Current { get; private set; }
    public float Max => max;
    public bool IsAlive => Current > 0f;
    public float Fraction => Current / max;

    public event Action<DamageInfo> Damaged;
    public event Action<float> Healed;
    public event Action<DamageInfo> Died;                  // carries the killing blow

    float invulnerableUntil;

    void Awake() => Current = max;

    public void TakeDamage(DamageInfo info)
    {
        if (!IsAlive || info.Amount <= 0f) return;          // no damage after death
        if (Time.time < invulnerableUntil) return;          // i-frames

        Current = Mathf.Max(0f, Current - info.Amount);
        invulnerableUntil = Time.time + invulnerableAfterHit;
        Damaged?.Invoke(info);

        if (Current <= 0f) Died?.Invoke(info);              // exactly once: IsAlive is false from now on
    }

    public void Heal(float amount)
    {
        if (!IsAlive || amount <= 0f) return;               // healing doesn't revive
        float before = Current;
        Current = Mathf.Min(max, Current + amount);
        if (Current > before) Healed?.Invoke(Current - before);
    }

    public void Revive(float fraction = 1f)
    {
        Current = max * Mathf.Clamp01(fraction);
        invulnerableUntil = 0f;
    }
}

// On child colliders: forwards hits to the root's Health, with a location multiplier.
public class Hurtbox : MonoBehaviour, IDamageable
{
    [SerializeField] Health owner;
    [SerializeField] float multiplier = 1f;                 // head 2.0, armour plate 0.5

    public bool IsAlive => owner.IsAlive;

    public void TakeDamage(DamageInfo info)
    {
        info.Amount *= multiplier;
        owner.TakeDamage(info);
    }

    void Reset() => owner = GetComponentInParent<Health>();
}
```

Weapons only know the interface:

```csharp
void OnTriggerEnter(Collider other)
{
    // Hurtboxes on children are found first; otherwise fall back to the parent's Health.
    if (!other.TryGetComponent(out IDamageable target))
        target = other.GetComponentInParent<IDamageable>();

    target?.TakeDamage(new DamageInfo
    {
        Amount = 25f, Type = DamageType.Physical, Source = gameObject, Point = other.ClosestPoint(transform.position),
    });
}
```

`target?.` is safe here because `target` is a C# interface reference returned this frame. The Unity destroyed-object problem only applies to stored `UnityEngine.Object` references.

Everything else reacts to events: the health bar listens to `Damaged` and `Healed`, the loot dropper and score listen to `Died`, and AI uses `info.Source` to pick who to fight back against.

## When to use

- Every game where more than one kind of thing can be damaged: players, enemies, props, vehicles, buildings.
- When weapons, traps, explosions and status effects should all hurt things in the same way.

## When not to use

- Games where only the player can be damaged, and only in one way. A health field on the player is enough.
- One-hit objects such as pickups or breakable crates. A simple `OnHit` call or destroy is clearer.

## Pitfalls

- **Double death.** Two hits in the same frame both see `Current <= 0` and raise `Died` twice, unless the "already dead" check comes first, as above.
- **Hitting several hurtboxes of one character.** An explosion overlapping the head, chest and arm hurtboxes damages the same character three times. Deduplicate by owner per attack.
- **Damage after death.** The death animation keeps colliders active, so the corpse soaks up bullets and plays hit effects. Ignore damage when not alive, and disable hurtboxes on death.
- **Integer health.** Fractional damage (DoT ticks, multipliers) rounds away with `int`. Use `float` internally, and round only for display.
- **Event order.** Listeners to `Died` that destroy the object (or return it to a pool) can break other listeners that run after them. Defer destruction to the end of the frame, or have one owner handle it.

## Related

- [Damage Pipeline](./damage-pipeline) — transforms `DamageInfo` before it reaches `Health`: armour, resistances, shields.
- [Component](./component) — `Health` is the classic reusable component.
- [Observer](./observer) — `Damaged`, `Healed` and `Died` drive UI, audio, loot and AI.
- [Status Effects](./status-effects) — damage over time goes through the same interface.
- [Juicy Combat Hits](../recipes/juicy-combat-hits) — feedback built on top of these events.
