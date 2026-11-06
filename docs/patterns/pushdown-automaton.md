# Pushdown Automaton

> A state machine with a stack, so states can be pushed and later resumed.

**Category:** Behavioral & Communication

## Problem

A character is *Running* when it gets stunned. When the stun ends, which state should it return to? A flat [state machine](./state) has no memory: the *Stunned* state must guess, or every state must remember where it came from. The same problem appears with "climb a ladder, then return to whatever you were doing", "open the map in the middle of combat", and "pause, open settings, back, back".

## Solution

Keep states on a **stack**. The top of the stack is the active state.

- **Push** a state to interrupt: the current state is **paused**, not exited, and the new one becomes active.
- **Pop** when the interruption ends: the top state exits, and the one below **resumes** exactly where it was.
- **Switch** (replace the top) for ordinary transitions that should not be remembered.

States get four hooks instead of two: `Enter` and `Exit` for entering and leaving the stack, and `Pause` and `Resume` for being covered and uncovered. A paused state keeps all its data: timers, targets, animation phase.

```
push Stunned            pop (stun ends)
┌──────────┐            ┌──────────┐
│ Stunned  │ ← active   │          │
├──────────┤            ├──────────┤
│ Running  │ paused     │ Running  │ ← resumed, same data
└──────────┘            └──────────┘
```

## Example (Unity C#)

```csharp
using System.Collections.Generic;
using UnityEngine;

public abstract class StackState
{
    public virtual void Enter() { }     // pushed onto the stack
    public virtual void Exit() { }      // popped off the stack
    public virtual void Pause() { }     // something was pushed on top
    public virtual void Resume() { }    // the state on top was popped
    public virtual void Tick(float dt) { }
}

public class StateStack
{
    readonly Stack<StackState> stack = new();
    public StackState Top => stack.Count > 0 ? stack.Peek() : null;

    public void Push(StackState state)
    {
        Top?.Pause();
        stack.Push(state);
        state.Enter();
    }

    public void Pop()
    {
        if (stack.Count == 0) return;
        stack.Pop().Exit();
        Top?.Resume();
    }

    public void Switch(StackState state)   // replace the top without remembering it
    {
        if (stack.Count > 0) stack.Pop().Exit();
        stack.Push(state);
        state.Enter();
    }

    public void Tick(float dt) => Top?.Tick(dt);
}
```

Interruptions that return to whatever was happening before:

```csharp
public class Character : MonoBehaviour
{
    public readonly StateStack States = new();
    public Animator Animator;

    void Start() => States.Push(new PatrolState(this));
    void Update() => States.Tick(Time.deltaTime);

    // Any system can interrupt: the stun knows nothing about what it interrupted.
    public void Stun(float seconds) => States.Push(new StunnedState(this, seconds));
}

public class PatrolState : StackState
{
    readonly Character c;
    int waypoint;                       // survives being paused
    public PatrolState(Character c) => this.c = c;

    public override void Resume() => c.Animator.Play("Walk");   // pick up where we left off
    public override void Tick(float dt) { /* walk toward waypoint, advance index on arrival */ }
}

public class StunnedState : StackState
{
    readonly Character c;
    float remaining;
    public StunnedState(Character c, float seconds) { this.c = c; remaining = seconds; }

    public override void Enter() => c.Animator.Play("Stunned");

    public override void Tick(float dt)
    {
        if ((remaining -= dt) <= 0f) c.States.Pop();   // return to whatever was running before
    }
}
```

The same structure drives game flow (*Playing* → push *Paused* → push *Settings* → pop → pop), which is what a [Screen Stack](./screen-stack) does for UI.

## When to use

- Interruptions that should return to the previous state: stuns, knockdowns, cutscenes, dialogues, ladders, vehicles, menus.
- Nested modes where "back" means "where I was", not a fixed state.

## Pitfalls

- **Pushing what should be switched.** If *Walk → Run → Walk → Run* is done with pushes, the stack grows forever. Use `Switch` for peer transitions, and `Push` only for interruptions.
- **Stale paused states.** A paused *Attack* state targeting an enemy that died during the stun resumes against nothing. Re-validate in `Resume`.
- **Interruptions of interruptions.** A second stun pushed during the first gives two stun states, popping one at a time. Decide whether repeated interruptions stack, refresh or are ignored.
- **Popping from the wrong place.** Only the top state should pop itself, or a manager on its behalf. Popping while another state is on top removes the wrong one.
- **Only the top runs.** Paused states do not tick. If something must keep running underneath (a cooldown timer), move it out of the state, or tick paused states explicitly.

## Related

- [State](./state) — the flat machine without memory.
- [Hierarchical State Machine](./hierarchical-state-machine) — nesting by structure rather than by time.
- [Screen Stack](./screen-stack) — this pattern applied to menus.
- [Game State Manager](./game-state-manager) — can use a stack so *Paused* sits on top of *Playing*.
- [Memento](./memento) — an alternative way to return to an earlier state, by snapshot.
