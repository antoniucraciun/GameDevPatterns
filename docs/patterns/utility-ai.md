# Utility AI

> Score every possible action with response curves and pick the best one.

**Category:** AI & Decision Making

## Problem

A survival NPC must eat, sleep, flee danger, fight, gather wood and socialise. With a [behavior tree](./behavior-tree) or [state machine](./state), priorities are fixed: "flee beats eat" always. Real decisions are trade-offs. A *slightly* hungry NPC near a threat should flee, but a *starving* one might grab the food first. Expressing every combination as conditions and priorities explodes, and the behaviour still looks rigid and predictable.

## Solution

Give every candidate action a **score** between 0 and 1, computed from the current situation, and pick the highest (or pick randomly among the top few).

Each action's score is built from **considerations**. Each consideration:

1. reads one **input** from the world or blackboard, normalised to 0..1: hunger, distance to threat, own health, time of day.
2. maps it through a **response curve**: linear, quadratic, logistic or inverse. "Hunger matters little until it is high" is an exponential curve, while "threat matters a lot when close" is an inverse curve.
3. returns a value from 0 to 1.

The action's score is the **product** of its considerations, so any single consideration at 0 vetoes the action (no food nearby means eating scores 0). Multiplying many values below 1 drags scores down for actions with more considerations, so apply a **compensation factor**.

```
Eat   = curve(hunger) × curve(food nearby) × curve(1 − threat)
Flee  = curve(threat) × curve(1 − own health)
Sleep = curve(tiredness) × curve(is night) × curve(1 − threat)
```

Designers tune behaviour by editing curves rather than adding rules.

## Example (Unity C#)

Considerations and actions as data, using `AnimationCurve` for visual curve editing:

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

public enum UtilityInput { Hunger, Tiredness, Threat, Health, FoodNearby, IsNight }

public class AgentContext                      // inputs, each normalised to 0..1
{
    readonly Dictionary<UtilityInput, float> values = new();
    public float this[UtilityInput i] { get => values.TryGetValue(i, out var v) ? v : 0f; set => values[i] = Mathf.Clamp01(value); }
}

[Serializable]
public class Consideration
{
    public UtilityInput input;
    public AnimationCurve curve = AnimationCurve.Linear(0f, 0f, 1f, 1f);   // edit visually in the inspector

    public float Score(AgentContext ctx) => Mathf.Clamp01(curve.Evaluate(ctx[input]));
}

[CreateAssetMenu(menuName = "AI/Utility Action")]
public class UtilityAction : ScriptableObject
{
    public string actionName;
    [Range(0f, 2f)] public float weight = 1f;          // designer bias, e.g. 1.2 for "prefers this"
    public List<Consideration> considerations = new();

    public float Score(AgentContext ctx)
    {
        if (considerations.Count == 0) return 0f;
        float score = 1f;
        foreach (var c in considerations)
        {
            score *= c.Score(ctx);
            if (score <= 0f) return 0f;                // early out: vetoed
        }

        // Compensation: undo the penalty for having many considerations.
        float modification = 1f - 1f / considerations.Count;
        score += (1f - score) * modification * score;
        return score * weight;
    }
}
```

The reasoner picks the best action, with hysteresis so the agent does not flip between near-equal options:

```csharp
public class UtilityReasoner : MonoBehaviour
{
    [SerializeField] List<UtilityAction> actions;
    [SerializeField] float decisionInterval = 0.25f;
    [SerializeField] float commitmentBonus = 0.1f;     // stickiness for the current action

    public UtilityAction Current { get; private set; }
    public readonly AgentContext Context = new();
    public event Action<UtilityAction> Decided;

    float nextDecision;

    void Update()
    {
        if (Time.time < nextDecision) return;
        nextDecision = Time.time + decisionInterval;

        UtilityAction best = null;
        float bestScore = 0f;
        foreach (var a in actions)
        {
            float s = a.Score(Context);
            if (a == Current) s += commitmentBonus;    // hysteresis
            if (s > bestScore) { best = a; bestScore = s; }
        }

        if (best != Current)
        {
            Current = best;
            Decided?.Invoke(best);                     // start the matching behaviour (move, eat, sleep…)
        }
    }
}

// Each frame (or from perception), keep the inputs current:
// reasoner.Context[UtilityInput.Hunger] = needs.Hunger / 100f;
// reasoner.Context[UtilityInput.Threat] = 1f - Mathf.Clamp01(distanceToNearestEnemy / 20f);
```

In a debug view, show every action's score per decision. Utility AI is only tunable if you can see *why* it chose what it did.

## When to use

- Agents with many competing needs: life sims, survival games, colony sims, RPG companions.
- Combat AI choosing between abilities, targets and positions, where the best choice depends on many factors.
- Behaviour that should feel organic and context-sensitive rather than scripted.

## Pitfalls

- **Opaque decisions.** "Why did it do that?" is hard to answer from numbers. Build a score inspector early.
- **Dithering.** Two actions with close scores alternate every decision. Add a commitment bonus for the current action, minimum durations, or cooldowns.
- **Curve tuning explosion.** Dozens of actions × several considerations is a lot of curves. Share consideration presets, and keep inputs well normalised so curves transfer between actions.
- **Unnormalised inputs.** Feeding raw distances (0–200) into curves expecting 0..1 breaks everything. Normalise every input explicitly, with a documented range.
- **Utility for everything.** Simple, rule-like logic (reload when empty) is clearer as a condition. Use utility where trade-offs exist, and combine it with [Behavior Trees](./behavior-tree) or [State](./state) for execution.

## Related

- [Behavior Tree](./behavior-tree) — fixed priorities. Utility can choose *which subtree* to run.
- [Blackboard](./blackboard) and [Perception System](./perception-system) — where inputs come from.
- [Strategy](./strategy) — each chosen action is often a strategy object that does the work.
- Goal-Oriented Action Planning — plans *sequences* of actions, where utility scores single choices.
- AI Director — utility-style scoring applied to pacing a whole game.
