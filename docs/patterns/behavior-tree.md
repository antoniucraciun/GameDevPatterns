# Behavior Tree

> Compose agent behaviour from a tree of reusable tasks, selectors and sequences.

**Category:** AI & Decision Making

## Problem

A guard should patrol, investigate noises, chase the player when seen, attack in range, and flee at low health. As a [state machine](./state), every state needs explicit transitions to most other states. With a dozen behaviours, the transition graph becomes unmanageable, and reusing a "flee" behaviour in another enemy means copying its transitions.

## Solution

Arrange behaviour as a **tree** that is evaluated from the root every tick. Each node returns **Success**, **Failure** or **Running**.

| Node | Kind | Behaviour |
| --- | --- | --- |
| **Action** | Leaf | Does something, such as moving to a point or playing an attack. Often returns Running for several ticks. |
| **Condition** | Leaf | Checks something, such as "can see player?". Returns Success or Failure. |
| **Sequence** | Composite | Runs children in order. Fails as soon as one fails. Acts as AND. |
| **Selector** (Fallback) | Composite | Tries children in order until one succeeds. Acts as OR, and expresses priorities. |
| **Decorator** | Single child | Modifies its child: Inverter, Repeat, Cooldown, Timeout. |

A selector at the root, with the most important behaviour first, gives priorities without any explicit transitions:

```
Selector
├── Sequence  [flee]    : IsHealthLow → MoveToCover
├── Sequence  [attack]  : CanSeePlayer → InRange → Attack
├── Sequence  [chase]   : CanSeePlayer → MoveToPlayer
└── Action    [patrol]  : Patrol
```

## Example

A guard that takes cover when hurt, attacks a visible player in range, chases a visible player, and otherwise patrols. Unity and Godot have no built-in behaviour tree, so the first group is a minimal one written from scratch. Unreal ships Behavior Trees and Blackboards in its AIModule, so its tabs show the custom C++ nodes you plug into a tree asset instead.

### Nodes

::: code-group

```csharp [Unity (C#)]
using System;

public enum Status { Success, Failure, Running }

public abstract class Node { public abstract Status Tick(); }

public class Sequence : Node
{
    readonly Node[] children;
    public Sequence(params Node[] children) => this.children = children;

    public override Status Tick()
    {
        foreach (var child in children)
        {
            var s = child.Tick();
            if (s != Status.Success) return s;   // Failure or Running stops the sequence
        }
        return Status.Success;
    }
}

public class Selector : Node
{
    readonly Node[] children;
    public Selector(params Node[] children) => this.children = children;

    public override Status Tick()
    {
        foreach (var child in children)
        {
            var s = child.Tick();
            if (s != Status.Failure) return s;   // Success or Running stops the selector
        }
        return Status.Failure;
    }
}

public class Condition : Node
{
    readonly Func<bool> check;
    public Condition(Func<bool> check) => this.check = check;
    public override Status Tick() => check() ? Status.Success : Status.Failure;
}

public class ActionNode : Node
{
    readonly Func<Status> action;
    public ActionNode(Func<Status> action) => this.action = action;
    public override Status Tick() => action();
}
```

```gdscript [Godot (GDScript)]
# bt.gd: a minimal behaviour tree. Its nodes are lightweight objects, not scene nodes.
class_name BT
extends RefCounted

enum Status { SUCCESS, FAILURE, RUNNING }


class BTNode:
	func tick() -> BT.Status:
		return BT.Status.FAILURE


class Composite extends BTNode:
	var children: Array[BTNode] = []

	func _init(nodes: Array) -> void:
		children.assign(nodes)


class Sequence extends Composite:
	func tick() -> BT.Status:
		for child: BTNode in children:
			var s := child.tick()
			if s != BT.Status.SUCCESS:
				return s  # FAILURE or RUNNING stops the sequence
		return BT.Status.SUCCESS


class Selector extends Composite:
	func tick() -> BT.Status:
		for child: BTNode in children:
			var s := child.tick()
			if s != BT.Status.FAILURE:
				return s  # SUCCESS or RUNNING stops the selector
		return BT.Status.FAILURE


class Condition extends BTNode:
	var _check: Callable

	func _init(check: Callable) -> void:
		_check = check

	func tick() -> BT.Status:
		return BT.Status.SUCCESS if _check.call() else BT.Status.FAILURE


class Action extends BTNode:
	var _action: Callable  # returns a BT.Status

	func _init(action: Callable) -> void:
		_action = action

	func tick() -> BT.Status:
		return _action.call()
```

