# Asset References & Addressing

> Refer to assets by stable keys and load them on demand instead of hard links.

**Category:** Data, Content & Procedural Generation

## Problem

A level-select menu has direct references to all 40 level backgrounds. Because the engine loads everything a loaded object hard-references, all 40 textures (800 MB) load the moment the menu opens. The enemy spawner references every enemy prefab, so all their meshes, textures and sounds sit in memory for the whole game. Shipping a new costume means shipping a new build. Loading content by hand-typed path or name breaks silently when files are renamed, and Unity's `Resources` folder also bloats startup.

## Solution

Separate **referring to an asset** from **loading it**:

- An **asset reference** is a lightweight, stable key (a GUID or an address) stored in data, instead of a direct link. Holding it costs nothing.
- Code **loads** the asset asynchronously when it is needed, and receives a **handle**.
- Code **releases** the handle when done. The system counts references and unloads the asset (and its dependencies) when nothing uses it.
- Assets are packed into **bundles** that can ship with the game or be **downloaded later** (new content without a new build).

Each engine implements this:

- **Unity:** the **Addressables** package, with `AssetReference` fields in the inspector, `LoadAssetAsync`, `Release`, labels for loading groups ("all level 3 enemies"), and local or remote hosting.
- **Godot:** a path or `uid://` string is the soft reference, loaded with `ResourceLoader.load_threaded_request()`. Resources are reference counted, so they are freed when the last reference goes.
- **Unreal:** `TSoftObjectPtr` and `TSoftClassPtr` properties, loaded with `FStreamableManager::RequestAsyncLoad`, which returns a handle that keeps the asset loaded.

## Pseudocode

```text
// The definition holds a key, not the asset: holding it loads nothing.
EnemyType:
    id
    prefab key             // a GUID, address or path

// One owner per lifetime (here, a level) holds the handles.
LevelContent:
    enemies in this level  // list of EnemyType
    loaded                 // map: EnemyType → handle

    preload():             // behind the loading screen
        for each type in enemies in this level not yet in loaded:
            loaded[type] ← start loading type.prefab key    // async, returns a handle
        wait until every handle in loaded is done
        report any handle that failed

    spawn(type, position):
        handle ← loaded[type]
        if there is no handle or it is not done:
            report "type was not preloaded"; return nothing
        return a new instance of handle.asset at position

    on level end:
        for each handle in loaded: release handle
        clear loaded       // the system unloads assets nothing else holds

// Underneath: the asset system counts handles per asset.
load(key):   count[key] ← count[key] + 1; load key and its dependencies if count was 0
release(key): count[key] ← count[key] - 1; unload if count is now 0
```

## Example

Loading enemy prefabs on demand, per level, and releasing them when the level ends. The enemy definition holds a **soft reference** (a path or key) instead of a hard link, so nothing loads until the level asks for it.

### Preloading a level's content

::: code-group

```csharp [Unity (C#)]
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

```gdscript [Godot (GDScript)]
# enemy_type.gd: stores the scene's path, not the scene. An exported PackedScene would be a
# hard reference, loaded together with this resource.
class_name EnemyType
extends Resource

@export var id: StringName
## A res:// path or a uid:// path. UIDs keep working when the file is moved or renamed.
@export_file("*.tscn") var scene_path: String


# level_content.gd
class_name LevelContent
extends Node

@export var enemies_in_this_level: Array[EnemyType] = []

var _loaded := {}  # EnemyType -> PackedScene


# Called by the level loader before gameplay starts (behind the loading screen).
func preload_content() -> void:
	for type in enemies_in_this_level:
		if not _loaded.has(type):
			ResourceLoader.load_threaded_request(type.scene_path)  # starts loading on a worker thread

	for type in enemies_in_this_level:
		if _loaded.has(type):
			continue
		var path: String = type.scene_path
		while ResourceLoader.load_threaded_get_status(path) == ResourceLoader.THREAD_LOAD_IN_PROGRESS:
			await get_tree().process_frame  # keep the loading screen animating
		if ResourceLoader.load_threaded_get_status(path) == ResourceLoader.THREAD_LOAD_LOADED:
			_loaded[type] = ResourceLoader.load_threaded_get(path)
		else:
			push_error("Failed to load %s" % path)


