# Save & Load

> Save slots that restore the right level, world state and inventory, and survive game updates.

## Goal

Saving for a game with several levels and persistent world state, like an action RPG or metroidvania:

- **Three save slots**, each showing level name, play time and date on the load screen.
- Loading puts the player **in the right level, at the right place**, with the right inventory.
- **World state persists per level.** Chests opened in level 1 stay open after visiting level 2 and returning, without saving the game in between.
- Saves made with **older versions** of the game keep working after updates.
- A crash during saving **never corrupts** a slot.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Save System](../patterns/save-system) | `ISaveable` components with stable IDs, a versioned file format with migrations, and safe writes. |
| [Memento](../patterns/memento) | Each saveable captures an opaque snapshot of itself. The world-state cache stores mementos for levels that are not loaded. |
| [Inventory](../patterns/inventory) | Containers saved as plain data (item IDs, counts, durability), not object references. |
| [Data-Driven Design](../patterns/data-driven-design) | An item registry maps saved IDs back to `ItemDefinition` assets, so renaming an asset never breaks a save. |
| [Scene / Level Management](../patterns/scene-management) | Loading a slot loads its level first, then restores state into it. Leaving a level captures its state before unloading. |

## How they fit together

```
                     ┌──────────────────── WorldState (in memory, whole session) ────────────────────┐
                     │  "Level1": { chest_a1: {...}, door_7: {...} }    "Level2": { ... }            │
                     │  "global": { player: {...}, inventory: {...} }                                 │
                     └───────▲──────────────────────────┬──────────────────────────────▲─────────────┘
           capture before unload                restore after load                  Save(slot) / Load(slot)
                     │                                  │                                  │
   SceneLoader ──────┴── leaving Level1 ── LoadLevel(Level2) ──┘                     SaveFile (versioned, atomic)
                                                                                     { version, level, playTime,
   ISaveable components (Chest, Door, PlayerSaveable, InventorySaveable) ◄────────    worldState }
```

The joins:

- **Memento ↔ Scene Management.** World state cannot live only in the save file, or returning to a level without saving would reset it. A session-wide `WorldState` keeps one memento set per level. The scene loader captures a level when leaving and restores it when entering. Saving just writes `WorldState` to disk.
- **Save System ↔ Inventory.** The inventory is saved as data, `{ itemId, count, durability }` per slot, never as `ItemDefinition` references, which `JsonUtility` would write as meaningless instance IDs.
- **Data-Driven Design ↔ Save System.** An `ItemRegistry` asset maps stable string IDs to definitions. Saves refer to `"iron_sword"`, not to an asset path, so assets can be renamed and moved freely.
- **Save System ↔ Scene Management.** Loading a slot is a sequence: read and migrate the file, replace `WorldState`, load the saved level, *then* restore. Restoring before the level exists would find no saveables.

## Example (Unity C#)

This builds on the pattern pages: `ISaveable`, `SaveId`, `SaveFile` versioning and atomic writes ([Save System](../patterns/save-system)), `Container`, `ItemStack`, `ItemDefinition` ([Inventory](../patterns/inventory)) and `SceneLoader` ([Scene / Level Management](../patterns/scene-management)).

### World state: mementos per level, for the whole session

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

[Serializable]
public class WorldState
{
    [Serializable] public class Entry { public string scope, id, json; }   // scope = level name or "global"
    public List<Entry> entries = new();

    readonly Dictionary<(string, string), int> index = new();

    public void Set(string scope, string id, string json)
    {
        if (index.Count != entries.Count) Reindex();
        if (index.TryGetValue((scope, id), out int i)) entries[i].json = json;
        else { index[(scope, id)] = entries.Count; entries.Add(new Entry { scope = scope, id = id, json = json }); }
    }

    public bool TryGet(string scope, string id, out string json)
    {
        if (index.Count != entries.Count) Reindex();
        if (index.TryGetValue((scope, id), out int i)) { json = entries[i].json; return true; }
        json = null; return false;
    }

    void Reindex()                                      // after deserialisation, the index is empty
    {
        index.Clear();
        for (int i = 0; i < entries.Count; i++) index[(entries[i].scope, entries[i].id)] = i;
    }

    // Capture every saveable in a scene (or the persistent ones under "global").
    public void Capture(string scope, IEnumerable<ISaveable> saveables)
    {
        foreach (var s in saveables) Set(scope, s.Id, JsonUtility.ToJson(s.CaptureState()));
    }

    public void Restore(string scope, IEnumerable<ISaveable> saveables)
    {
        foreach (var s in saveables)
            if (TryGet(scope, s.Id, out var json)) s.RestoreState(json);
    }

    public static IEnumerable<ISaveable> In(Scene scene)
    {
        foreach (var root in scene.GetRootGameObjects())
            foreach (var mb in root.GetComponentsInChildren<MonoBehaviour>(includeInactive: true))
                if (mb is ISaveable s) yield return s;
    }
}
```

### Inventory as data, resolved through a registry

```csharp
[CreateAssetMenu(menuName = "Items/Item Registry")]
public class ItemRegistry : ScriptableObject
{
    [SerializeField] List<ItemDefinition> items = new();
    Dictionary<string, ItemDefinition> byId;

    public ItemDefinition Get(string id)
    {
        byId ??= BuildIndex();
        return byId.TryGetValue(id, out var def) ? def : null;
    }

    Dictionary<string, ItemDefinition> BuildIndex()
    {
        var d = new Dictionary<string, ItemDefinition>();
        foreach (var i in items) d[i.id] = i;
        return d;
    }
}