```cpp [Unreal (C++)]
// Composites (Selector, Sequence), the tree asset and the Blackboard are built in.
// You write leaf nodes: a service keeps blackboard keys fresh, a decorator guards a branch,
// a task does the work. Add "AIModule" and "GameplayTasks" to the module's dependencies.

// BTService_FindPlayer.h
#pragma once

#include "CoreMinimal.h"
#include "BehaviorTree/BTService.h"
#include "BTService_FindPlayer.generated.h"

UCLASS()
class UBTService_FindPlayer : public UBTService
{
	GENERATED_BODY()

public:
	UBTService_FindPlayer();

protected:
	UPROPERTY(EditAnywhere, Category = "Blackboard")
	FBlackboardKeySelector TargetKey;           // Object: the player, or empty when not visible

	virtual void TickNode(UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory, float DeltaSeconds) override;
};

// BTService_FindPlayer.cpp
#include "BTService_FindPlayer.h"
#include "AIController.h"
#include "BehaviorTree/BlackboardComponent.h"
#include "Kismet/GameplayStatics.h"

UBTService_FindPlayer::UBTService_FindPlayer()
{
	NodeName = TEXT("Find Player");
	Interval = 0.25f;                           // services tick on their own interval, not every frame
	RandomDeviation = 0.05f;
}

void UBTService_FindPlayer::TickNode(UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory, float DeltaSeconds)
{
	Super::TickNode(OwnerComp, NodeMemory, DeltaSeconds);

	AAIController* AI = OwnerComp.GetAIOwner();
	APawn* Player = UGameplayStatics::GetPlayerPawn(AI, 0);
	UBlackboardComponent* BB = OwnerComp.GetBlackboardComponent();
	if (!AI || !BB) return;

	if (Player && AI->LineOfSightTo(Player))
		BB->SetValueAsObject(TargetKey.SelectedKeyName, Player);
	else
		BB->ClearValue(TargetKey.SelectedKeyName);
}

// BTDecorator_InRange.h
#pragma once

#include "CoreMinimal.h"
#include "BehaviorTree/BTDecorator.h"
#include "BTDecorator_InRange.generated.h"

UCLASS()
class UBTDecorator_InRange : public UBTDecorator
{
	GENERATED_BODY()

public:
	UBTDecorator_InRange() { NodeName = TEXT("In Range"); }

protected:
	UPROPERTY(EditAnywhere, Category = "Blackboard")
	FBlackboardKeySelector TargetKey;

	UPROPERTY(EditAnywhere, Category = "Condition")
	float Range = 200.f;

	virtual bool CalculateRawConditionValue(UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory) const override;
};

// BTDecorator_InRange.cpp
#include "BTDecorator_InRange.h"
#include "AIController.h"
#include "BehaviorTree/BlackboardComponent.h"

bool UBTDecorator_InRange::CalculateRawConditionValue(UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory) const
{
	const APawn* Self = OwnerComp.GetAIOwner() ? OwnerComp.GetAIOwner()->GetPawn() : nullptr;
	const AActor* Target = Cast<AActor>(
		OwnerComp.GetBlackboardComponent()->GetValueAsObject(TargetKey.SelectedKeyName));
	return Self && Target && FVector::Dist(Self->GetActorLocation(), Target->GetActorLocation()) <= Range;
}

// BTTask_Attack.h
#pragma once

#include "CoreMinimal.h"
#include "BehaviorTree/BTTaskNode.h"
#include "BTTask_Attack.generated.h"

UCLASS()
class UBTTask_Attack : public UBTTaskNode
{
	GENERATED_BODY()

public:
	UBTTask_Attack() { NodeName = TEXT("Attack"); }

protected:
	UPROPERTY(EditAnywhere, Category = "Blackboard")
	FBlackboardKeySelector TargetKey;

	UPROPERTY(EditAnywhere, Category = "Attack")
	float Damage = 10.f;

	virtual EBTNodeResult::Type ExecuteTask(UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory) override;
};

// BTTask_Attack.cpp
#include "BTTask_Attack.h"
#include "AIController.h"
#include "BehaviorTree/BlackboardComponent.h"
#include "Kismet/GameplayStatics.h"

EBTNodeResult::Type UBTTask_Attack::ExecuteTask(UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory)
{
	AAIController* AI = OwnerComp.GetAIOwner();
	AActor* Target = Cast<AActor>(OwnerComp.GetBlackboardComponent()->GetValueAsObject(TargetKey.SelectedKeyName));
	if (!AI || !AI->GetPawn() || !Target) return EBTNodeResult::Failed;

	UGameplayStatics::ApplyDamage(Target, Damage, AI, AI->GetPawn(), nullptr);
	return EBTNodeResult::Succeeded;            // a longer action returns InProgress and calls FinishLatentTask later
}
```

