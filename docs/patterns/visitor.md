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

## Example (Unity C#)

```csharp
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

Modern C# offers a lightweight alternative, **pattern matching**: `switch (e) { case Wall w: ...; case Door d: ...; }`. It is fine for one or two operations. The visitor's advantage is that the compiler forces every visitor to handle every type, so adding `Ladder` to the interface produces compile errors in every operation that has not been updated yet, rather than silent gaps.

## When to use

- A stable set of types with a growing set of operations: level elements, ability effects, AST nodes of a scripting language ([Interpreter](./interpreter)), save-data nodes, editor tools.
- When operations should live in their own classes (validation, export, statistics), not inside the data types.

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
