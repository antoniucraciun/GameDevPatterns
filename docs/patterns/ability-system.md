# Ability System

> Data-driven abilities with costs, cooldowns, targeting and effects.

**Category:** Gameplay Systems

## Problem

The first abilities are each a method: `CastFireball()`, `CastHeal()`, `Dash()`. Each one repeats the same checks (enough mana? off cooldown? not stunned? target in range?) slightly differently, and slightly wrong in different ways. Enemies cannot reuse the player's abilities, the UI cannot show why a button is greyed out, and every new spell needs a programmer, even "Fireball, but ice, with a slow".

## Solution

Split an ability into **data** and a **runner**:

- **`AbilityDefinition`** (a [Type Object](./type-object)): name, icon, cost, cooldown, range, targeting mode, tags that block it (`Stun`, `Silence`), and an ordered list of **effects**.
- **Effects** are small, reusable, composable pieces: *deal damage*, *heal*, *apply status effect*, *knock back*, *spawn projectile*. "Ice bolt" is *damage + apply Slow*, assembled by a designer from existing parts.
- **`AbilityRunner`** on any character (player or AI): owns cooldowns and resources, runs **one** shared validation path, pays the cost, starts the cooldown, and executes the effects with a context describing caster and target.

Validation returns a **reason** rather than a bare `false`, so the UI can say "Not enough mana" and the AI can choose something else.

```
TryActivate(ability, target)
  ├─ CanActivate? ── OnCooldown / NotEnoughMana / Blocked(Stun) / OutOfRange / InvalidTarget
  ├─ pay cost, start cooldown
  └─ foreach effect: effect.Apply(context)   ── Damage, ApplyStatus, Heal, …
```

## Example (Unity C#)

### Definitions and effects

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

public enum Targeting { Self, Enemy, Ally }
public enum ActivationResult { Success, OnCooldown, NotEnoughMana, Blocked, OutOfRange, InvalidTarget }

public struct AbilityContext
{
    public AbilityRunner Caster;
    public AbilityRunner Target;
    public AbilityDefinition Ability;
}

[Serializable]
public abstract class AbilityEffect
{
    public abstract void Apply(in AbilityContext ctx);
}

[Serializable]
public class DamageEffect : AbilityEffect
{
    public int amount = 10;
    public override void Apply(in AbilityContext ctx) => ctx.Target.Health.TakeDamage(amount);
}

[Serializable]
public class HealEffect : AbilityEffect
{
    public int amount = 10;
    public override void Apply(in AbilityContext ctx) => ctx.Target.Health.Heal(amount);
}

[Serializable]
public class ApplyStatusEffect : AbilityEffect
{
    public StatusEffectDefinition effect;
    public override void Apply(in AbilityContext ctx) => ctx.Target.Effects.Apply(effect, ctx.Caster);
}

[CreateAssetMenu(menuName = "Abilities/Ability")]
public class AbilityDefinition : ScriptableObject
{
    public string displayName;
    public Sprite icon;
    public int manaCost;
    public float cooldown = 1f;
    public float range = 10f;
    public Targeting targeting = Targeting.Enemy;
    public string[] blockedByTags = { "Stun", "Silence" };

    // Polymorphic list: each element can be any AbilityEffect subclass.
    [SerializeReference] public List<AbilityEffect> effects = new();
}
```

`Health` is the component from the [Component](./component) page, with a `Heal` method added. `StatusEffectDefinition` and `StatusEffectContainer` are from [Status Effects](./status-effects).

`[SerializeReference]` stores a list of *different* effect classes in one asset. The default inspector shows existing entries but has no "add element of type…" menu, so add a small custom editor, or a property drawer with a type dropdown, for designers.

### The runner: one validation path for players and AI

```csharp
public class AbilityRunner : MonoBehaviour
{
    [SerializeField] int maxMana = 100;
    [SerializeField] float manaRegenPerSecond = 5f;
    [SerializeField] int team;

