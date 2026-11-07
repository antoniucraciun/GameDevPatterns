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

## Example

A puzzle room: pressure plates, two levers, progress lights and a door. The parts only report what happened to them; the room decides what it means.

### The colleagues

::: code-group

```csharp [Unity (C#)]
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
```

```gdscript [Godot (GDScript)]
# Colleagues signal up and never look for each other ("call down, signal up").

# pressure_plate.gd
class_name PressurePlate
extends Area3D

signal pressed
signal released

var is_pressed := false


func _ready() -> void:
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)


func _on_body_entered(_body: Node3D) -> void:
	is_pressed = true
	pressed.emit()


func _on_body_exited(_body: Node3D) -> void:
	is_pressed = false
	released.emit()


func reset_plate() -> void:
	is_pressed = false


# lever.gd
class_name Lever
extends Node3D

signal pulled

var is_up := false


func pull() -> void:  # called by the interaction system
	is_up = not is_up
	pulled.emit()


# puzzle_door.gd
class_name PuzzleDoor
extends Node3D


func set_open(_open: bool) -> void:
	pass  # animate


# progress_light.gd
class_name ProgressLight
extends Node3D


func set_lit(_lit: bool) -> void:
	pass  # toggle emission
```

```cpp [Unreal (C++)]
// PuzzleParts.h: colleagues broadcast a change and never look for each other.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "PuzzleParts.generated.h"

class APuzzlePart;
DECLARE_MULTICAST_DELEGATE_OneParam(FOnPuzzlePartChanged, APuzzlePart* /*Sender*/);

UCLASS(Abstract)
class APuzzlePart : public AActor
{
	GENERATED_BODY()

public:
	FOnPuzzlePartChanged OnChanged;
};

UCLASS()
class APressurePlate : public APuzzlePart
{
	GENERATED_BODY()

public:
	bool IsPressed() const { return bPressed; }
	void ResetPlate() { bPressed = false; }

protected:
	virtual void NotifyActorBeginOverlap(AActor* Other) override { bPressed = true; OnChanged.Broadcast(this); }
	virtual void NotifyActorEndOverlap(AActor* Other) override { bPressed = false; OnChanged.Broadcast(this); }

private:
	bool bPressed = false;
};

UCLASS()
class ALever : public APuzzlePart
{
	GENERATED_BODY()

public:
	bool IsUp() const { return bUp; }
	void Pull() { bUp = !bUp; OnChanged.Broadcast(this); }   // called by the interaction system

private:
	bool bUp = false;
};

UCLASS()
class APuzzleDoor : public APuzzlePart
{
	GENERATED_BODY()

public:
	void SetOpen(bool bOpen) { /* animate */ }
};

UCLASS()
class AProgressLight : public APuzzlePart
{
	GENERATED_BODY()

public:
	void SetLit(bool bLit) { /* toggle emission */ }
};
```

:::

### The mediator: all the rules of this room, in one place

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

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

```gdscript [Godot (GDScript)]
# plate_and_lever_room.gd: the room node connects to its parts' signals and calls down into them.
extends Node3D

@export var plates: Array[PressurePlate]
@export var left_lever: Lever
@export var right_lever: Lever
@export var door: PuzzleDoor
@export var lights: Array[ProgressLight]
@export var plate_timeout := 10.0

var _reset_timer := Timer.new()


func _ready() -> void:
	_reset_timer.one_shot = true
	_reset_timer.timeout.connect(_on_timeout)
	add_child(_reset_timer)

	for p in plates:
		p.pressed.connect(_on_plate_pressed)
		p.released.connect(_update)
	left_lever.pulled.connect(_update)
	right_lever.pulled.connect(_update)


func _on_plate_pressed() -> void:
	if _reset_timer.is_stopped():
		_reset_timer.start(plate_timeout)  # first plate starts the timer
	_update()


func _update() -> void:
	var pressed := 0
	for p in plates:
		if p.is_pressed:
			pressed += 1
	for i in lights.size():
		lights[i].set_lit(i < pressed)

	var solved := pressed == plates.size() and left_lever.is_up and not right_lever.is_up
	door.set_open(solved)
	if solved:
		_reset_timer.stop()


func _on_timeout() -> void:
	for p in plates:
		p.reset_plate()  # too slow: start over
	_update()
```

