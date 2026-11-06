# RPG Character Sheet

> Stats from gear, buffs and talents that update the UI only when something changes.

## Goal

The character screen of an RPG or ARPG:

- Final stats combine base values, **equipment**, **buffs** and **derived rules** such as "+10 max health per point of Vitality".
- Equipping, unequipping or a buff expiring always returns stats to exactly the right value, in any order.
- The UI shows each stat and a **tooltip breakdown** ("Damage 47 = 20 base + 15 Iron Sword, +35%…").
- Equipping a full gear set changes dozens of modifiers but **recalculates and redraws once**, not dozens of times.
- Item stats are defined once per item type, not copied into every dropped item.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Stat & Modifier System](../patterns/stat-modifier-system) | Every stat is a base value plus a list of tagged modifiers, applied in a fixed order. Nothing ever adds to a stat directly. |
| [Flyweight](../patterns/flyweight) | `ItemDefinition` assets hold names, icons and modifier lists once. Each item instance only references its definition. |
| [Dirty Flag](../patterns/dirty-flag) | Stats recalculate lazily, only when read after a change. The UI also marks itself dirty and redraws once per frame at most. |
| [Observer](../patterns/observer) | Stats raise `Changed`. The UI and derived-stat rules subscribe, so nothing polls and the stat code knows nothing about UI. |

## How they fit together

```
ItemDefinition (Flyweight)          CharacterStats                         UI
 ├─ name, icon                      ┌─────────────────────────────────┐    ┌─────────────────────────┐
 └─ modifiers ──equip──────────────►│ Stat Strength  [mods…] dirty?   │    │ StatRow                 │
                                    │ Stat Vitality  [mods…] dirty? ──┼─Changed─► mark UI dirty     │
Buffs ──────add/remove by source───►│ Stat MaxHealth [mods…] dirty? ◄─┐  │ LateUpdate: if dirty,   │
                                    │                                 │  │   read Value once,      │
Derived rule ◄──Vitality.Changed────┼─────────────────────────────────┘  │   redraw                │
(+10 MaxHealth per Vitality)        └─────────────────────────────────┘  └─────────────────────────┘
```

- **Observer ↔ Dirty Flag.** `Changed` tells listeners that a value is *stale*, not what the new value is. Firing it costs almost nothing, and the recalculation happens once, when someone actually reads `Value`. This is what keeps equipping ten items cheap.
- **Dirty Flag at two levels.** Stats cache their computed value, and the UI caches "needs redraw". Twenty `Changed` events in one frame become one redraw in `LateUpdate`.
- **Flyweight ↔ Stat & Modifier System.** Item definitions describe *which* modifiers an item grants. Equipping creates modifiers whose **source** is the item instance, so unequipping removes exactly those, even if two identical swords are equipped.
- **Observer ↔ Stat & Modifier System.** Derived stats are ordinary modifiers owned by a rule. The rule listens to its input stat and replaces its modifier when the input changes.

## Example (Unity C#)

### Stats and modifiers

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

public enum StatType { Strength, Vitality, Damage, MaxHealth, Armor }
public enum ModType { Flat = 100, PercentAdd = 200, PercentMult = 300 }

public readonly struct StatModifier
{
    public readonly float Value;
    public readonly ModType Type;
    public readonly object Source;       // item instance, buff, rule... used for removal and tooltips
    public readonly string Label;

    public StatModifier(float value, ModType type, object source, string label)
    {
        Value = value; Type = type; Source = source; Label = label;
    }
}

public class Stat
{
    readonly List<StatModifier> modifiers = new();
    readonly float baseValue;
    float cached;
    bool dirty = true;                   // Dirty Flag

    public event Action Changed;         // Observer

    public Stat(float baseValue) => this.baseValue = baseValue;

    public float Base => baseValue;
    public IReadOnlyList<StatModifier> Modifiers => modifiers;

    public float Value
    {
        get
        {
            if (dirty) { cached = Calculate(); dirty = false; }
            return cached;
        }
    }

    public void Add(StatModifier m) { modifiers.Add(m); MarkDirty(); }

    public void RemoveAllFrom(object source)
    {
        if (modifiers.RemoveAll(m => m.Source == source) > 0) MarkDirty();
    }

    void MarkDirty()
    {
        bool wasClean = !dirty;
        dirty = true;
        if (wasClean) Changed?.Invoke();   // notify once until someone reads the new value
    }

    float Calculate()
    {
        float flat = 0f, percentAdd = 0f, mult = 1f;
        foreach (var m in modifiers)
        {
            if (m.Type == ModType.Flat) flat += m.Value;
            else if (m.Type == ModType.PercentAdd) percentAdd += m.Value;
            else mult *= 1f + m.Value;
        }
        return (float)Math.Round((baseValue + flat) * (1f + percentAdd) * mult, 4);
    }
}
```

`MarkDirty` notifies only on the clean → dirty transition. Ten modifiers added before anyone reads the stat produce **one** `Changed` event.

### Items as flyweights, equipment as modifier sources

```csharp
[Serializable]
public struct ItemModifier
{
    public StatType stat;
    public ModType type;
    public float value;
}

