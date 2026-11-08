# Composite

> Treat a tree of objects and a single object uniformly (scene graphs, UI, BT nodes).

**Category:** Architecture & Structure

## Problem

In an RTS, the player can command a single unit, a squad of six, a platoon of three squads, or an entire army. "Move to here", "attack that", "how many units?", "what is the total health?" make sense for all of them. If commands handle each case separately (`if unit ... else if squad ... foreach platoon ...`), every new grouping level or command means another nested loop. Many familiar structures share this shape: UI panels containing panels, scene objects containing children, [behavior tree](./behavior-tree) nodes containing nodes, ability effects made of effects.

## Solution

Make **individual objects** (leaves) and **groups** (composites) implement **the same interface**. A composite holds children of that interface, and implements each operation by delegating to them, often combining the results.

```
           Army  (composite)
          /    \
   Platoon      Platoon  (composites)
   /  |  \         |
 Squad Squad Squad Squad  (composites)
  |||   |||   |||   |||
 units ...                (leaves)
```

Callers hold an `ICommandable` and call `MoveTo(point)` without knowing whether it is one unit or a thousand. New grouping levels need no new code, because a composite can contain composites.

## Example

RTS selection: a unit, a squad and an army all answer to the same commands, and groups can contain groups.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public interface ICommandable
{
    string Name { get; }
    int UnitCount { get; }
    float TotalHealth { get; }
    Vector3 Center { get; }
    void MoveTo(Vector3 destination);
    void Attack(ITargetable target);
}

// Leaf: one unit.
public class Unit : MonoBehaviour, ICommandable
{
    [SerializeField] float health = 100f;
    public string Name => name;
    public int UnitCount => 1;
    public float TotalHealth => health;
    public Vector3 Center => transform.position;
    public void MoveTo(Vector3 destination) { /* navmesh agent SetDestination */ }
    public void Attack(ITargetable target) { /* set attack target */ }
}

// Composite: a group of anything commandable, including other groups.
public class Group : ICommandable
{
    readonly List<ICommandable> members = new();
    public string Name { get; }
    public Group(string name) => Name = name;

    public void Add(ICommandable c) => members.Add(c);
    public void Remove(ICommandable c) => members.Remove(c);
    public IReadOnlyList<ICommandable> Members => members;

    public int UnitCount { get { int n = 0; foreach (var m in members) n += m.UnitCount; return n; } }
    public float TotalHealth { get { float h = 0; foreach (var m in members) h += m.TotalHealth; return h; } }

    public Vector3 Center
    {
        get
        {
            Vector3 sum = Vector3.zero;
            int n = 0;
            foreach (var m in members) { sum += m.Center * m.UnitCount; n += m.UnitCount; }   // weighted by size
            return n > 0 ? sum / n : Vector3.zero;
        }
    }

    // Operations delegate to children; a group can add its own logic, such as formations.
    public void MoveTo(Vector3 destination)
    {
        int columns = Mathf.CeilToInt(Mathf.Sqrt(members.Count));
        for (int i = 0; i < members.Count; i++)
        {
            var offset = new Vector3(i % columns, 0f, i / columns) * 3f;   // simple grid formation
            members[i].MoveTo(destination + offset);
        }
    }

    public void Attack(ITargetable target)
    {
        foreach (var m in members) m.Attack(target);
    }
}

// The UI and input code treat everything the same:
//   ICommandable selection = selectedArmy;          // or one unit, or one squad
//   selection.MoveTo(clickPoint);
//   hud.Show($"{selection.Name}: {selection.UnitCount} units, {selection.TotalHealth:0} HP");
```

```gdscript [Godot (GDScript)]
# unit.gd: leaf. GDScript uses duck typing: anything with these methods is "commandable".
class_name Unit
extends CharacterBody3D

@export var health := 100.0
@onready var _agent: NavigationAgent3D = $NavigationAgent3D

func unit_count() -> int: return 1
func total_health() -> float: return health
func center() -> Vector3: return global_position
func move_to(destination: Vector3) -> void: _agent.target_position = destination
func attack(target: Node3D) -> void: pass  # set attack target


# unit_group.gd: composite, a group of anything commandable, including other groups.
class_name UnitGroup
extends RefCounted

var group_name: String
var members: Array = []  # Units and UnitGroups

func _init(n: String) -> void:
	group_name = n

func unit_count() -> int:
	var n := 0
	for m in members: n += m.unit_count()
	return n

func total_health() -> float:
	var h := 0.0
	for m in members: h += m.total_health()
	return h

func center() -> Vector3:
	var sum := Vector3.ZERO
	var n := 0
	for m in members:  # weighted by size
		sum += m.center() * m.unit_count()
		n += m.unit_count()
	return sum / n if n > 0 else Vector3.ZERO

# Operations delegate to children; a group can add its own logic, such as formations.
func move_to(destination: Vector3) -> void:
	var columns := ceili(sqrt(members.size()))
	for i in members.size():
		var offset := Vector3(i % columns, 0, floori(i / float(columns))) * 3.0  # simple grid formation
		members[i].move_to(destination + offset)

func attack(target: Node3D) -> void:
	for m in members: m.attack(target)

# The UI and input code treat everything the same:
#   selection.move_to(click_point)
#   hud.show_text("%d units, %.0f HP" % [selection.unit_count(), selection.total_health()])
```

```cpp [Unreal (C++)]
// Commandable.h: a plain C++ interface. Units (actors) and groups (plain objects) both implement it.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "AIController.h"

