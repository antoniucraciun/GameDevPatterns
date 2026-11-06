# Data-Driven Abilities

> Designers create new abilities as assets: costs, cooldowns, effects and buffs without code.

## Goal

A spell and skill system for an RPG, MOBA or ARPG:

- A designer creates **"Frost Nova"** (damage around the caster, then chill everyone hit) and **"Shatter"** (bonus damage to chilled targets) entirely in the editor.
- Damage **scales with the caster's stats**, and buffs and gear change those stats without the ability knowing.
- Abilities have **cast times**. A press during a cast is **queued** and fires when the cast ends, instead of being dropped.
- Players and AI use the same abilities, through the same entry point, with the same rules.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Type Object](../patterns/type-object) | `AbilityDefinition` and `StatusEffectDefinition` assets *are* the kinds of abilities and effects. New kinds are new assets. |
| [Ability System](../patterns/ability-system) | Validation (cost, cooldown, blocking tags, range) and execution of a list of composable effects. |
| [Command](../patterns/command) | An activation request (`CastRequest`) is a value that can wait in a queue while a cast finishes, come from a player or an AI, or be sent to a server. |
| [Stat & Modifier System](../patterns/stat-modifier-system) | Effects read caster and target stats (`SpellPower`, `Armor`). Status effects and gear add modifiers to those stats. |
| [Status Effects](../patterns/status-effects) | "Chilled" slows the target *and* carries a tag that other abilities can react to. |

## How they fit together

```
 Player input ─┐                         Caster
 AI decision ──┴─► CastRequest ──► queue ─► AbilityRunner (Idle ⇄ Casting)
                   (Command)               │  validate: cost, cooldown, tags, range
                                           │  wait cast time
                                           ▼
                        AbilityDefinition.effects  (Type Object, composed in the editor)
                         ├─ AreaDamage   power × caster.SpellPower − target.Armor ◄── Stat & Modifier
                         ├─ ApplyStatus  Chilled ──► target: −30% MoveSpeed, tag "Chilled" ◄── Status Effects
                         └─ BonusIfTag   "Chilled": +50% damage  (Shatter)
```

The joins:

- **Command ↔ Ability System.** The runner never executes input directly. It *consumes* requests. That gives queuing during casts for free, and the same path for AI and for networked play.
- **Stat & Modifier ↔ Status Effects.** Chilled lowers `MoveSpeed` by adding a modifier whose source is the effect instance. Expiry removes it. The ability that applied Chilled knows nothing about stats.
- **Status Effects ↔ Ability System.** Tags are the shared vocabulary. Stun *blocks* abilities (`blockedByTags`), and Chilled *enables* Shatter's bonus (`BonusIfTag`). New interactions are new data, not new branches.
- **Type Object everywhere.** Abilities, effects and status effects are all assets, and abilities reference status effects by asset. A designer can build a new combo without a programmer.

## Example (Unity C#)

This builds on the code from [Ability System](../patterns/ability-system), [Status Effects](../patterns/status-effects) and the [RPG Character Sheet](./rpg-character-sheet) recipe (`CharacterStats`, `StatType`, `StatModifier`), and shows the parts that connect them.

### Effects that read stats and tags

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

// Shared formula: scales with the caster, mitigated by the target.
public static class DamageMath
{
    public static int Compute(float power, Character caster, Character target, float multiplier = 1f)
    {
        float raw = power * caster.Stats[StatType.SpellPower].Value / 100f * multiplier;
        float armor = target.Stats[StatType.Armor].Value;
        return Mathf.Max(1, Mathf.RoundToInt(raw * 100f / (100f + armor)));
    }
}

public struct CastContext
{
    public Character Caster;
    public Character Target;          // primary target (may be the caster)
    public AbilityDefinition Ability;
}

[Serializable] public abstract class AbilityEffect { public abstract void Apply(in CastContext ctx); }