[CreateAssetMenu(menuName = "RPG/Item Definition")]
public class ItemDefinition : ScriptableObject        // Flyweight: shared, read-only
{
    public string displayName;
    public Sprite icon;
    public List<ItemModifier> modifiers = new();
}

public class ItemInstance                             // per drop: just a reference + own state
{
    public readonly ItemDefinition Definition;
    public int Durability = 100;
    public ItemInstance(ItemDefinition definition) => Definition = definition;
}

public class CharacterStats
{
    readonly Dictionary<StatType, Stat> stats = new();

    public CharacterStats()
    {
        stats[StatType.Strength]  = new Stat(10);
        stats[StatType.Vitality]  = new Stat(10);
        stats[StatType.Damage]    = new Stat(5);
        stats[StatType.MaxHealth] = new Stat(100);
        stats[StatType.Armor]     = new Stat(0);

        // Derived rules: ordinary modifiers, refreshed when their input changes.
        AddDerived(StatType.Vitality, StatType.MaxHealth, perPoint: 10f, label: "from Vitality");
        AddDerived(StatType.Strength, StatType.Damage,    perPoint: 0.5f, label: "from Strength");
    }

    public Stat this[StatType type] => stats[type];

    public void Equip(ItemInstance item)
    {
        foreach (var m in item.Definition.modifiers)
            stats[m.stat].Add(new StatModifier(m.value, m.type, item, item.Definition.displayName));
    }

    public void Unequip(ItemInstance item)
    {
        foreach (var stat in stats.Values)
            stat.RemoveAllFrom(item);              // removes exactly this instance's modifiers
    }

    void AddDerived(StatType from, StatType to, float perPoint, string label)
    {
        var rule = new object();                   // the rule is the modifier's source
        void Refresh()
        {
            stats[to].RemoveAllFrom(rule);
            stats[to].Add(new StatModifier(stats[from].Value * perPoint, ModType.Flat, rule, label));
        }
        stats[from].Changed += Refresh;            // Observer: recompute when the input changes
        Refresh();
    }
}
```

Derived rules read the input's `Value` inside the event, so their recalculation is immediate rather than lazy. That is acceptable because there are only a few rules, and it keeps the dependent stat correct for anyone who reads it next.

### UI that redraws once per frame at most

```csharp
public class StatRow : MonoBehaviour
{
    [SerializeField] StatType type;
    [SerializeField] TMPro.TMP_Text valueLabel;
    [SerializeField] TMPro.TMP_Text tooltip;

    Stat stat;
    bool uiDirty = true;                           // Dirty Flag at the UI level

    public void Bind(CharacterStats character)
    {
        if (stat != null) stat.Changed -= OnChanged;
        stat = character[type];
        stat.Changed += OnChanged;                 // Observer
        uiDirty = true;
    }

    void OnDestroy() { if (stat != null) stat.Changed -= OnChanged; }

    void OnChanged() => uiDirty = true;            // cheap: no recalculation, no redraw

    void LateUpdate()
    {
        if (!uiDirty || stat == null) return;
        uiDirty = false;

        valueLabel.text = Mathf.RoundToInt(stat.Value).ToString();   // recalculates here, once

        var sb = new System.Text.StringBuilder($"{type}: {stat.Value:0.#}\n  {stat.Base:0.#} base");
        foreach (var m in stat.Modifiers)
        {
            string amount = m.Type == ModType.Flat ? $"{m.Value:+0.#;-0.#}" : $"{m.Value:+0%;-0%}";
            string kind = m.Type == ModType.PercentMult ? " (multiplicative)" : "";
            sb.Append($"\n  {amount} {m.Label}{kind}");
        }
        tooltip.text = sb.ToString();
    }
}
```

## Where the patterns meet: pitfalls

- **Notifying with the new value.** If `Changed` passed the recalculated value, every event would force a recalculation and the dirty flag would be pointless. Notify *that* something changed, and let readers pull the value.
- **Notify-once needs a read to re-arm.** With the clean → dirty rule, a stat that nobody reads never notifies again. Every listener that needs future events must read `Value` when it handles one. `StatRow` does this in `LateUpdate`, and derived rules do it immediately.
- **Derived-stat cycles.** "+1% damage per armor" plus "+1 armor per damage" loop forever through `Changed`. Keep derived rules a one-way dependency graph, and assert it in development builds.
- **Modifiers keyed by definition instead of instance.** Using the `ItemDefinition` as the source means unequipping one of two identical rings removes the bonuses of both. Use the instance.
- **Mutating the flyweight.** "Upgrading" an item by editing `definition.modifiers` upgrades every copy, and changes the asset permanently in the editor. Per-item upgrades belong in `ItemInstance`, as extra modifiers it contributes.
- **Leaking subscriptions.** UI rows that do not unsubscribe keep stats alive and receive events after they are destroyed. Unsubscribe in `OnDestroy` or `OnDisable`.

## Variations

- **Buffs with duration:** a [status effect](../patterns/status-effects) system adds modifiers with the buff as source and removes them on expiry.
- **Comparison tooltips:** clone the modifier lists, apply the hovered item, and show the difference without touching the real stats.
- **Clamped stats:** apply caps (for example, resistance ≤ 75%) to the final value only, and show the uncapped value in the tooltip.
- **Networked stats:** replicate base values and modifier sources, and recalculate on each client with the same code.
