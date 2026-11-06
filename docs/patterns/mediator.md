# Mediator

> Route interactions through one object so participants do not reference each other.

**Category:** Behavioral & Communication

## Problem

A puzzle room has three pressure plates, two levers, a door, four lights and a timer. The door opens when all plates are pressed and the levers are in the right positions. Lights show progress. The timer resets the plates. Each lever ends up referencing the door, the lights and the other lever, each plate references the timer, and so on. With N objects, there are up to N² references. Changing the puzzle rule means editing several objects, and the same lever cannot be reused in another room because it knows too much about this one.

## Solution

Introduce a **mediator** that owns the **rules of interaction**:

- **Colleagues** (plates, levers, door, lights) know only the mediator. They **report** what happened to them ("I was pressed") and **obey** instructions ("open", "light up").
- The **mediator** knows all colleagues, and contains the logic connecting them: when this happens, do that.
- Colleagues become **reusable**, because a lever is just a lever. The *room* decides what levers mean.

Compared with an [Event Bus](./event-bus): a bus *relays* messages between anyone and anyone, with no logic. A mediator *coordinates* a specific group, and the rules live inside it.

## Example (Unity C#)

```csharp
using System.Collections.Generic;
using UnityEngine;

// Colleagues: simple, reusable, and they only talk to their mediator.
public interface IPuzzleMediator
{
    void Notify(PuzzlePart sender, string evt);
}

public abstract class PuzzlePart : MonoBehaviour
{
    protected IPuzzleMediator Mediator { get; private set; }
    public void Connect(IPuzzleMediator mediator) => Mediator = mediator;
}

public class PressurePlate : PuzzlePart
{
    public bool IsPressed { get; private set; }
    void OnTriggerEnter(Collider other) { IsPressed = true; Mediator.Notify(this, "pressed"); }
    void OnTriggerExit(Collider other)  { IsPressed = false; Mediator.Notify(this, "released"); }
    public void ResetPlate() => IsPressed = false;
}

public class Lever : PuzzlePart
{
    public bool IsUp { get; private set; }
    public void Pull() { IsUp = !IsUp; Mediator.Notify(this, "pulled"); }   // called by the Interaction System
}

public class PuzzleDoor : PuzzlePart
{
    public void SetOpen(bool open) { /* animate */ }
}

public class ProgressLight : PuzzlePart
{
    public void SetLit(bool lit) { /* toggle emission */ }
}

// The mediator: all the rules of THIS room, in one place.
public class PlateAndLeverRoom : MonoBehaviour, IPuzzleMediator
{
    [SerializeField] PressurePlate[] plates;
    [SerializeField] Lever leftLever, rightLever;
    [SerializeField] PuzzleDoor door;
    [SerializeField] ProgressLight[] lights;
    [SerializeField] float plateTimeout = 10f;

    float resetAt = float.PositiveInfinity;

    void Awake()
    {
        foreach (var p in GetComponentsInChildren<PuzzlePart>()) p.Connect(this);
    }

    public void Notify(PuzzlePart sender, string evt)
    {
        if (sender is PressurePlate && evt == "pressed" && float.IsPositiveInfinity(resetAt))
            resetAt = Time.time + plateTimeout;            // first plate starts the timer

        int pressed = 0;
        foreach (var p in plates) if (p.IsPressed) pressed++;
        for (int i = 0; i < lights.Length; i++) lights[i].SetLit(i < pressed);

        bool solved = pressed == plates.Length && leftLever.IsUp && !rightLever.IsUp;
        door.SetOpen(solved);
        if (solved) resetAt = float.PositiveInfinity;
    }

    void Update()
    {
        if (Time.time < resetAt) return;
        resetAt = float.PositiveInfinity;
        foreach (var p in plates) p.ResetPlate();          // too slow: start over
        Notify(null, "timeout");
    }
}
```

The same plates, levers and doors can be reused in a different room with a different mediator ("pull the levers in the right order"). Only the mediator changes.

Other common mediators in games: a **combat encounter** that coordinates its enemies (who attacks, who flanks, when reinforcements arrive), a **UI screen** that coordinates its widgets (selecting an item updates the preview, enables the buy button, refreshes the price), and a **vehicle** that coordinates engine, wheels and gearbox.

## When to use

- A group of objects with many interdependencies, whose rules belong to the *group*: puzzle rooms, encounters, UI screens, minigames.
- When you want individual parts to be reusable in different configurations.

## Pitfalls

- **The mediator becomes a god object.** All logic moves into one class that grows forever. Keep one mediator per group (room, screen, encounter), not one for the whole game.
- **String events.** `"pressed"` typos fail silently. Use enums, or separate methods on the mediator, once the set of events stabilises.
- **Colleagues reaching around the mediator.** A lever that directly opens the door "just this once" brings back the tangle. Colleagues should only talk to the mediator.
- **Hidden flow.** Behaviour now depends on mediator code that is not visible on the objects. Name mediators clearly and keep them next to the content they control (on the room's root object).

## Related

- [Event Bus](./event-bus) and [Observer](./observer) — notification without coordination logic.
- [Trigger Volume](./trigger-volume) and [Interaction System](./interaction-system) — typical sources of colleague events.
- [Facade](./facade) — simplifies access to a subsystem. A mediator coordinates peers.
- [MVC / MVP / MVVM](./mvp-mvvm) — a presenter mediates between view widgets and the model.
