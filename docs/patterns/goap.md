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

## Example

World state as a bitmask makes states cheap to copy, compare and hash. The **core** is an A* search over those states with no engine types; the **domain** is a soldier's action set, which is all a designer writes.

### Core

::: code-group

```csharp [Unity (C#)]
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
        // Unity's .NET profile has no PriorityQueue, so a SortedSet serves as one; the counter keeps entries distinct.
        var open = new SortedSet<(float f, int order, Fact state)>();
        var cost = new Dictionary<Fact, float> { [start] = 0f };
        var cameFrom = new Dictionary<Fact, (Fact prev, GoapAction action)>();
        int order = 0;
        open.Add((Heuristic(start, goal), order++, start));

        int expanded = 0;
        while (open.Count > 0 && expanded++ < maxNodes)
        {
            var (_, _, state) = open.Min;
            open.Remove(open.Min);
            if ((state & goal) == goal) return Reconstruct(state, start, cameFrom);

            foreach (var a in actions)
            {
                if (!a.CanRun(state)) continue;
                var next = a.Apply(state);
                float g = cost[state] + a.Cost;
                if (cost.TryGetValue(next, out var old) && old <= g) continue;
                cost[next] = g;
                cameFrom[next] = (state, a);
                open.Add((g + Heuristic(next, goal), order++, next));
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

```gdscript [Godot (GDScript)]
# goap_action.gd: world states are plain ints used as bit sets, so they copy and hash for free.
class_name GoapAction
extends RefCounted

var action_name: String
var requires: int  # these facts must be true
var adds: int      # these become true
var removes: int   # these become false
var cost: float


func _init(p_name: String, p_requires: int, p_adds: int, p_cost := 1.0, p_removes := 0) -> void:
	action_name = p_name
	requires = p_requires
	adds = p_adds
	cost = p_cost
	removes = p_removes


func can_run(state: int) -> bool:
	return (state & requires) == requires


func apply(state: int) -> int:
	return (state | adds) & ~removes


# goap_planner.gd
class_name GoapPlanner
extends RefCounted


## A* over world states. Returns the cheapest action list, or an empty one if the goal is unreachable.
static func plan(start: int, goal: int, actions: Array[GoapAction], max_nodes := 2000) -> Array[GoapAction]:
	var cost := {start: 0.0}
	var came_from := {}  # state -> [previous state, action]
	# Open list of [f, state]. A linear scan for the minimum is fine for a few hundred states.
	var open: Array = [[_heuristic(start, goal), start]]

	var expanded := 0
	while not open.is_empty() and expanded < max_nodes:
		expanded += 1
		var best := 0
		for i in range(1, open.size()):
			if open[i][0] < open[best][0]:
				best = i
		var state: int = open[best][1]
		open.remove_at(best)
		if (state & goal) == goal:
			return _reconstruct(state, start, came_from)

		for a: GoapAction in actions:
			if not a.can_run(state):
				continue
			var next := a.apply(state)
			var g: float = cost[state] + a.cost
			if cost.has(next) and cost[next] <= g:
				continue
			cost[next] = g
			came_from[next] = [state, a]
			open.append([g + _heuristic(next, goal), next])
	return []


## Number of goal facts still missing: never overestimates if every action costs at least 1.
static func _heuristic(state: int, goal: int) -> float:
	var missing := goal & ~state
	var count := 0
	while missing != 0:
		missing &= missing - 1
		count += 1
	return count


static func _reconstruct(end: int, start: int, came_from: Dictionary) -> Array[GoapAction]:
	var result: Array[GoapAction] = []
	var s := end
	while s != start:
		var step: Array = came_from[s]
		result.push_front(step[1])
		s = step[0]
	return result
```

```cpp [Unreal (C++)]
// GoapPlanner.h: plain C++ with no UObjects, so it can be unit tested with automation tests.
#pragma once

#include "CoreMinimal.h"

namespace GoapFact
{
	constexpr uint64 None = 0;
	constexpr uint64 HasAmmo = 1ull << 0;
	constexpr uint64 WeaponLoaded = 1ull << 1;
	constexpr uint64 InRange = 1ull << 2;
	constexpr uint64 HasKnife = 1ull << 3;
	constexpr uint64 EnemyDead = 1ull << 4;
	constexpr uint64 AmmoNearby = 1ull << 5;
	constexpr uint64 KnifeNearby = 1ull << 6;
}

