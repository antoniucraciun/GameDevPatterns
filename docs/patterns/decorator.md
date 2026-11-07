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

## Example

Roguelike weapon mods: each pickup wraps the current weapon in a decorator that changes how it fires. This is pure logic, so all three versions are engine-free apart from vector maths.

::: code-group

```csharp [Unity (C#)]
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
//   IWeapon weapon = new BasicGun();
//   weapon = new Piercing(weapon);              // picked up "Piercing"
//   weapon = new ExplosiveRounds(weapon);       // picked up "Explosive"
//   weapon = new DoubleShot(weapon);            // picked up "Double Shot"
//   weapon.Fire(new ShotInfo { Origin = muzzle.position, Direction = muzzle.forward, Damage = 10 }, shots);
//   → 2 shots, each explosive and piercing; Description: "Gun, piercing, explosive, double shot"
```

```gdscript [Godot (GDScript)]
# shot_info.gd: a small value object. GDScript objects are references, so decorators
# copy() before changing a shot, which is what a struct copy does for free in C# and C++.
class_name ShotInfo
extends RefCounted

var origin: Vector3
var direction: Vector3
var damage := 0.0
var pierce := 0       # how many targets a shot passes through
var explosive := false


func copy() -> ShotInfo:
	var s := ShotInfo.new()
	s.origin = origin; s.direction = direction; s.damage = damage; s.pierce = pierce; s.explosive = explosive
	return s


# weapon.gd: the component interface, and the plain gun.
class_name Weapon
extends RefCounted

func description() -> String:
	return "Gun"

func fire(shot: ShotInfo, output: Array[ShotInfo]) -> void:  # produces the projectiles to spawn
	output.append(shot)


# weapon_mod.gd: base decorator, forwards to the wrapped weapon.
class_name WeaponMod
extends Weapon

var inner: Weapon

func _init(wrapped: Weapon) -> void:
	inner = wrapped

func description() -> String:
	return inner.description()

func fire(shot: ShotInfo, output: Array[ShotInfo]) -> void:
	inner.fire(shot, output)


# piercing.gd
class_name Piercing
extends WeaponMod

func description() -> String:
	return inner.description() + ", piercing"

func fire(shot: ShotInfo, output: Array[ShotInfo]) -> void:
	var s := shot.copy()
	s.pierce += 2
	inner.fire(s, output)


# double_shot.gd
class_name DoubleShot
extends WeaponMod

func description() -> String:
	return inner.description() + ", double shot"

func fire(shot: ShotInfo, output: Array[ShotInfo]) -> void:
	# Fire the inner weapon twice, spread apart: every inner mod applies to both shots.
	for angle in [-6.0, 6.0]:
		var s := shot.copy()
		s.direction = shot.direction.rotated(Vector3.UP, deg_to_rad(angle))
		inner.fire(s, output)

# DamageBoost and ExplosiveRounds follow the same shape.
# During a run, pickups wrap the current weapon:
#   var weapon: Weapon = Weapon.new()
#   weapon = Piercing.new(weapon)
#   weapon = DoubleShot.new(weapon)
```

