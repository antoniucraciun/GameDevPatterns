# Builder

> Assemble complex objects step by step with a readable, validated API.

**Category:** Architecture & Structure

## Problem

A loot system generates weapons: a base type, a rarity, two to five random affixes, a level that scales stats, an optional unique effect, and a generated name ("Blazing Longsword of the Fox"). A constructor with nine parameters is unreadable and easy to call wrongly. Setting public fields one by one allows half-built weapons (no base type, an epic with zero affixes) to escape into the game. Every place that makes weapons (loot drops, shops, quest rewards, the debug console) repeats the same assembly logic.

## Solution

Separate **how an object is assembled** from **the object itself**:

- A **builder** collects configuration through small, readable steps: `WithBase(...)`, `WithRarity(...)`, `AddAffix(...)`, `AtLevel(...)`.
- `Build()` **validates** the configuration, fills in defaults, derives computed values (final stats, name), and returns a finished, consistent object.
- The product can be **immutable**, because all assembly happens in the builder.

Builders often return `this` from each step (a fluent API), so construction reads like a description. A **director** (or plain helper methods) can encode common recipes: "random drop for level 20", "quest reward", "vendor item".

## Pseudocode

```text
// The product: set once, never changed afterwards.
Weapon:
    name, base, rarity, level, affixes, damage

// The builder: collects choices, then checks and finishes them in one place.
WeaponBuilder:
    base ← none,  rarity ← Common,  level ← 1
    affixes ← empty list,  custom_name ← none

    with_base(b):    base ← b;  return this builder     // each step returns the
    with_rarity(r):  rarity ← r;  return this builder   // builder, so calls chain
    at_level(l):     level ← max(1, l);  return this builder
    add_affix(a):    add a to affixes;  return this builder

    with_random_affixes(table, rng):    // fill the remaining slots
        target ← random whole number in affix_range(rarity), from rng
        while affixes has fewer than target entries:
            add table.roll(rng, level, excluding affixes) to affixes
        return this builder

    build():
        if base is none: fail "a weapon needs a base type"
        if count of affixes is outside affix_range(rarity): fail
        damage ← base.damage × (1 + 0.08 × (level - 1))
        for each affix a: damage ← a.modify(damage)
        name ← custom_name, or prefix + base name + suffix
        return new Weapon(name, base, rarity, level, copy of affixes, damage)

affix_range(rarity): Common 0-0, Magic 1-2, Rare 3-4, Epic 4-5

sword ← new WeaponBuilder
            .with_base(longsword).with_rarity(Rare).at_level(20)
            .add_affix(blazing).with_random_affixes(table, rng)
            .build()
```

## Example

A builder for generated weapons: readable step-by-step construction, validation that impossible combinations can't escape, and an immutable result.

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public enum Rarity { Common, Magic, Rare, Epic }

public sealed class Weapon                                   // immutable product
{
    public string Name { get; }
    public WeaponBase Base { get; }
    public Rarity Rarity { get; }
    public int Level { get; }
    public IReadOnlyList<Affix> Affixes { get; }
    public float Damage { get; }

    internal Weapon(string name, WeaponBase b, Rarity r, int level, List<Affix> affixes, float damage)
    {
        Name = name; Base = b; Rarity = r; Level = level; Affixes = affixes; Damage = damage;
    }
}

public class WeaponBuilder
{
    WeaponBase weaponBase;
    Rarity rarity = Rarity.Common;
    int level = 1;
    readonly List<Affix> affixes = new();
    string customName;

    public WeaponBuilder WithBase(WeaponBase b) { weaponBase = b; return this; }
    public WeaponBuilder WithRarity(Rarity r) { rarity = r; return this; }
    public WeaponBuilder AtLevel(int l) { level = Mathf.Max(1, l); return this; }
    public WeaponBuilder AddAffix(Affix a) { affixes.Add(a); return this; }
    public WeaponBuilder Named(string name) { customName = name; return this; }

