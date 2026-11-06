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

## Example (Unity C#)

```csharp
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
// var sword = new WeaponBuilder()
//     .WithBase(longsword).WithRarity(Rarity.Rare).AtLevel(20)
//     .AddAffix(blazing)                       // guaranteed affix for a quest reward
//     .WithRandomAffixes(affixTable, rng)      // the rest random
//     .Build();                                 // "Blazing Longsword of the Fox", 3-4 affixes
```

`WeaponBase`, `Affix` and `AffixTable` are data assets (see [Type Object](./type-object) and [Weighted Random](./weighted-random)). Builders also appear elsewhere in games: procedural mesh builders, network packet builders, dungeon builders, and test-data builders that make unit tests readable.

## When to use

- Objects with many optional parts, or rules about which parts combine: generated items, characters, levels, meshes, network messages.
- When the same assembly logic is needed in several places.
- Test setups: `new PlayerBuilder().WithHealth(1).WithItem(potion).Build()` keeps tests short and focused.

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
