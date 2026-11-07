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

## Example

The **core** is the planner: depth-first decomposition with backtracking over methods, with no engine types. The **domain** is a soldier authored as ways of doing things.

### Core

::: code-group

```csharp [Unity (C#)]
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

```gdscript [Godot (GDScript)]
# htn.gd: tasks, methods and the planner. The world state is a Dictionary, copied with duplicate().
class_name Htn
extends RefCounted


class Task:
	var task_name: String


class PrimitiveTask extends Task:
	var precondition: Callable  # (state) -> bool; empty means always true
	var effect: Callable        # (state) -> void; simulated during planning

	func _init(p_name: String, p_precondition := Callable(), p_effect := Callable()) -> void:
		task_name = p_name
		precondition = p_precondition
		effect = p_effect


class Method:
	var method_name: String
	var condition: Callable
	var subtasks: Array[Task] = []

	func _init(p_name: String, p_condition: Callable, p_subtasks: Array) -> void:
		method_name = p_name
		condition = p_condition
		subtasks.assign(p_subtasks)


class CompoundTask extends Task:
	var methods: Array[Method] = []  # tried in order: designer priority

	func _init(p_name: String) -> void:
		task_name = p_name


## Returns the plan, or an empty array if no decomposition works.
static func plan(root: Task, state: Dictionary) -> Array[PrimitiveTask]:
	var result: Array[PrimitiveTask] = []
	if not _decompose([root], 0, state.duplicate(), result):
		result.clear()
	return result


# Depth-first decomposition with backtracking over methods.
static func _decompose(tasks: Array, index: int, state: Dictionary, out_plan: Array[PrimitiveTask]) -> bool:
	if index == tasks.size():
		return true  # everything decomposed
	var task: Task = tasks[index]

	if task is PrimitiveTask:
		var p := task as PrimitiveTask
		if p.precondition.is_valid() and not p.precondition.call(state):
			return false
		var next := state.duplicate()  # Dictionaries are shared by reference, so copy before simulating
		if p.effect.is_valid():
			p.effect.call(next)
		out_plan.append(p)
		if _decompose(tasks, index + 1, next, out_plan):
			return true
		out_plan.pop_back()  # backtrack
		return false

	for m: Method in (task as CompoundTask).methods:
		if not m.condition.call(state):
			continue
		# Replace the compound task with this method's subtasks, then continue.
		var expanded := tasks.slice(0, index)
		expanded.append_array(m.subtasks)
		expanded.append_array(tasks.slice(index + 1))

		var plan_size := out_plan.size()
		if _decompose(expanded, index, state, out_plan):
			return true
		out_plan.resize(plan_size)  # undo this method's tasks
	return false  # no method worked
```

```cpp [Unreal (C++)]
// HtnPlanner.h: plain C++. Unreal builds without RTTI, so one task struct covers both kinds.
#pragma once

#include "CoreMinimal.h"

struct FHtnWorldState                          // copied by value, so simulating a step can't leak
{
	bool bHasAmmo = false, bWeaponLoaded = false, bInRange = false, bAmmoNearby = false, bEnemyVisible = false;
};

struct FHtnTask;

struct FHtnMethod
{
	FString Name;
	TFunction<bool(const FHtnWorldState&)> Condition;
	TArray<const FHtnTask*> Subtasks;
};

struct FHtnTask
{
	FString Name;

	// Primitive tasks: both optional (empty Precondition = always true).
	TFunction<bool(const FHtnWorldState&)> Precondition;
	TFunction<void(FHtnWorldState&)> Effect;   // simulated during planning

	// Compound tasks: tried in order, designer priority.
	TArray<FHtnMethod> Methods;

	bool IsCompound() const { return Methods.Num() > 0; }
};

class FHtnPlanner
{
public:
	// OutPlan points at tasks owned by the domain, so keep the domain alive while executing.
	static bool Plan(const FHtnTask& Root, const FHtnWorldState& State, TArray<const FHtnTask*>& OutPlan);

private:
	static bool Decompose(const TArray<const FHtnTask*>& Tasks, int32 Index, const FHtnWorldState& State,
		TArray<const FHtnTask*>& OutPlan);
};

// HtnPlanner.cpp
#include "HtnPlanner.h"

