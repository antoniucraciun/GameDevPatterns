# Hierarchical State Machine

> Nest states inside super-states to share transitions and behaviour.

**Also known as:** HFSM · **Category:** Behavioral & Communication

## Problem

A character controller built as a flat [state machine](./state) has *Idle*, *Running*, *Crouching*, *Jumping* and *Falling*. Idle, Running and Crouching all need the same rules: jump when Jump is pressed, fall when the ground disappears, take hits. So the same transitions are copied into three states. Adding *Sliding* means copying them again, and fixing a bug in "fall when ungrounded" means fixing it three times. The number of transitions grows much faster than the number of states.

## Solution

Let states have a **parent**. *Idle*, *Running* and *Crouching* become children of a **Grounded** super-state, and *Jumping* and *Falling* children of **Airborne**.

- **Events bubble up.** The active leaf state gets the first chance to handle input or update. Whatever it does not handle is passed to its parent, then the grandparent. *Grounded* handles Jump and "lost the ground" once for all its children.
- **Shared behaviour lives in the parent.** Ground friction and the grounded check belong to *Grounded*.
- **Transitions exit and enter the right levels.** Going from *Running* to *Crouching* exits only *Running* and enters *Crouching*, because *Grounded* stays active. Going from *Running* to *Jumping* exits *Running* and *Grounded*, then enters *Airborne* and *Jumping*. The rule: exit up to the **lowest common ancestor**, then enter down to the target.

```
Grounded                    Airborne
├── Idle                    ├── Jumping
├── Running                 └── Falling
└── Crouching
```

## Example (Unity C#)

```csharp
using System.Collections.Generic;
using UnityEngine;

public abstract class HState
{
    public HState Parent { get; }
    protected readonly CharacterContext Ctx;

    protected HState(CharacterContext ctx, HState parent) { Ctx = ctx; Parent = parent; }

    public virtual void Enter() { }
    public virtual void Exit() { }

    // Return true if handled. Unhandled updates bubble to the parent.
    public virtual bool Tick(float dt) => false;
}

public class HStateMachine
{
    public HState Current { get; private set; }

    public void Tick(float dt)
    {
        for (var s = Current; s != null; s = s.Parent)   // leaf first, then ancestors
            if (s.Tick(dt)) return;
    }

    public void ChangeTo(HState target)
    {
        var fromPath = PathFromRoot(Current);
        var toPath = PathFromRoot(target);

        int common = 0;                                  // length of the shared prefix
        while (common < fromPath.Count && common < toPath.Count && fromPath[common] == toPath[common])
            common++;

        for (int i = fromPath.Count - 1; i >= common; i--) fromPath[i].Exit();   // exit upward
        Current = target;
        for (int i = common; i < toPath.Count; i++) toPath[i].Enter();           // enter downward
    }

    static List<HState> PathFromRoot(HState s)
    {
        var path = new List<HState>();
        for (; s != null; s = s.Parent) path.Insert(0, s);
        return path;
    }
}
```

The character's states:

```csharp
public class CharacterContext
{
    public HStateMachine Machine = new();
    public Vector2 MoveInput;
    public bool JumpPressed, CrouchHeld, IsGrounded;
    public Rigidbody2D Body;

    public HState Grounded, Idle, Running, Crouching, Airborne, Jumping, Falling;
}

// ── Super-states: shared rules, written once ──

public class GroundedState : HState
{
    public GroundedState(CharacterContext c) : base(c, null) { }

    public override bool Tick(float dt)
    {
        if (Ctx.JumpPressed) { Ctx.Machine.ChangeTo(Ctx.Jumping); return true; }   // for ALL grounded children
        if (!Ctx.IsGrounded) { Ctx.Machine.ChangeTo(Ctx.Falling); return true; }
        return true;
    }
}

public class AirborneState : HState
{
    public AirborneState(CharacterContext c) : base(c, null) { }

    public override bool Tick(float dt)
    {
        if (Ctx.IsGrounded && Ctx.Body.linearVelocity.y <= 0f) { Ctx.Machine.ChangeTo(Ctx.Idle); return true; }
        return true;
    }
}

// ── Leaf states: only what is specific to them ──

public class IdleState : HState
{
    public IdleState(CharacterContext c, HState parent) : base(c, parent) { }

    public override bool Tick(float dt)
    {
        if (Ctx.CrouchHeld) { Ctx.Machine.ChangeTo(Ctx.Crouching); return true; }
        if (Ctx.MoveInput.x != 0f) { Ctx.Machine.ChangeTo(Ctx.Running); return true; }
        return false;                                   // let Grounded check jump and falling
    }
}

public class JumpingState : HState
{
    public JumpingState(CharacterContext c, HState parent) : base(c, parent) { }

    public override void Enter() => Ctx.Body.linearVelocity = new Vector2(Ctx.Body.linearVelocity.x, 12f);

    public override bool Tick(float dt)
    {
        if (Ctx.Body.linearVelocity.y < 0f) { Ctx.Machine.ChangeTo(Ctx.Falling); return true; }
        return false;                                   // let Airborne check landing
    }
}

// Running, Crouching and Falling follow the same shape. Wiring:
// ctx.Grounded = new GroundedState(ctx);
// ctx.Idle = new IdleState(ctx, ctx.Grounded);  ctx.Running = ...;  ctx.Crouching = ...;
// ctx.Airborne = new AirborneState(ctx);
// ctx.Jumping = new JumpingState(ctx, ctx.Airborne);  ctx.Falling = ...;
// ctx.Machine.ChangeTo(ctx.Idle);   // enters Grounded, then Idle
```

`ChangeTo` here finds the common ancestor by building two short paths, which is fine for shallow hierarchies. Cache the paths if transitions are frequent and hierarchies are deep.

## When to use

- State machines where groups of states share transitions: character controllers, enemy AI (*Combat* containing *Melee*, *Ranged* and *TakingCover*), UI flows.
- When a flat machine's transition count is clearly growing faster than its state count.

## Pitfalls

- **Parents that always handle.** If a super-state returns `true` without checking anything, its children's later checks never matter. Decide deliberately which level owns which decision.
- **Child-first versus parent-first.** Here children get the first chance, so they can override shared behaviour. Some designs let parents pre-empt (for example, "stunned" overrides everything). Choose one order and document it.
- **Entering a super-state directly.** `ChangeTo(Grounded)` leaves no leaf active. Either always target leaves, or give each super-state a default child to enter.
- **Deep hierarchies.** Three levels are usually enough. Deeper trees become hard to follow, and a [Behavior Tree](./behavior-tree) may suit the problem better.

## Related

- [State](./state) — the flat version this extends.
- [Pushdown Automaton](./pushdown-automaton) — adds a stack for interrupting and resuming states.
- [Behavior Tree](./behavior-tree) — an alternative for AI with many prioritised behaviours.
- [Tight Platformer Controller](../recipes/platformer-controller) — a flat two-state controller that this pattern would scale up.
