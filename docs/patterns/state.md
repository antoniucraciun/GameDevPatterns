# State

> Let an object change its behaviour when its internal state changes.

**Also known as:** Finite State Machine, FSM · **Category:** Behavioral & Communication

## Problem

A player controller starts with a few booleans: `isJumping`, `isCrouching`, `isAttacking`, `isDashing`. Each new mechanic adds another flag and more `if` checks. Soon you hit bugs where the player is somehow jumping and crouching at once, or can dash out of a stun. The combinations grow exponentially, and nothing enforces which combinations are legal.

## Solution

Model the object as being in exactly **one state** at a time. Each state is an object that handles input and updates for that mode, and decides when to **transition** to another state. States get `Enter` and `Exit` hooks for setup and cleanup, such as starting an animation or resetting a timer. Illegal combinations cannot happen because only one state is active.

## Example (Unity C#)

```csharp
public abstract class State
{
    protected readonly PlayerController player;
    protected State(PlayerController player) => this.player = player;
    public virtual void Enter() { }
    public virtual void Exit() { }
    public abstract void Tick(float dt);
}

public class StateMachine
{
    public State Current { get; private set; }

    public void ChangeTo(State next)
    {
        Current?.Exit();
        Current = next;
        Current.Enter();
    }

    public void Tick(float dt) => Current?.Tick(dt);
}

public class GroundedState : State
{
    public GroundedState(PlayerController p) : base(p) { }

    public override void Tick(float dt)
    {
        player.Move(player.InputX);
        if (player.JumpPressed || !player.IsGrounded)
            player.Machine.ChangeTo(player.Airborne);
    }
}

public class AirborneState : State
{
    public AirborneState(PlayerController p) : base(p) { }
    public override void Enter() { if (player.JumpPressed) player.Jump(); }

    public override void Tick(float dt)
    {
        player.Move(player.InputX * 0.6f);              // reduced air control
        if (player.IsGrounded) player.Machine.ChangeTo(player.Grounded);
    }
}

// In PlayerController: create states once, reuse them.
// Grounded = new GroundedState(this); Airborne = new AirborneState(this);
// Machine.ChangeTo(Grounded);  then  Machine.Tick(Time.deltaTime) in Update.
```

Create state instances once and reuse them, so transitions do not allocate.

## When to use

- An entity has distinct modes with different behaviour and clear rules for moving between them: player movement, enemy AI, doors, weapons.
- Top-level game flow: boot, menu, playing, paused, game over.

## Pitfalls

- **State explosion.** Many states that share most of their transitions call for a [Hierarchical State Machine](./hierarchical-state-machine).
- **Needing to resume a previous state**, for example "pause, then return to what I was doing", calls for a [Pushdown Automaton](./pushdown-automaton).
- **Parallel concerns in one machine.** Movement and weapon state are independent. Use two machines, not a cross-product of states.
- **Transitions scattered everywhere.** Keep transition logic inside states, or in one transition table, but not both.

## Related

- [Hierarchical State Machine](./hierarchical-state-machine) and [Pushdown Automaton](./pushdown-automaton) — the extended forms.
- [Strategy](./strategy) — similar structure, but chosen from outside rather than switching itself.
- [Behavior Tree](./behavior-tree) — an alternative for AI that scales better with many behaviours.
- [Command](./command) — states often produce or consume commands.
