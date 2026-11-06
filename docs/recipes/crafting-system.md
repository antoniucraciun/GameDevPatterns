# Crafting System

> Data-driven recipes, safe all-or-nothing crafting, quality rolls, and a crafting screen that shows what is missing.

## Goal

Crafting for a survival game or RPG:

- Designers add **recipes as data**: inputs, output, required station, and how skill affects quality.
- Crafting is **all or nothing**. Ingredients are never consumed if the result cannot be created (full bag, missing station).
- Crafted gear gets **quality and random bonuses** based on crafting skill and station level.
- The crafting screen lists recipes, shows **owned / required** counts for each ingredient, and greys out what cannot be crafted yet, with the reason.
- Crafting progresses **quests** ("Craft 3 iron swords") without the crafting code knowing about quests.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Data-Driven Design](../patterns/data-driven-design) | `CraftingRecipe` assets: ingredients, output, station and quality curve. |
| [Inventory](../patterns/inventory) | Counting ingredients, removing them, and adding the result. |
| [Builder](../patterns/builder) | Assembles the crafted item: base, quality tier, rolled bonuses, generated name. |
| [Quest System](../patterns/quest-system) | Listens for `ItemCrafted` events to progress objectives. |
| [MVC / MVP / MVVM](../patterns/mvp-mvvm) | The crafting screen: a presenter turns recipes and inventory state into rows, and the view only displays them. |

## How they fit together

```
 CraftingRecipe assets (Data-Driven) ──► Crafter.Check(recipe) ──► CraftCheck { canCraft, reason, counts }
                                              │ Inventory.CountOf per ingredient
                                              ▼
 Craft(recipe):  1. check everything        (ingredients, station, output space)
                 2. build the result        (Builder: quality from skill and station, bonuses, name)
                 3. remove ingredients      (Inventory.TryRemove, all of them)
                 4. add the result          (guaranteed to fit: checked in step 1)
                 5. publish ItemCrafted     (Event Bus → Quest System objectives)
                                              ▼
 CraftingPresenter (MVP) ── rows: name, icon, "Iron 3/5", reason ──► CraftingView (dumb)
          ▲ Inventory.Changed → refresh                          craft button → presenter.Craft(i)
```

The joins:

- **Inventory ↔ crafting transaction.** The order is the whole point: *check, build, remove, add*. Building before removing means a failed build costs nothing. Checking output space before removing means a full bag never eats ingredients.
- **Data-Driven Design ↔ Builder.** Recipes describe *what* to make and *how quality scales*. The builder knows *how* to assemble a valid item from that. New gear types need recipe assets, not code.
- **Quest System ↔ crafting.** Crafting publishes an `ItemCrafted` event, and collect-or-craft objectives listen to it. Crafting code never imports quest code.
- **MVP ↔ Inventory.** The presenter subscribes to `Inventory.Changed`, so picking up ore while the crafting screen is open immediately updates "Iron 4/5" to "Iron 5/5" and enables the button.

## Example (Unity C#)

This builds on `Container` and `ItemDefinition` ([Inventory](../patterns/inventory)), `WeaponBuilder` ([Builder](../patterns/builder)) and `EventBus` ([Event Bus](../patterns/event-bus)).

### Recipes as data

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

[Serializable]
public struct Ingredient { public ItemDefinition item; public int count; }

[CreateAssetMenu(menuName = "Crafting/Recipe")]
public class CraftingRecipe : ScriptableObject
{
    public string displayName;
    public List<Ingredient> ingredients = new();
    public ItemDefinition output;
    public int outputCount = 1;
    public string requiredStation = "Forge";             // empty = craft anywhere
    public int minStationLevel = 1;
    [Tooltip("x = crafting skill 0..100, y = chance of a higher-quality result")]
    public AnimationCurve qualityBySkill = AnimationCurve.Linear(0, 0, 100, 0.6f);
    public WeaponBase weaponBase;                        // set for gear: crafted through the Builder
}

public readonly struct ItemCrafted : IEvent
{
    public readonly string ItemId; public readonly int Count;
    public ItemCrafted(string id, int count) { ItemId = id; Count = count; }
}
```

### The crafter: check, build, remove, add, announce

```csharp
public enum CraftBlock { None, MissingIngredients, WrongStation, StationTooLow, NoSpace }

public struct CraftCheck
{
    public CraftBlock Block;
    public List<(ItemDefinition item, int have, int need)> Counts;
    public bool CanCraft => Block == CraftBlock.None;
}

public class Crafter
{
    readonly Container bag;
    readonly Func<int> craftingSkill;                     // from the stat system
    readonly System.Random rng;

    public Crafter(Container bag, Func<int> craftingSkill, System.Random rng)
    {
        this.bag = bag; this.craftingSkill = craftingSkill; this.rng = rng;
    }

    public CraftCheck Check(CraftingRecipe r, CraftingStation station)
    {
        var check = new CraftCheck { Counts = new() };
        foreach (var ing in r.ingredients)
        {
            int have = bag.CountOf(ing.item);
            check.Counts.Add((ing.item, have, ing.count));
            if (have < ing.count) check.Block = CraftBlock.MissingIngredients;
        }
        if (check.Block != CraftBlock.None) return check;

        if (!string.IsNullOrEmpty(r.requiredStation))
        {
            if (station == null || station.Kind != r.requiredStation) { check.Block = CraftBlock.WrongStation; return check; }
            if (station.Level < r.minStationLevel) { check.Block = CraftBlock.StationTooLow; return check; }
        }

        // Will the result fit once the ingredients are gone? Simulate on a copy, so the real bag isn't touched.
        var trial = bag.Clone();
        foreach (var ing in r.ingredients) trial.TryRemove(ing.item, ing.count);
        if (trial.TryAdd(r.output, r.outputCount) > 0) check.Block = CraftBlock.NoSpace;
        return check;
    }

