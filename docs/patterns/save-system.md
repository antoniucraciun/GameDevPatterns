# Save System

> Serialise game state through saveable components with versioned, migratable data.

**Category:** Gameplay Systems

## Problem

The first save code is one big method that reaches into the player, the inventory, every chest and every door, and writes their fields to a file. Each new feature means editing that method. Renaming a field breaks every existing save. A crash halfway through writing corrupts the player's only save file. Objects are matched by name, so two chests called "Chest" overwrite each other. And references (the item in a chest, the quest giver) cannot be written to disk at all.

## Solution

Distribute the work, and make the format robust:

- **Saveable components.** Anything with persistent state implements `ISaveable`: *capture my state as plain data* and *restore from that data*. The save system does not know what a chest or a door is.
- **Stable IDs.** Each saveable object has a unique, persistent ID (a GUID generated in the editor), so it can be matched on load regardless of name or hierarchy.
- **Plain data only.** Saved state contains values and IDs, never object references. "The chest contains item `iron_sword`", not a reference to a ScriptableObject instance.
- **A versioned envelope.** The file records a format version. On load, **migrations** upgrade old data step by step to the current version.
- **Safe writes.** Write to a temporary file, then replace the old save in one step, keeping a backup. A crash can never leave a half-written save.

## Example

### Saveable objects with stable IDs

Every object with saved state has an ID that survives reloads and builds, and turns its state into plain data and back.

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public interface ISaveable
{
    string Id { get; }
    object CaptureState();                 // must return a [Serializable] plain-data object
    void RestoreState(string json);
}

[DisallowMultipleComponent]
public class SaveId : MonoBehaviour
{
    [SerializeField] string id;
    public string Id => id;

#if UNITY_EDITOR
    void OnValidate()                      // assign once, keep forever; fix duplicates from copy-paste
    {
        if (string.IsNullOrEmpty(id) || IsDuplicate())
        {
            id = Guid.NewGuid().ToString("N");
            UnityEditor.EditorUtility.SetDirty(this);
        }
    }

    bool IsDuplicate()
    {
        foreach (var other in FindObjectsByType<SaveId>())
            if (other != this && other.id == id) return true;
        return false;
    }
#endif
}

public class Chest : MonoBehaviour, ISaveable
{
    [Serializable] class State { public bool opened; public List<string> itemIds = new(); }

    public bool Opened;
    public List<string> ItemIds = new();

    public string Id => GetComponent<SaveId>().Id;

    public object CaptureState() => new State { opened = Opened, itemIds = new List<string>(ItemIds) };

    public void RestoreState(string json)
    {
        var s = JsonUtility.FromJson<State>(json);
        Opened = s.opened;
        ItemIds = s.itemIds;
        // Update visuals (lid open/closed) from the restored state here.
    }
}
```

```gdscript [Godot (GDScript)]
# chest.gd: saveable nodes join the "saveable" group and provide three methods.
# @tool so the id is assigned in the editor, once, and saved with the scene.
@tool
extends Node3D

@export var save_id := ""  # duplicating a node copies this: clear it on the copy to get a new one
@export var opened := false
@export var item_ids: Array[String] = []


func _ready() -> void:
	if Engine.is_editor_hint():
		if save_id.is_empty():
			save_id = str(ResourceUID.create_id())  # a random 64-bit id
		return
	add_to_group(&"saveable")


func get_save_id() -> String:
	return save_id


func capture_state() -> Dictionary:  # plain data only: it goes through JSON
	return {"opened": opened, "item_ids": item_ids.duplicate()}


func restore_state(data: Dictionary) -> void:
	opened = data.get("opened", false)
	item_ids.assign(data.get("item_ids", []))
	# Update visuals (lid open/closed) from the restored state here.
```

```cpp [Unreal (C++)]
// Saveable.h: a marker interface. The saved data is every UPROPERTY marked SaveGame, and the id is
// the actor's name, which is stable for actors placed in a level.
#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "Saveable.generated.h"

UINTERFACE()
class USaveable : public UInterface { GENERATED_BODY() };

class ISaveable
{
	GENERATED_BODY()

public:
	virtual void OnStateRestored() {}               // update visuals from the restored properties
};