    // Fill the remaining affix slots randomly, from a seeded generator.
    public WeaponBuilder WithRandomAffixes(AffixTable table, System.Random rng)
    {
        var (min, max) = AffixRange(rarity);
        int target = rng.Next(min, max + 1);
        while (affixes.Count < target) affixes.Add(table.Roll(rng, level, exclude: affixes));
        return this;
    }

    public Weapon Build()
    {
        // Validation: impossible combinations never leave the builder.
        if (weaponBase == null) throw new InvalidOperationException("A weapon needs a base type");
        var (min, max) = AffixRange(rarity);
        if (affixes.Count < min || affixes.Count > max)
            throw new InvalidOperationException($"{rarity} weapons need {min}-{max} affixes, got {affixes.Count}");

        // Derived values, computed once.
        float damage = weaponBase.BaseDamage * (1f + 0.08f * (level - 1));
        foreach (var a in affixes) damage = a.ModifyDamage(damage);

        string name = customName ?? GenerateName();
        return new Weapon(name, weaponBase, rarity, level, new List<Affix>(affixes), damage);
    }

    string GenerateName()
    {
        var prefix = affixes.Find(a => a.IsPrefix);
        var suffix = affixes.Find(a => !a.IsPrefix);
        return $"{prefix?.Text}{(prefix != null ? " " : "")}{weaponBase.DisplayName}{(suffix != null ? " " + suffix.Text : "")}";
    }

    static (int min, int max) AffixRange(Rarity r) => r switch
    {
        Rarity.Common => (0, 0), Rarity.Magic => (1, 2), Rarity.Rare => (3, 4), _ => (4, 5),
    };
}

// Readable, validated construction:
//   var sword = new WeaponBuilder()
//       .WithBase(longsword).WithRarity(Rarity.Rare).AtLevel(20)
//       .AddAffix(blazing)                       // guaranteed affix for a quest reward
//       .WithRandomAffixes(affixTable, rng)      // the rest random
//       .Build();                                 // "Blazing Longsword of the Fox", 3-4 affixes
```

```gdscript [Godot (GDScript)]
# weapon.gd: the product. GDScript has no read-only fields, so expose getters only.
class_name Weapon
extends RefCounted

enum Rarity { COMMON, MAGIC, RARE, EPIC }

var _name: String
var _base: WeaponBase
var _rarity: Rarity
var _level: int
var _affixes: Array[Affix]
var _damage: float


func _init(name: String, base: WeaponBase, rarity: Rarity, level: int, affixes: Array[Affix], damage: float) -> void:
	_name = name; _base = base; _rarity = rarity; _level = level; _affixes = affixes; _damage = damage

func get_weapon_name() -> String: return _name
func get_damage() -> float: return _damage
func get_affixes() -> Array[Affix]: return _affixes.duplicate()


# weapon_builder.gd
class_name WeaponBuilder
extends RefCounted

var _base: WeaponBase
var _rarity := Weapon.Rarity.COMMON
var _level := 1
var _affixes: Array[Affix] = []
var _custom_name := ""


func with_base(base: WeaponBase) -> WeaponBuilder: _base = base; return self
func with_rarity(rarity: Weapon.Rarity) -> WeaponBuilder: _rarity = rarity; return self
func at_level(level: int) -> WeaponBuilder: _level = maxi(1, level); return self
func add_affix(affix: Affix) -> WeaponBuilder: _affixes.append(affix); return self
func named(n: String) -> WeaponBuilder: _custom_name = n; return self


# Fill the remaining affix slots randomly, from a seeded generator.
func with_random_affixes(table: AffixTable, rng: RandomNumberGenerator) -> WeaponBuilder:
	var slots := _affix_range(_rarity)
	var target := rng.randi_range(slots.x, slots.y)
	while _affixes.size() < target:
		_affixes.append(table.roll(rng, _level, _affixes))
	return self