:::

### The guard

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class Guard : MonoBehaviour
{
    Node root;

    void Awake()
    {
        root = new Selector(
            new Sequence(new Condition(IsHealthLow), new ActionNode(MoveToCover)),
            new Sequence(new Condition(CanSeePlayer), new Condition(InAttackRange), new ActionNode(Attack)),
            new Sequence(new Condition(CanSeePlayer), new ActionNode(MoveToPlayer)),
            new ActionNode(Patrol));
    }

    void Update() => root.Tick();

    bool IsHealthLow() => /* ... */ false;
    bool CanSeePlayer() => /* ... */ false;
    bool InAttackRange() => /* ... */ false;
    Status MoveToCover() => Status.Running;
    Status Attack() => Status.Success;
    Status MoveToPlayer() => Status.Running;
    Status Patrol() => Status.Running;
}
```

```gdscript [Godot (GDScript)]
# guard.gd
extends CharacterBody3D

var _root: BT.BTNode


func _ready() -> void:
	_root = BT.Selector.new([
		BT.Sequence.new([BT.Condition.new(_is_health_low), BT.Action.new(_move_to_cover)]),
		BT.Sequence.new([BT.Condition.new(_can_see_player), BT.Condition.new(_in_attack_range),
				BT.Action.new(_attack)]),
		BT.Sequence.new([BT.Condition.new(_can_see_player), BT.Action.new(_move_to_player)]),
		BT.Action.new(_patrol),
	])


func _physics_process(_delta: float) -> void:
	_root.tick()


func _is_health_low() -> bool: return false  # ...
func _can_see_player() -> bool: return false
func _in_attack_range() -> bool: return false
func _move_to_cover() -> BT.Status: return BT.Status.RUNNING
func _attack() -> BT.Status: return BT.Status.SUCCESS
func _move_to_player() -> BT.Status: return BT.Status.RUNNING
func _patrol() -> BT.Status: return BT.Status.RUNNING
```

```cpp [Unreal (C++)]
// The tree itself is a Behavior Tree asset built in the editor:
//
//   Root (Blackboard: BB_Guard with keys Target: Object, HealthLow: Bool set by the pawn's health code)
//   └─ Selector                                    [Service: Find Player → Target]
//      ├─ Sequence   [Blackboard: HealthLow is set, Observer aborts: Lower Priority]
//      │  └─ Run EQS Query (find cover) → Move To
//      ├─ Sequence   [Blackboard: Target is set] [In Range]
//      │  └─ Attack
//      ├─ Sequence   [Blackboard: Target is set, Observer aborts: Lower Priority]
//      │  └─ Move To (Target)
//      └─ Move To (next patrol point)
//
// GuardAIController.h
#pragma once

