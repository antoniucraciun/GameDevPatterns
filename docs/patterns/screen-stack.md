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

## Example (Unity C#)

```csharp
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

With the Input System package, bind Back to a UI "Cancel" action, so the keyboard, gamepad and Android back button all go through the same path.

## When to use

- Any game with nested menus, settings, inventories, shops, popups or confirmation dialogs.
- Console and gamepad games, where correct focus restoration matters a lot.

## Pitfalls

- **Screens that open other screens directly** (`settings.SetActive(true)`) bypass the stack and break Back. All navigation goes through `Push` and `Pop`.
- **Several listeners for Back.** If gameplay also listens for Escape to open Pause, it must ignore the press whenever the stack is not empty.
- **Non-stack flows.** Tabs inside one screen, or a HUD that is always visible, do not belong on the stack. Keep them inside a screen, or on a separate layer.
- **Pushing the same screen twice** causes odd states. Guard against it, or bring the existing instance to the top.

## Related

- [State](./state) — a screen stack is a pushdown automaton applied to UI.
- [Command](./command) — UI buttons can issue commands instead of manipulating screens directly.
- MVC / MVP / MVVM — how to structure the contents of each screen.