// Chest.h
UCLASS()
class AChest : public AActor, public ISaveable
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, SaveGame, Category = "Chest") bool bOpened = false;
	UPROPERTY(EditAnywhere, SaveGame, Category = "Chest") TArray<FName> ItemIds;

	virtual void OnStateRestored() override;        // swing the lid open or closed
};
```

:::

### The save file: envelope, versioning, migrations and atomic writes

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

[Serializable]
public class SaveFile
{
    public int version;
    public string savedAtUtc;
    public List<Entry> entries = new();
    [Serializable] public class Entry { public string id; public string json; }
}

public static class SaveSystem
{
    public const int CurrentVersion = 2;

    static string PathFor(string slot) => Path.Combine(Application.persistentDataPath, $"{slot}.save");

    public static void Save(string slot)
    {
        var file = new SaveFile { version = CurrentVersion, savedAtUtc = DateTime.UtcNow.ToString("o") };
        foreach (var s in FindSaveables())
            file.entries.Add(new SaveFile.Entry { id = s.Id, json = JsonUtility.ToJson(s.CaptureState()) });

        string path = PathFor(slot), temp = path + ".tmp", backup = path + ".bak";
        File.WriteAllText(temp, JsonUtility.ToJson(file));       // 1. write everything to a temp file
        if (File.Exists(path)) File.Replace(temp, path, backup);  // 2. swap in one step, keep a backup
        else File.Move(temp, path);
    }

    public static bool Load(string slot)
    {
        string path = PathFor(slot);
        if (!File.Exists(path)) return false;

        var file = JsonUtility.FromJson<SaveFile>(File.ReadAllText(path));
        Migrate(file);

        var byId = new Dictionary<string, string>();
        foreach (var e in file.entries) byId[e.id] = e.json;

        foreach (var s in FindSaveables())
            if (byId.TryGetValue(s.Id, out var json)) s.RestoreState(json);
        return true;
    }

    // Upgrade old saves one version at a time.
    static void Migrate(SaveFile file)
    {
        if (file.version > CurrentVersion)
            throw new InvalidOperationException("Save is from a newer version of the game.");

        if (file.version < 2)
        {
            // v1 stored chest items as "item:sword"; v2 uses plain ids "iron_sword".
            foreach (var e in file.entries)
                e.json = e.json.Replace("\"item:sword\"", "\"iron_sword\"");
        }
        file.version = CurrentVersion;
    }

    static IEnumerable<ISaveable> FindSaveables()
    {
        foreach (var mb in UnityEngine.Object.FindObjectsByType<MonoBehaviour>(FindObjectsInactive.Include))
            if (mb is ISaveable s) yield return s;
    }
}
```

```gdscript [Godot (GDScript)]
# save_system.gd: autoload named SaveSystem.
# Saves are JSON, not Resources: loading a .tres or .res can run scripts embedded in it,
# so a save file shared online could execute code. ConfigFile is also safe, for settings.
extends Node

const CURRENT_VERSION := 2


func _path_for(slot: String) -> String:
	return "user://%s.save" % slot


func save_game(slot: String) -> Error:
	var entries := {}
	for node in get_tree().get_nodes_in_group(&"saveable"):
		entries[node.get_save_id()] = node.capture_state()
	var data := {
		"version": CURRENT_VERSION,
		"saved_at_utc": Time.get_datetime_string_from_system(true),
		"entries": entries,
	}

	var path := _path_for(slot)
	var file := FileAccess.open(path + ".tmp", FileAccess.WRITE)  # 1. write everything to a temp file
	if file == null:
		return FileAccess.get_open_error()
	file.store_string(JSON.stringify(data))
	file.close()
	if FileAccess.file_exists(path):
		DirAccess.rename_absolute(path, path + ".bak")  # 2. keep the previous save as a backup
	return DirAccess.rename_absolute(path + ".tmp", path)  # 3. move the new one into place


func load_game(slot: String) -> bool:
	var path := _path_for(slot)
	if not FileAccess.file_exists(path):
		path += ".bak"  # the game stopped between steps 2 and 3
		if not FileAccess.file_exists(path):
			return false

	var data = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not (data is Dictionary) or not _migrate(data):
		return false

	var entries: Dictionary = data["entries"]
	for node in get_tree().get_nodes_in_group(&"saveable"):
		var id: String = node.get_save_id()
		if entries.has(id):
			node.restore_state(entries[id])
	return true


# Upgrade old saves one version at a time.
func _migrate(data: Dictionary) -> bool:
	var version := int(data.get("version", 1))  # JSON numbers load as floats
	if version > CURRENT_VERSION:
		push_error("Save is from a newer version of the game.")
		return false
	if version < 2:
		# v1 stored chest items as "item:sword"; v2 uses plain ids "iron_sword".
		for id in data["entries"]:
			var items: Array = data["entries"][id].get("item_ids", [])
			for i in items.size():
				if items[i] == "item:sword":
					items[i] = "iron_sword"
	data["version"] = CURRENT_VERSION
	return true
```

