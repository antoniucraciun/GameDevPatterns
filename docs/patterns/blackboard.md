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

## Example (Unity C#)

```csharp
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

Reusable behavior-tree nodes that only know about keys:

```csharp
public class HasRecent<T> : Node                         // Node/Status from the Behavior Tree pattern
{
    readonly Blackboard bb; readonly BlackboardKey<T> key; readonly float maxAge;
    public HasRecent(Blackboard bb, BlackboardKey<T> key, float maxAge) { this.bb = bb; this.key = key; this.maxAge = maxAge; }
    public override Status Tick() => bb.Age(key) <= maxAge ? Status.Success : Status.Failure;
}

public class MoveToKey : Node
{
    readonly Blackboard bb; readonly BlackboardKey<Vector3> key; readonly UnityEngine.AI.NavMeshAgent agent;
    public MoveToKey(Blackboard bb, BlackboardKey<Vector3> key, UnityEngine.AI.NavMeshAgent agent) { this.bb = bb; this.key = key; this.agent = agent; }

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

Squad sharing: give every guard `new Blackboard(parent: squadBlackboard)`. When one guard sees the player, its perception writes `LastKnownPosition` to the *squad* blackboard, and every guard's tree reads it through the parent chain.

## When to use

- AI built from independent, reusable parts: behavior tree nodes, utility considerations, GOAP actions.
- Sharing knowledge between agents (squads, factions) or between AI and a director system.
- Designer tools where nodes are wired to keys in an editor.

## Pitfalls

- **A dumping ground.** Without discipline, the blackboard becomes a bag of global variables. Define keys in one place, and give each key a clear owner that writes it.
- **Stale facts.** A `Target` that died stays on the board, and the agent chases a corpse. Clear facts when they stop being true, or use timestamps and treat old facts as unknown.
- **Boxing.** Storing value types as `object` allocates on every `Set`. That is fine for a few dozen agents. For hundreds, use per-type dictionaries or a struct-based store.
- **Hidden coupling through keys.** Two systems that disagree on what a key means (`Target` as "attack this" versus "look at this") cause subtle bugs. Name keys by meaning, and document them next to their definition.

## Related

- [Behavior Tree](./behavior-tree) — the most common consumer.
- [Perception System](./perception-system) — the main writer.
- [Observer](./observer) — change notifications for reactive trees.
- [Utility AI](./utility-ai) and Goal-Oriented Action Planning — also read their world state from a blackboard.
