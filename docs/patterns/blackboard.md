# Blackboard

> A shared key–value memory that decision-making components read and write.

**Category:** AI & Decision Making

## Problem

A guard's [behavior tree](./behavior-tree) has a "can see player?" condition, a "move to last known position" action and an "investigate noise" action. They all need the same facts: who the target is, where it was last seen, where the noise came from. Passing these through method parameters does not fit a tree of independent nodes. Storing them as fields on a `Guard` class couples every reusable node to one enemy type. And squads need to share some facts, so that when one guard spots the player, the others know.

## Solution

Give each agent a **blackboard**: a dictionary of facts, keyed by name or by typed key, that any component can read and write.

- **Sensors write** what the agent perceives (`Target`, `LastKnownPosition`, `NoiseLocation`).
- **Decision-makers read** facts to choose behaviour, and **write** their own intermediate results (`ChosenCover`, `PatrolIndex`).
- Nodes depend only on **keys**, not on concrete classes, so the same "MoveTo(key)" node works for every agent.

Useful extras:

| Feature | Why |
| --- | --- |
| **Typed keys** | `BlackboardKey<Vector3>` catches type mismatches at compile time, not at runtime. |
| **Change notifications** | Reactive behavior trees abort a running branch when a fact it depends on changes. |
| **Timestamps** | "Last seen 4 s ago" lets behaviour fade from *chase* to *search* to *give up*. |
| **Parent blackboard** | A squad or global blackboard that agents fall back to for shared facts. |

## Example

A guard's memory: the target, where it was last seen, where a noise came from, all with timestamps so the tree can ask "how fresh is this?". Unreal has blackboards built in (`UBlackboardComponent` plus a Blackboard asset), so its tabs use those; Unity and Godot get a small class.

### The blackboard

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

// Typed keys: create once, share everywhere. Reference equality makes lookups cheap.
public sealed class BlackboardKey<T>
{
    public readonly string Name;
    public BlackboardKey(string name) => Name = name;
    public override string ToString() => Name;
}

public static class Keys
{
    public static readonly BlackboardKey<Transform> Target            = new("Target");
    public static readonly BlackboardKey<Vector3>   LastKnownPosition = new("LastKnownPosition");
    public static readonly BlackboardKey<Vector3>   NoiseLocation     = new("NoiseLocation");
    public static readonly BlackboardKey<int>       PatrolIndex       = new("PatrolIndex");
}

public class Blackboard
{
    struct Entry { public object Value; public float Time; }

    readonly Dictionary<object, Entry> entries = new();
    readonly Blackboard parent;                     // e.g. the squad's shared blackboard

    public event Action<object> Changed;            // key that changed

    public Blackboard(Blackboard parent = null) => this.parent = parent;

    public void Set<T>(BlackboardKey<T> key, T value)
    {
        bool same = entries.TryGetValue(key, out var old) && Equals(old.Value, value);
        entries[key] = new Entry { Value = value, Time = UnityEngine.Time.time };   // refresh timestamp
        if (!same) Changed?.Invoke(key);
    }

    public bool TryGet<T>(BlackboardKey<T> key, out T value)
    {
        if (entries.TryGetValue(key, out var e)) { value = (T)e.Value; return true; }
        if (parent != null) return parent.TryGet(key, out value);
        value = default;
        return false;
    }

    public T Get<T>(BlackboardKey<T> key, T fallback = default) => TryGet(key, out var v) ? v : fallback;

    public bool Has<T>(BlackboardKey<T> key) => TryGet(key, out _);

    // Seconds since the fact was last written; infinity if unknown.
    public float Age<T>(BlackboardKey<T> key) =>
        entries.TryGetValue(key, out var e) ? UnityEngine.Time.time - e.Time
        : parent?.Age(key) ?? float.PositiveInfinity;

    public void Clear<T>(BlackboardKey<T> key)
    {
        if (entries.Remove(key)) Changed?.Invoke(key);
    }
}
```

```gdscript [Godot (GDScript)]
# blackboard.gd
class_name Blackboard
extends RefCounted

signal changed(key: StringName)

# Keys as StringName constants, shared by every script: a typo is a parse error, not a silent miss.
# GDScript has no generics, so unlike typed keys these don't check the value's type.
const TARGET := &"target"
const LAST_KNOWN_POSITION := &"last_known_position"
const NOISE_LOCATION := &"noise_location"
const PATROL_INDEX := &"patrol_index"

