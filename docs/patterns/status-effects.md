# Status Effects

> Timed buffs and debuffs with stacking, refresh and tick rules.

**Also known as:** Buffs/Debuffs · **Category:** Gameplay Systems

## Problem

Poison deals damage every second for 6 seconds. Haste gives +30% move speed for 10 seconds. A stun prevents acting. Then the questions start. What happens when poison is applied again while active: reset the timer, add the durations, or stack the damage? Can two players' poisons both tick? What removes "all debuffs"? Implemented as ad-hoc coroutines and boolean fields, every new effect adds special cases. Modifiers are left behind when an effect ends early, and nobody can show the player what is currently affecting them.

## Solution

Separate **what an effect is** from **an effect currently applied**:

- **`StatusEffectDefinition`** (a [Type Object](./type-object)): name, icon, duration, tick interval, stacking policy, max stacks, stat modifiers, per-tick action, and tags such as `Debuff` or `Stun`.
- **`ActiveEffect`**: one application on one target, with its remaining time, stack count, next tick time and source.
- **`StatusEffectContainer`** on each target: applies new effects according to the stacking policy, ticks them, and removes expired ones, which undoes their modifiers.

Make the **stacking policy** an explicit choice per definition:

| Policy | Re-applying while active… | Typical use |
| --- | --- | --- |
| **Refresh** | Resets the remaining duration | Slows, most buffs |
| **Extend** | Adds the new duration to the remaining one | Fire that burns longer |
| **Stack intensity** | Adds a stack (up to a maximum) and refreshes duration | Bleed, poison that gets worse |
| **Independent** | Creates a separate instance, one per source | DoTs from different players |
| **Ignore** | Does nothing | Immunity windows, unique effects |

## Example (Unity C#)

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

public enum StackPolicy { Refresh, Extend, StackIntensity, Independent, Ignore }

[CreateAssetMenu(menuName = "Effects/Status Effect")]
public class StatusEffectDefinition : ScriptableObject
{
    public string displayName;
    public Sprite icon;
    public float duration = 5f;
    public float tickInterval = 1f;             // 0 = no ticking
    public StackPolicy stacking = StackPolicy.Refresh;
    public int maxStacks = 1;
    public string[] tags;                       // e.g. "Debuff", "Stun", "Poison"

    [Header("Per tick (multiplied by stacks)")]
    public int damagePerTick;

    [Header("While active (multiplied by stacks)")]
    public float moveSpeedPercent;              // e.g. -0.3 for a 30% slow

    public bool HasTag(string tag) => Array.IndexOf(tags, tag) >= 0;
}

public class ActiveEffect
{
    public readonly StatusEffectDefinition Definition;
    public readonly object Source;              // who applied it: used by Independent stacking
    public float Remaining;
    public int Stacks = 1;
    public float NextTick;

    public ActiveEffect(StatusEffectDefinition def, object source)
    {
        Definition = def; Source = source;
        Remaining = def.duration;
        NextTick = def.tickInterval;
    }
}

public class StatusEffectContainer : MonoBehaviour
{
    readonly List<ActiveEffect> active = new();
    Health health;                              // something that can take damage
    CharacterStats stats;                       // see the Stat & Modifier System pattern

    public IReadOnlyList<ActiveEffect> Active => active;
    public event Action Changed;                // UI icons, VFX

    public void Init(Health health, CharacterStats stats) { this.health = health; this.stats = stats; }

    public bool HasTag(string tag) => active.Exists(e => e.Definition.HasTag(tag));

    public void Apply(StatusEffectDefinition def, object source)
    {
        var existing = def.stacking == StackPolicy.Independent
            ? active.Find(e => e.Definition == def && e.Source == source)
            : active.Find(e => e.Definition == def);

        if (existing == null)
        {
            var effect = new ActiveEffect(def, source);
            active.Add(effect);
            ApplyModifiers(effect);
        }
        else
        {
            switch (def.stacking)
            {
                case StackPolicy.Refresh:
                case StackPolicy.Independent:          // same source re-applies: refresh its instance
                    existing.Remaining = def.duration;
                    break;
                case StackPolicy.Extend:
                    existing.Remaining += def.duration;
                    break;
                case StackPolicy.StackIntensity:
                    existing.Stacks = Mathf.Min(existing.Stacks + 1, def.maxStacks);
                    existing.Remaining = def.duration;
                    ApplyModifiers(existing);           // re-apply with the new stack count
                    break;
                case StackPolicy.Ignore:
                    return;
            }
        }
        Changed?.Invoke();
    }

