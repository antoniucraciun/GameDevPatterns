# Visitor

> Add operations over a fixed object hierarchy without modifying its classes.

**Category:** Behavioral & Communication

## Problem

A level editor has a handful of element types: `Wall`, `Door`, `SpawnPoint`, `Trigger`, `Light`. Over time, more and more operations are needed on them: validate the level, compute a performance budget, export to the runtime format, draw editor gizmos, generate a minimap, count objectives. Adding each operation as a method on every element class bloats them with unrelated concerns (export code inside `Wall`?), and the code for one operation is scattered across five files. Writing it as `if (e is Wall) ... else if (e is Door) ...` repeats a type switch in every operation, and silently misses new element types.

## Solution

Separate **operations** from **the element classes**:

- Each element class has one method, `Accept(visitor)`, which calls back the visitor method for its own type: `visitor.Visit(this)`. This is **double dispatch**: the call picks the right method based on both the element's type and the visitor's type.
- Each **operation** is a **visitor class**, with one `Visit` method per element type, containing *all* of that operation's logic in one place.
- New operations are new visitor classes. The element classes do not change.

The trade-off is the reverse for new *element types*: adding `Ladder` means adding `Visit(Ladder)` to every visitor. Visitor fits when the set of types is **stable** and the set of operations **grows**.

## Pseudocode

```text
// One visit method per element type: the stable part.
LevelVisitor:
    visit_wall(w), visit_door(d), visit_spawn_point(s), visit_trigger(t)

// Each element knows only which visit method is its own.
Wall:       triangles      accept(v): v.visit_wall(this)
Door:       required_key   accept(v): v.visit_door(this)
SpawnPoint: enemy_type     accept(v): v.visit_spawn_point(this)
Trigger:    target         accept(v): v.visit_trigger(this)

// Operation 1: every validation rule, in one place.
Validation is a LevelVisitor:
    errors ← empty list
    keys_in_level, known_enemy_types
    visit_wall(w):        nothing to check
    visit_door(d):        if d needs a key not in keys_in_level: add an error
    visit_spawn_point(s): if s.enemy_type not in known_enemy_types: add an error
    visit_trigger(t):     if t has no target: add an error

// Operation 2: a different concern, also in one place.
Budget is a LevelVisitor:
    triangles ← 0, enemies ← 0, triggers ← 0
    visit_wall(w):        triangles ← triangles + w.triangles
    visit_door(d):        triangles ← triangles + 500
    visit_spawn_point(s): enemies ← enemies + 1
    visit_trigger(t):     triggers ← triggers + 1

run(level, visitor):
    for each element e in level:
        e.accept(visitor)   // double dispatch: e's type picks the method

budget ← Budget; run(level, budget)
if budget.triangles > 500 000: warn "over triangle budget"
```

## Example

Level tooling: the level is made of walls, doors, spawn points and triggers, and several unrelated operations (validation, a performance budget) run over all of them.

### The elements and the visitor interface

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public interface ILevelVisitor
{
    void Visit(Wall w);
    void Visit(Door d);
    void Visit(SpawnPoint s);
    void Visit(Trigger t);
}

public abstract class LevelElement : MonoBehaviour
{
    public abstract void Accept(ILevelVisitor v);
}

public class Wall : LevelElement       { public int Triangles = 200; public override void Accept(ILevelVisitor v) => v.Visit(this); }
public class Door : LevelElement       { public string RequiredKey; public override void Accept(ILevelVisitor v) => v.Visit(this); }
public class SpawnPoint : LevelElement { public string EnemyTypeId; public override void Accept(ILevelVisitor v) => v.Visit(this); }
public class Trigger : LevelElement    { public LevelElement Target; public override void Accept(ILevelVisitor v) => v.Visit(this); }
```

```gdscript [Godot (GDScript)]
# GDScript has no overloading, so each element calls its own visit_* method.
# @abstract (Godot 4.5+) makes every concrete visitor implement every visit_* method.

