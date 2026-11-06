# Goal-Oriented Action Planning

> Agents search for a sequence of actions whose effects satisfy a goal.

**Also known as:** GOAP · **Category:** AI & Decision Making

## Problem

A soldier AI should "kill the enemy". Depending on the situation, that means *shoot*, or *reload, then shoot*, or *pick up ammo, reload, move into range, shoot*, or *pick up a knife and charge*. A [behavior tree](./behavior-tree) or [state machine](./state) must spell out every one of these sequences by hand, and adding a new action (throw a grenade) means rewiring the tree in several places. The designer knows *what* each action needs and does. The *sequences* are what explodes.

## Solution

Describe actions declaratively, and let a **planner** find the sequence:

- **World state:** a set of facts (`HasAmmo`, `WeaponLoaded`, `InRange`, `EnemyDead`).
- **Actions** each have **preconditions** (facts that must be true), **effects** (facts they change) and a **cost**. For example, *Reload* requires `HasAmmo` and produces `WeaponLoaded`.
- **Goals** are desired facts: `EnemyDead = true`. Agents can have several goals, with priorities.
- The **planner** runs an [A*](./a-star) search over world states: from the current state, which applicable actions lead to a state satisfying the goal at the lowest total cost?
- The agent **executes** the plan action by action, and **replans** when an action fails or the world changes (ammo was taken, the enemy moved).

Adding *ThrowGrenade* (requires `HasGrenade`, gives `EnemyDead`, costs 3) is just a new action. The planner automatically uses it when it is the cheapest way to the goal.

## Example (Unity C#)

World state as a bitmask makes states cheap to copy, compare and hash:

```csharp
using System;
using System.Collections.Generic;

[Flags]
public enum Fact : ulong
{
    None = 0,
    HasAmmo = 1 << 0,
    WeaponLoaded = 1 << 1,
    InRange = 1 << 2,
    HasKnife = 1 << 3,
    EnemyDead = 1 << 4,
    AmmoNearby = 1 << 5,
    KnifeNearby = 1 << 6,
}

public class GoapAction
{
    public string Name;
    public Fact Requires;        // these facts must be true
    public Fact Adds;            // these become true
    public Fact Removes;         // these become false
    public float Cost = 1f;

    public bool CanRun(Fact state) => (state & Requires) == Requires;
    public Fact Apply(Fact state) => (state | Adds) & ~Removes;
}

public static class GoapPlanner
{
    // A* over world states. Returns the cheapest action sequence, or null if the goal is unreachable.
    public static List<GoapAction> Plan(Fact start, Fact goal, IReadOnlyList<GoapAction> actions, int maxNodes = 2000)
    {
        var open = new PriorityQueue<Fact, float>();       // .NET 6+; use your own heap on older Unity
        var cost = new Dictionary<Fact, float> { [start] = 0f };
        var cameFrom = new Dictionary<Fact, (Fact prev, GoapAction action)>();
        open.Enqueue(start, Heuristic(start, goal));

        int expanded = 0;
        while (open.TryDequeue(out var state, out _) && expanded++ < maxNodes)
        {
            if ((state & goal) == goal) return Reconstruct(state, start, cameFrom);

            foreach (var a in actions)
            {
                if (!a.CanRun(state)) continue;
                var next = a.Apply(state);
                float g = cost[state] + a.Cost;
                if (cost.TryGetValue(next, out var old) && old <= g) continue;
                cost[next] = g;
                cameFrom[next] = (state, a);
                open.Enqueue(next, g + Heuristic(next, goal));
            }
        }
        return null;
    }

    // Number of goal facts still missing: never overestimates if every action costs at least 1.
    static float Heuristic(Fact s, Fact goal) => BitCount((ulong)(goal & ~s));

    static int BitCount(ulong v) { int c = 0; while (v != 0) { v &= v - 1; c++; } return c; }

    static List<GoapAction> Reconstruct(Fact end, Fact start, Dictionary<Fact, (Fact, GoapAction)> cameFrom)
    {
        var plan = new List<GoapAction>();
        for (var s = end; s != start; s = cameFrom[s].Item1) plan.Add(cameFrom[s].Item2);
        plan.Reverse();
        return plan;
    }
}
```

A soldier's action set. Note that no sequences are written anywhere:

```csharp
var actions = new List<GoapAction>
{
    new() { Name = "PickUpAmmo",  Requires = Fact.AmmoNearby,              Adds = Fact.HasAmmo,      Cost = 2 },
    new() { Name = "Reload",      Requires = Fact.HasAmmo,                 Adds = Fact.WeaponLoaded, Cost = 1 },
    new() { Name = "MoveInRange", Requires = Fact.None,                    Adds = Fact.InRange,      Cost = 2 },
    new() { Name = "Shoot",       Requires = Fact.WeaponLoaded | Fact.InRange, Adds = Fact.EnemyDead, Cost = 1 },
    new() { Name = "PickUpKnife", Requires = Fact.KnifeNearby,             Adds = Fact.HasKnife,     Cost = 1 },
    new() { Name = "Stab",        Requires = Fact.HasKnife | Fact.InRange, Adds = Fact.EnemyDead,    Cost = 4 },
};

// No ammo, but ammo and a knife are nearby:
var plan = GoapPlanner.Plan(Fact.AmmoNearby | Fact.KnifeNearby, Fact.EnemyDead, actions);
// → PickUpAmmo (2), Reload (1), MoveInRange (2), Shoot (1)   total 6
// vs. PickUpKnife (1), MoveInRange (2), Stab (4)               total 7
// If no ammo is nearby, the planner picks the knife route instead, with no code change.
```

Execution: each `GoapAction` has a matching behaviour (move to the ammo, play the reload animation) that reports *running*, *success* or *failure*. On failure, or when sensors change a relevant fact, the agent replans from the new world state.

## When to use

- Agents with many actions that combine in different orders depending on the situation: tactical shooters, survival and life-sim NPCs, crafting-capable workers.
- Emergent behaviour: designers add actions, and the AI finds new ways to use them.

## When not to use

- AI whose behaviour designers need to predict and script exactly. Planning makes it emergent and harder to control; use a [Behavior Tree](./behavior-tree) or [HTN](./htn-planning).
- Agents with only a handful of actions. There is little to plan; a [State](./state) machine is enough.
- Large numbers of agents re-planning often. Planning is expensive; cache plans or use a cheaper decision method.

## Pitfalls

- **Cost tuning is behaviour design.** Plans are only as good as their costs. Make costs depend on context (distance to the ammo, danger), not just constants.
- **Planning cost.** A* over states grows quickly with many facts and actions. Keep facts few and meaningful, cap expanded nodes, plan at most a few times per second, and spread replanning across agents ([Time Slicing](./time-slicing)).
- **Facts that are really numbers.** "Has 3 ammo" or "health below 30%" do not fit booleans well. Discretise into facts (`LowHealth`), and keep the precise values for execution and costs.
- **Thrashing.** Replanning on every tiny world change makes agents switch plans constantly. Replan on meaningful changes only, and add a small cost for abandoning the current plan.
- **Unpredictability.** Emergent plans can surprise designers, sometimes badly. Log plans, and show them in a debug view.

## Related

- [A* Pathfinding](./a-star) — the same search, applied to world states instead of positions.
- [HTN Planning](./htn-planning) — plans by decomposing authored tasks: more control, less emergence.
- [Behavior Tree](./behavior-tree) and [Utility AI](./utility-ai) — non-planning alternatives.
- [Blackboard](./blackboard) and [Perception System](./perception-system) — where world-state facts come from.
- [Command](./command) — each planned step can be issued as a command to the agent.
