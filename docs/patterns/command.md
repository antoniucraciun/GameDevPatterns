# Command

> Turn a request into an object you can queue, replay, undo or send over a network.

**Category:** Behavioral & Communication

## Problem

Input handling often calls gameplay methods directly: `if (jumpPressed) player.Jump();`. That works until you need rebindable controls, AI that drives the same character, undo in a level editor, a replay system, or sending player actions to a server. Every one of these needs the action as *data*, not as a method call that has already happened.

## Solution

Wrap each action in a **command object** with an `Execute` method, and optionally `Undo`. Input code (or AI, or a network packet) creates commands. Something else executes them, possibly later, possibly more than once, possibly on another machine. A history stack of executed commands gives you undo. A timestamped log gives you replays.

## Example

An undoable move for a grid-based puzzle game or level editor. Unity and Unreal define the command objects; Godot already ships an undo stack, `UndoRedo`, whose actions are commands built from a "do" and an "undo" half.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public interface ICommand
{
    void Execute();
    void Undo();
}

public class MoveCommand : ICommand
{
    readonly Transform target;
    readonly Vector3Int delta;

    public MoveCommand(Transform target, Vector3Int delta)
    {
        this.target = target;
        this.delta = delta;
    }

    public void Execute() => target.position += (Vector3)delta;
    public void Undo()    => target.position -= (Vector3)delta;
}

public class CommandHistory
{
    readonly Stack<ICommand> done = new();
    readonly Stack<ICommand> undone = new();

    public void Run(ICommand c) { c.Execute(); done.Push(c); undone.Clear(); }
    public void Undo() { if (done.TryPop(out var c)) { c.Undo(); undone.Push(c); } }
    public void Redo() { if (undone.TryPop(out var c)) { c.Execute(); done.Push(c); } }
}

// Input layer: translate keys into commands.
public class PuzzleInput : MonoBehaviour
{
    [SerializeField] Transform box;
    readonly CommandHistory history = new();

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.RightArrow)) history.Run(new MoveCommand(box, Vector3Int.right));
        if (Input.GetKeyDown(KeyCode.Z)) history.Undo();
        if (Input.GetKeyDown(KeyCode.Y)) history.Redo();
    }
}
```

```gdscript [Godot (GDScript)]
# puzzle_input.gd: the input layer turns keys into UndoRedo actions.
extends Node

@export var box: Node2D
@export var cell_size := 64.0

var _history := UndoRedo.new()


func _exit_tree() -> void:
	_history.free()  # UndoRedo is an Object, not RefCounted


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_right"):
		move(box, Vector2i.RIGHT)
	elif event.is_action_pressed("ui_undo"):
		_history.undo()
	elif event.is_action_pressed("ui_redo"):
		_history.redo()


func move(target: Node2D, delta: Vector2i) -> void:
	var from := target.position
	_history.create_action("Move %s" % target.name)
	_history.add_do_property(target, "position", from + Vector2(delta) * cell_size)
	_history.add_undo_property(target, "position", from)
	_history.commit_action()  # runs the "do" half now; redo() runs it again later
```

```cpp [Unreal (C++)]
// Command.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"

class ICommand
{
public:
	virtual ~ICommand() = default;
	virtual void Execute() = 0;
	virtual void Undo() = 0;
};

class FMoveCommand : public ICommand
{
public:
	FMoveCommand(AActor* InTarget, FIntVector InDelta, float InCellSize)
		: Target(InTarget), Offset(FVector(InDelta) * InCellSize) {}

	virtual void Execute() override { if (AActor* T = Target.Get()) T->AddActorWorldOffset(Offset); }
	virtual void Undo() override    { if (AActor* T = Target.Get()) T->AddActorWorldOffset(-Offset); }

private:
	TWeakObjectPtr<AActor> Target;     // the actor may be destroyed while the command sits in history
	FVector Offset;
};

class FCommandHistory
{
public:
	void Run(TUniquePtr<ICommand> Command)
	{
		Command->Execute();
		Done.Push(MoveTemp(Command));
		Undone.Reset();
	}

	void Undo()
	{
		if (Done.Num() == 0) return;
		TUniquePtr<ICommand> Command = Done.Pop();
		Command->Undo();
		Undone.Push(MoveTemp(Command));
	}