var parent: Blackboard  # e.g. the squad's shared blackboard
var _values := {}
var _times := {}


func _init(p_parent: Blackboard = null) -> void:
	parent = p_parent


func set_value(key: StringName, value: Variant) -> void:
	var old: Variant = _values.get(key)
	var same := _values.has(key) and typeof(old) == typeof(value) and old == value
	_values[key] = value
	_times[key] = _now()  # refresh timestamp
	if not same:
		changed.emit(key)


func get_value(key: StringName, fallback: Variant = null) -> Variant:
	if _values.has(key):
		return _values[key]
	return parent.get_value(key, fallback) if parent else fallback


func has(key: StringName) -> bool:
	return _values.has(key) or (parent != null and parent.has(key))


## Seconds since the fact was last written; INF if unknown.
func age(key: StringName) -> float:
	if _times.has(key):
		return _now() - _times[key]
	return parent.age(key) if parent else INF


func erase(key: StringName) -> void:
	if _values.erase(key):
		_times.erase(key)
		changed.emit(key)


static func _now() -> float:
	return Time.get_ticks_msec() / 1000.0  # real time; ignores Engine.time_scale
```

```cpp [Unreal (C++)]
// The blackboard is a Blackboard asset (BB_Guard) with typed keys:
//   Target (Object, base class Actor), LastKnownPosition (Vector), LastSeenTime (Float),
//   NoiseLocation (Vector), NoiseTime (Float), PatrolIndex (Int).
// Unreal stores no timestamps, so "when" is a key of its own. Ticking "Instance Synced" on a key
// shares its value between every agent using BB_Guard: a squad blackboard with no extra code.

// GuardAIController.h
#pragma once

#include "CoreMinimal.h"
#include "AIController.h"
#include "BehaviorTree/BlackboardComponent.h"
#include "GuardAIController.generated.h"

UCLASS()
class AGuardAIController : public AAIController
{
	GENERATED_BODY()

public:
	void OnPlayerSeen(AActor* Player);          // called by perception
	void OnNoiseHeard(const FVector& Location);

protected:
	virtual void OnPossess(APawn* InPawn) override;

	UPROPERTY(EditDefaultsOnly, Category = "AI")
	TObjectPtr<class UBehaviorTree> BehaviorTree;

private:
	EBlackboardNotificationResult OnTargetChanged(const UBlackboardComponent& BB, FBlackboard::FKey Key);
};

// GuardAIController.cpp
#include "GuardAIController.h"
#include "BehaviorTree/BehaviorTree.h"

void AGuardAIController::OnPossess(APawn* InPawn)
{
	Super::OnPossess(InPawn);
	RunBehaviorTree(BehaviorTree);              // creates the blackboard from the tree's BB_Guard

	// Observers fire when a key's value changes, like the Changed event in the other tabs.
	UBlackboardComponent* BB = GetBlackboardComponent();
	BB->RegisterObserver(BB->GetKeyID(TEXT("Target")), this,
		FOnBlackboardChangeNotification::CreateUObject(this, &AGuardAIController::OnTargetChanged));
}

void AGuardAIController::OnPlayerSeen(AActor* Player)
{
	UBlackboardComponent* BB = GetBlackboardComponent();
	BB->SetValueAsObject(TEXT("Target"), Player);
	BB->SetValueAsVector(TEXT("LastKnownPosition"), Player->GetActorLocation());
	BB->SetValueAsFloat(TEXT("LastSeenTime"), GetWorld()->GetTimeSeconds());
}

void AGuardAIController::OnNoiseHeard(const FVector& Location)
{
	UBlackboardComponent* BB = GetBlackboardComponent();
	BB->SetValueAsVector(TEXT("NoiseLocation"), Location);
	BB->SetValueAsFloat(TEXT("NoiseTime"), GetWorld()->GetTimeSeconds());
}