# level_visitor.gd
@abstract
class_name LevelVisitor
extends RefCounted

@abstract func visit_wall(w: Wall) -> void
@abstract func visit_door(d: Door) -> void
@abstract func visit_spawn_point(s: SpawnPoint) -> void
@abstract func visit_trigger(t: Trigger) -> void


# level_element.gd
@abstract
class_name LevelElement
extends Node3D

@abstract func accept(v: LevelVisitor) -> void


# wall.gd
class_name Wall
extends LevelElement

@export var triangles := 200


func accept(v: LevelVisitor) -> void:
	v.visit_wall(self)


# door.gd
class_name Door
extends LevelElement

@export var required_key := ""


func accept(v: LevelVisitor) -> void:
	v.visit_door(self)


# spawn_point.gd
class_name SpawnPoint
extends LevelElement

@export var enemy_type_id := ""


func accept(v: LevelVisitor) -> void:
	v.visit_spawn_point(self)


# trigger.gd
class_name Trigger
extends LevelElement

@export var target: LevelElement


func accept(v: LevelVisitor) -> void:
	v.visit_trigger(self)
```

```cpp [Unreal (C++)]
// LevelElements.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "LevelElements.generated.h"

class AWall;
class ADoor;
class AEnemySpawn;
class ALevelTrigger;

class ILevelVisitor
{
public:
	virtual ~ILevelVisitor() = default;
	virtual void Visit(AWall& W) = 0;
	virtual void Visit(ADoor& D) = 0;
	virtual void Visit(AEnemySpawn& S) = 0;
	virtual void Visit(ALevelTrigger& T) = 0;
};

UCLASS(Abstract)
class ALevelElement : public AActor
{
	GENERATED_BODY()

public:
	virtual void Accept(ILevelVisitor& V) PURE_VIRTUAL(ALevelElement::Accept, );
};

UCLASS()
class AWall : public ALevelElement
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Level") int32 Triangles = 200;
	virtual void Accept(ILevelVisitor& V) override { V.Visit(*this); }
};

UCLASS()
class ADoor : public ALevelElement
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Level") FName RequiredKey;
	virtual void Accept(ILevelVisitor& V) override { V.Visit(*this); }
};

UCLASS()
class AEnemySpawn : public ALevelElement
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Level") FName EnemyTypeId;
	virtual void Accept(ILevelVisitor& V) override { V.Visit(*this); }
};

UCLASS()
class ALevelTrigger : public ALevelElement
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Level") TObjectPtr<ALevelElement> Target;
	virtual void Accept(ILevelVisitor& V) override { V.Visit(*this); }
};
```

:::

### Two operations, each in one class

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

// Operation 1: validation, all rules in one class.
public class ValidationVisitor : ILevelVisitor
{
    public readonly List<string> Errors = new();
    readonly HashSet<string> keysInLevel;
    readonly HashSet<string> knownEnemyTypes;

    public ValidationVisitor(HashSet<string> keysInLevel, HashSet<string> knownEnemyTypes)
    {
        this.keysInLevel = keysInLevel; this.knownEnemyTypes = knownEnemyTypes;
    }

    public void Visit(Wall w) { }
    public void Visit(Door d)
    {
        if (!string.IsNullOrEmpty(d.RequiredKey) && !keysInLevel.Contains(d.RequiredKey))
            Errors.Add($"{d.name}: needs key '{d.RequiredKey}', which is not in this level");
    }
    public void Visit(SpawnPoint s)
    {
        if (!knownEnemyTypes.Contains(s.EnemyTypeId)) Errors.Add($"{s.name}: unknown enemy '{s.EnemyTypeId}'");
    }
    public void Visit(Trigger t)
    {
        if (t.Target == null) Errors.Add($"{t.name}: trigger has no target");
    }
}

// Operation 2: performance budget, a completely different concern, also in one class.
public class BudgetVisitor : ILevelVisitor
{
    public int Triangles, Enemies, Triggers;
    public void Visit(Wall w) => Triangles += w.Triangles;
    public void Visit(Door d) => Triangles += 500;
    public void Visit(SpawnPoint s) => Enemies++;
    public void Visit(Trigger t) => Triggers++;
}

// Running any operation over the whole level:
public static class LevelTools
{
    public static void Run(GameObject levelRoot, ILevelVisitor visitor)
    {
        foreach (var e in levelRoot.GetComponentsInChildren<LevelElement>(includeInactive: true))
            e.Accept(visitor);
    }
}

// var budget = new BudgetVisitor();
// LevelTools.Run(level, budget);
// if (budget.Triangles > 500_000) Debug.LogWarning("Level over triangle budget");
```