	void Redo()
	{
		if (Undone.Num() == 0) return;
		TUniquePtr<ICommand> Command = Undone.Pop();
		Command->Execute();
		Done.Push(MoveTemp(Command));
	}

private:
	TArray<TUniquePtr<ICommand>> Done, Undone;
};

// PuzzlePawn.h: the input layer turns Enhanced Input actions into commands.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "Command.h"
#include "PuzzlePawn.generated.h"

class UInputAction;

UCLASS()
class APuzzlePawn : public APawn
{
	GENERATED_BODY()

public:
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	UPROPERTY(EditAnywhere, Category = "Puzzle") TObjectPtr<AActor> Box;
	UPROPERTY(EditAnywhere, Category = "Puzzle") float CellSize = 100.f;
	UPROPERTY(EditDefaultsOnly, Category = "Input") TObjectPtr<UInputAction> MoveRightAction;
	UPROPERTY(EditDefaultsOnly, Category = "Input") TObjectPtr<UInputAction> UndoAction;
	UPROPERTY(EditDefaultsOnly, Category = "Input") TObjectPtr<UInputAction> RedoAction;

private:
	void MoveRight() { History.Run(MakeUnique<FMoveCommand>(Box, FIntVector(1, 0, 0), CellSize)); }
	void Undo() { History.Undo(); }
	void Redo() { History.Redo(); }

	FCommandHistory History;
};

// PuzzlePawn.cpp (the input mapping context is added in the player controller, not shown)
#include "PuzzlePawn.h"
#include "EnhancedInputComponent.h"

void APuzzlePawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);
	UEnhancedInputComponent* Input = CastChecked<UEnhancedInputComponent>(PlayerInputComponent);
	Input->BindAction(MoveRightAction, ETriggerEvent::Started, this, &APuzzlePawn::MoveRight);
	Input->BindAction(UndoAction, ETriggerEvent::Started, this, &APuzzlePawn::Undo);
	Input->BindAction(RedoAction, ETriggerEvent::Started, this, &APuzzlePawn::Redo);
}
```

:::

For gameplay actions you can pass the actor at execution time instead (`Execute(Unit actor)`). The same command can then be issued by the player or by AI.

**Engine notes**

- **Unity:** There is no runtime undo stack; `UnityEditor.Undo` is editor-only. The Input System's actions decouple keys from behaviour but are not commands themselves: they don't carry the data to undo.
- **Godot:** `UndoRedo` (Godot 4) handles the do/undo stacks, redo clearing and merging (`MERGE_ENDS` for drags). It extends `Object`, so free it yourself. Editor plugins use `EditorUndoRedoManager` instead. For commands that also go to AI or replays, keep a `RefCounted` command class with `execute()` and `undo()` and call it from `add_do_method` / `add_undo_method`.
- **Unreal:** `FScopedTransaction` and the transaction buffer are editor undo; they don't exist in packaged games, so gameplay undo is your own history as above. Hold actors weakly (`TWeakObjectPtr`) in commands, since the history can outlive them. Gameplay Ability System abilities play a similar role for networked actions: an activation request carrying target data.

## When to use

- Undo/redo in puzzles, editors and strategy games.
- Replays and deterministic networking: record or transmit commands, not state.
- Decoupling input from the actor so players and AI share one code path.
- Queued actions, such as RTS orders or turn-based moves.

## When not to use

- Actions you never need to undo, replay, queue or send over the network. Calling the method directly is simpler.
- Undo for complex changes that are hard to reverse by hand. Snapshotting with [Memento](./memento) may be less error-prone.
- Wrapping every method call in a command class. Use it at the boundary (player and AI actions, editor operations), not everywhere.

## Pitfalls

- **Undo needs enough captured state.** "Deal 10 damage" cannot be undone if the target was clamped at 0 HP. Store what actually changed.
- **Allocation per command** in hot paths. Use structs or pool commands if you create thousands per frame.
- **Commands that reference scene objects** cannot be serialised for replays or networking. Use stable IDs.

## Related

- [Observer](./observer) — notifies listeners that something happened. A command *makes* it happen.
- [Replay System](./replay-system) and [Server Reconciliation](./server-reconciliation) are built on command logs.
- [Memento](./memento) — an alternative way to support undo, by saving snapshots.