EBlackboardNotificationResult AGuardAIController::OnTargetChanged(const UBlackboardComponent& BB, FBlackboard::FKey Key)
{
	// e.g. play an "I see you!" bark when a target appears
	return EBlackboardNotificationResult::ContinueObserving;
}
```

:::

### Nodes that only know about keys

Reusable behaviour-tree nodes read the blackboard by key, so the same node serves the chase, the search and the noise check:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;
using UnityEngine.AI;

public class HasRecent<T> : Node                         // Node/Status from the Behavior Tree pattern
{
    readonly Blackboard bb; readonly BlackboardKey<T> key; readonly float maxAge;
    public HasRecent(Blackboard bb, BlackboardKey<T> key, float maxAge) { this.bb = bb; this.key = key; this.maxAge = maxAge; }
    public override Status Tick() => bb.Age(key) <= maxAge ? Status.Success : Status.Failure;
}

public class MoveToKey : Node
{
    readonly Blackboard bb; readonly BlackboardKey<Vector3> key; readonly NavMeshAgent agent;
    public MoveToKey(Blackboard bb, BlackboardKey<Vector3> key, NavMeshAgent agent) { this.bb = bb; this.key = key; this.agent = agent; }

    public override Status Tick()
    {
        if (!bb.TryGet(key, out var destination)) return Status.Failure;
        agent.SetDestination(destination);
        return agent.remainingDistance > agent.stoppingDistance || agent.pathPending ? Status.Running : Status.Success;
    }
}

// Guard tree: chase while the sighting is fresh, then search where it was last seen, then patrol.
// root = new Selector(
//     new Sequence(new HasRecent<Vector3>(bb, Keys.LastKnownPosition, 1f),  new ActionNode(Chase)),
//     new Sequence(new HasRecent<Vector3>(bb, Keys.LastKnownPosition, 10f), new MoveToKey(bb, Keys.LastKnownPosition, agent)),
//     new Sequence(new HasRecent<Vector3>(bb, Keys.NoiseLocation, 8f),      new MoveToKey(bb, Keys.NoiseLocation, agent)),
//     new ActionNode(Patrol));
```

```gdscript [Godot (GDScript)]
# blackboard_nodes.gd: BT nodes from the Behavior Tree pattern, reading only keys.
class_name BlackboardNodes
extends RefCounted


class HasRecent extends BT.BTNode:
	var _bb: Blackboard
	var _key: StringName
	var _max_age: float

	func _init(bb: Blackboard, key: StringName, max_age: float) -> void:
		_bb = bb
		_key = key
		_max_age = max_age

	func tick() -> BT.Status:
		return BT.Status.SUCCESS if _bb.age(_key) <= _max_age else BT.Status.FAILURE


class MoveToKey extends BT.BTNode:
	var _bb: Blackboard
	var _key: StringName
	var _agent: NavigationAgent3D  # the body follows agent.get_next_path_position() each physics frame

	func _init(bb: Blackboard, key: StringName, agent: NavigationAgent3D) -> void:
		_bb = bb
		_key = key
		_agent = agent

	func tick() -> BT.Status:
		if not _bb.has(_key):
			return BT.Status.FAILURE
		var destination: Vector3 = _bb.get_value(_key)
		if not _agent.target_position.is_equal_approx(destination):
			_agent.target_position = destination  # each change requests a new path, so only on change
		return BT.Status.SUCCESS if _agent.is_navigation_finished() else BT.Status.RUNNING

# Guard tree: chase while the sighting is fresh, then search where it was last seen, then patrol.
# _root = BT.Selector.new([
# 	BT.Sequence.new([BlackboardNodes.HasRecent.new(bb, Blackboard.LAST_KNOWN_POSITION, 1.0), BT.Action.new(_chase)]),
# 	BT.Sequence.new([BlackboardNodes.HasRecent.new(bb, Blackboard.LAST_KNOWN_POSITION, 10.0),
# 			BlackboardNodes.MoveToKey.new(bb, Blackboard.LAST_KNOWN_POSITION, agent)]),
# 	BT.Sequence.new([BlackboardNodes.HasRecent.new(bb, Blackboard.NOISE_LOCATION, 8.0),
# 			BlackboardNodes.MoveToKey.new(bb, Blackboard.NOISE_LOCATION, agent)]),
# 	BT.Action.new(_patrol),
# ])
```