#include "CoreMinimal.h"
#include "AIController.h"
#include "GuardAIController.generated.h"

class UBehaviorTree;

UCLASS()
class AGuardAIController : public AAIController
{
	GENERATED_BODY()

protected:
	UPROPERTY(EditDefaultsOnly, Category = "AI")
	TObjectPtr<UBehaviorTree> BehaviorTree;

	virtual void OnPossess(APawn* InPawn) override;
};

// GuardAIController.cpp
#include "GuardAIController.h"
#include "BehaviorTree/BehaviorTree.h"

void AGuardAIController::OnPossess(APawn* InPawn)
{
	Super::OnPossess(InPawn);
	RunBehaviorTree(BehaviorTree);               // also creates the Blackboard the tree asset names
}
```

:::

This minimal tree re-evaluates from the root every tick, so higher-priority branches can always interrupt lower ones (a "reactive" tree). Production implementations also track the running node, offer decorators, and read shared data from a [Blackboard](./blackboard). Unreal's tree is event-driven instead: it resumes the running task and only re-checks a higher branch when a decorator with **Observer aborts** sees its blackboard key change.

**Engine notes**

- **Unity:** no built-in behaviour tree. **Behavior** (the `com.unity.behavior` package, Unity 6) adds a graph editor and blackboard; NodeCanvas and Behavior Designer are the common Asset Store options.
- **Godot:** no built-in behaviour tree. **Beehave** (pure GDScript, trees built from scene nodes) and **LimboAI** (a C++ module/GDExtension with behaviour trees, state machines and a blackboard) are the popular add-ons. The tree above uses `RefCounted` objects so a thousand agents don't mean thousands of scene nodes.
- **Unreal:** Behavior Trees and Blackboards are built into AIModule and come with a visual editor and a runtime debugger. A custom decorator that isn't based on a blackboard key, like **In Range** above, is only re-checked when its branch is entered; to make a branch interrupt on a changing condition, have a service write a bool key and use the built-in Blackboard decorator with Observer aborts. **StateTree** is Unreal's alternative when a state machine with selectors fits better.

## When to use

- AI with many behaviours and clear priorities between them.
- Designers need to author or tweak AI, usually through a visual editor.
- Behaviours should be reused across different agent types.

## When not to use

- Simple AI with a few modes, such as an enemy that patrols, chases and attacks. A [State](./state) machine or an enum `switch` is easier to write and debug.
- Agents that weigh many competing needs. Priority order in a tree gets awkward; [Utility AI](./utility-ai) scores options directly.
- Building your own tree editor and runtime before you have AI that needs it. Start with code; adopt an existing tool when designers need to author behaviour.

## Pitfalls

- **Interrupted actions need cleanup.** When a higher-priority branch takes over, the running action must stop its animation, release reservations and so on. Add an `Abort` or `OnExit` hook.
- **Expensive conditions evaluated every tick.** Cache perception results, or tick the tree at a lower rate than the frame rate.
- **Using a tree as a state machine.** If the logic is really "mode A, then mode B", a [State](./state) machine is clearer.
- **Opaque at runtime.** Build a debug view that highlights the active path (see [Debug Draw](./debug-draw)).

## Related

- [State](./state) — simpler, and better for a few well-defined modes.
- [Blackboard](./blackboard) — the shared memory that nodes read and write.
- [Perception System](./perception-system) — supplies what the tree's conditions check.
- [Composite](./composite) and [Decorator](./decorator) — the general patterns behind composite and decorator nodes.
- [Steering Behaviors](./steering-behaviors) — how movement actions actually move the agent.
- [Utility AI](./utility-ai), [GOAP](./goap) and [HTN Planning](./htn-planning) — alternatives that score actions or plan them instead of following authored priorities.
