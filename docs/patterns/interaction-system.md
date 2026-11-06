# Interaction System

> A generic "interactable" contract with prompts, priority and range checks.

**Category:** Gameplay Systems

## Problem

The player can open doors, talk to NPCs, pick up items, pull levers and sit on benches. Each was added separately: the door has its own trigger and key check, the NPC its own, and the pickup uses a different button. When a lever stands next to an item, both respond to one press, or neither does. Prompts ("Press E to open") are inconsistent, gamepad players cannot tell what will be activated, and adding a new interactable means copying another one's code.

## Solution

Split the work between **the things you can interact with** and **the one thing that decides**:

- **`IInteractable`** is implemented by doors, NPCs, items and levers. It provides a prompt ("Open", "Talk"), whether interaction is currently possible (`CanInteract`, e.g. "locked: needs key"), the action itself, and optionally a hold duration and priority.
- **`Interactor`** on the player is the only component that reads the interact button. Every few frames it finds nearby interactables, filters them (range, line of sight, `CanInteract`), **scores** them (distance, how centred they are in the view, priority), and keeps **one focused target**.
- The **focused target** gets a highlight and a prompt in the UI. Pressing the button interacts with that target only.

New interactables need no changes to the player.

## Example (Unity C#)

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

public interface IInteractable
{
    string Prompt { get; }                        // "Open", "Talk to Mira", "Pick up Iron Sword"
    int Priority { get; }                         // ties broken in favour of higher priority
    float HoldSeconds { get; }                    // 0 = press, > 0 = hold to interact
    Transform Anchor { get; }                     // where the prompt appears
    bool CanInteract(Interactor who, out string reason);   // reason: "Locked", "Inventory full"
    void Interact(Interactor who);
    void SetFocused(bool focused);                // highlight on/off
}

public class Interactor : MonoBehaviour
{
    [SerializeField] Transform eyes;
    [SerializeField] float range = 2.5f;
    [SerializeField] LayerMask interactableMask, occluders;
    [SerializeField] float scanInterval = 0.1f;

    public IInteractable Focused { get; private set; }
    public string BlockedReason { get; private set; }     // shown greyed out by the UI
    public float HoldProgress { get; private set; }        // 0..1 for a radial fill
    public event Action<IInteractable> FocusChanged;

    readonly Collider[] hits = new Collider[16];
    float nextScan;

    void Update()
    {
        if (Time.time >= nextScan) { nextScan = Time.time + scanInterval; Scan(); }
        HandleInput();
    }

    void Scan()
    {
        IInteractable best = null;
        float bestScore = float.MinValue;
        string bestReason = null;

        int n = Physics.OverlapSphereNonAlloc(eyes.position, range, hits, interactableMask);
        for (int i = 0; i < n; i++)
        {
            var candidate = hits[i].GetComponentInParent<IInteractable>();
            if (candidate == null) continue;

            Vector3 to = candidate.Anchor.position - eyes.position;
            if (Physics.Raycast(eyes.position, to.normalized, to.magnitude, occluders)) continue;   // behind a wall

            // Prefer what the player is looking at, then what is close, then higher priority.
            float facing = Vector3.Dot(eyes.forward, to.normalized);          // 1 = dead centre
            if (facing < 0.3f) continue;                                       // outside a ~70° cone
            float score = facing * 2f - to.magnitude / range + candidate.Priority * 0.5f;

            if (score > bestScore)
            {
                bestScore = score;
                best = candidate;
                candidate.CanInteract(this, out bestReason);
            }
        }

        if (best != Focused)
        {
            Focused?.SetFocused(false);
            Focused = best;
            Focused?.SetFocused(true);
            HoldProgress = 0f;
            FocusChanged?.Invoke(Focused);                                     // UI updates the prompt
        }
        BlockedReason = bestReason;
    }

    void HandleInput()
    {
        if (Focused == null || BlockedReason != null) { HoldProgress = 0f; return; }

        if (Focused.HoldSeconds <= 0f)
        {
            if (Input.GetButtonDown("Interact")) Focused.Interact(this);
            return;
        }

        if (Input.GetButton("Interact"))
        {
            HoldProgress += Time.deltaTime / Focused.HoldSeconds;
            if (HoldProgress >= 1f) { HoldProgress = 0f; Focused.Interact(this); }
        }
        else HoldProgress = 0f;
    }
}
```

An interactable door:

```csharp
public class Door : MonoBehaviour, IInteractable
{
    [SerializeField] string keyItemId;                  // empty = unlocked
    [SerializeField] Renderer outline;
    bool open;

    public string Prompt => open ? "Close" : "Open";
    public int Priority => 0;
    public float HoldSeconds => 0f;
    public Transform Anchor => transform;

    public bool CanInteract(Interactor who, out string reason)
    {
        reason = null;
        if (string.IsNullOrEmpty(keyItemId) || open) return true;
        if (who.GetComponent<PlayerInventory>().Has(keyItemId)) return true;
        reason = "Locked";
        return false;
    }

    public void Interact(Interactor who) { open = !open; /* animate, play sound */ }
    public void SetFocused(bool focused) => outline.enabled = focused;
}
```

`CanInteract` is evaluated when the focus is chosen and shown in the prompt ("Locked"), rather than letting the press fail silently. `Input.GetButton("Interact")` stands in for an action from [Input Abstraction](./input-abstraction).

## When to use

- First- and third-person games, adventure games, RPGs, immersive sims: anything with "press to use".
- Whenever several kinds of objects respond to the same button.

## When not to use

- One or two interactable kinds. Direct trigger checks are clearer.
- Games with no "use" input, such as shooters where you only touch pickups. Collisions are enough.

## Pitfalls

- **Several objects activating at once.** Interacting in each interactable's own trigger means overlapping triggers all fire. Only the interactor reads input, and only the focused target acts.
- **Focus flicker.** Two objects with similar scores swap focus every scan. Add a small bonus for the current focus (hysteresis).
- **Prompts that lie.** A prompt saying "Open" on a locked door that then does nothing feels broken. Show the blocked reason in the prompt.
- **Interacting through walls.** Range checks alone let players loot through thin walls. Add a line-of-sight check.
- **Holding through a focus change.** If the player turns away mid-hold, progress must reset, or the hold completes on a different object.
- **Interaction during other actions.** Opening a door mid-attack or mid-dialogue causes odd states. Gate the interactor with the player's state or tags (for example, not while in a cutscene).

## Related

- [Input Abstraction](./input-abstraction) — the interact action, rebindable per device.
- [Observer](./observer) — `FocusChanged` drives the prompt UI.
- [Gameplay Tags](./tags) — gate interaction on character state.
- [Inventory](./inventory) — keys and pickups.
- [Dialogue System](./dialogue-system) — what talking to an NPC starts.
- [Trigger Volume](./trigger-volume) — automatic interactions without a button press.
