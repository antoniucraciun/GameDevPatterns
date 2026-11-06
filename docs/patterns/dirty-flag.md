# Dirty Flag

> Defer expensive recalculation until a result is actually needed.

**Category:** Performance & Memory

## Problem

A character's final stats depend on base values, equipment, buffs and talents. Recomputing them every frame wastes work, because they change only a few times a minute. Recomputing them on every change is also wasteful: equipping a full gear set triggers ten recalculations when only the last one matters.

## Solution

Store the derived value in a cache, together with a boolean **dirty flag**. Whenever an input changes, set the flag; do not recompute. When someone reads the derived value, recompute it only if the flag is set, then clear the flag. Many changes between reads collapse into one recalculation, and if nothing reads the value, nothing is computed.

## Example (Unity C#)

```csharp
public enum ModType { Flat, Percent }
public readonly struct StatModifier
{
    public readonly ModType Type;
    public readonly float Value;
    public StatModifier(ModType type, float value) { Type = type; Value = value; }
}

public class CharacterStats
{
    readonly List<StatModifier> modifiers = new();
    float baseDamage = 10f;

    float cachedDamage;
    bool dirty = true;

    public float BaseDamage
    {
        get => baseDamage;
        set { baseDamage = value; dirty = true; }
    }

    public void AddModifier(StatModifier m)    { modifiers.Add(m); dirty = true; }
    public void RemoveModifier(StatModifier m) { modifiers.Remove(m); dirty = true; }

    public float Damage
    {
        get
        {
            if (dirty)
            {
                cachedDamage = Recalculate();
                dirty = false;
            }
            return cachedDamage;
        }
    }

    float Recalculate()
    {
        float flat = 0f, percent = 0f;
        foreach (var m in modifiers)
        {
            if (m.Type == ModType.Flat) flat += m.Value;
            else percent += m.Value;
        }
        return (baseDamage + flat) * (1f + percent);
    }
}
```

Unity uses this pattern internally. Transform world matrices are recomputed only when a parent changes, and UI layout is rebuilt only for elements marked dirty.

## When to use

- A derived value is expensive to compute, its inputs change less often than it is read, or many changes happen between reads.
- Hierarchies such as transforms, UI layout and navigation meshes, where a change in one node invalidates its descendants.

## When not to use

- Values that are cheap to compute. Recomputing every time is simpler and never stale.
- Values that change every frame anyway. The flag is always set, so it saves nothing.
- When many places change the inputs. Forgetting to set the flag in one of them leaves stale data that is hard to track down.

## Pitfalls

- **Forgetting to set the flag** on one of the input paths gives you stale results that are hard to track down. Route every mutation through one place.
- **Unpredictable cost.** The recomputation happens on whatever read comes first, which may be in a hot loop. Sometimes it is better to recompute at a known time, such as end of frame.
- **Not worth it for cheap calculations.** The flag and the branch can cost more than recomputing.

## Related

- [Stat & Modifier System](./stat-modifier-system) — the classic consumer of this pattern.
- [Memoization / Caching](./memoization) — caches by input values rather than with an invalidation flag.
- [Observer](./observer) — can be used to mark dependants dirty.
