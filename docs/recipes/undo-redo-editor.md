# Undo/Redo Level Editor

> Every edit is undoable and redoable, including grouped edits, with the UI always in sync.

## Goal

An in-game level editor, like those in puzzle and builder games:

- Painting tiles, placing props and changing prop settings can all be undone and redone.
- A whole brush stroke undoes as **one** step, not one step per tile.
- Undo/Redo buttons are enabled only when there is something to undo or redo, and the "unsaved changes" marker is always correct.
- Simple edits store only what changed. Complex edits never need hand-written undo logic.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Command](../patterns/command) | Every edit is an object with `Execute` and `Undo`. A history of commands is the undo stack. |
| Memento | For edits too complex to reverse by hand, the command snapshots the object's state before and after, and restores the snapshot to undo. |
| [Observer](../patterns/observer) | The history raises `Changed`, so buttons, the unsaved-changes marker and autosave react without the history knowing about them. |

## How they fit together

```
 UI / tools ──create──► ICommand ──Run()──► CommandHistory ──Changed──► Undo/Redo buttons
                          │                  ├─ undo stack                Unsaved-changes marker
       ┌──────────────────┼──────────────┐   ├─ redo stack                Autosave
       ▼                  ▼              ▼   └─ open group (brush stroke)
 PaintTileCommand   SnapshotCommand  CompositeCommand
 (stores old tile)  (Memento: JSON   (one undo step
                     before/after)    for many commands)
```

- **Command ↔ Memento.** Commands choose *how* they undo. A tile paint stores just the previous tile, which is cheap. A prop settings change stores a memento of the component, which needs no hand-written undo. Callers never see the difference.
- **Command ↔ Composite.** A brush stroke opens a group, and every tile painted until the mouse is released is collected into one `CompositeCommand`.
- **History ↔ Observer.** The history is the single place where edits happen, so it is the single place to raise `Changed`. Nothing polls.

## Example (Unity C#)

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Tilemaps;

public interface ICommand
{
    void Execute();
    void Undo();
}

// ── A cheap, hand-written undo: store only what changed ──────────────
public class PaintTileCommand : ICommand
{
    readonly Tilemap map;
    readonly Vector3Int cell;
    readonly TileBase newTile;
    TileBase previousTile;

    public PaintTileCommand(Tilemap map, Vector3Int cell, TileBase newTile)
    {
        this.map = map; this.cell = cell; this.newTile = newTile;
    }

    public void Execute()
    {
        previousTile = map.GetTile(cell);
        map.SetTile(cell, newTile);
    }

    public void Undo() => map.SetTile(cell, previousTile);
}

// ── Memento: snapshot the whole object instead of reversing by hand ──
public class SnapshotCommand : ICommand
{
    readonly MonoBehaviour target;
    readonly Action change;
    string before, after;

    public SnapshotCommand(MonoBehaviour target, Action change)
    {
        this.target = target; this.change = change;
    }

    public void Execute()
    {
        if (after == null)                         // first run: perform the change and record it
        {
            before = JsonUtility.ToJson(target);
            change();
            after = JsonUtility.ToJson(target);
        }
        else JsonUtility.FromJsonOverwrite(after, target);   // redo: restore the "after" memento
    }

    public void Undo() => JsonUtility.FromJsonOverwrite(before, target);
}

// ── Many commands, one undo step ────────────────────────────────────
public class CompositeCommand : ICommand
{
    public readonly List<ICommand> Children = new();

    public void Execute() { foreach (var c in Children) c.Execute(); }

    public void Undo()
    {
        for (int i = Children.Count - 1; i >= 0; i--)   // undo in reverse order
            Children[i].Undo();
    }
}

// ── The history: the only place edits happen ─────────────────────────
public class CommandHistory
{
    readonly LinkedList<ICommand> undo = new();   // LinkedList so the oldest entry can be dropped
    readonly Stack<ICommand> redo = new();
    readonly int capacity;
    CompositeCommand openGroup;
    int savedVersion, version;

    public event Action Changed;                  // Observer

    public CommandHistory(int capacity = 200) => this.capacity = capacity;

