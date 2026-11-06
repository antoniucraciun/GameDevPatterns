# Chain of Responsibility

> Pass a request along handlers until one deals with it (input, damage modifiers).

**Category:** Behavioral & Communication

## Problem

A click in a strategy game could mean many things. Close a modal popup, if one is open. Interact with a UI button, if the cursor is over one. Place a building, if the build tool is active. Select a unit, if one is under the cursor. Otherwise, move the selected units. Writing this as one big `if/else` in a single input handler couples every system to every other. Adding a new mode (a targeting spell) means editing that block, and the priority order is buried in the conditions.

## Solution

Give every potential receiver the same interface, and arrange them in a **chain**, ordered by priority. The request (the click) travels down the chain: each handler either **handles it and stops** the chain, or **passes it on**.

- Each handler is independent, and only knows whether *it* wants the request.
- The **order of the chain is the priority**, visible in one place.
- Handlers can be **added and removed at runtime**: entering build mode inserts the build tool, and leaving removes it.

A variation lets every handler process the request and pass it on (modifying it along the way) instead of stopping. The [Damage Pipeline](./damage-pipeline) is that variation.

## Example (Unity C#)

Pointer-input routing for a strategy game:

```csharp
using System.Collections.Generic;
using UnityEngine;

public struct PointerEvent
{
    public Vector2 ScreenPosition;
    public int Button;                 // 0 = left, 1 = right
}

public interface IPointerHandler
{
    int Priority { get; }              // higher runs first
    bool Handle(in PointerEvent e);    // true = handled, stop the chain
}

public class PointerChain : MonoBehaviour
{
    readonly List<IPointerHandler> handlers = new();

    public void Add(IPointerHandler h)
    {
        handlers.Add(h);
        handlers.Sort((a, b) => b.Priority.CompareTo(a.Priority));
    }

    public void Remove(IPointerHandler h) => handlers.Remove(h);

    void Update()
    {
        for (int button = 0; button < 2; button++)
        {
            if (!Input.GetMouseButtonDown(button)) continue;
            var e = new PointerEvent { ScreenPosition = Input.mousePosition, Button = button };
            foreach (var h in handlers.ToArray())          // copy: handlers may add/remove themselves
                if (h.Handle(e)) break;
        }
    }
}

// Each handler only decides for itself.
public class ModalPopupHandler : IPointerHandler
{
    public int Priority => 100;
    public bool Handle(in PointerEvent e) => ModalPopup.IsOpen;              // swallow clicks while a modal is open
}

public class UiHandler : IPointerHandler
{
    public int Priority => 90;
    public bool Handle(in PointerEvent e) =>
        UnityEngine.EventSystems.EventSystem.current.IsPointerOverGameObject();   // the UI handles it
}

public class BuildToolHandler : IPointerHandler           // added only while build mode is active
{
    public int Priority => 50;
    readonly BuildingPlacer placer;
    public BuildToolHandler(BuildingPlacer placer) => this.placer = placer;

    public bool Handle(in PointerEvent e)
    {
        if (e.Button == 1) { placer.Cancel(); return true; }
        return placer.TryPlaceAt(e.ScreenPosition);
    }
}

public class UnitSelectionHandler : IPointerHandler
{
    public int Priority => 20;
    public bool Handle(in PointerEvent e) => e.Button == 0 && Selection.TrySelectAt(e.ScreenPosition);
}

public class MoveOrderHandler : IPointerHandler          // last resort: right-click moves the selection
{
    public int Priority => 0;
    public bool Handle(in PointerEvent e) => e.Button == 1 && Selection.OrderMoveTo(e.ScreenPosition);
}

// Entering build mode: chain.Add(buildTool);   Leaving: chain.Remove(buildTool);
```

`ModalPopup`, `BuildingPlacer` and `Selection` stand in for game systems. Each handler stays small, and the full priority order is the list of `Priority` values.

## When to use

- Input routing between UI, tools, modes and gameplay.
- Requests that one of several handlers should claim: interaction targets, help or tooltip providers, cheat commands, "who handles this collision?".
- Processing pipelines where each step may modify or stop the request: damage, chat filters, network message processing.

## Pitfalls

- **Unhandled requests.** If nothing in the chain handles a request, it vanishes silently. Add a final catch-all handler, or log unhandled requests in development.
- **Order bugs.** A handler that claims too much (always returns `true`) blocks everything after it. Keep handlers strict about what they claim, and make priorities visible (a debug view of the chain).
- **Modifying the chain while iterating.** A handler that removes itself mid-dispatch breaks iteration. Iterate a copy, as above, or apply changes after dispatch.
- **Long chains in hot paths.** Walking 20 handlers for every mouse move is fine. For per-entity, per-frame requests, a direct lookup may be better.

## Related

- [Damage Pipeline](./damage-pipeline) — the "every handler processes" variation.
- [Decorator](./decorator) — wraps handlers around one object, always passing through.
- [Input Abstraction](./input-abstraction) — produces the actions that flow through a chain.
- [Screen Stack](./screen-stack) — the top screen gets input first: a chain ordered by the stack.
- [Command](./command) — handlers often turn requests into commands.