```gdscript [Godot (GDScript)]
# validation_visitor.gd: operation 1, all rules in one class.
class_name ValidationVisitor
extends LevelVisitor

var errors: Array[String] = []
var _keys_in_level: Array[String]
var _known_enemy_types: Array[String]


func _init(keys_in_level: Array[String], known_enemy_types: Array[String]) -> void:
	_keys_in_level = keys_in_level
	_known_enemy_types = known_enemy_types


func visit_wall(_w: Wall) -> void:
	pass


func visit_door(d: Door) -> void:
	if d.required_key != "" and not _keys_in_level.has(d.required_key):
		errors.append("%s: needs key '%s', which is not in this level" % [d.name, d.required_key])


func visit_spawn_point(s: SpawnPoint) -> void:
	if not _known_enemy_types.has(s.enemy_type_id):
		errors.append("%s: unknown enemy '%s'" % [s.name, s.enemy_type_id])


func visit_trigger(t: Trigger) -> void:
	if t.target == null:
		errors.append("%s: trigger has no target" % t.name)


# budget_visitor.gd: operation 2, a completely different concern, also in one class.
class_name BudgetVisitor
extends LevelVisitor

var triangles := 0
var enemies := 0
var triggers := 0


func visit_wall(w: Wall) -> void:
	triangles += w.triangles


func visit_door(_d: Door) -> void:
	triangles += 500


func visit_spawn_point(_s: SpawnPoint) -> void:
	enemies += 1


func visit_trigger(_t: Trigger) -> void:
	triggers += 1


# level_tools.gd: running any operation over the whole level.
class_name LevelTools


static func run(level_root: Node, visitor: LevelVisitor) -> void:
	for node in level_root.find_children("*", "", true, false):
		if node is LevelElement:
			(node as LevelElement).accept(visitor)

# var budget := BudgetVisitor.new()
# LevelTools.run(level, budget)
# if budget.triangles > 500_000: push_warning("Level over triangle budget")
```

