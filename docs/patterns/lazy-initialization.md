# Lazy Initialization

> Create expensive resources on first use instead of up front.

**Category:** Performance & Memory

## Problem

At startup, the game builds every object pool, loads every sound bank, precomputes every lookup table and creates every UI screen, including the credits screen most players never open. Startup takes 12 seconds, and memory is full of things this session will never use. Yet some of it is needed eventually, and creating it at an unpredictable moment mid-game causes a hitch.

## Solution

Defer creating something **until it is first needed**, then keep it:

```
Thing Instance => instance ??= CreateThing();
```

Lazy initialisation trades **startup time and memory** for a **one-time cost at first use**. That trade-off is the whole pattern. Use it deliberately, with three variations:

| Variation | When it is created | Use for |
| --- | --- | --- |
| **Pure lazy** | On first access | Rarely used things: credits, debug tools, optional features |
| **Lazy with warm-up** | On first access, *or* earlier during a loading screen | Things that would hitch if created mid-gameplay: pools, shaders, effects |
| **Lazy per context** | First access within a level, released with the level | Level-specific content |

For thread safety, use the language's run-once primitive: .NET's `Lazy<T>`, or a function-local `static` or `std::call_once` in C++. On the main thread only, a plain null check is enough.

## Example

The basic form, plus a warm-up hook so the cost can be moved to a loading screen. Check with the profiler (Unity Profiler, Godot's profiler, Unreal Insights) that the first use really hitches before adding warm-up calls:

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public class EffectLibrary : MonoBehaviour
{
    [SerializeField] ParticleSystem[] prefabs;

    Dictionary<string, ParticleSystem> byName;        // built on first use, not in Awake

    Dictionary<string, ParticleSystem> ByName => byName ??= BuildIndex();

    Dictionary<string, ParticleSystem> BuildIndex()
    {
        var d = new Dictionary<string, ParticleSystem>(prefabs.Length);
        foreach (var p in prefabs) d[p.name] = p;
        return d;
    }

    public ParticleSystem Get(string name) => ByName.TryGetValue(name, out var p) ? p : null;
}

// A lazily created pool per effect type, with optional warm-up.
public class LazyPools
{
    readonly Dictionary<GameObject, UnityEngine.Pool.ObjectPool<GameObject>> pools = new();

    UnityEngine.Pool.ObjectPool<GameObject> PoolFor(GameObject prefab)
    {
        if (pools.TryGetValue(prefab, out var pool)) return pool;      // already created

        pool = new UnityEngine.Pool.ObjectPool<GameObject>(
            () => UnityEngine.Object.Instantiate(prefab),
            go => go.SetActive(true),
            go => go.SetActive(false),
            UnityEngine.Object.Destroy);
        pools[prefab] = pool;
        return pool;
    }

    public GameObject Get(GameObject prefab) => PoolFor(prefab).Get();
    public void Release(GameObject prefab, GameObject instance) => PoolFor(prefab).Release(instance);

    // Call during loading for effects this level is known to use: the first explosion won't hitch.
    public void WarmUp(GameObject prefab, int count)
    {
        var pool = PoolFor(prefab);
        var temp = new List<GameObject>(count);
        for (int i = 0; i < count; i++) temp.Add(pool.Get());
        foreach (var go in temp) pool.Release(go);
    }
}
```

```gdscript [Godot (GDScript)]
# effect_library.gd
extends Node

@export var effects: Array[PackedScene] = []

var _by_name := {}  # String -> PackedScene, built on first use, not in _ready()
var _indexed := false


# Not get() or a parameter called "name": both would shadow Node members.
func get_effect(effect_name: String) -> PackedScene:
	if not _indexed:
		for scene in effects:
			_by_name[scene.resource_path.get_file().get_basename()] = scene
		_indexed = true
	return _by_name.get(effect_name)


# lazy_pools.gd: a free list per scene, created the first time that scene is requested.
class_name LazyPools
extends Node

var _pools := {}  # PackedScene -> Array of inactive Node3D


func acquire(scene: PackedScene) -> Node3D:
	var pool := _pool_for(scene)
	var node: Node3D
	if pool.is_empty():
		node = scene.instantiate()
		add_child(node)
	else:
		node = pool.pop_back()
	node.process_mode = Node.PROCESS_MODE_INHERIT
	node.show()
	return node


func release(scene: PackedScene, node: Node3D) -> void:
	node.hide()
	node.process_mode = Node.PROCESS_MODE_DISABLED
	_pool_for(scene).append(node)


# Call during loading for effects this level is known to use: the first explosion won't hitch.
func warm_up(scene: PackedScene, count: int) -> void:
	var temp: Array[Node3D] = []
	for i in count:
		temp.append(acquire(scene))
	for node in temp:
		release(scene, node)


func _pool_for(scene: PackedScene) -> Array:
	if not _pools.has(scene):
		_pools[scene] = []  # Arrays are references, so callers can append to it
	return _pools[scene]
```

```cpp [Unreal (C++)]
// EffectLibraryComponent.h: soft references, so effects load the first time they're asked for.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "EffectLibraryComponent.generated.h"

class UNiagaraSystem;

UCLASS(ClassGroup = (Custom), meta = (BlueprintSpawnableComponent))
class UEffectLibraryComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UNiagaraSystem* Get(FName EffectName);

	// Call during loading for effects this level is known to use: the first explosion won't hitch.
	void WarmUp(const TArray<FName>& EffectNames);

private:
	void EnsureIndexed();

	UPROPERTY(EditAnywhere)
	TArray<TSoftObjectPtr<UNiagaraSystem>> Effects;

	TMap<FName, TSoftObjectPtr<UNiagaraSystem>> ByName;   // built on first use
	bool bIndexed = false;

	UPROPERTY()
	TMap<FName, TObjectPtr<UNiagaraSystem>> Loaded;       // hard references keep loaded effects alive
};