    public void RemoveWhere(Predicate<ActiveEffect> match)   // e.g. cleanse: e => e.Definition.HasTag("Debuff")
    {
        for (int i = active.Count - 1; i >= 0; i--)
            if (match(active[i])) Remove(i);
        Changed?.Invoke();
    }

    void Update()
    {
        float dt = Time.deltaTime;
        bool changed = false;

        for (int i = active.Count - 1; i >= 0; i--)
        {
            var e = active[i];
            var def = e.Definition;

            if (def.tickInterval > 0f)
            {
                e.NextTick -= dt;
                while (e.NextTick <= 0f && e.Remaining > 0f)    // catch up after long frames
                {
                    health.TakeDamage(def.damagePerTick * e.Stacks);
                    e.NextTick += def.tickInterval;
                }
            }

            if ((e.Remaining -= dt) <= 0f) { Remove(i); changed = true; }
        }

        if (changed) Changed?.Invoke();
    }

    void ApplyModifiers(ActiveEffect e)
    {
        stats[StatType.MoveSpeed].RemoveAllFrom(e);            // the effect instance is the source
        if (e.Definition.moveSpeedPercent != 0f)
            stats[StatType.MoveSpeed].Add(new StatModifier(
                e.Definition.moveSpeedPercent * e.Stacks, ModType.PercentAdd, e, e.Definition.displayName));
    }

    void Remove(int index)
    {
        var e = active[index];
        stats[StatType.MoveSpeed].RemoveAllFrom(e);            // nothing is left behind
        active.RemoveAt(index);
    }
}

// Elsewhere: gameplay checks tags instead of bespoke booleans.
// if (target.Effects.HasTag("Stun")) return;   // can't act
```

`CharacterStats`, `StatModifier` and `ModType` are from the [RPG Character Sheet](../recipes/rpg-character-sheet) recipe, with a `MoveSpeed` entry added to `StatType`.

## When to use

- Any game with buffs, debuffs, damage-over-time, crowd control, auras or temporary power-ups.
- When designers need to create effects without code, and players need to see what affects them.

## When not to use

- A single temporary effect, such as an invincibility timer after being hit. A timer field is enough.
- Effects that only change numbers. A [Stat & Modifier System](./stat-modifier-system) entry with a duration may be all you need.

## Pitfalls

- **Leftover modifiers.** Every path that ends an effect (expiry, cleanse, death, removal of the target) must remove its modifiers. Funnel all of them through one `Remove` method, and tag modifiers with the effect instance as source.
- **Ticks tied to frame rate.** Decrementing by `deltaTime` without a catch-up loop loses ticks on long frames, and ticking in `Update` makes long poisons frame-rate dependent. Use the accumulator above, or tick on a fixed step.
- **Undefined stacking.** "What happens on re-apply?" must be decided per effect and visible to designers, not left to whatever the code happens to do.
- **Effects outliving their source.** An aura should end when its caster dies. Store the source, and remove its effects when the source goes away.
- **Order-dependent interactions.** Rules like "frozen + fire = shatter" belong in one explicit interaction step, not scattered across `Apply` calls.

## Related

- [Stat & Modifier System](./stat-modifier-system) — effects contribute modifiers tagged with themselves as source.
- [Type Object](./type-object) — effect definitions are kinds defined as data.
- [Ability System](./ability-system) — abilities apply effects to targets.
- [Observer](./observer) — `Changed` drives the buff bar and VFX.
- [Gameplay Tags](./tags) — hierarchical tags such as `Debuff.Poison` make queries like "remove all debuffs" simple.
