# Input Abstraction

> Map physical buttons to game actions so code never reads raw keys.

**Also known as:** Action Mapping · **Category:** Game Feel & Input

## Problem

The player controller checks `Input.GetKeyDown(KeyCode.Space)`. Then gamepad support is needed, so the check grows into `Space || JoystickButton0`. Then a player asks to rebind jump. Then the inventory screen also uses Space, and opening it makes the character jump. Then the AI should drive the same controller, and the replay system should feed it recorded input. Every one of these changes touches gameplay code, because gameplay talks to *keys* instead of *intentions*.

## Solution

Put a layer between devices and gameplay:

- **Actions** describe intent: *Move*, *Jump*, *Attack*, *Interact*, *Pause*. Gameplay reads only actions.
- **Bindings** connect actions to device inputs: Space, gamepad South button, a touch button. They live in data, so players can rebind them.
- **Action maps** group actions by context (*Gameplay*, *UI*, *Vehicle*). Only the active map's actions fire, so opening a menu disables gameplay actions instead of every script checking "is a menu open?".
- An **interface** in front of gameplay (`ICharacterInput`) lets the player, the AI or a replay drive the same character.

## Example (Unity C#)

Using Unity's **Input System** package. Actions are defined in code here so the example is self-contained. In a project you would normally use an Input Actions asset and its generated C# class.

```csharp
using UnityEngine;
using UnityEngine.InputSystem;

// What gameplay sees: intentions, not devices.
public interface ICharacterInput
{
    Vector2 Move { get; }
    bool JumpPressed { get; }     // true for one frame
    bool AttackHeld { get; }
}

public class PlayerInputSource : ICharacterInput, System.IDisposable
{
    readonly InputActionMap gameplay = new("Gameplay");
    readonly InputAction move, jump, attack;

    public PlayerInputSource()
    {
        move = gameplay.AddAction("Move", InputActionType.Value);
        move.AddCompositeBinding("2DVector")
            .With("Up", "<Keyboard>/w").With("Down", "<Keyboard>/s")
            .With("Left", "<Keyboard>/a").With("Right", "<Keyboard>/d");
        move.AddBinding("<Gamepad>/leftStick");

        jump = gameplay.AddAction("Jump", InputActionType.Button);
        jump.AddBinding("<Keyboard>/space");
        jump.AddBinding("<Gamepad>/buttonSouth");

        attack = gameplay.AddAction("Attack", InputActionType.Button);
        attack.AddBinding("<Mouse>/leftButton");
        attack.AddBinding("<Gamepad>/rightTrigger");

        gameplay.Enable();
    }

    public Vector2 Move => move.ReadValue<Vector2>();
    public bool JumpPressed => jump.WasPressedThisFrame();
    public bool AttackHeld => attack.IsPressed();

    // Context switching: opening a menu disables gameplay actions entirely.
    public void SetGameplayEnabled(bool enabled) { if (enabled) gameplay.Enable(); else gameplay.Disable(); }

    // Rebinding: let the player press a new button for Jump, then save all overrides.
    // The action must be disabled while rebinding.
    public void RebindJump(System.Action onDone)
    {
        jump.Disable();
        jump.PerformInteractiveRebinding(bindingIndex: 0)          // rebinds the keyboard binding
            .WithControlsExcluding("<Mouse>/position")
            .OnComplete(op =>
            {
                op.Dispose();
                jump.Enable();
                PlayerPrefs.SetString("bindings", gameplay.SaveBindingOverridesAsJson());
                onDone();
            })
            .OnCancel(op => { op.Dispose(); jump.Enable(); })
            .Start();
    }

    public void LoadBindings()
    {
        var json = PlayerPrefs.GetString("bindings", "");
        if (!string.IsNullOrEmpty(json)) gameplay.LoadBindingOverridesFromJson(json);
    }

    public void Dispose() => gameplay.Dispose();
}
```

Gameplay depends only on the interface, so other sources plug in without changes:

```csharp
public class CharacterMotor : MonoBehaviour
{
    public ICharacterInput Input { get; set; }       // assigned by whoever controls this character

    void Update()
    {
        if (Input == null) return;
        Vector2 m = Input.Move;
        transform.position += new Vector3(m.x, 0f, m.y) * (5f * Time.deltaTime);
        if (Input.JumpPressed) { /* jump */ }
    }
}

// An AI drives the same motor by implementing the same interface.
public class ChaseAiInput : ICharacterInput
{
    readonly Transform self, target;
    public ChaseAiInput(Transform self, Transform target) { this.self = self; this.target = target; }

    public Vector2 Move
    {
        get { var d = target.position - self.position; return new Vector2(d.x, d.z).normalized; }
    }
    public bool JumpPressed => false;
    public bool AttackHeld => Vector3.Distance(self.position, target.position) < 2f;
}
```

## When to use

- Every game with more than one input device, rebindable controls or menus. In practice, every shipped game.
- When AI, replays, networking or tests need to drive the same characters as the player.

## When not to use

- Game jams and prototypes with one device and fixed controls. Reading input directly is faster.
- Duplicating what Unity's Input System already does. Its actions and bindings are an input abstraction; build on them instead of wrapping them again.

## Pitfalls

- **Raw input leaking back.** A single `Keyboard.current.spaceKey` in gameplay code bypasses rebinding and context switching. Search for direct device access and route it through actions.
- **One-frame actions in `FixedUpdate`.** `WasPressedThisFrame` is a frame concept. Latch presses in `Update` (see [Input Buffer](./input-buffer)) or use callbacks.
- **Overlapping maps.** Leaving *Gameplay* and *UI* enabled together means Escape both pauses and closes the menu. Enable exactly the maps the current context needs.
- **Rebinding conflicts.** Binding Jump to the same button as Attack silently breaks one of them. Detect conflicts and offer to swap.
- **Displaying the wrong glyphs.** Prompts that always say "Press Space" confuse gamepad players. Show bindings from the action (`GetBindingDisplayString`) for the active device.

## Related

- [Command](./command) — actions can produce command objects for queuing, undo and networking.
- [Input Buffer](./input-buffer) and [Coyote Time](./coyote-time) — timing forgiveness on top of actions.
- [Replay System](./replay-system) — a replay is just another `ICharacterInput`.
- [Screen Stack](./screen-stack) and [Game State Manager](./game-state-manager) — switch action maps on context changes.