// EffectLibraryComponent.cpp
#include "EffectLibraryComponent.h"
#include "Engine/AssetManager.h"
#include "NiagaraSystem.h"

void UEffectLibraryComponent::EnsureIndexed()
{
	if (bIndexed) return;
	for (const TSoftObjectPtr<UNiagaraSystem>& Effect : Effects)
		ByName.Add(FName(*Effect.GetAssetName()), Effect);
	bIndexed = true;
}

UNiagaraSystem* UEffectLibraryComponent::Get(FName EffectName)
{
	if (TObjectPtr<UNiagaraSystem>* Found = Loaded.Find(EffectName)) return *Found;

	EnsureIndexed();
	const TSoftObjectPtr<UNiagaraSystem>* Soft = ByName.Find(EffectName);
	if (!Soft) return nullptr;

	UNiagaraSystem* System = Soft->LoadSynchronous();     // the first-use cost: a blocking load
	Loaded.Add(EffectName, System);
	return System;
}

void UEffectLibraryComponent::WarmUp(const TArray<FName>& EffectNames)
{
	EnsureIndexed();
	TArray<FSoftObjectPath> Paths;
	for (FName EffectName : EffectNames)
		if (const TSoftObjectPtr<UNiagaraSystem>* Soft = ByName.Find(EffectName))
			Paths.Add(Soft->ToSoftObjectPath());

	// Loads in the background; Get() then finds them already in memory.
	UAssetManager::GetStreamableManager().RequestAsyncLoad(Paths,
		FStreamableDelegate::CreateWeakLambda(this, [this, EffectNames]
		{
			for (FName EffectName : EffectNames) Get(EffectName);
		}));
}
```

:::

Thread-safe, for data that worker threads may also request:

::: code-group

```csharp [Unity (C#)]
using System;
using UnityEngine;

public static class TerrainTables
{
    // The factory runs exactly once, even if several threads ask at the same time.
    static readonly Lazy<float[]> erosionTable = new(() =>
    {
        var t = new float[4096];
        for (int i = 0; i < t.Length; i++) t[i] = Mathf.Pow(i / 4095f, 2.2f);
        return t;
    });

    public static float[] Erosion => erosionTable.Value;
}
```

```gdscript [Godot (GDScript)]
# terrain_tables.gd: static variables need Godot 4.1+. GDScript has no Lazy<T>, so a Mutex
# makes sure only one thread builds the table.
class_name TerrainTables
extends RefCounted

static var _erosion := PackedFloat32Array()
static var _mutex := Mutex.new()


static func erosion() -> PackedFloat32Array:
	_mutex.lock()
	if _erosion.is_empty():
		var t := PackedFloat32Array()
		t.resize(4096)
		for i in t.size():
			t[i] = pow(i / 4095.0, 2.2)
		_erosion = t
	_mutex.unlock()
	return _erosion
```

```cpp [Unreal (C++)]
// TerrainTables.h: a function-local static is initialised exactly once, even if several
// threads call at the same time (guaranteed by C++11).
inline const TArray<float>& GetErosionTable()
{
	static const TArray<float> Table = []
	{
		TArray<float> T;
		T.SetNumUninitialized(4096);
		for (int32 i = 0; i < T.Num(); ++i) T[i] = FMath::Pow(i / 4095.f, 2.2f);
		return T;
	}();
	return Table;
}
```

:::

**Engine notes**

- **Unity:** `Lazy<T>` defaults to `LazyThreadSafetyMode.ExecutionAndPublication`. Unity APIs inside the factory (loading assets, creating objects) must still run on the main thread. Addressables' `LoadAssetAsync` is the asset-level version of the warm-up hook.
- **Godot:** `preload()` is eager (it loads when the script loads) and `load()` is lazy. `ResourceLoader.load_threaded_request()` loads in the background during a loading screen, and `load_threaded_get()` collects the result.
- **Unreal:** `TSoftObjectPtr` and `TSoftClassPtr` are the engine's lazy references; hard `UPROPERTY` references load everything they point at with the owner. Keep the handle returned by `RequestAsyncLoad` if the assets must stay loaded without a hard reference.

## When to use

- Resources that are expensive and may not be needed this session: optional screens, rarely visited areas, debug tools, large tables.
- Shortening startup time, by moving creation from boot to first use.
- Combined with warm-up for things that are needed, but whose first-use cost must not hit gameplay.

## When not to use

- Objects needed during gameplay where a first-use hitch would be noticeable. Create them during loading, or warm them up.
- Cheap objects. Lazy creation adds checks and makes the order of creation harder to predict.
- Multithreaded code without care. Lazy creation from two threads can create two instances; use `Lazy<T>` or create the object up front.

## Pitfalls

- **Hitch at the worst moment.** The first explosion of the game also creates the explosion pool, loads its textures and compiles its shader, freezing the frame the player cares about most. Warm up things that are likely needed during loading, and keep pure laziness for things that are truly optional.
- **Hidden cost in a getter.** A property that looks cheap (`Library.Effects`) but sometimes takes 200 ms surprises callers. Name it clearly, or expose an explicit `EnsureLoaded()`.
- **Unity objects and `??=`.** `??=` uses C# null, not Unity's "destroyed" check. A destroyed `GameObject` is not null to `??=`, so the cache keeps a dead object. Use `if (cached == null) cached = Create();` for `UnityEngine.Object` fields. Godot and Unreal have the same trap: check freed nodes with `is_instance_valid()`, and destroyed actors with `IsValid()` or a `TWeakObjectPtr`.
- **Initialisation order bugs.** Lazy creation can hide dependency problems until an unusual code path runs first. Keep factories free of dependencies on other lazy objects, or document them.
- **Static lazies in the editor.** In Unity with Domain Reload disabled, and in Unreal's Play In Editor, static lazy fields survive between play sessions and may hold stale references. Reset them when play starts. Godot runs the game in a separate process, so it is unaffected.

## Related

- [Object Pool](./object-pool) — pools are often created lazily, then warmed up.
- [Asset References & Addressing](./asset-reference) — load content when needed rather than at startup.
- [Bootstrapper](./bootstrapper) — decides what is created eagerly at startup.
- [Memoization / Caching](./memoization) and [Dirty Flag](./dirty-flag) — also compute on demand and keep the result.
- [Singleton](./singleton) — lazy creation of the single instance is common, with the same pitfalls.
- [Proxy](./proxy) — a virtual proxy wraps lazy initialization in a stand-in with the real object's interface, so callers don't know it is lazy.
