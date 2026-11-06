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

## Example (Unity C#)

### Saveable components with stable IDs

```csharp
using System;
using System.Collections.Generic;
using System.IO;
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
        foreach (var other in FindObjectsByType<SaveId>(FindObjectsSortMode.None))
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

### The save file: envelope, versioning, migrations and atomic writes

```csharp
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
        foreach (var mb in UnityEngine.Object.FindObjectsByType<MonoBehaviour>(FindObjectsInactive.Include, FindObjectsSortMode.None))
            if (mb is ISaveable s) yield return s;
    }
}
```

Objects created at runtime (dropped items, spawned enemies) have no editor-assigned ID. Save them as a list of "spawn this prefab ID with this state" entries owned by a manager, and recreate them on load.

## When to use

- Any game with persistence: progression, world state, settings, checkpoints.
- Games that keep updating after release. Versioned saves are what keep old players' progress working.

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
- [Bootstrapper](./bootstrapper) and Checkpoint / Respawn — when and from where saving and loading happen.
