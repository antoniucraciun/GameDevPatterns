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

## Example (Unity C#)

```csharp
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
// ICommandable selection = selectedArmy;          // or one unit, or one squad
// selection.MoveTo(clickPoint);
// hud.Show($"{selection.Name}: {selection.UnitCount} units, {selection.TotalHealth:0} HP");
```

Unity's Transform hierarchy, UI layout groups, [behavior trees](./behavior-tree) and the `AreaEffect` in [Data-Driven Abilities](../recipes/data-driven-abilities), which contains other effects, are all composites.

## When to use

- Part–whole hierarchies where clients should not care about the difference: unit groups, UI containers, scene graphs, effect lists, AI task trees, inventory bags inside bags.
- Operations that naturally aggregate (count, total weight, bounds) or broadcast (move all, enable all).

## When not to use

- Flat collections where nothing nests. A `List<T>` and a loop is enough.
- When leaves and groups need very different operations. Forcing them behind one interface leads to methods that do nothing or throw.
- Unity's Transform hierarchy already composes objects. Don't build a parallel tree for things the scene graph handles.

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
