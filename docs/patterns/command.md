# Command

> Turn a request into an object you can queue, replay, undo or send over a network.

**Category:** Behavioral & Communication

## Problem

Input handling often calls gameplay methods directly: `if (Input.GetKeyDown(KeyCode.Space)) player.Jump();`. That works until you need rebindable controls, AI that drives the same character, undo in a level editor, a replay system, or sending player actions to a server. Every one of these needs the action as *data*, not as a method call that has already happened.

## Solution

Wrap each action in a **command object** with an `Execute` method, and optionally `Undo`. Input code (or AI, or a network packet) creates commands. Something else executes them, possibly later, possibly more than once, possibly on another machine. A history stack of executed commands gives you undo. A timestamped log gives you replays.

## Example (Unity C#)

An undoable command for a grid-based puzzle game or level editor:

```csharp
public interface ICommand
{
    void Execute();
    void Undo();
}

public class MoveCommand : ICommand
{
    readonly Transform target;
    readonly Vector3Int delta;

    public MoveCommand(Transform target, Vector3Int delta)
    {
        this.target = target;
        this.delta = delta;
    }

    public void Execute() => target.position += (Vector3)delta;
    public void Undo()    => target.position -= (Vector3)delta;
}

public class CommandHistory
{
    readonly Stack<ICommand> done = new();
    readonly Stack<ICommand> undone = new();

    public void Run(ICommand c) { c.Execute(); done.Push(c); undone.Clear(); }
    public void Undo() { if (done.TryPop(out var c)) { c.Undo(); undone.Push(c); } }
    public void Redo() { if (undone.TryPop(out var c)) { c.Execute(); done.Push(c); } }
}

// Input layer: translate keys into commands.
if (Input.GetKeyDown(KeyCode.RightArrow)) history.Run(new MoveCommand(box, Vector3Int.right));
if (Input.GetKeyDown(KeyCode.Z)) history.Undo();
```

For gameplay actions you can pass the actor at execution time instead (`Execute(Unit actor)`). The same command can then be issued by the player or by AI.

## When to use

- Undo/redo in puzzles, editors and strategy games.
- Replays and deterministic networking: record or transmit commands, not state.
- Decoupling input from the actor so players and AI share one code path.
- Queued actions, such as RTS orders or turn-based moves.

## When not to use

- Actions you never need to undo, replay, queue or send over the network. Calling the method directly is simpler.
- Undo for complex changes that are hard to reverse by hand. Snapshotting with [Memento](./memento) may be less error-prone.
- Wrapping every method call in a command class. Use it at the boundary (player and AI actions, editor operations), not everywhere.

## Pitfalls

- **Undo needs enough captured state.** "Deal 10 damage" cannot be undone if the target was clamped at 0 HP. Store what actually changed.
- **Allocation per command** in hot paths. Use structs or pool commands if you create thousands per frame.
- **Commands that reference scene objects** cannot be serialised for replays or networking. Use stable IDs.

## Related

- [Observer](./observer) — notifies listeners that something happened. A command *makes* it happen.
- [Replay System](./replay-system) and [Server Reconciliation](./server-reconciliation) are built on command logs.
- [Memento](./memento) — an alternative way to support undo, by saving snapshots.