```cpp [Unreal (C++)]
// Move To is built in (BTTask_MoveTo takes a Vector or Actor key), so only "how fresh" needs code.

// BTDecorator_HasRecent.h
#pragma once

#include "CoreMinimal.h"
#include "BehaviorTree/BTDecorator.h"
#include "BTDecorator_HasRecent.generated.h"

UCLASS()
class UBTDecorator_HasRecent : public UBTDecorator
{
	GENERATED_BODY()

public:
	UBTDecorator_HasRecent() { NodeName = TEXT("Has Recent"); }

protected:
	UPROPERTY(EditAnywhere, Category = "Blackboard")
	FBlackboardKeySelector TimeKey;             // Float key holding when the fact was written

	UPROPERTY(EditAnywhere, Category = "Condition")
	float MaxAge = 10.f;

	virtual bool CalculateRawConditionValue(UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory) const override;
};

// BTDecorator_HasRecent.cpp
#include "BTDecorator_HasRecent.h"
#include "BehaviorTree/BlackboardComponent.h"

bool UBTDecorator_HasRecent::CalculateRawConditionValue(UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory) const
{
	const UBlackboardComponent* BB = OwnerComp.GetBlackboardComponent();
	if (!BB) return false;
	const float WrittenAt = BB->GetValueAsFloat(TimeKey.SelectedKeyName);   // 0 if never written
	return WrittenAt > 0.f && OwnerComp.GetWorld()->GetTimeSeconds() - WrittenAt <= MaxAge;
}

// Guard tree:
//   Selector
//   ├─ Sequence [Has Recent: LastSeenTime, 1 s]   → Chase (Move To: Target)
//   ├─ Sequence [Has Recent: LastSeenTime, 10 s]  → Move To: LastKnownPosition
//   ├─ Sequence [Has Recent: NoiseTime, 8 s]      → Move To: NoiseLocation
//   └─ Patrol
```

:::

Squad sharing: give every guard `new Blackboard(parent: squadBlackboard)` (Godot: `Blackboard.new(squad_blackboard)`). When one guard sees the player, its perception writes `LastKnownPosition` to the *squad* blackboard, and every guard's tree reads it through the parent chain. In Unreal, mark the shared keys **Instance Synced** instead.

**Engine notes**

- **Unity:** the **Behavior** package (Unity 6) has its own blackboard with typed variables, shared through *Blackboard assets*. The class above keeps typed keys without it; `NavMeshAgent` needs the AI Navigation package and a baked navmesh.
- **Godot:** no built-in blackboard; LimboAI ships one (`Blackboard` with scoped parents) if you use that add-on. `Time.get_ticks_msec()` ignores `Engine.time_scale`, so ages keep counting during slow motion; track your own scaled clock if that matters.
- **Unreal:** a time-based condition like **Has Recent** changes without its key changing, so it won't trigger **Observer aborts** on its own; it is checked when the selector reaches it. Blackboard observers (`RegisterObserver`) are how C++ reacts to a key change outside the tree; remove them with `UnregisterObserversFrom(this)` if the controller outlives the tree.

## When to use

- AI built from independent, reusable parts: behavior tree nodes, utility considerations, GOAP actions.
- Sharing knowledge between agents (squads, factions) or between AI and a director system.
- Designer tools where nodes are wired to keys in an editor.

## When not to use

- A single agent whose AI reads a few of its own fields. Plain fields on the agent class are typed, faster and easier to find.
- As a global dumping ground for any data. Untyped string keys hide dependencies; keep the blackboard small and documented.
- Sharing data that already has a clear owner, such as the player's health. Read it from that owner.

## Pitfalls

- **A dumping ground.** Without discipline, the blackboard becomes a bag of global variables. Define keys in one place, and give each key a clear owner that writes it.
- **Stale facts.** A `Target` that died stays on the board, and the agent chases a corpse. Clear facts when they stop being true, or use timestamps and treat old facts as unknown.
- **Boxing.** Storing value types as `object` allocates on every `Set`. That is fine for a few dozen agents. For hundreds, use per-type dictionaries or a struct-based store.
- **Hidden coupling through keys.** Two systems that disagree on what a key means (`Target` as "attack this" versus "look at this") cause subtle bugs. Name keys by meaning, and document them next to their definition.

## Related

- [Behavior Tree](./behavior-tree) — the most common consumer.
- [Perception System](./perception-system) — the main writer.
- [Observer](./observer) — change notifications for reactive trees.
- [Utility AI](./utility-ai), [GOAP](./goap) and [HTN Planning](./htn-planning) — also read their world state from a blackboard.