struct FGoapAction
{
	FString Name;
	uint64 Requires = 0;     // these facts must be true
	uint64 Adds = 0;         // these become true
	uint64 Removes = 0;      // these become false
	float Cost = 1.f;

	bool CanRun(uint64 State) const { return (State & Requires) == Requires; }
	uint64 Apply(uint64 State) const { return (State | Adds) & ~Removes; }
};

class FGoapPlanner
{
public:
	// A* over world states. OutPlan points into Actions, so keep that array alive while executing.
	static bool Plan(uint64 Start, uint64 Goal, const TArray<FGoapAction>& Actions,
		TArray<const FGoapAction*>& OutPlan, int32 MaxNodes = 2000);

private:
	static float Heuristic(uint64 State, uint64 Goal);
};

// GoapPlanner.cpp
#include "GoapPlanner.h"
#include "Algo/Reverse.h"

namespace
{
	struct FOpenEntry { uint64 State; float F; };
	struct FStep { uint64 Prev; const FGoapAction* Action; };
}

bool FGoapPlanner::Plan(uint64 Start, uint64 Goal, const TArray<FGoapAction>& Actions,
	TArray<const FGoapAction*>& OutPlan, int32 MaxNodes)
{
	OutPlan.Reset();
	TMap<uint64, float> CostSoFar;
	TMap<uint64, FStep> CameFrom;
	TArray<FOpenEntry> Open;                     // binary heap via TArray::HeapPush / HeapPop
	auto ByF = [](const FOpenEntry& A, const FOpenEntry& B) { return A.F < B.F; };

	CostSoFar.Add(Start, 0.f);
	Open.HeapPush({Start, Heuristic(Start, Goal)}, ByF);

	for (int32 Expanded = 0; Open.Num() > 0 && Expanded < MaxNodes; ++Expanded)
	{
		FOpenEntry Entry;
		Open.HeapPop(Entry, ByF);
		const uint64 State = Entry.State;
		if ((State & Goal) == Goal)
		{
			for (uint64 S = State; S != Start; S = CameFrom[S].Prev) OutPlan.Add(CameFrom[S].Action);
			Algo::Reverse(OutPlan);
			return true;
		}

		const float G = CostSoFar[State];
		for (const FGoapAction& A : Actions)
		{
			if (!A.CanRun(State)) continue;
			const uint64 Next = A.Apply(State);
			const float NewCost = G + A.Cost;
			const float* Old = CostSoFar.Find(Next);
			if (Old && *Old <= NewCost) continue;
			CostSoFar.Add(Next, NewCost);        // Add replaces an existing key's value
			CameFrom.Add(Next, {State, &A});
			Open.HeapPush({Next, NewCost + Heuristic(Next, Goal)}, ByF);
		}
	}
	return false;
}

float FGoapPlanner::Heuristic(uint64 State, uint64 Goal)
{
	int32 Count = 0;                             // goal facts still missing
	for (uint64 Missing = Goal & ~State; Missing != 0; Missing &= Missing - 1) ++Count;
	return static_cast<float>(Count);
}
```

:::

### Domain

A soldier's action set. Note that no sequences are written anywhere:

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public static class SoldierDomain
{
    public static readonly List<GoapAction> Actions = new()
    {
        new() { Name = "PickUpAmmo",  Requires = Fact.AmmoNearby,              Adds = Fact.HasAmmo,      Cost = 2 },
        new() { Name = "Reload",      Requires = Fact.HasAmmo,                 Adds = Fact.WeaponLoaded, Cost = 1 },
        new() { Name = "MoveInRange", Requires = Fact.None,                    Adds = Fact.InRange,      Cost = 2 },
        new() { Name = "Shoot",       Requires = Fact.WeaponLoaded | Fact.InRange, Adds = Fact.EnemyDead, Cost = 1 },
        new() { Name = "PickUpKnife", Requires = Fact.KnifeNearby,             Adds = Fact.HasKnife,     Cost = 1 },
        new() { Name = "Stab",        Requires = Fact.HasKnife | Fact.InRange, Adds = Fact.EnemyDead,    Cost = 4 },
    };

    public static void Demo()
    {
        // No ammo, but ammo and a knife are nearby:
        var plan = GoapPlanner.Plan(Fact.AmmoNearby | Fact.KnifeNearby, Fact.EnemyDead, Actions);
        Debug.Log(string.Join(" → ", plan.ConvertAll(a => a.Name)));
        // → PickUpAmmo (2), Reload (1), MoveInRange (2), Shoot (1)   total 6
        // vs. PickUpKnife (1), MoveInRange (2), Stab (4)               total 7
        // If no ammo is nearby, the planner picks the knife route instead, with no code change.
    }
}
```