[Serializable]
public class DamageEffect : AbilityEffect
{
    public float power = 100f;
    public override void Apply(in CastContext ctx) =>
        ctx.Target.Health.TakeDamage(DamageMath.Compute(power, ctx.Caster, ctx.Target));
}

[Serializable]
public class AreaEffect : AbilityEffect                         // runs nested effects on everyone in range
{
    public float radius = 5f;
    public bool enemiesOnly = true;
    [SerializeReference] public List<AbilityEffect> effects = new();

    static readonly Collider[] hits = new Collider[64];

    public override void Apply(in CastContext ctx)
    {
        int n = Physics.OverlapSphereNonAlloc(ctx.Caster.transform.position, radius, hits);
        for (int i = 0; i < n; i++)
        {
            if (!hits[i].TryGetComponent(out Character c) || c == ctx.Caster) continue;
            if (enemiesOnly && c.Team == ctx.Caster.Team) continue;
            var sub = new CastContext { Caster = ctx.Caster, Target = c, Ability = ctx.Ability };
            foreach (var e in effects) e.Apply(sub);
        }
    }
}

[Serializable]
public class ApplyStatusEffect : AbilityEffect
{
    public StatusEffectDefinition status;
    public override void Apply(in CastContext ctx) => ctx.Target.Effects.Apply(status, ctx.Caster);
}

[Serializable]
public class BonusIfTagEffect : AbilityEffect                   // the Shatter interaction, as data
{
    public string requiredTag = "Chilled";
    public float power = 80f;
    public float multiplierIfTagged = 1.5f;
    public bool consumeTag = true;

    public override void Apply(in CastContext ctx)
    {
        bool tagged = ctx.Target.Effects.HasTag(requiredTag);
        ctx.Target.Health.TakeDamage(DamageMath.Compute(power, ctx.Caster, ctx.Target,
                                                        tagged ? multiplierIfTagged : 1f));
        if (tagged && consumeTag)
            ctx.Target.Effects.RemoveWhere(e => e.Definition.HasTag(requiredTag));
    }
}
```

### Requests as commands, cast times, one entry point

```csharp
public readonly struct CastRequest                               // Command
{
    public readonly AbilityDefinition Ability;
    public readonly Character Target;
    public readonly float IssuedAt;
    public CastRequest(AbilityDefinition ability, Character target)
    {
        Ability = ability; Target = target; IssuedAt = Time.time;
    }
}

public class Character : MonoBehaviour
{
    public int Team;
    public Health Health { get; private set; }
    public StatusEffectContainer Effects { get; private set; }
    public CharacterStats Stats { get; } = new();
    public float Mana { get; private set; } = 100f;

    const float QueueWindow = 0.4f;                              // how long a queued request stays valid

    readonly Dictionary<AbilityDefinition, float> readyAt = new();
    CastRequest? queued;
    CastRequest? casting;
    float castEndsAt;

    public event Action<AbilityDefinition> CastStarted, CastFinished;   // animation, VFX, UI

    void Awake()
    {
        Health = GetComponent<Health>();
        Effects = GetComponent<StatusEffectContainer>();
        Effects.Init(Health, Stats);
    }

    // Players and AI both call this. Nothing executes directly.
    public void Request(AbilityDefinition ability, Character target) => queued = new CastRequest(ability, target);

    void Update()
    {
        if (casting is { } c)                                    // State: Casting
        {
            if (Effects.HasTag("Stun")) { casting = null; return; }   // interrupted
            if (Time.time < castEndsAt) return;
            casting = null;
            Execute(c);
        }

        if (queued is { } q)                                     // State: Idle, with a pending request
        {
            if (Time.time - q.IssuedAt > QueueWindow) { queued = null; return; }   // too old: drop it
            if (CanCast(q) != CastResult.Success) return;        // keep it until it becomes valid or expires
            queued = null;
            Begin(q);
        }
    }

    public enum CastResult { Success, OnCooldown, NotEnoughMana, Blocked, OutOfRange }