```cpp [Unreal (C++)]
// GameSave.h: USaveGame is Unreal's save container; UGameplayStatics writes it to a named slot.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/SaveGame.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "GameSave.generated.h"

USTRUCT()
struct FSavedActor
{
	GENERATED_BODY()

	UPROPERTY() FName Id;
	UPROPERTY() TArray<uint8> Data;                 // the actor's SaveGame properties
};

UCLASS()
class UGameSave : public USaveGame
{
	GENERATED_BODY()

public:
	UPROPERTY() int32 Version = 0;
	UPROPERTY() FDateTime SavedAtUtc;
	UPROPERTY() TArray<FSavedActor> Actors;
};

// SaveSubsystem.h
UCLASS()
class USaveSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	static constexpr int32 CurrentVersion = 2;

	UFUNCTION(BlueprintCallable, Category = "Save") bool Save(const FString& Slot);
	UFUNCTION(BlueprintCallable, Category = "Save") bool Load(const FString& Slot);

private:
	bool Migrate(UGameSave* Save) const;
};

// SaveSubsystem.cpp
#include "SaveSubsystem.h"
#include "Saveable.h"
#include "Kismet/GameplayStatics.h"
#include "Serialization/MemoryReader.h"
#include "Serialization/MemoryWriter.h"
#include "Serialization/ObjectAndNameAsStringProxyArchive.h"

bool USaveSubsystem::Save(const FString& Slot)
{
	UGameSave* Save = Cast<UGameSave>(UGameplayStatics::CreateSaveGameObject(UGameSave::StaticClass()));
	Save->Version = CurrentVersion;
	Save->SavedAtUtc = FDateTime::UtcNow();

	TArray<AActor*> Saveables;
	UGameplayStatics::GetAllActorsWithInterface(GetWorld(), USaveable::StaticClass(), Saveables);
	for (AActor* Actor : Saveables)
	{
		FSavedActor& Entry = Save->Actors.AddDefaulted_GetRef();
		Entry.Id = Actor->GetFName();
		FMemoryWriter Writer(Entry.Data, true);
		FObjectAndNameAsStringProxyArchive Ar(Writer, false);
		Ar.ArIsSaveGame = true;                     // only properties marked SaveGame
		Actor->Serialize(Ar);
	}
	return UGameplayStatics::SaveGameToSlot(Save, Slot, 0);   // AsyncSaveGameToSlot avoids a hitch
}

bool USaveSubsystem::Load(const FString& Slot)
{
	if (!UGameplayStatics::DoesSaveGameExist(Slot, 0)) return false;
	UGameSave* Save = Cast<UGameSave>(UGameplayStatics::LoadGameFromSlot(Slot, 0));
	if (!Save || !Migrate(Save)) return false;

	TMap<FName, const TArray<uint8>*> ById;
	for (const FSavedActor& Entry : Save->Actors) ById.Add(Entry.Id, &Entry.Data);

	TArray<AActor*> Saveables;
	UGameplayStatics::GetAllActorsWithInterface(GetWorld(), USaveable::StaticClass(), Saveables);
	for (AActor* Actor : Saveables)
	{
		const TArray<uint8>* const* Data = ById.Find(Actor->GetFName());
		if (!Data) continue;
		FMemoryReader Reader(**Data, true);
		FObjectAndNameAsStringProxyArchive Ar(Reader, true);
		Ar.ArIsSaveGame = true;
		Actor->Serialize(Ar);
		Cast<ISaveable>(Actor)->OnStateRestored();
	}
	return true;
}

// Upgrade old saves one version at a time.
bool USaveSubsystem::Migrate(UGameSave* Save) const
{
	if (Save->Version > CurrentVersion) return false;     // from a newer version of the game
	if (Save->Version < 2)
	{
		// Envelope changes go here. Changes inside an actor's data are versioned per class:
		// register an FCustomVersion and check Ar.CustomVer() in that class's Serialize.
	}
	Save->Version = CurrentVersion;
	return true;
}
```