func spawn(type: EnemyType, position: Vector3) -> Node3D:
	var scene: PackedScene = _loaded.get(type)
	if scene == null:
		push_error("%s was not preloaded for this level" % type.id)
		return null
	var enemy := scene.instantiate() as Node3D
	add_child(enemy)
	enemy.global_position = position
	return enemy


# Resources are reference counted: dropping the references lets Godot free what nothing else uses.
func _exit_tree() -> void:
	_loaded.clear()
```

```cpp [Unreal (C++)]
// EnemyType.h: TSoftClassPtr stores an asset path, not a loaded class. A TSubclassOf here
// would be a hard reference, loaded with every asset that references this one.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "EnemyType.generated.h"

UCLASS(BlueprintType)
class UEnemyType : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditDefaultsOnly, Category = "Enemy") FName Id;

	// AssetBundles: the Asset Manager can load this when the "Game" bundle is requested.
	UPROPERTY(EditDefaultsOnly, Category = "Enemy", meta = (AssetBundles = "Game"))
	TSoftClassPtr<AActor> ActorClass;
};

// LevelContent.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Engine/StreamableManager.h"
#include "LevelContent.generated.h"

class UEnemyType;

UCLASS()
class ALevelContent : public AActor
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Level") TArray<TObjectPtr<UEnemyType>> EnemiesInThisLevel;

	// Called by the level loader before gameplay starts; OnLoaded fires when everything is in memory.
	void Preload(FStreamableDelegate OnLoaded);
	AActor* Spawn(const UEnemyType* Type, const FVector& Location);

protected:
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;

private:
	TSharedPtr<FStreamableHandle> Handle;   // keeps the loaded classes alive while held
};

// LevelContent.cpp
#include "LevelContent.h"
#include "EnemyType.h"
#include "Engine/AssetManager.h"

void ALevelContent::Preload(FStreamableDelegate OnLoaded)
{
	TArray<FSoftObjectPath> Paths;
	for (const UEnemyType* Type : EnemiesInThisLevel)
		if (Type && !Type->ActorClass.IsNull()) Paths.AddUnique(Type->ActorClass.ToSoftObjectPath());

	// One async request for the whole set; nothing blocks the game thread.
	Handle = UAssetManager::GetStreamableManager().RequestAsyncLoad(Paths, MoveTemp(OnLoaded));
}

AActor* ALevelContent::Spawn(const UEnemyType* Type, const FVector& Location)
{
	UClass* Class = Type ? Type->ActorClass.Get() : nullptr;   // null if not loaded yet
	if (!Class)
	{
		UE_LOG(LogTemp, Error, TEXT("%s was not preloaded for this level"), Type ? *Type->Id.ToString() : TEXT("null"));
		return nullptr;
	}
	return GetWorld()->SpawnActor<AActor>(Class, Location, FRotator::ZeroRotator);
}

// When the level unloads: release the handle; the classes are garbage collected once nothing uses them.
void ALevelContent::EndPlay(const EEndPlayReason::Type Reason)
{
	if (Handle.IsValid()) { Handle->ReleaseHandle(); Handle.Reset(); }
	Super::EndPlay(Reason);
}
```

:::

### Loading a whole group at once

Addressables can load everything tagged with a **label**, for example `level3`. Godot has no labels, so a level usually lists its content in a manifest resource. Unreal's **Asset Manager** loads every primary asset of a type, plus the soft references tagged with a bundle.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;

public static class LabelLoading
{
    // Every asset tagged "level3". Keep the handle and call Addressables.Release(handle) when the level ends.
    public static async Awaitable<AsyncOperationHandle<IList<GameObject>>> LoadLabel(string label)
    {
        var handle = Addressables.LoadAssetsAsync<GameObject>(label, null);
        await handle.Task;
        return handle;                                    // handle.Result holds the loaded prefabs
    }
}
```

```gdscript [Godot (GDScript)]
# level_manifest.gd: one .tres per level, listing the paths to request with load_threaded_request.
class_name LevelManifest
extends Resource

@export var scene_paths: PackedStringArray = []


func request_all() -> void:
	for path in scene_paths:
		ResourceLoader.load_threaded_request(path)


func progress() -> float:  # 0..1, for a loading bar
	if scene_paths.is_empty():
		return 1.0
	var total := 0.0
	for path in scene_paths:
		var p := []
		var status := ResourceLoader.load_threaded_get_status(path, p)
		if status == ResourceLoader.THREAD_LOAD_LOADED:
			total += 1.0
		elif not p.is_empty():
			total += float(p[0])
	return total / scene_paths.size()
```

