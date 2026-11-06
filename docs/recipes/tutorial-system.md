# Tutorial System

> Step-by-step onboarding driven by what the player actually does, showing the right button for their device.

## Goal

The first ten minutes of a new player's experience:

- A sequence of **steps**: move, jump, open the inventory, equip a sword, defeat the first enemy.
- Each step completes when the player **actually does the thing**, not when they click "Next".
- Hints show the **correct button for the current device** ("Press **A**" on gamepad, "Press **Space**" on keyboard) and update if the player switches device or rebinds.
- Some hints are **non-blocking** overlays, while important moments **pause** the game with a modal explanation.
- Steps can be triggered by **reaching places** in the level ("You found a campfire").
- Tutorials are **written by designers** as data, can be skipped, and **never repeat** after completion, even across saves.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Quest System](../patterns/quest-system) | Each tutorial step is an objective that completes on a gameplay event. Steps are stages of one "tutorial quest". |
| [Event Bus](../patterns/event-bus) | Gameplay publishes facts (`PlayerJumped`, `ItemEquipped`, `EnemyKilled`) that steps listen for. |
| [Trigger Volume](../patterns/trigger-volume) | Location-based steps: entering an area publishes an event, or starts a step. |
| [Screen Stack](../patterns/screen-stack) | Modal tutorial screens pushed on top of gameplay. Non-blocking hints use an overlay layer. |
| [Input Abstraction](../patterns/input-abstraction) | Hint text uses the binding display string of an *action*, so glyphs match the device and rebinds. |

## How they fit together

```
 TutorialDefinition (data): steps[]
   step: { hint key, action to show, completion event, style: Overlay | Modal, optional area trigger }
                │
 TutorialRunner ── current step ──► subscribe to its completion event on the Event Bus
                │                     (PlayerJumped, InventoryOpened, ItemEquipped, AreaEntered("camp"), ...)
                ├─ Overlay: HintOverlay.Show("Press {0} to jump", action) ─► Input Abstraction display string
                └─ Modal:   ScreenStack.Push(TutorialPopup) + pause      ─► Back / Confirm continues
                │
   event arrives ──► step done ──► next step (or tutorial complete)
                │
   progress saved: { tutorialId, stepIndex, completed } (Save System, per profile)
```

The joins:

- **Quest System ↔ Event Bus.** A tutorial is a quest whose objectives are player actions. Gameplay code only publishes facts it would publish anyway. No gameplay class contains `if (tutorial.step == 3)`.
- **Trigger Volume ↔ Event Bus.** Level designers place volumes that publish `AreaEntered("campfire")`. A tutorial step waiting for that area completes, and steps can also *start* there.
- **Input Abstraction ↔ hint text.** Hints refer to *actions* ("Jump"), and the text is built from `GetBindingDisplayString` for the active device. Switching from keyboard to gamepad updates the hint immediately.
- **Screen Stack ↔ step styles.** Modal steps push a screen and pause, while overlay steps do not touch the stack. Back closes a modal step exactly like any other screen, with no special case.

## Example (Unity C#)

This builds on `EventBus` ([Event Bus](../patterns/event-bus)), `ScreenStack` ([Screen Stack](../patterns/screen-stack)), `GameTime` ([Time Scale](../patterns/time-scale)) and the Input System actions from [Input Abstraction](../patterns/input-abstraction).

### Gameplay facts, published anyway

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;

public readonly struct PlayerJumped : IEvent { }
public readonly struct InventoryOpened : IEvent { }
public readonly struct ItemEquipped : IEvent { public readonly string ItemId; public ItemEquipped(string id) => ItemId = id; }
public readonly struct AreaEntered : IEvent { public readonly string AreaId; public AreaEntered(string id) => AreaId = id; }

// Trigger Volume → event: wire TriggerVolume.OnFirstEnter to Publish() in the inspector.
public class AreaMarker : MonoBehaviour
{
    [SerializeField] string areaId;
    public void Publish() => EventBus<AreaEntered>.Publish(new AreaEntered(areaId));
}
```

### Tutorial steps as data

```csharp
public enum StepStyle { Overlay, Modal }
public enum StepEvent { Jumped, InventoryOpened, ItemEquipped, AreaEntered, Confirmed }

[Serializable]
public class TutorialStep
{
    public string hintKey;                       // localisation key: "tut.jump" → "Press {0} to jump"
    public InputActionReference action;          // shown with the right glyph; may be empty
    public StepStyle style = StepStyle.Overlay;
    public StepEvent completeOn;
    public string parameter;                     // item id or area id, for those event types
}

