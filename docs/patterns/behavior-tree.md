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

## Example (Unity C#)

```csharp
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
    readonly System.Func<bool> check;
    public Condition(System.Func<bool> check) => this.check = check;
    public override Status Tick() => check() ? Status.Success : Status.Failure;
}

public class ActionNode : Node
{
    readonly System.Func<Status> action;
    public ActionNode(System.Func<Status> action) => this.action = action;
    public override Status Tick() => action();
}

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

This minimal tree re-evaluates from the root every tick, so higher-priority branches can always interrupt lower ones (a "reactive" tree). Production implementations also track the running node, offer decorators, and read shared data from a Blackboard.

## When to use

- AI with many behaviours and clear priorities between them.
- Designers need to author or tweak AI, usually through a visual editor.
- Behaviours should be reused across different agent types.

## Pitfalls

- **Interrupted actions need cleanup.** When a higher-priority branch takes over, the running action must stop its animation, release reservations and so on. Add an `Abort` or `OnExit` hook.
- **Expensive conditions evaluated every tick.** Cache perception results, or tick the tree at a lower rate than the frame rate.
- **Using a tree as a state machine.** If the logic is really "mode A, then mode B", a [State](./state) machine is clearer.
- **Opaque at runtime.** Build a debug view that highlights the active path.

## Related

- [State](./state) — simpler, and better for a few well-defined modes.
- Blackboard — the shared memory that nodes read and write.
- Utility AI and GOAP — alternatives that score actions or plan them instead of following authored priorities.
