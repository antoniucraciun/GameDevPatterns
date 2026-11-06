# Strategy

> Swap an algorithm (movement, targeting, damage formula) at runtime behind one interface.

**Category:** Behavioral & Communication

## Problem

A tower-defence turret picks targets with a `switch` on an enum: nearest, first along the path, strongest, weakest. Every new targeting mode means editing the turret. Some turrets need a mode no other turret uses. Designers want to try "lowest health within range, preferring flying enemies" without a programmer. Players want to change a turret's targeting at runtime. The turret has become a pile of unrelated algorithms behind one `switch`.

## Solution

Pull each algorithm out into its own object behind a common interface: the **strategy**. The **context** (the turret) holds a reference to a strategy and calls it, without knowing which one it is.

- New algorithms are new classes, or new assets, and the context never changes.
- Strategies can be swapped at runtime, for example from a UI dropdown.
- Each algorithm is small and testable on its own.

In Unity, strategies are often **ScriptableObject assets**. Designers then pick a strategy in the inspector, and tune its parameters per asset ("nearest, but ignore targets beyond 15 m").

## Example (Unity C#)

```csharp
using System.Collections.Generic;
using UnityEngine;

public interface ITargetable
{
    Vector3 Position { get; }
    float Health { get; }
    float PathProgress { get; }    // 0 at the spawn, 1 at the goal
    bool IsFlying { get; }
}

// The strategy interface, as an abstract ScriptableObject so strategies are assets.
public abstract class TargetingStrategy : ScriptableObject
{
    public abstract ITargetable Choose(Vector3 from, IReadOnlyList<ITargetable> inRange);
}

[CreateAssetMenu(menuName = "Targeting/Nearest")]
public class NearestTargeting : TargetingStrategy
{
    public override ITargetable Choose(Vector3 from, IReadOnlyList<ITargetable> inRange)
    {
        ITargetable best = null;
        float bestDistance = float.MaxValue;
        foreach (var t in inRange)
        {
            float d = (t.Position - from).sqrMagnitude;
            if (d < bestDistance) { best = t; bestDistance = d; }
        }
        return best;
    }
}

[CreateAssetMenu(menuName = "Targeting/First Along Path")]
public class FirstTargeting : TargetingStrategy
{
    public override ITargetable Choose(Vector3 from, IReadOnlyList<ITargetable> inRange)
    {
        ITargetable best = null;
        foreach (var t in inRange)
            if (best == null || t.PathProgress > best.PathProgress) best = t;
        return best;
    }
}

[CreateAssetMenu(menuName = "Targeting/Weakest (Prefer Flying)")]
public class WeakestTargeting : TargetingStrategy
{
    [SerializeField] bool preferFlying = true;           // tunable per asset

    public override ITargetable Choose(Vector3 from, IReadOnlyList<ITargetable> inRange)
    {
        ITargetable best = null;
        foreach (var t in inRange)
        {
            if (best == null) { best = t; continue; }
            if (preferFlying && t.IsFlying != best.IsFlying) { if (t.IsFlying) best = t; continue; }
            if (t.Health < best.Health) best = t;
        }
        return best;
    }
}
```

The context only knows the interface:

```csharp
public class Turret : MonoBehaviour
{
    [SerializeField] TargetingStrategy targeting;          // chosen per prefab, in the inspector
    [SerializeField] float range = 12f;

    public TargetingStrategy Targeting { get => targeting; set => targeting = value; }   // UI can swap it

    readonly List<ITargetable> inRange = new();
    ITargetable current;

    void Update()
    {
        GatherTargetsInRange(inRange);
        current = targeting.Choose(transform.position, inRange);
        if (current != null) { /* rotate toward current.Position and fire */ }
    }

    void GatherTargetsInRange(List<ITargetable> results)
    {
        results.Clear();
        /* fill from a spatial query, e.g. Physics.OverlapSphereNonAlloc + TryGetComponent<ITargetable> */
    }
}
```

When a strategy needs no parameters and no inspector support, a plain interface or even a delegate (`Func<Vector3, IReadOnlyList<ITargetable>, ITargetable>`) works just as well.

## When to use

- Several interchangeable ways to do one job: targeting, movement styles, damage formulas, difficulty rules, AI personalities, save formats, camera behaviours.
- Behaviour that designers or players should choose, or that changes at runtime.
- Replacing a growing `switch` on a "mode" enum.

## Pitfalls

- **Strategies that need too much context.** If a strategy needs ten parameters from the context, the interface is wrong. Pass a small context object, or reconsider the split.
- **State in shared assets.** A ScriptableObject strategy is shared by every turret that uses it. Storing per-turret state in it (such as "the last target") mixes turrets up. Keep strategies stateless, and keep state in the context.
- **Over-engineering.** Two fixed options that will never change are clearer as an `if`. Introduce strategies when the variation is real.
- **Allocation per call.** LINQ in strategies (`inRange.OrderBy(...)`) allocates every frame. Write the loops by hand in hot paths.

## Related

- [State](./state) — similar structure, but states switch *themselves*. Strategies are chosen from outside.
- [Type Object](./type-object) — a type asset can reference strategy assets to vary behaviour per kind.
- [ScriptableObject Architecture](./scriptable-object-architecture) — strategies as assets.
- Template Method — varies steps of one algorithm through inheritance, rather than swapping the whole algorithm.