# Returns null and reports the error for impossible combinations (GDScript has no exceptions).
func build() -> Weapon:
	if _base == null:
		push_error("A weapon needs a base type")
		return null
	var slots := _affix_range(_rarity)
	if _affixes.size() < slots.x or _affixes.size() > slots.y:
		push_error("%s weapons need %d-%d affixes, got %d" % [Weapon.Rarity.keys()[_rarity], slots.x, slots.y, _affixes.size()])
		return null

	# Derived values, computed once.
	var damage := _base.base_damage * (1.0 + 0.08 * (_level - 1))
	for a in _affixes:
		damage = a.modify_damage(damage)
	var name := _custom_name if _custom_name != "" else _generate_name()
	return Weapon.new(name, _base, _rarity, _level, _affixes.duplicate(), damage)


func _generate_name() -> String:
	var prefix := _affixes.filter(func(a): return a.is_prefix)
	var suffix := _affixes.filter(func(a): return not a.is_prefix)
	var parts: Array[String] = []
	if not prefix.is_empty(): parts.append(prefix[0].text)
	parts.append(_base.display_name)
	if not suffix.is_empty(): parts.append(suffix[0].text)
	return " ".join(parts)


static func _affix_range(rarity: Weapon.Rarity) -> Vector2i:
	match rarity:
		Weapon.Rarity.COMMON: return Vector2i(0, 0)
		Weapon.Rarity.MAGIC: return Vector2i(1, 2)
		Weapon.Rarity.RARE: return Vector2i(3, 4)
		_: return Vector2i(4, 5)

# var sword := WeaponBuilder.new().with_base(longsword).with_rarity(Weapon.Rarity.RARE) \
#     .at_level(20).add_affix(blazing).with_random_affixes(affix_table, rng).build()
```

```cpp [Unreal (C++)]
// WeaponBuilder.h: plain C++. The product's constructor is private, so only the builder can make one.
#pragma once

#include "CoreMinimal.h"

enum class ERarity : uint8 { Common, Magic, Rare, Epic };

class FWeapon                                                // immutable product
{
public:
	const FString& GetName() const { return Name; }
	float GetDamage() const { return Damage; }
	const TArray<const UAffix*>& GetAffixes() const { return Affixes; }

private:
	friend class FWeaponBuilder;
	FWeapon(FString InName, const UWeaponBase* InBase, ERarity InRarity, int32 InLevel, TArray<const UAffix*> InAffixes, float InDamage)
		: Name(MoveTemp(InName)), Base(InBase), Rarity(InRarity), Level(InLevel), Affixes(MoveTemp(InAffixes)), Damage(InDamage) {}

	FString Name;
	const UWeaponBase* Base;
	ERarity Rarity;
	int32 Level;
	TArray<const UAffix*> Affixes;
	float Damage;
};

class FWeaponBuilder
{
public:
	FWeaponBuilder& WithBase(const UWeaponBase* B) { Base = B; return *this; }
	FWeaponBuilder& WithRarity(ERarity R) { Rarity = R; return *this; }
	FWeaponBuilder& AtLevel(int32 L) { Level = FMath::Max(1, L); return *this; }
	FWeaponBuilder& AddAffix(const UAffix* A) { Affixes.Add(A); return *this; }
	FWeaponBuilder& Named(FString InName) { CustomName = MoveTemp(InName); return *this; }

	// Fill the remaining affix slots randomly, from a seeded stream.
	FWeaponBuilder& WithRandomAffixes(const UAffixTable& Table, FRandomStream& Rng)
	{
		const FInt32Interval Range = AffixRange(Rarity);
		const int32 Target = Rng.RandRange(Range.Min, Range.Max);
		while (Affixes.Num() < Target) Affixes.Add(Table.Roll(Rng, Level, Affixes));
		return *this;
	}

