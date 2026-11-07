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

## Example

Pointer-input routing for a strategy game: a modal popup, the UI, the build tool, unit selection and move orders each get a chance at a click, in priority order. Godot's input propagation already is such a chain, so the Godot tab uses it instead of building one.

::: code-group

```csharp [Unity (C#)]
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

```gdscript [Godot (GDScript)]
# Godot passes every input event along a chain: _input, then Control nodes' _gui_input
# (a Control with Mouse Filter = Stop consumes the click, so a modal popup or HUD panel
# needs no code), then _shortcut_input, then _unhandled_input on each node in reverse
# tree order. Any handler can stop it with get_viewport().set_input_as_handled().
#
#   Main
#   ├─ MoveOrders       ← asked last
#   ├─ UnitSelection
#   ├─ BuildTool        ← asked first; added only while build mode is active
#   └─ HUD (CanvasLayer with Controls, which see clicks before all of these)

# build_tool.gd
extends Node

@export var placer: BuildingPlacer


func _unhandled_input(event: InputEvent) -> void:
	var click := event as InputEventMouseButton
	if click == null or not click.pressed:
		return
	if click.button_index == MOUSE_BUTTON_RIGHT:
		placer.cancel()
		get_viewport().set_input_as_handled()  # handled: stop the chain
	elif placer.try_place_at(click.position):
		get_viewport().set_input_as_handled()


# unit_selection.gd
extends Node


func _unhandled_input(event: InputEvent) -> void:
	var click := event as InputEventMouseButton
	if click and click.pressed and click.button_index == MOUSE_BUTTON_LEFT:
		if Selection.try_select_at(click.position):
			get_viewport().set_input_as_handled()


# move_orders.gd: last resort, right-click moves the selection.
extends Node


func _unhandled_input(event: InputEvent) -> void:
	var click := event as InputEventMouseButton
	if click and click.pressed and click.button_index == MOUSE_BUTTON_RIGHT:
		if Selection.order_move_to(click.position):
			get_viewport().set_input_as_handled()

# Entering build mode: add_child(build_tool)   Leaving: remove_child(build_tool)
```

```cpp [Unreal (C++)]
// PointerChain.h: UMG already consumes clicks on widgets that return FReply::Handled(),
// so only clicks on the game world reach this chain.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "InputCoreTypes.h"
#include "PointerChain.generated.h"

struct FPointerClick
{
	FVector2D ScreenPosition = FVector2D::ZeroVector;
	FKey Button;
};

class IPointerHandler
{
public:
	virtual ~IPointerHandler() = default;
	virtual int32 GetPriority() const = 0;                    // higher runs first
	virtual bool Handle(const FPointerClick& Click) = 0;      // true = handled, stop the chain
};

// Lives on the player controller, which calls Dispatch from its click input actions.
UCLASS()
class UPointerChainComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	void Add(TSharedRef<IPointerHandler> Handler)
	{
		Handlers.Add(Handler);
		Handlers.StableSort([](const TSharedRef<IPointerHandler>& A, const TSharedRef<IPointerHandler>& B)
		{
			return A->GetPriority() > B->GetPriority();
		});
	}

	void Remove(const TSharedRef<IPointerHandler>& Handler) { Handlers.Remove(Handler); }

	void Dispatch(const FPointerClick& Click)
	{
		const TArray<TSharedRef<IPointerHandler>> Snapshot = Handlers;   // copy: handlers may add/remove themselves
		for (const TSharedRef<IPointerHandler>& Handler : Snapshot)
			if (Handler->Handle(Click)) return;
	}

private:
	TArray<TSharedRef<IPointerHandler>> Handlers;
};

// Each handler only decides for itself.
class FBuildToolHandler : public IPointerHandler          // added only while build mode is active
{
public:
	explicit FBuildToolHandler(ABuildingPlacer* InPlacer) : Placer(InPlacer) {}
	virtual int32 GetPriority() const override { return 50; }

	virtual bool Handle(const FPointerClick& Click) override
	{
		ABuildingPlacer* P = Placer.Get();
		if (!P) return false;
		if (Click.Button == EKeys::RightMouseButton) { P->Cancel(); return true; }
		return P->TryPlaceAt(Click.ScreenPosition);
	}

private:
	TWeakObjectPtr<ABuildingPlacer> Placer;                   // handlers are not UObjects: hold actors weakly
};

class FMoveOrderHandler : public IPointerHandler          // last resort: right-click moves the selection
{
public:
	explicit FMoveOrderHandler(USelectionSubsystem* InSelection) : Selection(InSelection) {}
	virtual int32 GetPriority() const override { return 0; }

	virtual bool Handle(const FPointerClick& Click) override
	{
		USelectionSubsystem* S = Selection.Get();
		return S && Click.Button == EKeys::RightMouseButton && S->OrderMoveTo(Click.ScreenPosition);
	}

private:
	TWeakObjectPtr<USelectionSubsystem> Selection;
};

// Unit selection follows the same shape. In the player controller:
//   float X, Y;
//   if (GetMousePosition(X, Y)) PointerChain->Dispatch({FVector2D(X, Y), EKeys::LeftMouseButton});
// Entering build mode: PointerChain->Add(BuildTool);   Leaving: PointerChain->Remove(BuildTool);
```

:::

`ModalPopup`, `BuildingPlacer` and `Selection` stand in for game systems. Each handler stays small, and the full priority order is the list of `Priority` values (in Godot, the order of the nodes in the tree).

**Engine notes**

- **Unity:** The EventSystem already routes clicks to UI first, and `ExecuteEvents.ExecuteHierarchy` bubbles an event up the transform hierarchy until a handler takes it, which is a chain of responsibility for UI. The chain above adds the gameplay layers behind it.
- **Godot:** The input chain is built in; the only design decision is node order. Remember that `_unhandled_input` runs in *reverse* tree order: the node lower in the scene tree is asked first.
- **Unreal:** UMG/Slate events bubble from the widget under the cursor to its parents until one returns `FReply::Handled()`. Player-side input components form a priority stack too (`APlayerController::PushInputComponent`, `UInputComponent::Priority`, `bBlockInput`), and Enhanced Input mapping contexts have priorities. Use those for key bindings; a chain like this one suits "who gets this world click" decisions.

## When to use

- Input routing between UI, tools, modes and gameplay.
- Requests that one of several handlers should claim: interaction targets, help or tooltip providers, cheat commands, "who handles this collision?".
- Processing pipelines where each step may modify or stop the request: damage, chat filters, network message processing.

## When not to use

- When exactly one known handler always processes the request. Call it directly.
- Pipelines where every step always runs. That is a list of processors, not a chain, and it is easier to read as a simple loop.
- Long chains where it is hard to tell why a request was handled or dropped. Log the chain or use an explicit lookup.

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