```cpp [Unreal (C++)]
// Register UEnemyType under Project Settings > Asset Manager > Primary Asset Types to Scan,
// then load every enemy type and, through the "Game" bundle, each one's ActorClass.
#include "Engine/AssetManager.h"

TSharedPtr<FStreamableHandle> LoadAllEnemyTypes(FStreamableDelegate OnLoaded)
{
	return UAssetManager::Get().LoadPrimaryAssetsWithType(
		FPrimaryAssetType(TEXT("EnemyType")), { TEXT("Game") }, MoveTemp(OnLoaded));
	// Later: UAssetManager::Get().UnloadPrimaryAssetsWithType(FPrimaryAssetType(TEXT("EnemyType")));
}
```

:::

Instances created with `Instantiate` from a loaded prefab do not hold their own reference. Keep the prefab handle until all instances are gone, as `LevelContent` does by holding handles for the level's lifetime. Alternatively, use `Addressables.InstantiateAsync` and `Addressables.ReleaseInstance`, which count each instance.

**Engine notes**

- **Unity:** Addressables (`com.unity.addressables`) is the standard; `AssetReference` fields are the soft references, and every load needs a matching `Release`. `Resources.Load` works but forces everything in `Resources/` into the build. This page isn't compile-checked here, because the check's project doesn't include Addressables.
- **Godot:** `preload()` and exported `PackedScene`/`Resource` properties are hard references; a path string plus `load()` or `ResourceLoader.load_threaded_request()` is the soft version. Resources are reference counted, so there is no explicit release: drop every reference and the resource is freed. Every resource has a `uid://` ID (Godot 4.0+) that survives moving files.
- **Unreal:** `TObjectPtr` and `TSubclassOf` properties are hard references; `TSoftObjectPtr` and `TSoftClassPtr` are soft. Load them with `FStreamableManager::RequestAsyncLoad` (or `LoadSynchronous` when a hitch is acceptable) and keep the returned handle. The **Reference Viewer** and **Size Map** show which hard references drag assets into memory.

## When to use

- Large or optional content: levels, characters, cosmetics, audio banks, localised voice-over.
- Memory-constrained platforms (mobile, Switch), where only the current level's content should be in memory.
- Live games that download new content without app-store updates.
- Replacing hard references or path-based loading (such as Unity's `Resources.Load`) that give no control over what is in memory.

## When not to use

- Small games that fit in memory. Direct references are simpler and load with the scene.
- Assets that are always needed, such as the player or the HUD. Loading them on demand adds delay and failure cases.
- Before you need downloadable or optional content. Soft references and asynchronous loading add build and loading complexity.

## Pitfalls

- **Leaks from missing releases.** In Unity, every successful load needs exactly one `Release`; in Unreal, a stored streamable handle keeps its assets loaded until you release or drop it; in Godot, any lingering reference keeps a resource alive. Track handles and references in one owner per lifetime (level, screen), and release them when the owner is destroyed.
- **Releasing too early (Unity).** Releasing a prefab handle while instances still exist can unload their materials, leaving pink or invisible objects. Release after the last instance is gone. Godot and Unreal keep an asset loaded while instances still reference it.
- **Hitches from synchronous loads.** `WaitForCompletion()` blocks the main thread until loading finishes. Preload behind a loading screen instead.
- **Duplicated dependencies.** A texture used by assets in two bundles, but not addressable itself, is copied into both. Check with Unity's Addressables Analyze tool or Unreal's Asset Audit window, and make shared assets explicitly part of one group or chunk.
- **String keys.** Loading by address string brings back typos and silent breakage. Prefer `AssetReference` fields, which survive renames.
- **Remote content versioning.** A remote catalog update must match the client's code. Version catalogs, and test updates against old clients.

## Related

- [Data-Driven Design](./data-driven-design) — data refers to content by key.
- [Scene / Level Management](./scene-management) — scenes and levels can be soft references too, loaded and released the same way.
- [Lazy Initialization](./lazy-initialization) — load when first needed, at the cost of a delay on first use.
- [Object Pool](./object-pool) — pools of instances created from a loaded prefab, scene or class.
- [Save System](./save-system) — saves store asset keys, never asset references.
- [Proxy](./proxy) — soft references and load handles are built-in virtual proxies; a proxy class hides the loading from callers entirely.
