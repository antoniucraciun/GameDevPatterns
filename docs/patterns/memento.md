# Memento

> Capture and restore an object's state without exposing its internals.

**Category:** Behavioral & Communication

## Problem

A puzzle game needs "restart room", a strategy game needs "undo last turn", and a level editor needs undo for a complex prop with twenty settings. Writing a hand-crafted reverse operation for every possible change is tedious and easy to get wrong. Making every field public, so that some external undo system can copy them, breaks encapsulation and couples that system to every class it saves.

## Solution

The object whose state is saved (the **originator**) can produce a **memento**: an opaque snapshot of its own state. It can later restore itself from that memento. A **caretaker**, such as an undo stack, a checkpoint system or a "restart room" button, stores mementos without knowing or touching what is inside them.

Three roles:

| Role | Responsibility |
| --- | --- |
| **Originator** | Creates mementos of itself and restores itself from them. Only it understands their contents. |
| **Memento** | An immutable snapshot. To everyone else, it is a black box. |
| **Caretaker** | Decides *when* to snapshot and *which* memento to restore. Never inspects contents. |

## Example (Unity C#)

An explicit memento, where the originator controls exactly what is captured:

```csharp
public class Crate : MonoBehaviour
{
    [SerializeField] int health = 3;
    bool isOpen;

    // The memento: immutable, and its fields are private to everyone except Crate.
    public sealed class Memento
    {
        internal readonly Vector3 Position;
        internal readonly int Health;
        internal readonly bool IsOpen;

        internal Memento(Vector3 position, int health, bool isOpen)
        {
            Position = position; Health = health; IsOpen = isOpen;
        }
    }

    public Memento Save() => new(transform.position, health, isOpen);

    public void Restore(Memento m)
    {
        transform.position = m.Position;
        health = m.Health;
        isOpen = m.IsOpen;
    }
}

// Caretaker: "restart room" snapshots every crate on entry.
public class RoomReset : MonoBehaviour
{
    readonly List<(Crate crate, Crate.Memento state)> snapshot = new();

    public void OnRoomEntered()
    {
        snapshot.Clear();
        foreach (var crate in GetComponentsInChildren<Crate>())
            snapshot.Add((crate, crate.Save()));
    }

    public void ResetRoom()
    {
        foreach (var (crate, state) in snapshot)
            crate.Restore(state);
    }
}
```

`internal` only hides the fields from *other* assemblies. To hide them inside one assembly too, have `Save` return an empty marker interface (`ICrateMemento`) and keep the concrete class private inside `Crate`.

A generic memento, using Unity serialisation, for any component with serialised fields:

```csharp
public static class ComponentMemento
{
    public static string Save(Object target) => JsonUtility.ToJson(target);
    public static void Restore(Object target, string memento) => JsonUtility.FromJsonOverwrite(memento, target);
}
```

The generic version needs no per-class code, but captures *every* serialised field. That is convenient for editor undo, but wasteful and sometimes wrong for gameplay, for example when it captures object references.

## When to use

- Undo when changes are too complex to reverse by hand.
- Checkpoints, "restart room", rewinding a turn.
- Saving and restoring speculative state, such as AI look-ahead or previewing a move before committing it.

## Pitfalls

- **Memory.** Snapshotting large objects often is expensive. Snapshot only what changes, use incremental (delta) mementos, or cap the history length.
- **References inside mementos.** A memento that stores a reference to another object restores the *reference*, not that object's state. If the other object was destroyed, the reference is dead. Store stable IDs, and snapshot related objects together.
- **Mutable mementos.** If a memento can be modified after capture, undo becomes unreliable. Make mementos immutable, and copy collections rather than storing the live list.
- **Engine state you cannot capture**, such as physics contacts, animator internals or particle systems mid-play. Decide explicitly what "restored" means for these, usually reset rather than restore.

## Related

- [Command](./command) — the other way to implement undo. Commands can use mementos internally.
- [Replay System](./replay-system) — snapshot replays are a sequence of mementos.
- Save System — persistent mementos written to disk, with versioning.