	// Validation: impossible combinations never leave the builder (returns unset on failure).
	TOptional<FWeapon> Build() const
	{
		const FInt32Interval Range = AffixRange(Rarity);
		if (!Base || Affixes.Num() < Range.Min || Affixes.Num() > Range.Max)
		{
			UE_LOG(LogTemp, Error, TEXT("Invalid weapon: needs a base and %d-%d affixes, got %d"), Range.Min, Range.Max, Affixes.Num());
			return {};
		}

		// Derived values, computed once.
		float Damage = Base->BaseDamage * (1.f + 0.08f * (Level - 1));
		for (const UAffix* A : Affixes) Damage = A->ModifyDamage(Damage);

		return FWeapon(CustomName.IsEmpty() ? GenerateName() : CustomName, Base, Rarity, Level, Affixes, Damage);
	}

private:
	FString GenerateName() const
	{
		const UAffix* const* Prefix = Affixes.FindByPredicate([](const UAffix* A) { return A->bIsPrefix; });
		const UAffix* const* Suffix = Affixes.FindByPredicate([](const UAffix* A) { return !A->bIsPrefix; });
		FString Result = Base->DisplayName.ToString();
		if (Prefix) Result = (*Prefix)->Text.ToString() + TEXT(" ") + Result;
		if (Suffix) Result += TEXT(" ") + (*Suffix)->Text.ToString();
		return Result;
	}

	static FInt32Interval AffixRange(ERarity R)
	{
		switch (R)
		{
		case ERarity::Common: return {0, 0};
		case ERarity::Magic:  return {1, 2};
		case ERarity::Rare:   return {3, 4};
		default:              return {4, 5};
		}
	}

	const UWeaponBase* Base = nullptr;
	ERarity Rarity = ERarity::Common;
	int32 Level = 1;
	TArray<const UAffix*> Affixes;
	FString CustomName;
};

// TOptional<FWeapon> Sword = FWeaponBuilder()
//     .WithBase(Longsword).WithRarity(ERarity::Rare).AtLevel(20)
//     .AddAffix(Blazing).WithRandomAffixes(*AffixTable, Rng)
//     .Build();
```

:::

`WeaponBase`, `Affix` and `AffixTable` are data assets (see [Type Object](./type-object) and [Weighted Random](./weighted-random)). Builders also appear elsewhere in games: procedural mesh builders, network packet builders, dungeon builders, and test-data builders that make unit tests readable.

**Engine notes**

- **Unity:** throwing from `Build()` is fine for content pipelines and tests; in shipped gameplay code, consider returning `null` with a logged error so one bad roll can't break a loot drop.
- **Godot:** GDScript has no exceptions, so `build()` reports with `push_error` and returns `null`; callers must check. `SurfaceTool` is Godot's own builder for meshes.
- **Unreal:** `TOptional` makes "maybe no result" explicit. Unreal uses builders itself, for example `FMeshDescriptionBuilder` and the Slate `SNew(...)` syntax, which is a builder with chained calls.

## When to use

- Objects with many optional parts, or rules about which parts combine: generated items, characters, levels, meshes, network messages.
- When the same assembly logic is needed in several places.
- Test setups: `new PlayerBuilder().WithHealth(1).WithItem(potion).Build()` keeps tests short and focused.

## When not to use

- Objects with only a few required fields. A constructor or object initializer is clearer.
- Objects configured in the editor. Unity prefabs, Godot scenes and Unreal Blueprints, edited in the Inspector or Details panel, are already the builder.
- One-off construction in a single place. A builder pays off when assembly rules are reused or easy to get wrong.

## Pitfalls

- **Builders for simple objects.** Two required fields belong in a constructor. Builders pay off with many options and validation rules.
- **Reusing a builder.** Calling `Build()` twice on the same builder may share mutable state (here, the affix list is copied for that reason). Document whether builders are single-use, or reset them after `Build()`.
- **Validation too late.** Throwing in `Build()` is fine for programming errors. For data-driven generation, prefer returning a result or logging, and falling back to a valid default, so a bad loot table does not crash the game.
- **Builders that grow into god objects.** If the builder starts making gameplay decisions ("pick a weapon the player will like"), split that into a director or a loot generator that *uses* the builder.

## Related

- [Factory](./factory) — creates whole objects in one call. A builder assembles them step by step.
- [Prototype](./prototype) — copies a finished example instead of assembling one.
- [Weighted Random & Loot Tables](./weighted-random) and [Seeded Randomness](./seeded-randomness) — random parts, reproducibly.
- [Stat & Modifier System](./stat-modifier-system) — affixes usually become stat modifiers.