[CreateAssetMenu(menuName = "Tutorial/Tutorial")]
public class TutorialDefinition : ScriptableObject
{
    public string id = "basics";
    public List<TutorialStep> steps = new();
}
```

### The runner: one step at a time, completed by events

```csharp
public class TutorialRunner : MonoBehaviour
{
    [SerializeField] TutorialDefinition tutorial;
    [SerializeField] HintOverlay overlay;                 // non-blocking hint text
    [SerializeField] TutorialPopup popup;                 // a UIScreen for modal steps
    [SerializeField] ScreenStack screens;

    int index = -1;
    GameTime.Request pause;
    readonly List<Action> unsubscribe = new();

    public void Begin(int fromStep)                       // from saved progress; -1 = new player
    {
        if (fromStep >= tutorial.steps.Count) return;     // already completed: never repeat
        index = Mathf.Max(fromStep, 0) - 1;
        Next();
    }

    void Next()
    {
        Cleanup();
        index++;
        TutorialProgress.Save(tutorial.id, index);         // resume here after quitting
        if (index >= tutorial.steps.Count) { overlay.Hide(); return; }

        var step = tutorial.steps[index];
        string text = string.Format(Loc.Get(step.hintKey), BindingText(step.action));

        if (step.style == StepStyle.Modal)
        {
            pause = GameTime.Push(0f, "Tutorial");
            popup.Show(text, onConfirm: Next);
            screens.Push(popup);
        }
        else overlay.Show(text);

        Listen(step);
    }

    // Subscribe to exactly the event that completes this step, and remember how to unsubscribe.
    void Listen(TutorialStep step)
    {
        switch (step.completeOn)
        {
            case StepEvent.Jumped:          Sub<PlayerJumped>(_ => Next()); break;
            case StepEvent.InventoryOpened: Sub<InventoryOpened>(_ => Next()); break;
            case StepEvent.ItemEquipped:    Sub<ItemEquipped>(e => { if (string.IsNullOrEmpty(step.parameter) || e.ItemId == step.parameter) Next(); }); break;
            case StepEvent.AreaEntered:     Sub<AreaEntered>(e => { if (e.AreaId == step.parameter) Next(); }); break;
            case StepEvent.Confirmed:       break;      // modal popups call Next() on confirm
        }
    }

    void Sub<T>(Action<T> handler) where T : struct, IEvent
    {
        EventBus<T>.Subscribe(handler);
        unsubscribe.Add(() => EventBus<T>.Unsubscribe(handler));
    }

    void Cleanup()
    {
        foreach (var u in unsubscribe) u();
        unsubscribe.Clear();
        pause?.Dispose(); pause = null;
        if (screens.Top == popup) screens.Pop();
    }

    // "Space" on keyboard, "A" or "Cross" on gamepad, and the player's rebinding if they changed it.
    static string BindingText(InputActionReference a) =>
        a == null ? "" : a.action.GetBindingDisplayString(InputBinding.DisplayStringOptions.DontIncludeInteractions);

    public void Skip() { index = tutorial.steps.Count - 1; Next(); }   // from the pause menu

    void OnDestroy() => Cleanup();
}
```

`Loc.Get` is the small localisation helper from [Localization Tables](../patterns/localization-tables). `TutorialProgress.Save` stores the step index per profile, outside save slots, so a player who finished the tutorial never sees it again in a new save. `HintOverlay` and `TutorialPopup` are simple UI components.

To keep glyphs current when the player switches device mid-step, refresh the overlay text when the active control scheme changes (for example, from `PlayerInput.onControlsChanged`).

## Where the patterns meet: pitfalls

- **Steps completed before they start.** If the player jumps *before* the jump step is shown, the event is missed and they must jump again. Usually that is fine, but for one-time actions (picking up the only sword), check the current state when a step starts, as well as listening for the event.
- **Modal steps and pausing.** A modal popup that pauses the game but is closed by something other than its own button leaves the game frozen. Release the pause request in one cleanup path, as `Cleanup` does.
- **Hard-coded button names.** "Press Space" is wrong for gamepad players and anyone who rebinds. Always build hint text from the action's binding, never from a literal key name.
- **Tutorial logic in gameplay code.** `if (TutorialRunner.Step == 4) ...` spreads tutorial state everywhere. Gameplay publishes facts. If gameplay must be restricted during the tutorial (no inventory until step 3), use [Feature Flags](../patterns/feature-flags) or [Gameplay Tags](../patterns/tags) that the tutorial sets and clears.
- **Unskippable tutorials.** Returning players and speedrunners will thank you for a skip option, and a "replay tutorial" option in settings.

## Variations

- **Contextual hints:** non-sequential tips triggered the first time something happens (first time low on health, first locked door), tracked in the same "seen" save data.
- **Highlighting UI:** steps that point at a UI element add a highlight or arrow to it through a named-anchor registry, so the tutorial does not need direct references into UI prefabs.
- **Adaptive help:** if a step is not completed after 30 seconds, show a more explicit hint, or a short animation.
- **Analytics:** log step start and completion times to find where new players get stuck or quit.