```cpp [Unreal (C++)]
// PlateAndLeverRoom.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "PuzzleParts.h"
#include "PlateAndLeverRoom.generated.h"

UCLASS()
class APlateAndLeverRoom : public AActor
{
	GENERATED_BODY()

public:
	UPROPERTY(EditInstanceOnly, Category = "Puzzle") TArray<TObjectPtr<APressurePlate>> Plates;
	UPROPERTY(EditInstanceOnly, Category = "Puzzle") TObjectPtr<ALever> LeftLever;
	UPROPERTY(EditInstanceOnly, Category = "Puzzle") TObjectPtr<ALever> RightLever;
	UPROPERTY(EditInstanceOnly, Category = "Puzzle") TObjectPtr<APuzzleDoor> Door;
	UPROPERTY(EditInstanceOnly, Category = "Puzzle") TArray<TObjectPtr<AProgressLight>> Lights;
	UPROPERTY(EditAnywhere, Category = "Puzzle") float PlateTimeout = 10.f;

protected:
	virtual void BeginPlay() override;

private:
	void HandlePartChanged(APuzzlePart* Sender);
	void HandleTimeout();

	FTimerHandle ResetTimer;
};

// PlateAndLeverRoom.cpp
#include "PlateAndLeverRoom.h"
#include "TimerManager.h"

void APlateAndLeverRoom::BeginPlay()
{
	Super::BeginPlay();
	for (APressurePlate* Plate : Plates) Plate->OnChanged.AddUObject(this, &APlateAndLeverRoom::HandlePartChanged);
	LeftLever->OnChanged.AddUObject(this, &APlateAndLeverRoom::HandlePartChanged);
	RightLever->OnChanged.AddUObject(this, &APlateAndLeverRoom::HandlePartChanged);
}

void APlateAndLeverRoom::HandlePartChanged(APuzzlePart* Sender)
{
	const APressurePlate* Plate = Cast<APressurePlate>(Sender);
	if (Plate && Plate->IsPressed() && !GetWorldTimerManager().IsTimerActive(ResetTimer))
		GetWorldTimerManager().SetTimer(ResetTimer, this, &APlateAndLeverRoom::HandleTimeout, PlateTimeout);   // first plate starts the timer

	int32 Pressed = 0;
	for (const APressurePlate* P : Plates) if (P->IsPressed()) ++Pressed;
	for (int32 i = 0; i < Lights.Num(); ++i) Lights[i]->SetLit(i < Pressed);

	const bool bSolved = Pressed == Plates.Num() && LeftLever->IsUp() && !RightLever->IsUp();
	Door->SetOpen(bSolved);
	if (bSolved) GetWorldTimerManager().ClearTimer(ResetTimer);
}

void APlateAndLeverRoom::HandleTimeout()
{
	for (APressurePlate* P : Plates) P->ResetPlate();      // too slow: start over
	HandlePartChanged(nullptr);
}
```

:::

The same plates, levers and doors can be reused in a different room with a different mediator ("pull the levers in the right order"). Only the mediator changes.

Other common mediators in games: a **combat encounter** that coordinates its enemies (who attacks, who flanks, when reinforcements arrive), a **UI screen** that coordinates its widgets (selecting an item updates the preview, enables the buy button, refreshes the price), and a **vehicle** that coordinates engine, wheels and gearbox.

**Engine notes**

- **Unity:** The string event names keep the colleague interface tiny; use an enum or separate methods if typos become a problem. Wiring the colleagues with `UnityEvent`s in the inspector also works, but then the rules are spread across inspector fields instead of one class.
- **Godot:** "Call down, signal up" is the engine's own convention, and a parent node coordinating its children through their signals is a mediator. Signals can also be connected in the editor's **Node** dock, but connecting them in code keeps all the room's rules in one script.
- **Unreal:** A **Level Blueprint** often plays this role for one-off rooms; a mediator actor like this one is reusable and testable. Arrays of `TObjectPtr` with `EditInstanceOnly` let designers pick the parts in the level with the eyedropper.

## When to use

- A group of objects with many interdependencies, whose rules belong to the *group*: puzzle rooms, encounters, UI screens, minigames.
- When you want individual parts to be reusable in different configurations.

## When not to use

- Two or three objects with a simple relationship. Direct references are easier to follow.
- When the mediator would grow into a god object that knows every system in the game. Split it per group, or use an [Event Bus](./event-bus) for loose announcements.

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