class ICommandable
{
public:
	virtual ~ICommandable() = default;
	virtual int32 GetUnitCount() const = 0;
	virtual float GetTotalHealth() const = 0;
	virtual FVector GetCenter() const = 0;
	virtual void MoveTo(const FVector& Destination) = 0;
	virtual void Attack(AActor* Target) = 0;
};

// Unit.h: leaf, one unit. A UCLASS may also inherit plain C++ interfaces like this one.
UCLASS()
class AUnit : public ACharacter, public ICommandable
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Unit") float Health = 100.f;
	virtual int32 GetUnitCount() const override { return 1; }
	virtual float GetTotalHealth() const override { return Health; }
	virtual FVector GetCenter() const override { return GetActorLocation(); }
	virtual void MoveTo(const FVector& Destination) override
	{
		if (AAIController* AI = Cast<AAIController>(GetController())) AI->MoveToLocation(Destination);
	}
	virtual void Attack(AActor* Target) override { /* set attack target */ }
};

// Composite: a group of anything commandable, including other groups.
class FUnitGroup : public ICommandable
{
public:
	explicit FUnitGroup(FString InName) : Name(MoveTemp(InName)) {}

	void Add(ICommandable* Member) { Members.Add(Member); }      // members must outlive the group, or be removed
	void Remove(ICommandable* Member) { Members.Remove(Member); }

	virtual int32 GetUnitCount() const override
	{
		int32 N = 0;
		for (const ICommandable* M : Members) N += M->GetUnitCount();
		return N;
	}

	virtual float GetTotalHealth() const override
	{
		float H = 0.f;
		for (const ICommandable* M : Members) H += M->GetTotalHealth();
		return H;
	}

	virtual FVector GetCenter() const override
	{
		FVector Sum = FVector::ZeroVector;
		int32 N = 0;
		for (const ICommandable* M : Members) { Sum += M->GetCenter() * M->GetUnitCount(); N += M->GetUnitCount(); }   // weighted by size
		return N > 0 ? Sum / N : FVector::ZeroVector;
	}

	// Operations delegate to children; a group can add its own logic, such as formations.
	virtual void MoveTo(const FVector& Destination) override
	{
		const int32 Columns = FMath::CeilToInt(FMath::Sqrt(float(Members.Num())));
		for (int32 I = 0; I < Members.Num(); ++I)
			Members[I]->MoveTo(Destination + FVector(I % Columns, I / Columns, 0.f) * 300.f);   // simple grid formation
	}

	virtual void Attack(AActor* Target) override
	{
		for (ICommandable* M : Members) M->Attack(Target);
	}

	FString Name;

private:
	TArray<ICommandable*> Members;
};
```

:::

The engines' own hierarchies (Unity's Transform tree, Godot's scene tree, Unreal's component attachment), UI layout containers, [behavior trees](./behavior-tree) and the `AreaEffect` in [Data-Driven Abilities](../recipes/data-driven-abilities), which contains other effects, are all composites.

**Engine notes**

- **Unity:** `GetComponent<ICommandable>()` and `TryGetComponent<ICommandable>()` find components by interface, which is what selection raycasts need. Groups are plain C# objects, not components.
- **Godot:** with duck typing, give every commandable the same method names and check with `has_method` at the boundary (selection) rather than everywhere.
- **Unreal:** a plain C++ interface can't be used from Blueprints. If designers need to command units in Blueprint, declare it as a `UINTERFACE` instead, and hold group members as `TWeakObjectPtr` (or `TScriptInterface`) so destroyed units drop out safely.

## When to use

- Part–whole hierarchies where clients should not care about the difference: unit groups, UI containers, scene graphs, effect lists, AI task trees, inventory bags inside bags.
- Operations that naturally aggregate (count, total weight, bounds) or broadcast (move all, enable all).

## When not to use

- Flat collections where nothing nests. A `List<T>` and a loop is enough.
- When leaves and groups need very different operations. Forcing them behind one interface leads to methods that do nothing or throw.
- The engine's scene hierarchy already composes objects (Unity's Transform hierarchy, Godot's node tree, Unreal's component attachment). Don't build a parallel tree for things the scene graph handles.

## Pitfalls

- **Cycles.** A group added to itself, directly or indirectly, recurses forever. Check ancestry when adding.
- **Operations that do not make sense for leaves.** `Add` and `Remove` on a single unit are meaningless. Keep them on the composite only, and accept that callers who build trees know which is which.
- **Aggregates recomputed constantly.** Summing health over 1,000 units every frame for a HUD is wasteful. Cache with a [Dirty Flag](./dirty-flag), invalidated when a child changes.
- **Removed or destroyed leaves.** A unit that dies must leave every group it is in. Raise an event on death, and let groups remove it ([Observer](./observer)).

## Related

- [Behavior Tree](./behavior-tree) — sequences and selectors are composites of nodes.
- [Decorator](./decorator) — wraps one object with the same interface. A composite wraps many.
- [Command](./command) — commands issued to a composite fan out to its leaves.
- [Visitor](./visitor) — performs operations over a composite structure without changing its classes.
- [Dirty Flag](./dirty-flag) — caches expensive aggregates.
- [Iterator](./iterator) — walks a composite tree depth-first or breadth-first without exposing its structure.