:::

Objects created at runtime (dropped items, spawned enemies) have no editor-assigned ID. Save them as a list of "spawn this prefab ID with this state" entries owned by a manager, and recreate them on load.

**Engine notes**

- **Unity:** Recent Unity 6 versions deprecate the `FindObjectsSortMode` overloads of `FindObjectsByType`; on versions without the overloads used here, add `FindObjectsSortMode.None`. `JsonUtility` handles only `[Serializable]` classes and structs with public or `[SerializeField]` fields: no dictionaries, no polymorphism, no top-level arrays. Use Newtonsoft JSON (the `com.unity.nuget.newtonsoft-json` package) when you need them. `Application.persistentDataPath` is the per-user save folder on every platform.
- **Godot:** `user://` is the per-user save folder. `FileAccess` plus `JSON` (or `ConfigFile` for settings) is the safe choice for save files. `ResourceSaver` / `ResourceLoader` are convenient but must never load files a player could have downloaded, because resources can contain scripts. JSON turns integers into floats, hence `int(...)` in the migration.
- **Unreal:** `USaveGame` with `SaveGameToSlot` / `LoadGameFromSlot` is the built-in path and handles the per-platform save location. `UPROPERTY(SaveGame)` with `ArIsSaveGame` saves only the marked fields of any actor. Actor names are stable for actors placed in a level but not for spawned ones; give those an `FGuid` property. The engine doesn't promise that a save survives a crash mid-write, so keep a fallback, for example by saving to two alternating slots and loading the newer valid one.

## When to use

- Any game with persistence: progression, world state, settings, checkpoints.
- Games that keep updating after release. Versioned saves are what keep old players' progress working.

## When not to use

- Arcade games that only store a high score. `PlayerPrefs` is enough.
- Saving the whole scene with reflection or binary serialization of objects. It breaks between versions; save explicit, versioned data.
- Short games with no persistence beyond settings.

## Pitfalls

- **Saving references.** `JsonUtility` stores Unity object references as instance IDs that are meaningless in the next session. Save IDs and look the objects up on load.
- **No versioning from day one.** Adding a version field later means guessing the format of unversioned files. Start at version 1 in the first build.
- **Non-atomic writes.** Writing directly over the save corrupts it if the game crashes or the device powers off mid-write. Always write to a temp file, then replace.
- **Duplicated IDs.** Copy-pasting objects in the editor duplicates their IDs, so two chests share a state. Detect and regenerate duplicates in the editor, as `SaveId` does.
- **Restore order.** Object B's state may depend on A being restored first (a door depends on its switch). Restore in two passes (data first, then "post-load" fix-ups), or give saveables an explicit order.
- **Saving mid-action.** Saving during a jump, a cutscene or a combat animation captures states that are hard to restore. Save at safe points, or save only data that is meaningful at rest.
- **Platform rules.** Consoles and some mobile platforms require their own save APIs, size limits and user prompts. Keep file access behind an interface.

## Related

- [Memento](./memento) — each saveable produces a memento of itself.
- [Data-Driven Design](./data-driven-design) — items and other content are saved as data IDs, not objects.
- [Inventory](./inventory) — a typical saveable with nested data.
- [Bootstrapper](./bootstrapper) and [Checkpoint / Respawn](./checkpoint) — when and from where saving and loading happen.