public class InventorySaveable : MonoBehaviour, ISaveable
{
    [Serializable] class SlotData { public string itemId; public int count, durability; }
    [Serializable] class State { public List<SlotData> slots = new(); }

    [SerializeField] ItemRegistry registry;
    public Container Bag { get; } = new Container(24);
    public string Id => "player_inventory";                       // persistent object: fixed id

    public object CaptureState()
    {
        var s = new State();
        for (int i = 0; i < Bag.Size; i++)
        {
            var stack = Bag[i];
            s.slots.Add(stack == null ? new SlotData()
                : new SlotData { itemId = stack.Definition.id, count = stack.Count, durability = stack.Durability });
        }
        return s;
    }

    public void RestoreState(string json)
    {
        var s = JsonUtility.FromJson<State>(json);
        Bag.Clear();                                              // a small addition to Container: empty all slots
        for (int i = 0; i < s.slots.Count && i < Bag.Size; i++)
        {
            var d = s.slots[i];
            if (string.IsNullOrEmpty(d.itemId)) continue;
            var def = registry.Get(d.itemId);
            if (def == null) { Debug.LogWarning($"Save references unknown item '{d.itemId}', skipped"); continue; }
            Bag.SetSlot(i, new ItemStack(def, d.count) { Durability = d.durability });
        }
    }
}
```

`Container` gains two small methods for this: `Clear()` and `SetSlot(int, ItemStack)`, both raising `Changed` so the UI refreshes.

### The game save: slots, level transitions, versioned file

```csharp
[Serializable]
public class GameSave                                  // the slot file, versioned and migrated as on the Save System page
{
    public int version = 3;
    public string level;
    public float playTimeSeconds;
    public string savedAtUtc;
    public WorldState world = new();
}

public class GameSaves : MonoBehaviour
{
    [SerializeField] SceneLoader loader;
    [SerializeField] PersistentRoot persistent;        // the player + inventory in the Core scene

    WorldState world = new();
    float playTime;

    void OnEnable()
    {
        loader.BeforeUnload += CaptureLevel;           // one small event added to SceneLoader
        loader.LevelLoaded += RestoreLevel;            // already on SceneLoader
    }

    void OnDisable()
    {
        loader.BeforeUnload -= CaptureLevel;
        loader.LevelLoaded -= RestoreLevel;
    }

    void Update() => playTime += Time.unscaledDeltaTime;

    void CaptureLevel(string level) => world.Capture(level, WorldState.In(SceneManager.GetSceneByName(level)));

    // After a level is loaded and set active, put its remembered state back.
    void RestoreLevel(string level) => world.Restore(level, WorldState.In(SceneManager.GetSceneByName(level)));

    public void Save(int slot)
    {
        CaptureLevel(loader.CurrentLevel);                          // the current level isn't captured yet
        world.Capture("global", persistent.Saveables);              // player position, inventory, quests
        var save = new GameSave
        {
            level = loader.CurrentLevel, playTimeSeconds = playTime,
            savedAtUtc = DateTime.UtcNow.ToString("o"), world = world,
        };
        AtomicFile.WriteJson($"slot{slot}.save", save);             // temp file + replace + backup
    }

    public async Awaitable Load(int slot)
    {
        var save = AtomicFile.ReadJson<GameSave>($"slot{slot}.save");
        SaveMigrations.Upgrade(save);                               // v1 → v2 → v3, one step at a time
        world = save.world;
        playTime = save.playTimeSeconds;

        world.Restore("global", persistent.Saveables);              // player and inventory first
        await loader.LoadLevel(save.level);                         // LevelLoaded → RestoreLevel
    }
}
```

`AtomicFile` wraps the temp-file-and-replace logic from [Save System](../patterns/save-system). The load screen reads just `level`, `playTimeSeconds` and `savedAtUtc` from each slot to show its summary.

## Where the patterns meet: pitfalls

- **Restoring before the level exists.** Calling `Restore` and then loading the scene restores nothing, or restores into the *old* level. Load first, restore after.
- **Forgetting the current level when saving.** The world cache only holds levels you have *left*. Capture the current level at save time, as `Save` does.
- **Level state captured too late.** If capture runs after unload has started, half the saveables are already destroyed. Capture in a "before unload" event, before calling `UnloadSceneAsync`.
- **Saving references.** Item definitions, prefabs and other assets must be saved as stable IDs, and resolved through registries on load.
- **Removed content.** An update that deletes an item breaks every save that contains it, unless loading skips unknown IDs (with a warning) or a migration converts them.
- **Runtime-spawned objects.** A dropped sword has no editor-assigned `SaveId`. Save dropped items as a list owned by a level manager (`{ itemId, position }`), and respawn them on restore.
- **Slot summaries that load everything.** Reading three full save files just to show the load screen is slow on consoles. Keep a small header (level, time, date) that can be read without parsing the world state.

## Variations

- **Autosave and checkpoints:** call `Save(autosaveSlot)` on checkpoints and level transitions, rotating between two autosave slots so one is always valid.
- **Cloud saves:** keep `AtomicFile` behind an interface, with platform implementations, and resolve conflicts with the newest `savedAtUtc` plus a prompt to the player.
- **Roguelike runs:** save meta-progression in a separate file that survives deleting the run.
- **Undo-friendly editors:** the same mementos power editor undo. See [Undo/Redo Level Editor](./undo-redo-editor).