```cpp [Unreal (C++)]
// WeaponMods.h: plain C++. Shots are structs, so each decorator modifies its own copy.
#pragma once

#include "CoreMinimal.h"

struct FShotInfo
{
	FVector Origin = FVector::ZeroVector;
	FVector Direction = FVector::ForwardVector;
	float Damage = 0.f;
	int32 Pierce = 0;                         // how many targets a shot passes through
	bool bExplosive = false;
};

class IWeapon
{
public:
	virtual ~IWeapon() = default;
	virtual FString Description() const = 0;
	virtual void Fire(FShotInfo Shot, TArray<FShotInfo>& Output) const = 0;   // produces the projectiles to spawn
};

class FBasicGun : public IWeapon
{
public:
	virtual FString Description() const override { return TEXT("Gun"); }
	virtual void Fire(FShotInfo Shot, TArray<FShotInfo>& Output) const override { Output.Add(Shot); }
};

// Base decorator: forwards to the wrapped weapon.
class FWeaponMod : public IWeapon
{
public:
	explicit FWeaponMod(TSharedRef<const IWeapon> InInner) : Inner(MoveTemp(InInner)) {}
	virtual FString Description() const override { return Inner->Description(); }
	virtual void Fire(FShotInfo Shot, TArray<FShotInfo>& Output) const override { Inner->Fire(Shot, Output); }

protected:
	TSharedRef<const IWeapon> Inner;
};

class FDamageBoost : public FWeaponMod
{
public:
	FDamageBoost(TSharedRef<const IWeapon> InInner, float InMultiplier) : FWeaponMod(MoveTemp(InInner)), Multiplier(InMultiplier) {}
	virtual FString Description() const override
	{
		return FString::Printf(TEXT("%s +%.0f%% dmg"), *Inner->Description(), (Multiplier - 1.f) * 100.f);
	}
	virtual void Fire(FShotInfo Shot, TArray<FShotInfo>& Output) const override
	{
		Shot.Damage *= Multiplier;                // modify the shot before passing it on
		Inner->Fire(Shot, Output);
	}

private:
	float Multiplier;
};

class FPiercing : public FWeaponMod
{
public:
	using FWeaponMod::FWeaponMod;
	virtual FString Description() const override { return Inner->Description() + TEXT(", piercing"); }
	virtual void Fire(FShotInfo Shot, TArray<FShotInfo>& Output) const override { Shot.Pierce += 2; Inner->Fire(Shot, Output); }
};

class FDoubleShot : public FWeaponMod
{
public:
	using FWeaponMod::FWeaponMod;
	virtual FString Description() const override { return Inner->Description() + TEXT(", double shot"); }
	virtual void Fire(FShotInfo Shot, TArray<FShotInfo>& Output) const override
	{
		// Fire the inner weapon twice, spread apart: every inner mod applies to both shots.
		for (const float Yaw : {-6.f, 6.f})
		{
			FShotInfo Spread = Shot;
			Spread.Direction = FRotator(0.f, Yaw, 0.f).RotateVector(Shot.Direction);
			Inner->Fire(Spread, Output);
		}
	}
};

// ExplosiveRounds follows the same shape. During a run, pickups wrap the current weapon:
//   TSharedRef<const IWeapon> Weapon = MakeShared<FBasicGun>();
//   Weapon = MakeShared<FPiercing>(Weapon);
//   Weapon = MakeShared<FDoubleShot>(Weapon);
```

:::

Order matters, and that is a feature: `DoubleShot(DamageBoost(gun))` and `DamageBoost(DoubleShot(gun))` give the same result here, but a "+1 projectile" mod wrapped *outside* a "spread" mod behaves differently from one *inside* it. Make the order part of the design.

**Engine notes**

- **Unity:** `ShotInfo` is a struct, so each mod receives its own copy; changing it never affects the shot another mod sees.
- **Godot:** objects are passed by reference, so a decorator that changes a shot without `copy()` changes it for every other branch, the most likely bug when porting this pattern to GDScript.
- **Unreal:** `TSharedRef<const IWeapon>` lets several weapons share an inner chain safely. For mods that designers author, the same idea is often built with GAS gameplay effects or data assets that list modifiers in order.

## When to use

- Combinable runtime upgrades: weapon mods, ability augments, roguelike items that change how something works.
- Cross-cutting concerns around services: logging, caching, retries, timing, permission checks.
- When subclassing for every combination is impossible.

## When not to use

- A fixed, small set of variations. Separate classes or a [Strategy](./strategy) are easier to follow.
- Stat bonuses that just add or multiply numbers. A [Stat Modifier System](./stat-modifier-system) is simpler and easier to show in the UI.
- When the order of wrappers matters and is hard to reason about. Long decorator chains are hard to debug; use an explicit pipeline such as [Chain of Responsibility](./chain-of-responsibility).

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
