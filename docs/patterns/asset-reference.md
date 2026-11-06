# Asset References & Addressing

> Refer to assets by stable keys and load them on demand instead of hard links.

**Category:** Data, Content & Procedural Generation

## Problem

A level-select menu has direct inspector references to all 40 level backgrounds. Because Unity loads everything a scene references, all 40 textures (800 MB) load the moment the menu opens. The enemy spawner references every enemy prefab, so all their meshes, textures and sounds sit in memory for the whole game. Shipping a new costume means shipping a new build. Loading content from a `Resources` folder by string name breaks silently when files are renamed, and bloats startup.

## Solution

Separate **referring to an asset** from **loading it**:

- An **asset reference** is a lightweight, stable key (a GUID or an address) stored in data, instead of a direct link. Holding it costs nothing.
- Code **loads** the asset asynchronously when it is needed, and receives a **handle**.
- Code **releases** the handle when done. The system counts references and unloads the asset (and its dependencies) when nothing uses it.
- Assets are packed into **bundles** that can ship with the game or be **downloaded later** (new content without a new build).

In Unity, the **Addressables** package implements this: `AssetReference` fields in the inspector, `LoadAssetAsync`, `Release`, labels for loading groups ("all level 3 enemies"), and local or remote hosting.

## Example (Unity C#)

Loading enemy prefabs on demand, per level, and releasing them when the level ends:

```csharp
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;

[CreateAssetMenu(menuName = "Enemies/Enemy Type (Addressable)")]
public class EnemyTypeAddressable : ScriptableObject
{
    public string id;
    public AssetReferenceGameObject prefab;          // a key, not a hard link: costs no memory until loaded
}

public class LevelContent : MonoBehaviour
{
    [SerializeField] List<EnemyTypeAddressable> enemiesInThisLevel;

    readonly Dictionary<EnemyTypeAddressable, AsyncOperationHandle<GameObject>> loaded = new();

    // Called by the level loader before gameplay starts (behind the loading screen).
    public async Awaitable Preload()
    {
        var pending = new List<AsyncOperationHandle<GameObject>>();
        foreach (var type in enemiesInThisLevel)
        {
            if (loaded.ContainsKey(type)) continue;
            var handle = type.prefab.LoadAssetAsync();   // starts loading; nothing blocks
            loaded[type] = handle;
            pending.Add(handle);
        }
        foreach (var h in pending)
        {
            await h.Task;                                 // wait for all of them
            if (h.Status != AsyncOperationStatus.Succeeded) Debug.LogError($"Failed to load {h.DebugName}");
        }
    }

    public GameObject Spawn(EnemyTypeAddressable type, Vector3 position)
    {
        if (!loaded.TryGetValue(type, out var h) || !h.IsDone)
        {
            Debug.LogError($"{type.id} was not preloaded for this level");
            return null;
        }
        return Instantiate(h.Result, position, Quaternion.identity);
    }

    // When the level unloads: release every handle; Addressables unloads what nothing else uses.
    void OnDestroy()
    {
        foreach (var h in loaded.Values) Addressables.Release(h);
        loaded.Clear();
    }
}
```

Loading a whole group by **label**, for example everything tagged `level3`:

```csharp
// var handle = Addressables.LoadAssetsAsync<GameObject>("level3", null);
// await handle.Task;  ... use handle.Result ...  Addressables.Release(handle);
```

Instances created with `Instantiate` from a loaded prefab do not hold their own reference. Keep the prefab handle until all instances are gone, as `LevelContent` does by holding handles for the level's lifetime. Alternatively, use `Addressables.InstantiateAsync` and `Addressables.ReleaseInstance`, which count each instance.

## When to use

- Large or optional content: levels, characters, cosmetics, audio banks, localised voice-over.
- Memory-constrained platforms (mobile, Switch), where only the current level's content should be in memory.
- Live games that download new content without app-store updates.
- Replacing `Resources.Load`, which is slow at startup and has no memory control.

## When not to use

- Small games that fit in memory. Direct references are simpler and load with the scene.
- Assets that are always needed, such as the player or the HUD. Loading them on demand adds delay and failure cases.
- Before you need downloadable or optional content. Addressables add build and loading complexity.

## Pitfalls

- **Leaks from missing `Release`.** Every successful load needs exactly one release. Track handles in one owner per lifetime (level, screen), and release in `OnDestroy`.
- **Releasing too early.** Releasing a prefab handle while instances still exist can unload their materials, leaving pink or invisible objects. Release after the last instance is gone.
- **Hitches from synchronous loads.** `WaitForCompletion()` blocks the main thread until loading finishes. Preload behind a loading screen instead.
- **Duplicated dependencies.** A texture used by assets in two bundles, but not addressable itself, is copied into both. Use the Addressables Analyze tool, and make shared assets explicitly addressable.
- **String keys.** Loading by address string brings back typos and silent breakage. Prefer `AssetReference` fields, which survive renames.
- **Remote content versioning.** A remote catalog update must match the client's code. Version catalogs, and test updates against old clients.

## Related

- [Data-Driven Design](./data-driven-design) — data refers to content by key.
- [Scene / Level Management](./scene-management) — scenes can also be addressable, loaded and released the same way.
- [Lazy Initialization](./lazy-initialization) — load when first needed, at the cost of a delay on first use.
- [Object Pool](./object-pool) — pools of instances created from a loaded prefab.
- [Save System](./save-system) — saves store asset keys, never asset references.