bool FHtnPlanner::Plan(const FHtnTask& Root, const FHtnWorldState& State, TArray<const FHtnTask*>& OutPlan)
{
	OutPlan.Reset();
	return Decompose({&Root}, 0, State, OutPlan);
}

// Depth-first decomposition with backtracking over methods.
bool FHtnPlanner::Decompose(const TArray<const FHtnTask*>& Tasks, int32 Index, const FHtnWorldState& State,
	TArray<const FHtnTask*>& OutPlan)
{
	if (Index == Tasks.Num()) return true;      // everything decomposed
	const FHtnTask& Task = *Tasks[Index];

	if (!Task.IsCompound())
	{
		if (Task.Precondition && !Task.Precondition(State)) return false;
		FHtnWorldState Next = State;
		if (Task.Effect) Task.Effect(Next);
		OutPlan.Add(&Task);
		if (Decompose(Tasks, Index + 1, Next, OutPlan)) return true;
		OutPlan.Pop();                          // backtrack
		return false;
	}

	for (const FHtnMethod& Method : Task.Methods)
	{
		if (!Method.Condition(State)) continue;
		// Replace the compound task with this method's subtasks, then continue.
		TArray<const FHtnTask*> Expanded;
		Expanded.Reserve(Tasks.Num() + Method.Subtasks.Num());
		Expanded.Append(Tasks.GetData(), Index);
		Expanded.Append(Method.Subtasks);
		Expanded.Append(Tasks.GetData() + Index + 1, Tasks.Num() - Index - 1);

		const int32 PlanSize = OutPlan.Num();
		if (Decompose(Expanded, Index, State, OutPlan)) return true;
		OutPlan.SetNum(PlanSize);               // undo this method's tasks
	}
	return false;                               // no method worked
}
```

:::

### Domain

A soldier domain, authored as ways of doing things:

::: code-group

```csharp [Unity (C#)]
public static class SoldierDomain
{
    public static CompoundTask Build()
    {
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
        return root;
    }

    public static void Demo()
    {
        var plan = HtnPlanner.Plan(Build(), new WorldState { EnemyVisible = true, AmmoNearby = true });
        // → PickUpAmmo, Reload, MoveInRange, Shoot   (the first method whose whole decomposition works)
    }
}
```

```gdscript [Godot (GDScript)]
# soldier_domain.gd
class_name SoldierDomain
extends RefCounted


static func build() -> Htn.CompoundTask:
	var move_in_range := Htn.PrimitiveTask.new("MoveInRange", Callable(),
			func(s: Dictionary) -> void: s["in_range"] = true)
	var pick_up_ammo := Htn.PrimitiveTask.new("PickUpAmmo",
			func(s: Dictionary) -> bool: return s["ammo_nearby"],
			func(s: Dictionary) -> void: s["has_ammo"] = true)
	var reload := Htn.PrimitiveTask.new("Reload",
			func(s: Dictionary) -> bool: return s["has_ammo"],
			func(s: Dictionary) -> void: s["weapon_loaded"] = true)
	var shoot := Htn.PrimitiveTask.new("Shoot",
			func(s: Dictionary) -> bool: return s["weapon_loaded"] and s["in_range"])
	var charge := Htn.PrimitiveTask.new("MeleeCharge", Callable(),
			func(s: Dictionary) -> void: s["in_range"] = true)
	var search_area := Htn.PrimitiveTask.new("SearchArea")
	var always := func(_s: Dictionary) -> bool: return true

	var attack := Htn.CompoundTask.new("AttackEnemy")
	attack.methods.append(Htn.Method.new("Shoot (loaded)",
			func(s: Dictionary) -> bool: return s["weapon_loaded"], [move_in_range, shoot]))
	attack.methods.append(Htn.Method.new("Reload first",
			func(s: Dictionary) -> bool: return s["has_ammo"], [reload, move_in_range, shoot]))
	attack.methods.append(Htn.Method.new("Get ammo",
			func(s: Dictionary) -> bool: return s["ammo_nearby"], [pick_up_ammo, reload, move_in_range, shoot]))
	attack.methods.append(Htn.Method.new("Melee", always, [charge]))

	var root := Htn.CompoundTask.new("BeSoldier")
	root.methods.append(Htn.Method.new("Fight",
			func(s: Dictionary) -> bool: return s["enemy_visible"], [attack]))
	root.methods.append(Htn.Method.new("Patrol", always, [search_area]))
	return root


static func demo() -> void:
	var state := {
		"has_ammo": false, "weapon_loaded": false, "in_range": false,
		"ammo_nearby": true, "enemy_visible": true,
	}
	var steps := Htn.plan(build(), state)
	print(steps.map(func(t: Htn.PrimitiveTask) -> String: return t.task_name))
	# → ["PickUpAmmo", "Reload", "MoveInRange", "Shoot"]   (the first method whose whole decomposition works)
```

```cpp [Unreal (C++)]
// SoldierDomain.h: the domain owns its tasks, so plans can point into it.
#pragma once

#include "HtnPlanner.h"

struct FSoldierDomain
{
	FHtnTask MoveInRange, PickUpAmmo, Reload, Shoot, Charge, SearchArea, Attack, Root;

	FSoldierDomain()
	{
		using FState = FHtnWorldState;
		MoveInRange = {TEXT("MoveInRange"), nullptr, [](FState& S) { S.bInRange = true; }};
		PickUpAmmo = {TEXT("PickUpAmmo"), [](const FState& S) { return S.bAmmoNearby; },
			[](FState& S) { S.bHasAmmo = true; }};
		Reload = {TEXT("Reload"), [](const FState& S) { return S.bHasAmmo; },
			[](FState& S) { S.bWeaponLoaded = true; }};
		Shoot = {TEXT("Shoot"), [](const FState& S) { return S.bWeaponLoaded && S.bInRange; }, nullptr};
		Charge = {TEXT("MeleeCharge"), nullptr, [](FState& S) { S.bInRange = true; }};
		SearchArea.Name = TEXT("SearchArea");

		auto Always = [](const FState&) { return true; };
		Attack.Name = TEXT("AttackEnemy");
		Attack.Methods = {
			{TEXT("Shoot (loaded)"), [](const FState& S) { return S.bWeaponLoaded; }, {&MoveInRange, &Shoot}},
			{TEXT("Reload first"), [](const FState& S) { return S.bHasAmmo; }, {&Reload, &MoveInRange, &Shoot}},
			{TEXT("Get ammo"), [](const FState& S) { return S.bAmmoNearby; },
				{&PickUpAmmo, &Reload, &MoveInRange, &Shoot}},
			{TEXT("Melee"), Always, {&Charge}},
		};

		Root.Name = TEXT("BeSoldier");
		Root.Methods = {
			{TEXT("Fight"), [](const FState& S) { return S.bEnemyVisible; }, {&Attack}},
			{TEXT("Patrol"), Always, {&SearchArea}},
		};
	}

	// Tasks point at each other, so the domain must stay where it was built.
	FSoldierDomain(const FSoldierDomain&) = delete;
	FSoldierDomain& operator=(const FSoldierDomain&) = delete;
};

// Usage, e.g. in an AI controller that holds a FSoldierDomain member:
//   FHtnWorldState State;
//   State.bEnemyVisible = State.bAmmoNearby = true;
//   TArray<const FHtnTask*> Plan;
//   FHtnPlanner::Plan(Domain.Root, State, Plan);
//   → PickUpAmmo, Reload, MoveInRange, Shoot   (the first method whose whole decomposition works)
```

:::

The agent executes the plan step by step, and replans when a step fails or the world state changes in a way the plan relied on.

**Engine notes**

- **Unity:** no built-in HTN planner. `MemberwiseClone` is enough for a world state of value fields; deep-copy any lists it gains.
- **Godot:** no built-in HTN planner. Dictionaries and arrays are passed by reference, which is why every simulated step works on `state.duplicate()`; forgetting that lets one branch's effects leak into the next.
- **Unreal:** no official HTN planner. Execute each primitive task as a **StateTree** task or a latent Behavior Tree task, and replan when one fails. `FHtnWorldState` is copied by value, so backtracking needs no undo.

## When to use

- AI where designers want explicit control over strategies, plus look-ahead to avoid starting plans that cannot finish: tactical shooters, squad AI, NPC daily routines.
- Large behaviour sets where GOAP's search would be too slow or too unpredictable.

## When not to use

- AI with only a few behaviours. A [Behavior Tree](./behavior-tree) or [State](./state) machine is simpler.
- When you want the AI to discover novel solutions on its own. HTN follows designer-written methods; [GOAP](./goap) searches more freely.
- Teams without time to build planner debugging tools. Plans that fail silently are hard to diagnose.

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
