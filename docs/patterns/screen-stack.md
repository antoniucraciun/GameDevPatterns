# Screen Stack

> Manage menus and popups as a stack so Back always does the right thing.

**Category:** UI

## Problem

The player opens Pause, then Settings, then Audio, then a "Discard changes?" confirmation. Pressing Back (Escape, B on a gamepad, or the Android back button) should close only the confirmation. Then the Audio panel, then Settings, then unpause. When every menu shows and hides other menus directly, the result is a web of `settingsPanel.SetActive(false); pausePanel.SetActive(true);` calls. Back goes to the wrong place, two menus react to the same press, and gamepad focus is lost.

## Solution

Keep the open screens on a **stack**:

- **Push** opens a screen on top. The screen below it is either hidden, or stays visible but loses input (a modal popup over a menu).
- **Pop** closes the top screen and **restores** the one beneath it, including where gamepad focus was.
- **Back is handled in exactly one place**, the stack, which forwards it to the top screen only. A screen can refuse, for example a confirmation that must be answered.

Screens get lifecycle hooks (`OnPush`, `OnPop`, `OnFocus`, `OnBlur`) for animations, pausing time and remembering the selected element.

## Example

One stack owns which screen is on top, where focus goes, and what Back does. Unreal's **CommonUI** plugin ships this as `UCommonActivatableWidgetStack`, so its tab uses it instead of a hand-written stack.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;

public abstract class UIScreen : MonoBehaviour
{
    [SerializeField] GameObject firstSelected;
    [Tooltip("Keep the screen below visible, e.g. a popup over a menu.")]
    public bool isOverlay;
    GameObject lastSelected;

    public virtual void OnPush()  => gameObject.SetActive(true);
    public virtual void OnPop()   => gameObject.SetActive(false);

    public virtual void OnFocus()
    {
        EventSystem.current.SetSelectedGameObject(lastSelected ? lastSelected : firstSelected);
    }

    public virtual void OnBlur() => lastSelected = EventSystem.current.currentSelectedGameObject;

    // Return false to block Back, e.g. on a mandatory confirmation.
    public virtual bool OnBack() => true;
}

public class ScreenStack : MonoBehaviour
{
    readonly Stack<UIScreen> stack = new();

    public UIScreen Top => stack.Count > 0 ? stack.Peek() : null;

    public void Push(UIScreen screen)
    {
        if (Top != null)
        {
            Top.OnBlur();
            if (!screen.isOverlay) Top.gameObject.SetActive(false);
        }
        stack.Push(screen);
        screen.OnPush();
        screen.OnFocus();
    }

    public void Pop()
    {
        if (stack.Count == 0) return;
        stack.Pop().OnPop();
        if (Top != null)
        {
            Top.gameObject.SetActive(true);
            Top.OnFocus();
        }
    }

    // The ONLY place that listens for Back.
    void Update()
    {
        if (Top != null && Input.GetKeyDown(KeyCode.Escape) && Top.OnBack())
            Pop();
    }
}

// Usage: a button on the Settings screen
// screenStack.Push(audioSettingsScreen);
```

```gdscript [Godot (GDScript)]
# ui_screen.gd: base script for every screen (a Control).
class_name UIScreen
extends Control

@export var first_focus: Control
@export var is_overlay := false  # keep the screen below visible, e.g. a popup over a menu

var _last_focus: Control


func on_push() -> void:
	show()


func on_pop() -> void:
	hide()


func on_focus() -> void:
	var target := _last_focus if is_instance_valid(_last_focus) else first_focus
	if target != null:
		target.grab_focus()


func on_blur() -> void:
	_last_focus = get_viewport().gui_get_focus_owner()


# Return false to block Back, e.g. on a mandatory confirmation.
func on_back() -> bool:
	return true


# screen_stack.gd
class_name ScreenStack
extends Node

var _stack: Array[UIScreen] = []


func top() -> UIScreen:
	return null if _stack.is_empty() else _stack.back()


func push(screen: UIScreen) -> void:
	var below := top()
	if below != null:
		below.on_blur()
		if not screen.is_overlay:
			below.hide()
	_stack.push_back(screen)
	screen.on_push()
	screen.on_focus()


func pop() -> void:
	if _stack.is_empty():
		return
	_stack.pop_back().on_pop()
	var below := top()
	if below != null:
		below.show()
		below.on_focus()


# The ONLY place that listens for Back. "ui_cancel" is a built-in action: Escape and the
# gamepad's East button.
func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel") and top() != null:
		get_viewport().set_input_as_handled()
		if top().on_back():
			pop()