    public bool TryCraft(CraftingRecipe r, CraftingStation station, out CraftCheck check)
    {
        check = Check(r, station);                        // 1. check everything first
        if (!check.CanCraft) return false;

        ItemStack result = BuildResult(r, station);       // 2. build: may roll quality and bonuses

        foreach (var ing in r.ingredients)                // 3. remove: known to succeed
            bag.TryRemove(ing.item, ing.count);

        bag.TryAdd(result.Definition, result.Count);      // 4. add: known to fit
        EventBus<ItemCrafted>.Publish(new ItemCrafted(r.output.id, r.outputCount));   // 5. announce
        return true;
    }

    ItemStack BuildResult(CraftingRecipe r, CraftingStation station)
    {
        if (r.weaponBase == null) return new ItemStack(r.output, r.outputCount);      // plain materials, potions

        // Gear: quality from skill and station, assembled by the Builder.
        float upgradeChance = r.qualityBySkill.Evaluate(craftingSkill()) + 0.05f * (station.Level - r.minStationLevel);
        var rarity = Rarity.Magic;
        while (rarity < Rarity.Epic && rng.NextDouble() < upgradeChance) rarity++;

        var weapon = new WeaponBuilder()
            .WithBase(r.weaponBase).WithRarity(rarity).AtLevel(craftingSkill() / 5 + 1)
            .WithRandomAffixes(AffixTables.Crafting, rng)
            .Build();
        return ItemStack.FromWeapon(r.output, weapon);    // stores the built weapon as instance data
    }
}
```

`Container.Clone()` (a shallow copy of the slots with new stack objects) and `ItemStack.FromWeapon` are small additions to the Inventory page's types. `CraftingStation` is a component with `Kind` and `Level`.

### The crafting screen presenter

```csharp
public interface ICraftingView
{
    void ShowRows(IReadOnlyList<CraftingRow> rows);
    event Action<int> CraftClicked;
}

public struct CraftingRow
{
    public string Name; public Sprite Icon; public string Ingredients;   // "Iron 3/5 · Coal 2/2"
    public bool Enabled; public string Reason;                          // "Needs a Forge (level 2)"
}

public class CraftingPresenter : IDisposable
{
    readonly IReadOnlyList<CraftingRecipe> recipes;
    readonly Crafter crafter; readonly Container bag; readonly ICraftingView view;
    readonly Func<CraftingStation> currentStation;

    public CraftingPresenter(IReadOnlyList<CraftingRecipe> recipes, Crafter crafter, Container bag,
                             ICraftingView view, Func<CraftingStation> currentStation)
    {
        this.recipes = recipes; this.crafter = crafter; this.bag = bag; this.view = view; this.currentStation = currentStation;
        bag.Changed += Refresh;
        view.CraftClicked += OnCraft;
        Refresh();
    }

    void OnCraft(int i) => crafter.TryCraft(recipes[i], currentStation(), out _);   // Refresh follows via bag.Changed

    void Refresh()
    {
        var rows = new List<CraftingRow>(recipes.Count);
        foreach (var r in recipes)
        {
            var check = crafter.Check(r, currentStation());
            var parts = new List<string>();
            foreach (var (item, have, need) in check.Counts) parts.Add($"{item.displayName} {have}/{need}");
            rows.Add(new CraftingRow
            {
                Name = r.displayName, Icon = r.output.icon, Ingredients = string.Join(" · ", parts),
                Enabled = check.CanCraft, Reason = ReasonText(check.Block, r),
            });
        }
        view.ShowRows(rows);
    }

    static string ReasonText(CraftBlock b, CraftingRecipe r) => b switch
    {
        CraftBlock.MissingIngredients => "Missing ingredients",
        CraftBlock.WrongStation => $"Needs a {r.requiredStation}",
        CraftBlock.StationTooLow => $"Needs a level {r.minStationLevel} {r.requiredStation}",
        CraftBlock.NoSpace => "Inventory full",
        _ => "",
    };

    public void Dispose() { bag.Changed -= Refresh; view.CraftClicked -= OnCraft; }
}
```

In a shipped game, the reason strings are [localisation keys](../patterns/localization-tables), not English text.

## Where the patterns meet: pitfalls

- **Removing before checking space.** The classic crafting bug: ingredients vanish and the sword does not appear because the bag was full. Check that the output fits *after* the ingredients are removed, before touching the real inventory.
- **Ingredients that are also outputs.** A recipe that consumes and produces the same item, or upgrades an item in place, breaks simple counting. Handle it explicitly, or forbid it in recipe validation.
- **Counting the wrong stacks.** Crafting must not consume equipped items, or items with durability or bonuses, as plain materials. Count only plain stacks, and exclude equipped slots.
- **Quest double-counting.** Publishing `ItemCrafted` *and* the inventory's "item added" event can both progress a "collect" objective. Decide which event each objective listens to.
- **Recomputing every recipe on every inventory change.** With hundreds of recipes, refreshing all rows for each picked-up pebble is wasteful. Refresh only visible rows, or mark the screen dirty and refresh once per frame.

## Variations

- **Discovery:** recipes unlock when the player first picks up an ingredient, or learns them from books. The presenter filters by a "known recipes" set.
- **Crafting time and queues:** a station processes a queue of craft orders over time, with the same check at enqueue and at completion.
- **Salvaging:** the inverse recipe returns some ingredients, with the same all-or-nothing transaction.
- **Multiplayer:** the client sends "craft recipe X at station Y", and the server runs `TryCraft` ([Authoritative Server](../patterns/authoritative-server)).