    public Health Health { get; private set; }
    public StatusEffectContainer Effects { get; private set; }
    public float Mana { get; private set; }

    readonly Dictionary<AbilityDefinition, float> readyAt = new();   // cooldowns per ability

    public event Action<AbilityDefinition, AbilityRunner> Activated;  // animation, VFX, audio, UI

    void Awake()
    {
        Health = GetComponent<Health>();
        Effects = GetComponent<StatusEffectContainer>();
        Mana = maxMana;
    }

    void Update() => Mana = Mathf.Min(maxMana, Mana + manaRegenPerSecond * Time.deltaTime);

    public float CooldownRemaining(AbilityDefinition a) =>
        readyAt.TryGetValue(a, out var t) ? Mathf.Max(0f, t - Time.time) : 0f;

    public ActivationResult CanActivate(AbilityDefinition a, AbilityRunner target)
    {
        if (CooldownRemaining(a) > 0f) return ActivationResult.OnCooldown;
        if (Mana < a.manaCost) return ActivationResult.NotEnoughMana;
        foreach (var tag in a.blockedByTags)
            if (Effects.HasTag(tag)) return ActivationResult.Blocked;

        target = a.targeting == Targeting.Self ? this : target;
        if (target == null) return ActivationResult.InvalidTarget;
        if (a.targeting == Targeting.Enemy && target.team == team) return ActivationResult.InvalidTarget;
        if (a.targeting == Targeting.Ally && target.team != team) return ActivationResult.InvalidTarget;
        if (Vector3.Distance(transform.position, target.transform.position) > a.range) return ActivationResult.OutOfRange;

        return ActivationResult.Success;
    }

    public ActivationResult TryActivate(AbilityDefinition a, AbilityRunner target)
    {
        var result = CanActivate(a, target);
        if (result != ActivationResult.Success) return result;

        if (a.targeting == Targeting.Self) target = this;
        Mana -= a.manaCost;
        readyAt[a] = Time.time + a.cooldown;

        var ctx = new AbilityContext { Caster = this, Target = target, Ability = a };
        foreach (var effect in a.effects)
            effect.Apply(ctx);

        Activated?.Invoke(a, target);
        return ActivationResult.Success;
    }
}

// Player input and AI use exactly the same entry point:
//   var result = runner.TryActivate(iceBolt, currentTarget);
//   if (result == ActivationResult.NotEnoughMana) ui.Flash("Not enough mana");
```

An "Ice Bolt" asset is now `manaCost 15, cooldown 2, effects: [DamageEffect 20, ApplyStatusEffect Slow]`, created entirely in the editor.

## When to use

- RPGs, MOBAs, ARPGs, roguelikes and any game with more than a handful of active skills.
- Abilities shared between players and AI, or between many character types.
- Designers need to create and tune abilities without code.

## Pitfalls

- **Instant effects only.** Real abilities have cast times, channels, projectiles that hit later, and animation events that decide *when* damage lands. Model activation as a small state machine (casting → executing → recovering), and let effects run on events such as "projectile hit" rather than immediately.
- **Validation in several places.** If the UI and AI check "can I cast?" with their own logic, they drift apart. Everything calls `CanActivate`.
- **Effects that know too much.** An effect reaching for `GameObject.Find` or singletons is hard to reuse. Pass everything it needs through the context.
- **Networked games.** Activation must be validated on the server, while the client predicts the cooldown and animation. See [Client-Side Prediction](./client-side-prediction).
- **Cooldowns keyed by asset.** Two different "Fireball" assets with the same name have independent cooldowns. If they should share one, key cooldowns by an explicit cooldown group.

## Related

- [Type Object](./type-object) — ability definitions are kinds defined as data.
- [Status Effects](./status-effects) — the most common thing abilities apply.
- [Command](./command) — an activation request is a natural command, for queuing, replays and networking.
- [Stat & Modifier System](./stat-modifier-system) — costs, damage and cooldowns can scale with stats.
- [State](./state) — cast, channel and recovery phases.