```cpp [Unreal (C++)]
// LevelVisitors.h
#pragma once

#include "CoreMinimal.h"
#include "LevelElements.h"
#include "EngineUtils.h"

// Operation 1: validation, all rules in one class.
class FValidationVisitor : public ILevelVisitor
{
public:
	FValidationVisitor(const TSet<FName>& InKeysInLevel, const TSet<FName>& InKnownEnemyTypes)
		: KeysInLevel(InKeysInLevel), KnownEnemyTypes(InKnownEnemyTypes) {}

	TArray<FString> Errors;

	virtual void Visit(AWall&) override {}

	virtual void Visit(ADoor& D) override
	{
		if (!D.RequiredKey.IsNone() && !KeysInLevel.Contains(D.RequiredKey))
			Errors.Add(FString::Printf(TEXT("%s: needs key '%s', which is not in this level"), *D.GetName(), *D.RequiredKey.ToString()));
	}

	virtual void Visit(AEnemySpawn& S) override
	{
		if (!KnownEnemyTypes.Contains(S.EnemyTypeId))
			Errors.Add(FString::Printf(TEXT("%s: unknown enemy '%s'"), *S.GetName(), *S.EnemyTypeId.ToString()));
	}

	virtual void Visit(ALevelTrigger& T) override
	{
		if (!T.Target) Errors.Add(FString::Printf(TEXT("%s: trigger has no target"), *T.GetName()));
	}

private:
	TSet<FName> KeysInLevel;
	TSet<FName> KnownEnemyTypes;
};

// Operation 2: performance budget, a completely different concern, also in one class.
class FBudgetVisitor : public ILevelVisitor
{
public:
	int32 Triangles = 0, Enemies = 0, Triggers = 0;
	virtual void Visit(AWall& W) override { Triangles += W.Triangles; }
	virtual void Visit(ADoor&) override { Triangles += 500; }
	virtual void Visit(AEnemySpawn&) override { ++Enemies; }
	virtual void Visit(ALevelTrigger&) override { ++Triggers; }
};

// Running any operation over every element in a world:
inline void RunLevelVisitor(UWorld* World, ILevelVisitor& Visitor)
{
	for (ALevelElement* Element : TActorRange<ALevelElement>(World))
		Element->Accept(Visitor);
}

// FBudgetVisitor Budget;
// RunLevelVisitor(GetWorld(), Budget);
// if (Budget.Triangles > 500'000) UE_LOG(LogTemp, Warning, TEXT("Level over triangle budget"));
```

:::

Modern C# offers a lightweight alternative, **pattern matching**: `switch (e) { case Wall w: ...; case Door d: ...; }`. It is fine for one or two operations. The visitor's advantage is that the compiler forces every visitor to handle every type, so adding `Ladder` to the interface produces compile errors in every operation that has not been updated yet, rather than silent gaps.

**Engine notes**

- **Unity:** Pattern matching (`switch` on type) is the lightweight alternative described above. For editor-time validation, run the visitor from a menu item or a build preprocess step (`IPreprocessBuildWithReport`).
- **Godot:** The GDScript equivalent of pattern matching is `if node is Door:` chains or `match` on a property; nothing checks that every type is covered. With `@abstract` (Godot 4.5+), a visitor missing a `visit_*` method fails to load, which restores that check. For per-node warnings in the editor, a `@tool` script can override `_get_configuration_warnings()`.
- **Unreal:** C++ overloading keeps one `Visit` name, as in C#. For the validation operation specifically, the **Data Validation** plugin is Unreal's built-in place for rules that run on save or from the Content Browser (override `IsDataValid`, or write a `UEditorValidatorBase`).

## When to use

- A stable set of types with a growing set of operations: level elements, ability effects, AST nodes of a scripting language ([Interpreter](./interpreter)), save-data nodes, editor tools.
- When operations should live in their own classes (validation, export, statistics), not inside the data types.

## When not to use

- Type sets that change often. Every new type breaks every visitor; use virtual methods on the types instead.
- One or two operations. A virtual method or a C# `switch` on the type is shorter.
- Modern C# code where pattern matching (`switch` with type patterns) covers the same need with less ceremony.

## Pitfalls

- **Frequently changing types.** Every new element type touches every visitor. If types change often and operations rarely, put the methods on the types instead.
- **Boilerplate.** Visitors that care about one type still implement empty methods for all the others. A base visitor class with empty virtual methods helps.
- **Encapsulation.** Visitors need access to elements' data, which pushes toward public fields. Expose read-only properties for what operations need.
- **Overkill.** For two types and one operation, a `switch` is clearer. Use Visitor when the operations multiply.

## Related

- [Composite](./composite) — visitors are often run over composite trees.
- [Interpreter](./interpreter) — evaluating, printing or optimising an expression tree are classic visitors.
- [Debug Draw](./debug-draw) and [Automated Playtesting](./automated-playtesting) — validation and gizmo visitors are tooling.
- [Data-Driven Design](./data-driven-design) — validating content data before it ships.
- [Iterator](./iterator) — lets the caller pull elements one by one. A visitor pushes an operation to every element.