    public bool CanUndo => undo.Count > 0 && openGroup == null;
    public bool CanRedo => redo.Count > 0 && openGroup == null;
    public bool HasUnsavedChanges => version != savedVersion;

    public void Run(ICommand command)
    {
        command.Execute();
        if (openGroup != null) { openGroup.Children.Add(command); return; }  // part of a stroke
        Record(command);
    }

    public void BeginGroup() => openGroup ??= new CompositeCommand();

    public void EndGroup()
    {
        var group = openGroup;
        openGroup = null;
        if (group is { Children: { Count: > 0 } }) Record(group);
    }

    public void Undo()
    {
        if (!CanUndo) return;
        var c = undo.Last.Value; undo.RemoveLast();
        c.Undo(); redo.Push(c);
        version--; Changed?.Invoke();
    }

    public void Redo()
    {
        if (!CanRedo) return;
        var c = redo.Pop();
        c.Execute(); undo.AddLast(c);
        version++; Changed?.Invoke();
    }

    public void MarkSaved() { savedVersion = version; Changed?.Invoke(); }

    void Record(ICommand command)
    {
        undo.AddLast(command);
        if (undo.Count > capacity) undo.RemoveFirst();
        redo.Clear();                               // a new edit invalidates the redo branch
        version++;
        Changed?.Invoke();
    }
}
```

Wiring it up in the editor UI:

```csharp
public class EditorToolbar : MonoBehaviour
{
    [SerializeField] UnityEngine.UI.Button undoButton, redoButton;
    [SerializeField] GameObject unsavedMarker;
    [SerializeField] Tilemap map;
    [SerializeField] TileBase brushTile;

    readonly CommandHistory history = new();

    void OnEnable()
    {
        history.Changed += Refresh;                        // Observer: react, don't poll
        undoButton.onClick.AddListener(history.Undo);
        redoButton.onClick.AddListener(history.Redo);
        Refresh();
    }

    void OnDisable() => history.Changed -= Refresh;

    void Refresh()
    {
        undoButton.interactable = history.CanUndo;
        redoButton.interactable = history.CanRedo;
        unsavedMarker.SetActive(history.HasUnsavedChanges);
    }

    void Update()
    {
        // A brush stroke is one undo step.
        if (Input.GetMouseButtonDown(0)) history.BeginGroup();
        if (Input.GetMouseButton(0))
        {
            var cell = map.WorldToCell(Camera.main.ScreenToWorldPoint(Input.mousePosition));
            if (map.GetTile(cell) != brushTile)
                history.Run(new PaintTileCommand(map, cell, brushTile));
        }
        if (Input.GetMouseButtonUp(0)) history.EndGroup();
    }

    // A prop's settings panel uses a memento-backed command.
    // PropSettings is any MonoBehaviour with serialised fields, e.g. `public Color color;`.
    public void SetPropColor(PropSettings prop, Color color) =>
        history.Run(new SnapshotCommand(prop, () => prop.color = color));
}
```

## Where the patterns meet: pitfalls

- **Editing without going through the history.** Any change made directly, such as `map.SetTile` in a tool, makes later undos restore the wrong state. Every edit must be a command.
- **Mementos that capture references.** `JsonUtility` stores object references as instance IDs, which go stale if the referenced object is destroyed and recreated. Snapshot plain data, or use stable IDs.
- **Memento cost.** Snapshotting a large object on every slider tick fills memory quickly. Group slider drags with `BeginGroup`/`EndGroup`, or merge consecutive commands on the same target.
- **Undo while a group is open** would split a stroke. That is why `CanUndo` is false until the group closes.
- **Commands that destroy objects.** "Delete prop" cannot keep a reference to a destroyed GameObject. Deactivate it and keep it alive while it is on the history, or store a memento that can re-create it.
- **Observer storms.** A 500-tile stroke recorded as one group raises `Changed` once, not 500 times. Keep notifications at the history level, not in individual commands.

## Variations

- **Merging:** consecutive `SnapshotCommand`s on the same target within a short time window replace each other's `after` state instead of adding new entries.
- **Persistent history:** serialise commands with stable IDs to keep undo across editor sessions.
- **Collaborative editing:** the same commands can be sent to other clients. See [Command](../patterns/command).