```gdscript [Godot (GDScript)]
# soldier_brain.gd: the facts are this agent's own; the planner only sees ints.
extends Node

enum Fact {
	NONE = 0, HAS_AMMO = 1, WEAPON_LOADED = 2, IN_RANGE = 4, HAS_KNIFE = 8,
	ENEMY_DEAD = 16, AMMO_NEARBY = 32, KNIFE_NEARBY = 64,
}

var actions: Array[GoapAction] = [
	GoapAction.new("PickUpAmmo", Fact.AMMO_NEARBY, Fact.HAS_AMMO, 2.0),
	GoapAction.new("Reload", Fact.HAS_AMMO, Fact.WEAPON_LOADED, 1.0),
	GoapAction.new("MoveInRange", Fact.NONE, Fact.IN_RANGE, 2.0),
	GoapAction.new("Shoot", Fact.WEAPON_LOADED | Fact.IN_RANGE, Fact.ENEMY_DEAD, 1.0),
	GoapAction.new("PickUpKnife", Fact.KNIFE_NEARBY, Fact.HAS_KNIFE, 1.0),
	GoapAction.new("Stab", Fact.HAS_KNIFE | Fact.IN_RANGE, Fact.ENEMY_DEAD, 4.0),
]


func _ready() -> void:
	# No ammo, but ammo and a knife are nearby:
	var plan := GoapPlanner.plan(Fact.AMMO_NEARBY | Fact.KNIFE_NEARBY, Fact.ENEMY_DEAD, actions)
	print(plan.map(func(a: GoapAction) -> String: return a.action_name))
	# → ["PickUpAmmo", "Reload", "MoveInRange", "Shoot"]   total 6, beating the knife route's 7
```

```cpp [Unreal (C++)]
// GoapSoldierTest.cpp: the domain, checked by an automation test (Session Frontend → Automation).
#include "GoapPlanner.h"
#include "Misc/AutomationTest.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FGoapSoldierTest, "Game.AI.Goap.Soldier",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter)

bool FGoapSoldierTest::RunTest(const FString& Parameters)
{
	using namespace GoapFact;
	//                          Name            Requires              Adds          Removes Cost
	const TArray<FGoapAction> Actions = {
		{TEXT("PickUpAmmo"),  AmmoNearby,           HasAmmo,      0, 2.f},
		{TEXT("Reload"),      HasAmmo,              WeaponLoaded, 0, 1.f},
		{TEXT("MoveInRange"), None,                 InRange,      0, 2.f},
		{TEXT("Shoot"),       WeaponLoaded | InRange, EnemyDead,  0, 1.f},
		{TEXT("PickUpKnife"), KnifeNearby,          HasKnife,     0, 1.f},
		{TEXT("Stab"),        HasKnife | InRange,   EnemyDead,    0, 4.f},
	};

	// No ammo, but ammo and a knife are nearby: the gun route (cost 6) beats the knife route (cost 7).
	TArray<const FGoapAction*> Plan;
	TestTrue(TEXT("found a plan"), FGoapPlanner::Plan(AmmoNearby | KnifeNearby, EnemyDead, Actions, Plan));
	TestEqual(TEXT("plan length"), Plan.Num(), 4);
	TestEqual(TEXT("last step"), Plan.Last()->Name, FString(TEXT("Shoot")));
	return true;
}
```

:::

Execution: each action has a matching behaviour (move to the ammo, play the reload animation) that reports *running*, *success* or *failure*. On failure, or when sensors change a relevant fact, the agent replans from the new world state.

**Engine notes**

- **Unity:** no built-in planner. .NET's `PriorityQueue` isn't in Unity's runtime, hence the `SortedSet`. To let designers author actions, make `GoapAction` a `ScriptableObject` with the `Fact` flags as fields; the inspector draws `[Flags]` enums as multi-select dropdowns.
- **Godot:** no built-in planner. For designer-authored actions, make `GoapAction` a `Resource` and declare `requires`/`adds` with `@export_flags("HasAmmo", "WeaponLoaded", …)`, keeping the names in bit order. Godot's `int` is 64-bit, so up to 64 facts fit.
- **Unreal:** no official GOAP. Run each plan step as a **StateTree** task or a latent Behavior Tree task, and let the movement steps use `AAIController::MoveToLocation`. `TArray::HeapPop` with two arguments works on every UE 5 version.

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