    public CastResult CanCast(in CastRequest r)
    {
        var a = r.Ability;
        if (readyAt.TryGetValue(a, out var t) && Time.time < t) return CastResult.OnCooldown;
        if (Mana < a.manaCost) return CastResult.NotEnoughMana;
        foreach (var tag in a.blockedByTags) if (Effects.HasTag(tag)) return CastResult.Blocked;
        if (r.Target && Vector3.Distance(transform.position, r.Target.transform.position) > a.range)
            return CastResult.OutOfRange;
        return CastResult.Success;
    }

    void Begin(CastRequest r)
    {
        Mana -= r.Ability.manaCost;                              // pay up front; refund on interrupt if you prefer
        readyAt[r.Ability] = Time.time + r.Ability.cooldown;
        CastStarted?.Invoke(r.Ability);

        if (r.Ability.castTime <= 0f) { Execute(r); return; }
        casting = r;
        castEndsAt = Time.time + r.Ability.castTime;
    }

    void Execute(CastRequest r)
    {
        var ctx = new CastContext { Caster = this, Target = r.Target ? r.Target : this, Ability = r.Ability };
        foreach (var effect in r.Ability.effects) effect.Apply(ctx);
        CastFinished?.Invoke(r.Ability);
    }
}
```

Compared with the [Ability System](../patterns/ability-system) page: `AbilityEffect` here takes a `CastContext` with `Character`s instead of `AbilityRunner`s, `Character` replaces `AbilityRunner`, and `AbilityDefinition` gains a `castTime` field. `StatType` needs `SpellPower`, `Armor` and `MoveSpeed` entries.

### What the designer builds (no code)

| Asset | Contents |
| --- | --- |
| **Chilled** (`StatusEffectDefinition`) | duration 4 s · stacking *Refresh* · `moveSpeedPercent` −0.3 · tags `Debuff`, `Chilled` |
| **Frost Nova** (`AbilityDefinition`) | mana 30 · cooldown 8 s · cast time 0 · effects: `AreaEffect` radius 6 → [`DamageEffect` power 60, `ApplyStatusEffect` Chilled] |
| **Shatter** (`AbilityDefinition`) | mana 20 · cooldown 3 s · cast time 0.5 s · range 20 · effects: `BonusIfTagEffect` "Chilled", power 80, ×1.5, consume |
| **Arcane Focus** (gear) | +25% `SpellPower`. Every ability above now hits harder, and none of them changed. |

## Where the patterns meet: pitfalls

- **Effects that hard-code stats.** `TakeDamage(20)` ignores gear and buffs. Route all numbers through one formula that reads stats, so balance changes happen in one place.
- **Snapshotting versus live stats.** Should a 5 s poison use the caster's spell power *when cast* or *each tick*? Decide per effect, and if you snapshot, store the value in the active effect.
- **Queued commands that outlive their meaning.** A request queued before a stun should not fire four seconds later. Give requests a short expiry, and re-validate when they are dequeued, as above.
- **Tag string typos.** `"Chilled"` versus `"Chiled"` silently breaks Shatter. Use asset-based [Gameplay Tags](../patterns/tags) with an inspector picker instead of free strings.
- **Recursive effects.** An `AreaEffect` containing an effect that triggers another area can cascade. Cap nesting depth, and keep `AreaEffect`'s hit buffer separate from any nested area's.
- **Networked play.** The server must validate `CastRequest`s, while clients predict the cast animation and cooldown. Commands make this natural: send the request, not the result.

## Variations

- **Projectiles:** a `SpawnProjectileEffect` whose projectile runs a second effect list on hit.
- **Channelled abilities:** effects applied every tick while a key is held, ending on release, stun or mana exhaustion.
- **Combo windows:** abilities that become available, or change, for a short time after another ability hits. This is a status effect on the *caster*, with a tag that the second ability requires.
- **AI with [Utility](../patterns/utility-ai) scoring:** AI picks the ability with the best score among those where `CanCast` succeeds, using the same assets as the player.
