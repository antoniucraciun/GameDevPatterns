# Memento

> Capture and restore an object's state without exposing its internals.

**Category:** Behavioral & Communication

## Problem

A puzzle game needs "restart room", a strategy game needs "undo last turn", and a level editor needs undo for a complex prop with twenty settings. Writing a hand-crafted reverse operation for every possible change is tedious and easy to get wrong. Making every field public, so that some external undo system can copy them, breaks encapsulation and couples that system to every class it saves.

## Solution

The object whose state is saved (the **originator**) can produce a **memento**: an opaque snapshot of its own state. It can later restore itself from that memento. A **caretaker**, such as an undo stack, a checkpoint system or a "restart room" button, stores mementos without knowing or touching what is inside them.

Three roles:

| Role | Responsibility |
| --- | --- |
| **Originator** | Creates mementos of itself and restores itself from them. Only it understands their contents. |
| **Memento** | An immutable snapshot. To everyone else, it is a black box. |
| **Caretaker** | Decides *when* to snapshot and *which* memento to restore. Never inspects contents. |

## Pseudocode

```text
// Originator: the only one that knows what its state is.
Crate:
    position, health, is_open

    save():
        return Memento(position, health, is_open)   // a copy, not a view

    restore(m):
        position ← m.position       // only Crate may read these
        health   ← m.health
        is_open  ← m.is_open

// Memento: an immutable snapshot, a black box to everyone else.
Memento:
    position, health, is_open       // set once, when created

// Caretaker: decides when to save and what to restore, never looks inside.
RoomReset:
    snapshot ← empty list of (crate, memento)

    on room entered:
        clear snapshot
        for each crate c in the room:
            add (c, c.save()) to snapshot

    reset room:
        for each (c, m) in snapshot:
            if c still exists:      // it may have been destroyed since
                c.restore(m)
```

## Example

### An explicit memento

The originator controls exactly what is captured, and the caretaker stores mementos without reading them.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public class Crate : MonoBehaviour
{
    [SerializeField] int health = 3;
    bool isOpen;

    // The memento: immutable, and its fields are private to everyone except Crate.
    public sealed class Memento
    {
        internal readonly Vector3 Position;
        internal readonly int Health;
        internal readonly bool IsOpen;

        internal Memento(Vector3 position, int health, bool isOpen)
        {
            Position = position; Health = health; IsOpen = isOpen;
        }
    }

    public Memento Save() => new(transform.position, health, isOpen);

    public void Restore(Memento m)
    {
        transform.position = m.Position;
        health = m.Health;
        isOpen = m.IsOpen;
    }
}

// Caretaker: "restart room" snapshots every crate on entry.
public class RoomReset : MonoBehaviour
{
    readonly List<(Crate crate, Crate.Memento state)> snapshot = new();

    public void OnRoomEntered()
    {
        snapshot.Clear();
        foreach (var crate in GetComponentsInChildren<Crate>())
            snapshot.Add((crate, crate.Save()));
    }

    public void ResetRoom()
    {
        foreach (var (crate, state) in snapshot)
            crate.Restore(state);
    }
}
```

```gdscript [Godot (GDScript)]
# crate.gd
class_name Crate
extends Node3D

@export var health := 3
var is_open := false


# The memento. GDScript has no access modifiers, so "only Crate reads it" is a convention,
# marked by the underscores.
class Memento:
	var _position: Vector3
	var _health: int
	var _is_open: bool

	func _init(p_position: Vector3, p_health: int, p_is_open: bool) -> void:
		_position = p_position
		_health = p_health
		_is_open = p_is_open


func save() -> Memento:
	return Memento.new(position, health, is_open)  # Vector3 is a value type: copied, not shared


func restore(m: Memento) -> void:
	position = m._position
	health = m._health
	is_open = m._is_open


# room_reset.gd: caretaker, "restart room" snapshots every crate on entry.
extends Node3D

var _snapshot := {}  # Crate -> Crate.Memento


func on_room_entered() -> void:
	_snapshot.clear()
	for node in find_children("*", "", true, false):
		if node is Crate:
			_snapshot[node] = (node as Crate).save()


func reset_room() -> void:
	for crate in _snapshot:
		if is_instance_valid(crate):  # a crate may have been freed since
			(crate as Crate).restore(_snapshot[crate])
```

```cpp [Unreal (C++)]
// Crate.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Crate.generated.h"

// The memento: anyone can store or copy it, but only ACrate can read or fill it.
class FCrateMemento
{
	friend class ACrate;

	FVector Location = FVector::ZeroVector;
	int32 Health = 0;
	bool bOpen = false;
};

UCLASS()
class ACrate : public AActor
{
	GENERATED_BODY()

public:
	FCrateMemento Save() const
	{
		FCrateMemento M;
		M.Location = GetActorLocation();
		M.Health = Health;
		M.bOpen = bOpen;
		return M;
	}

	void Restore(const FCrateMemento& M)
	{
		SetActorLocation(M.Location, false, nullptr, ETeleportType::TeleportPhysics);   // teleport: no sweep, no physics velocity
		Health = M.Health;
		bOpen = M.bOpen;
	}

private:
	UPROPERTY(EditAnywhere, Category = "Crate") int32 Health = 3;
	bool bOpen = false;
};

// RoomReset.h: caretaker, "restart room" snapshots every crate on entry.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Crate.h"
#include "RoomReset.generated.h"

UCLASS()
class ARoomReset : public AActor
{
	GENERATED_BODY()

public:
	UPROPERTY(EditInstanceOnly, Category = "Room") TArray<TObjectPtr<ACrate>> Crates;

