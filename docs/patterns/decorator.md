# Decorator

> Stack behaviour on an object at runtime by wrapping it (weapon mods, logging).

**Category:** Architecture & Structure

## Problem

A roguelike gun can pick up modifications during a run: explosive rounds, double shot, ricochet, piercing, fire damage. Any combination is possible. Subclasses for each combination (`ExplosiveDoubleShotGun`, `PiercingFireGun`…) explode combinatorially. A single `Gun` class full of `if (hasExplosive) ... if (hasDoubleShot) ...` grows with every new mod, and the order of effects is tangled into one method.

## Solution

Give the object and its add-ons **the same interface**. Each add-on, a **decorator**, **wraps** another object implementing that interface, forwards calls to it, and adds its own behaviour before or after.

```
DoubleShot( Explosive( Piercing( BasicGun ) ) )
```

- Decorators can be **stacked in any combination and order**, at runtime.
- Each decorator is small and knows only about its own effect.
- Callers see a single `IWeapon` and do not know how many layers are inside.

The same structure is useful well beyond gameplay: logging, caching, retrying or timing around a service (`LoggingSaveService(RetryingSaveService(CloudSaveService))`).

## Example (Unity C#)

```csharp
using System.Collections.Generic;
using UnityEngine;

public struct ShotInfo
{
    public Vector3 Origin, Direction;
    public float Damage;
    public int Pierce;                     // how many targets a shot passes through
    public bool Explosive;
}

public interface IWeapon
{
    string Description { get; }
    void Fire(ShotInfo shot, List<ShotInfo> output);   // produces the projectiles to spawn
}

public class BasicGun : IWeapon
{
    public string Description => "Gun";
    public void Fire(ShotInfo shot, List<ShotInfo> output) => output.Add(shot);
}

// Base decorator: forwards to the wrapped weapon.
public abstract class WeaponMod : IWeapon
{
    protected readonly IWeapon inner;
    protected WeaponMod(IWeapon inner) => this.inner = inner;
    public virtual string Description => inner.Description;
    public virtual void Fire(ShotInfo shot, List<ShotInfo> output) => inner.Fire(shot, output);
}

public class DamageBoost : WeaponMod
{
    readonly float multiplier;
    public DamageBoost(IWeapon inner, float multiplier) : base(inner) => this.multiplier = multiplier;
    public override string Description => $"{inner.Description} +{(multiplier - 1f) * 100f:0}% dmg";

    public override void Fire(ShotInfo shot, List<ShotInfo> output)
    {
        shot.Damage *= multiplier;                          // modify the shot before passing it on
        inner.Fire(shot, output);
    }
}

public class Piercing : WeaponMod
{
    public Piercing(IWeapon inner) : base(inner) { }
    public override string Description => $"{inner.Description}, piercing";
    public override void Fire(ShotInfo shot, List<ShotInfo> output) { shot.Pierce += 2; inner.Fire(shot, output); }
}

public class ExplosiveRounds : WeaponMod
{
    public ExplosiveRounds(IWeapon inner) : base(inner) { }
    public override string Description => $"{inner.Description}, explosive";
    public override void Fire(ShotInfo shot, List<ShotInfo> output) { shot.Explosive = true; inner.Fire(shot, output); }
}

public class DoubleShot : WeaponMod
{
    public DoubleShot(IWeapon inner) : base(inner) { }
    public override string Description => $"{inner.Description}, double shot";

    public override void Fire(ShotInfo shot, List<ShotInfo> output)
    {
        // Fire the inner weapon twice, spread apart: every inner mod applies to both shots.
        var left = shot;  left.Direction = Quaternion.Euler(0, -6f, 0) * shot.Direction;
        var right = shot; right.Direction = Quaternion.Euler(0, 6f, 0) * shot.Direction;
        inner.Fire(left, output);
        inner.Fire(right, output);
    }
}

// During a run, pickups wrap the current weapon:
// IWeapon weapon = new BasicGun();
// weapon = new Piercing(weapon);              // picked up "Piercing"
// weapon = new ExplosiveRounds(weapon);       // picked up "Explosive"
// weapon = new DoubleShot(weapon);            // picked up "Double Shot"
// weapon.Fire(new ShotInfo { Origin = muzzle.position, Direction = muzzle.forward, Damage = 10 }, shots);
// → 2 shots, each explosive and piercing; Description: "Gun, piercing, explosive, double shot"
```

Order matters, and that is a feature: `DoubleShot(DamageBoost(gun))` and `DamageBoost(DoubleShot(gun))` give the same result here, but a "+1 projectile" mod wrapped *outside* a "spread" mod behaves differently from one *inside* it. Make the order part of the design.

## When to use

- Combinable runtime upgrades: weapon mods, ability augments, roguelike items that change how something works.
- Cross-cutting concerns around services: logging, caching, retries, timing, permission checks.
- When subclassing for every combination is impossible.

## Pitfalls

- **Removing a layer from the middle.** Decorators form a chain, so removing "Explosive" when its pickup expires means rebuilding the chain. Keep the list of active mods, and rebuild the wrapped weapon from it when the list changes.
- **Identity and type checks.** `weapon is BasicGun` fails once it is wrapped. Never check concrete types of decorated objects. Ask the interface instead.
- **Deep stacks.** Fifty layers of tiny decorators are hard to debug and add call overhead. Provide a description or debug dump of the stack, as `Description` does.
- **When modifiers are just numbers.** If mods only change stats (+10% damage), a [Stat & Modifier System](./stat-modifier-system) is simpler. Decorators shine when mods change *behaviour* (fire twice, explode, split).

## Related

- [Stat & Modifier System](./stat-modifier-system) — for numeric changes. Decorators are for behavioural ones.
- [Composite](./composite) — also wraps objects behind one interface, but holds many children instead of one.
- [Strategy](./strategy) — swaps the whole behaviour. A decorator adds to it.
- [Adapter](./adapter) — wraps to change an interface. A decorator keeps the interface.
- [Chain of Responsibility](./chain-of-responsibility) — a related chain of handlers that may stop the request.