# Usage: a button on the Settings screen
# screen_stack.push(audio_settings_screen)
```

```cpp [Unreal (C++)]
// Needs the CommonUI plugin. A layout widget holds UCommonActivatableWidgetStacks; each screen
// is a UCommonActivatableWidget. Pushing deactivates the screen below; deactivating the top
// screen pops it and reactivates the one below, restoring its focus.

// MenuScreen.h
#pragma once

#include "CoreMinimal.h"
#include "CommonActivatableWidget.h"
#include "MenuScreen.generated.h"

UCLASS(Abstract)
class UMenuScreen : public UCommonActivatableWidget
{
	GENERATED_BODY()

public:
	UMenuScreen(const FObjectInitializer& ObjectInitializer) : Super(ObjectInitializer)
	{
		bIsBackHandler = true;                    // Back pops this screen
	}

protected:
	// Where focus goes when the screen activates (gamepad and keyboard navigation).
	virtual UWidget* NativeGetDesiredFocusTarget() const override { return FirstFocus; }

	// Return true without calling Super to block Back, e.g. on a mandatory confirmation.
	virtual bool NativeOnHandleBackAction() override
	{
		return bBlockBack ? true : Super::NativeOnHandleBackAction();   // Super deactivates (pops) it
	}

	UPROPERTY(meta = (BindWidget)) TObjectPtr<UWidget> FirstFocus;
	UPROPERTY(EditAnywhere, Category = "Screen") bool bBlockBack = false;
};

// MenuLayout.h: the root widget, added to the viewport once.
#pragma once

#include "CoreMinimal.h"
#include "CommonUserWidget.h"
#include "Widgets/CommonActivatableWidgetContainer.h"
#include "MenuLayout.generated.h"

UCLASS(Abstract)
class UMenuLayout : public UCommonUserWidget
{
	GENERATED_BODY()

public:
	UCommonActivatableWidget* Push(TSubclassOf<UCommonActivatableWidget> ScreenClass)
	{
		return MenuStack->AddWidget(ScreenClass);   // creates (or reuses) and activates the screen
	}

	// Overlays go on a second stack drawn above the first, so the menu below stays visible.
	UCommonActivatableWidget* PushOverlay(TSubclassOf<UCommonActivatableWidget> ScreenClass)
	{
		return ModalStack->AddWidget(ScreenClass);
	}

protected:
	UPROPERTY(meta = (BindWidget)) TObjectPtr<UCommonActivatableWidgetStack> MenuStack;
	UPROPERTY(meta = (BindWidget)) TObjectPtr<UCommonActivatableWidgetStack> ModalStack;
};

// Usage: a button on the Settings screen
// Layout->Push(AudioSettingsScreenClass);      // TSubclassOf<UCommonActivatableWidget>
```

:::

**Engine notes**

- **Unity:** with the Input System package, bind Back to a UI "Cancel" action, so the keyboard, gamepad and Android back button all go through the same path.
- **Godot:** `ui_cancel` is mapped to Escape and the gamepad's East button by default, and Android's back button arrives as the `NOTIFICATION_WM_GO_BACK_REQUEST` notification, which you can forward to the same Back path. Handling it in `_unhandled_input` lets a focused `LineEdit` or an open `PopupMenu` use Escape first.
- **Unreal:** CommonUI routes Back through its input settings: set a **Default Back Action** in **Project Settings > Common Input Settings** (an input action data table row, or an Enhanced Input action in UE 5.2+). Lyra's layered stacks (Game, GameMenu, Menu, Modal) and its UI extension points are a good reference for a full setup.

## When to use

- Any game with nested menus, settings, inventories, shops, popups or confirmation dialogs.
- Console and gamepad games, where correct focus restoration matters a lot.

## When not to use

- Games with one or two screens and no nesting.
- Overlays that should stay up independently of the stack, such as notifications or the HUD. Keep them on their own layer.

## Pitfalls

- **Screens that open other screens directly** (`settings.SetActive(true)`) bypass the stack and break Back. All navigation goes through `Push` and `Pop`.
- **Several listeners for Back.** If gameplay also listens for Escape to open Pause, it must ignore the press whenever the stack is not empty.
- **Non-stack flows.** Tabs inside one screen, or a HUD that is always visible, do not belong on the stack. Keep them inside a screen, or on a separate layer.
- **Pushing the same screen twice** causes odd states. Guard against it, or bring the existing instance to the top.

## Related

- [Pushdown Automaton](./pushdown-automaton) — a screen stack is this pattern applied to UI.
- [Command](./command) — UI buttons can issue commands instead of manipulating screens directly.
- [MVC / MVP / MVVM](./mvp-mvvm) — how to structure the contents of each screen.
