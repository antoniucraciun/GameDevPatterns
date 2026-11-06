# Damage Pipeline

> Run a damage event through ordered stages: mitigation, crits, shields, reactions.

**Category:** Gameplay Systems

## Problem

Damage rules accumulate: critical hits, armour, fire resistance, a shield that absorbs damage first, an "immune to poison" buff, a curse that doubles damage taken, lifesteal, thorns, and "the first hit after stealth deals triple". Each rule is implemented where someone happened to need it, some in the weapon, some in `Health`, some in a buff. The order is accidental, so armour sometimes applies before the crit multiplier and sometimes after, and players see inconsistent numbers. Nobody can explain why a hit dealt 37 damage.

## Solution

Treat every hit as a **`DamageInfo` flowing through an ordered list of stages**. Each stage can **modify** the damage, **cancel** it, or **react** to it, and stages run in a fixed, documented order:

| Order | Stage | Example |
| --- | --- | --- |
| 100 | **Attacker modifiers** | Strength scaling, "+20% fire damage", crit roll |
| 200 | **Immunity** | Invulnerable, immune to poison: cancel |
| 300 | **Resistances** | Fire resistance 30% |
| 400 | **Armour** | Flat or percentage reduction of physical damage |
| 500 | **Damage-taken modifiers** | Curse: +50% damage taken |
| 600 | **Shields** | Absorb up to the shield's remaining amount |
| 700 | **Apply to health** | `Health.TakeDamage` |
| 800 | **Reactions** | Lifesteal, thorns, on-hit status effects, combo counters |

Stages come from many places: the attacker's buffs, the target's equipment, global rules. Each registers with an order number, so adding a new rule never requires editing the others. Every stage can also write a line to a **breakdown**, so tooltips, combat logs and debugging can show exactly how 100 became 37.

## Example (Unity C#)

```csharp
using System.Collections.Generic;
using UnityEngine;

public class DamageContext
{
    public DamageInfo Info;                   // from the Health / Damageable page
    public GameObject Target;
    public bool Cancelled;
    public readonly List<string> Breakdown = new();

    public void Log(string line) => Breakdown.Add(line);
}

public interface IDamageStage
{
    int Order { get; }
    void Process(DamageContext ctx);
}

public class DamagePipeline
{
    readonly List<IDamageStage> stages = new();

    public void Add(IDamageStage stage)
    {
        stages.Add(stage);
        stages.Sort((a, b) => a.Order.CompareTo(b.Order));    // stable order regardless of registration time
    }

    public void Remove(IDamageStage stage) => stages.Remove(stage);

    public DamageContext Run(DamageInfo info, GameObject target)
    {
        var ctx = new DamageContext { Info = info, Target = target };
        ctx.Log($"{info.Amount:0.#} {info.Type} from {(info.Source ? info.Source.name : "unknown")}");
        foreach (var stage in stages)
        {
            if (ctx.Cancelled) break;
            stage.Process(ctx);
        }
        return ctx;
    }
}
```

Typical stages:

```csharp
public class CritStage : IDamageStage
{
    public int Order => 100;
    readonly float chance, multiplier;
    public CritStage(float chance, float multiplier) { this.chance = chance; this.multiplier = multiplier; }

    public void Process(DamageContext ctx)
    {
        if (Random.value >= chance) return;
        ctx.Info.Amount *= multiplier;
        ctx.Info.IsCritical = true;
        ctx.Log($"crit ×{multiplier} → {ctx.Info.Amount:0.#}");
    }
}

public class ImmunityStage : IDamageStage
{
    public int Order => 200;
    readonly StatusEffectContainer effects;               // from the Status Effects page
    public ImmunityStage(StatusEffectContainer effects) => this.effects = effects;

    public void Process(DamageContext ctx)
    {
        if (effects.HasTag("Invulnerable") || (ctx.Info.Type == DamageType.Poison && effects.HasTag("PoisonImmune")))
        {
            ctx.Cancelled = true;
            ctx.Log("immune");
        }
    }
}

public class ResistanceStage : IDamageStage
{
    public int Order => 300;
    readonly Dictionary<DamageType, float> resist;        // 0.3 = 30% less
    public ResistanceStage(Dictionary<DamageType, float> resist) => this.resist = resist;

    public void Process(DamageContext ctx)
    {
        if (ctx.Info.Type == DamageType.True || !resist.TryGetValue(ctx.Info.Type, out var r)) return;
        ctx.Info.Amount *= 1f - Mathf.Clamp(r, -1f, 0.9f);      // cap at 90%; negative = weakness
        ctx.Log($"{r:P0} {ctx.Info.Type} resist → {ctx.Info.Amount:0.#}");
    }
}

public class ArmourStage : IDamageStage
{
    public int Order => 400;
    readonly Stat armour;                                  // from the Stat & Modifier System page
    public ArmourStage(Stat armour) => this.armour = armour;

    public void Process(DamageContext ctx)
    {
        if (ctx.Info.Type != DamageType.Physical) return;
        float factor = 100f / (100f + armour.Value);       // diminishing returns: 100 armour = half damage
        ctx.Info.Amount *= factor;
        ctx.Log($"armour {armour.Value:0} → {ctx.Info.Amount:0.#}");
    }
}

public class ShieldStage : IDamageStage
{
    public int Order => 600;
    public float Shield;

    public void Process(DamageContext ctx)
    {
        float absorbed = Mathf.Min(Shield, ctx.Info.Amount);
        if (absorbed <= 0f) return;
        Shield -= absorbed;
        ctx.Info.Amount -= absorbed;
        ctx.Log($"shield absorbed {absorbed:0.#} → {ctx.Info.Amount:0.#}");
        if (ctx.Info.Amount <= 0f) ctx.Cancelled = true;
    }
}

public class ApplyToHealthStage : IDamageStage
{
    public int Order => 700;
    readonly Health health;
    public ApplyToHealthStage(Health health) => this.health = health;
    public void Process(DamageContext ctx) => health.TakeDamage(ctx.Info);
}

public class ThornsStage : IDamageStage
{
    public int Order => 800;
    readonly float reflect;
    public ThornsStage(float reflect) => this.reflect = reflect;

    public void Process(DamageContext ctx)
    {
        if (ctx.Info.Type == DamageType.True) return;      // reflected damage is True damage: never reflect it again
        if (ctx.Info.Source == null || !ctx.Info.Source.TryGetComponent(out IDamageable attacker)) return;
        attacker.TakeDamage(new DamageInfo { Amount = ctx.Info.Amount * reflect, Type = DamageType.True, Source = ctx.Target });
    }
}
```

Each character owns its pipeline, and the `IDamageable` entry point routes through it:

```csharp
public class DamageReceiver : MonoBehaviour, IDamageable
{
    public DamagePipeline Pipeline { get; } = new();
    Health health;

    public bool IsAlive => health.IsAlive;

    void Awake()
    {
        health = GetComponent<Health>();
        Pipeline.Add(new ApplyToHealthStage(health));
        // Equipment, buffs and passives add and remove their own stages at runtime.
    }

    public void TakeDamage(DamageInfo info)
    {
        var result = Pipeline.Run(info, gameObject);
        if (Debug.isDebugBuild) Debug.Log(string.Join("\n  ", result.Breakdown));
    }
}
```

Attacker-side stages (crit, damage bonuses) can live in a second pipeline on the attacker that runs before the target's, or be applied when the `DamageInfo` is created.

## When to use

- RPGs, ARPGs, MOBAs, roguelikes and any game with resistances, armour, shields or on-hit effects.
- When combat numbers must be explainable to players (tooltips, combat logs) or to designers (balance).

## Pitfalls

- **Ambiguous ordering.** "Armour before or after crit?" changes the numbers a lot. Choose the order once, document it next to the stage orders, and test it.
- **Reaction loops.** Thorns reflecting thorns reflecting thorns. Mark reflected damage (a flag, or `DamageType.True` that reaction stages ignore), and never let reactions trigger reactions of the same kind.
- **Stages that outlive their source.** An unequipped shield that never removes its stage keeps absorbing damage. Remove stages in the same place they are added, keyed by source, as with stat modifiers.
- **Randomness in many stages.** Crits rolled in two places double-dip. Keep each random roll in exactly one stage.
- **Cost.** A list sort on every `Add` is fine when stages change rarely. For effects added every frame, insert in place instead of sorting.

## Related

- [Health / Damageable Interface](./health-component) — the entry point and the final stage.
- [Stat & Modifier System](./stat-modifier-system) — armour, resistances and damage bonuses are stats.
- [Status Effects](./status-effects) — buffs and debuffs add and remove stages, and reactions apply effects.
- [Gameplay Tags](./tags) — immunities and conditions expressed as tags.
- [Chain of Responsibility](./chain-of-responsibility) — the classic pattern behind passing a request along ordered handlers.
