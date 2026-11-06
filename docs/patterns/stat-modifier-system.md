# Stat & Modifier System

> Compute final stats from a base value plus ordered flat, additive and multiplicative modifiers.

**Category:** Gameplay Systems

## Problem

A character's damage comes from a base value, a sword (+15), a ring (+10%), a rage buff (+25%) and a curse (×0.5). The bonuses are added and removed at different times, by different systems. If each system adds or subtracts directly from a `damage` field, removing them in a different order gives a different result. Percentage bonuses compound inconsistently, and one missed subtraction leaves the character permanently stronger. Nobody can answer "why is my damage 47?".

## Solution

Never mutate the stat. Store a **base value** and a list of **modifiers**. Each modifier has a value, a type, and a **source** (the item, buff or talent that applied it). The final value is always *derived* by applying the modifiers in a fixed order. A common order is:

1. **Flat:** `base + sum(flat)` (the sword's +15).
2. **Percent additive:** `× (1 + sum(percentAdd))`. The ring's +10% and rage's +25% give ×1.35. Bonuses from the same pool do not compound.
3. **Percent multiplicative:** `× each(percentMult)`. The curse's ×0.5 applies on its own.

Removing a modifier is just removing it from the list. Removing everything from one source, when an item is unequipped or a buff expires, is a single call. Because the result is always recalculated from scratch, the order in which modifiers were added and removed cannot change it.

## Example (Unity C#)

```csharp
public enum ModType { Flat = 100, PercentAdd = 200, PercentMult = 300 }   // value = application order

public sealed class StatModifier
{
    public readonly float Value;
    public readonly ModType Type;
    public readonly object Source;   // the item, buff or talent that applied it

    public StatModifier(float value, ModType type, object source)
    {
        Value = value; Type = type; Source = source;
    }
}

public class Stat
{
    readonly List<StatModifier> modifiers = new();
    float baseValue;
    float cached;
    bool dirty = true;

    public event System.Action<Stat> Changed;

    public Stat(float baseValue) => this.baseValue = baseValue;

    public float BaseValue
    {
        get => baseValue;
        set { baseValue = value; MarkDirty(); }
    }

    public float Value
    {
        get
        {
            if (dirty) { cached = Calculate(); dirty = false; }
            return cached;
        }
    }

    public void Add(StatModifier mod) { modifiers.Add(mod); MarkDirty(); }

    public void RemoveAllFrom(object source)
    {
        if (modifiers.RemoveAll(m => m.Source == source) > 0) MarkDirty();
    }

    void MarkDirty() { dirty = true; Changed?.Invoke(this); }

    float Calculate()
    {
        float flat = 0f, percentAdd = 0f, mult = 1f;
        foreach (var m in modifiers)
        {
            switch (m.Type)
            {
                case ModType.Flat:        flat += m.Value; break;
                case ModType.PercentAdd:  percentAdd += m.Value; break;
                case ModType.PercentMult: mult *= 1f + m.Value; break;
            }
        }
        float result = (baseValue + flat) * (1f + percentAdd) * mult;
        return (float)System.Math.Round(result, 4);   // avoid 46.99999 from float drift
    }
}

// Usage
var damage = new Stat(20f);
damage.Add(new StatModifier(15f,   ModType.Flat,        sword));
damage.Add(new StatModifier(0.10f, ModType.PercentAdd,  ring));
damage.Add(new StatModifier(0.25f, ModType.PercentAdd,  rageBuff));
damage.Add(new StatModifier(-0.5f, ModType.PercentMult, curse));
// (20 + 15) × 1.35 × 0.5 = 23.625

damage.RemoveAllFrom(curse);   // 47.25, regardless of when the curse was applied
```

## When to use

- RPGs, roguelikes, ARPGs and survival games: anywhere equipment, buffs, talents and auras affect numbers.
- When the design needs to show players a breakdown of where a number comes from.

## Pitfalls

- **Undocumented stacking rules.** Designers must know whether two +10% bonuses make +20% or +21%. Pick the rules, write them down, and show them in tooltips.
- **Removing by value instead of by source.** Two items that both give +5 become indistinguishable. Always tag modifiers with their source.
- **Clamping too early.** Clamp the *final* value, such as minimum 0 or maximum 75% resistance, not intermediate sums.
- **Stats that depend on other stats**, such as "+1% crit per 10 agility". Recompute the dependent stat when its input fires `Changed`, and watch for cycles.

## Related

- [Dirty Flag](./dirty-flag) — avoids recalculating on every read.
- [Observer](./observer) — the `Changed` event lets UI and dependent stats update.
- [Flyweight](./flyweight) — shared definitions describe which modifiers an item grants.