	void OnRoomEntered()
	{
		Snapshot.Reset();
		for (ACrate* Crate : Crates) Snapshot.Emplace(Crate, Crate->Save());
	}

	void ResetRoom()
	{
		for (const TPair<TWeakObjectPtr<ACrate>, FCrateMemento>& Entry : Snapshot)
			if (ACrate* Crate = Entry.Key.Get()) Crate->Restore(Entry.Value);   // skip crates destroyed since
	}

private:
	TArray<TPair<TWeakObjectPtr<ACrate>, FCrateMemento>> Snapshot;
};
```

:::

In C#, `internal` only hides the fields from *other* assemblies. To hide them inside one assembly too, have `Save` return an empty marker interface (`ICrateMemento`) and keep the concrete class private inside `Crate`. C++'s `friend` gives that guarantee directly.

### A generic memento

Each engine can serialise an object's saved fields without per-class code:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public static class ComponentMemento
{
    public static string Save(Object target) => JsonUtility.ToJson(target);
    public static void Restore(Object target, string memento) => JsonUtility.FromJsonOverwrite(memento, target);
}
```

```gdscript [Godot (GDScript)]
# node_memento.gd: captures every exported script variable (what the scene file would save).
class_name NodeMemento


static func save(target: Object) -> Dictionary:
	var state := {}
	for p in target.get_property_list():
		var usage: int = p["usage"]
		if usage & PROPERTY_USAGE_STORAGE and usage & PROPERTY_USAGE_SCRIPT_VARIABLE:
			state[p["name"]] = _copy(target.get(p["name"]))
	return state


static func restore(target: Object, state: Dictionary) -> void:
	for property in state:
		target.set(property, _copy(state[property]))


# Arrays and Dictionaries are shared references: without a deep copy, the memento
# would change along with the object.
static func _copy(value: Variant) -> Variant:
	if value is Array or value is Dictionary:
		return value.duplicate(true)
	return value
```

```cpp [Unreal (C++)]
// ActorMemento.h: serialises every UPROPERTY(SaveGame) field, the same mechanism save games use.
#pragma once

#include "CoreMinimal.h"
#include "Serialization/MemoryReader.h"
#include "Serialization/MemoryWriter.h"
#include "Serialization/ObjectAndNameAsStringProxyArchive.h"

namespace ActorMemento
{
	inline TArray<uint8> Save(UObject* Target)
	{
		TArray<uint8> Bytes;
		FMemoryWriter Writer(Bytes);
		FObjectAndNameAsStringProxyArchive Ar(Writer, true);
		Ar.ArIsSaveGame = true;                              // only properties marked SaveGame
		Target->Serialize(Ar);
		return Bytes;
	}

	inline void Restore(UObject* Target, const TArray<uint8>& Bytes)
	{
		FMemoryReader Reader(Bytes);
		FObjectAndNameAsStringProxyArchive Ar(Reader, true);
		Ar.ArIsSaveGame = true;
		Target->Serialize(Ar);
	}
}

// In ACrate:  UPROPERTY(EditAnywhere, SaveGame) int32 Health = 3;
```

:::

The generic version needs no per-class code, but captures *every* saved field. That is convenient for editor undo, but wasteful and sometimes wrong for gameplay, for example when it captures object references. Unreal's opt-in `SaveGame` flag narrows it to the fields you mark.

**Engine notes**

- **Unity:** `JsonUtility` serialises the same fields the inspector shows (public or `[SerializeField]`), and object references only as instance IDs, which are meaningless after a reload.
- **Godot:** `UndoRedo` can store and restore property values for undo (`add_do_property` / `add_undo_property`), which covers editor-style undo without a memento class. `Resource.duplicate()` snapshots state kept in a resource, and `PackedScene.pack(node)` snapshots a whole subtree (only nodes whose `owner` is set are included).
- **Unreal:** `FScopedTransaction` and `Modify()` are the editor's memento system, not available in packaged games. For gameplay, the `SaveGame` archive above is the usual tool; `USaveGame` objects plus `UGameplayStatics::SaveGameToSlot` write it to disk. Object references survive as names with `FObjectAndNameAsStringProxyArchive`, but only for objects that still exist when restoring.

## When to use

- Undo when changes are too complex to reverse by hand.
- Checkpoints, "restart room", rewinding a turn.
- Saving and restoring speculative state, such as AI look-ahead or previewing a move before committing it.

## When not to use

- Large state that changes in small steps. Full snapshots waste memory; use [Command](./command) with undo.
- Saving games. Snapshots of runtime objects are fragile across versions; use a [Save System](./save-system) with explicit, versioned data.
- State that includes references to engine objects you can't copy, such as scene objects, textures or sockets.

## Pitfalls

- **Memory.** Snapshotting large objects often is expensive. Snapshot only what changes, use incremental (delta) mementos, or cap the history length.
- **References inside mementos.** A memento that stores a reference to another object restores the *reference*, not that object's state. If the other object was destroyed, the reference is dead. Store stable IDs, and snapshot related objects together.
- **Mutable mementos.** If a memento can be modified after capture, undo becomes unreliable. Make mementos immutable, and copy collections rather than storing the live list.
- **Engine state you cannot capture**, such as physics contacts, animator internals or particle systems mid-play. Decide explicitly what "restored" means for these, usually reset rather than restore.

## Related

- [Command](./command) — the other way to implement undo. Commands can use mementos internally.
- [Replay System](./replay-system) — snapshot replays are a sequence of mementos.
- [Save System](./save-system) — persistent mementos written to disk, with versioning.
