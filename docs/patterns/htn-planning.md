# Hierarchical Task Network

> Plan by decomposing high-level tasks into primitive ones using authored methods.

**Also known as:** HTN · **Category:** AI & Decision Making

## Problem

[GOAP](./goap) finds clever plans, but designers lose control. The planner may pick an odd sequence because the costs happen to favour it, and planning slows down as facts and actions grow. A [behavior tree](./behavior-tree) gives full control, but cannot look ahead: it starts "attack" without checking whether the whole attack is feasible, then fails halfway through. You want designer-authored *ways of doing things*, checked for feasibility before the agent commits.

## Solution

Describe behaviour as a hierarchy of **tasks**:

- **Primitive tasks** are things the agent can actually do: *MoveTo*, *Reload*, *Shoot*. Each has preconditions and effects on the world state, like GOAP actions.
- **Compound tasks** are goals like *AttackEnemy*. Each has an ordered list of **methods**: alternative ways to accomplish it, each with a condition and a list of subtasks.

The **planner** decomposes the root task, top-down, on a **copy** of the world state:

1. Take the next task. If it is **compound**, pick the **first method whose condition holds** and replace the task with that method's subtasks.
2. If it is **primitive**, check its preconditions, apply its effects to the copied state, and add it to the plan.
3. If something fails, **backtrack** to the last compound task and try its next method.

The result is a complete, feasible sequence of primitive tasks, or nothing. Because methods are tried in authored order, designers decide what the agent prefers. Because effects are simulated, the agent knows the whole plan works before starting it.

## Example (Unity C#)

```csharp
using System;
using System.Collections.Generic;

public class WorldState
{
    public bool HasAmmo, WeaponLoaded, InRange, AmmoNearby, EnemyVisible;
    public WorldState Clone() => (WorldState)MemberwiseClone();
}

public abstract class HtnTask { public string Name; }

public class PrimitiveTask : HtnTask
{
    public Func<WorldState, bool> Precondition = _ => true;
    public Action<WorldState> Effect = _ => { };          // simulated during planning
}

public class Method
{
    public string Name;
    public Func<WorldState, bool> Condition;
    public List<HtnTask> Subtasks;
}

public class CompoundTask : HtnTask
{
    public List<Method> Methods = new();                   // tried in order: designer priority
}

public static class HtnPlanner
{
    public static List<PrimitiveTask> Plan(HtnTask root, WorldState state)
    {
        var plan = new List<PrimitiveTask>();
        return Decompose(new List<HtnTask> { root }, 0, state.Clone(), plan) ? plan : null;
    }

    // Depth-first decomposition with backtracking over methods.
    static bool Decompose(List<HtnTask> tasks, int index, WorldState state, List<PrimitiveTask> plan)
    {
        if (index == tasks.Count) return true;             // everything decomposed
        var task = tasks[index];

        if (task is PrimitiveTask p)
        {
            if (!p.Precondition(state)) return false;
            var next = state.Clone();
            p.Effect(next);
            plan.Add(p);
            if (Decompose(tasks, index + 1, next, plan)) return true;
            plan.RemoveAt(plan.Count - 1);                  // backtrack
            return false;
        }

        var compound = (CompoundTask)task;
        foreach (var m in compound.Methods)
        {
            if (!m.Condition(state)) continue;
            // Replace the compound task with this method's subtasks, then continue.
            var expanded = new List<HtnTask>(tasks.Count + m.Subtasks.Count);
            expanded.AddRange(tasks.GetRange(0, index));
            expanded.AddRange(m.Subtasks);
            expanded.AddRange(tasks.GetRange(index + 1, tasks.Count - index - 1));

            int planSize = plan.Count;
            if (Decompose(expanded, index, state, plan)) return true;
            plan.RemoveRange(planSize, plan.Count - planSize);   // undo this method's tasks
        }
        return false;                                        // no method worked
    }
}
```

A soldier domain, authored as ways of doing things:

```csharp
var moveInRange = new PrimitiveTask { Name = "MoveInRange", Effect = s => s.InRange = true };
var pickUpAmmo  = new PrimitiveTask { Name = "PickUpAmmo",  Precondition = s => s.AmmoNearby,  Effect = s => s.HasAmmo = true };
var reload      = new PrimitiveTask { Name = "Reload",      Precondition = s => s.HasAmmo,     Effect = s => s.WeaponLoaded = true };
var shoot       = new PrimitiveTask { Name = "Shoot",       Precondition = s => s.WeaponLoaded && s.InRange };
var charge      = new PrimitiveTask { Name = "MeleeCharge", Effect = s => s.InRange = true };
var searchArea  = new PrimitiveTask { Name = "SearchArea" };

var attack = new CompoundTask { Name = "AttackEnemy" };
attack.Methods.Add(new Method { Name = "Shoot (loaded)", Condition = s => s.WeaponLoaded,
                                Subtasks = new() { moveInRange, shoot } });
attack.Methods.Add(new Method { Name = "Reload first",   Condition = s => s.HasAmmo,
                                Subtasks = new() { reload, moveInRange, shoot } });
attack.Methods.Add(new Method { Name = "Get ammo",       Condition = s => s.AmmoNearby,
                                Subtasks = new() { pickUpAmmo, reload, moveInRange, shoot } });
attack.Methods.Add(new Method { Name = "Melee",          Condition = _ => true,
                                Subtasks = new() { charge } });

var root = new CompoundTask { Name = "BeSoldier" };
root.Methods.Add(new Method { Name = "Fight",  Condition = s => s.EnemyVisible, Subtasks = new() { attack } });
root.Methods.Add(new Method { Name = "Patrol", Condition = _ => true,           Subtasks = new() { searchArea } });

var plan = HtnPlanner.Plan(root, new WorldState { EnemyVisible = true, AmmoNearby = true });
// → PickUpAmmo, Reload, MoveInRange, Shoot   (the first method whose whole decomposition works)
```

The agent executes the plan step by step, and replans when a step fails or the world state changes in a way the plan relied on.

## When to use

- AI where designers want explicit control over strategies, plus look-ahead to avoid starting plans that cannot finish: tactical shooters, squad AI, NPC daily routines.
- Large behaviour sets where GOAP's search would be too slow or too unpredictable.

## Pitfalls

- **Method order is the AI's personality.** The first applicable method wins. Order methods from most to least preferred, and remember that a too-general method placed early hides everything after it.
- **Effects must match reality.** If *MoveInRange* is simulated as always succeeding but actually fails behind walls, the plan is wrong. Keep simulated effects conservative, and replan on failure.
- **Deep backtracking.** Large domains with many failing methods can backtrack a lot. Make method conditions precise, so failing branches are pruned early.
- **Replanning too often.** Replanning every frame discards progress and makes agents flicker between plans. Replan on failure or on meaningful state changes.
- **Authoring tools.** Large HTN domains in code become hard to read. Visual or data-driven domain editors pay off quickly.

## Related

- [GOAP](./goap) — plans by searching over actions: more emergent, less controllable.
- [Behavior Tree](./behavior-tree) — similar hierarchical structure, but evaluated live without look-ahead.
- [Utility AI](./utility-ai) — can choose which root task or method to try.
- [Blackboard](./blackboard) and [Perception System](./perception-system) — supply the world state the planner copies.
- [Hierarchical State Machine](./hierarchical-state-machine) — another hierarchical way to organise behaviour.
