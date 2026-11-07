# Scene / Level Management

> Load, unload and transition between levels, including additive and streamed scenes.

**Category:** Architecture & Structure

## Problem

Each level is one scene that contains everything: the player, the HUD, the camera rig, the audio manager and the level geometry. Loading level 2 with `SceneManager.LoadScene` destroys all of it and recreates it, so music restarts, the HUD flashes, managers are duplicated or lost, and the game freezes for two seconds with no loading screen. Two designers cannot edit the same level because it is one huge scene file. Open-world areas are too big to load at once.

## Solution

Split the game into **scenes with distinct lifetimes**, and load them **additively** and **asynchronously**:

| Scene | Lifetime | Contains |
| --- | --- | --- |
| **Core / Persistent** | Whole session | Services, audio, camera rig, player (if it persists), event system |
| **UI** | Whole session, or per mode | HUD, menus, loading screen |
| **Level** | Per level | Geometry, lighting, enemies, level logic |
| **Level sub-scenes** | Streamed in and out | Areas of an open world, interiors, or *Art* / *Gameplay* / *Audio* layers for parallel editing |

A **scene loader** owns all loading:

- **Load additively, asynchronously:** `LoadSceneAsync(name, LoadSceneMode.Additive)`, with a loading screen and progress.
- **Unload the previous level**, then free memory with `Resources.UnloadUnusedAssets`.
- **Set the active scene** to the level, so lighting settings and newly instantiated objects belong to it.
- **Hold activation** (`allowSceneActivation = false`) until the loading screen has faded in and other work has finished, so the swap happens off-screen.

## Example

A level loader that lives in a persistent core: fade out, unload the old level, load the new one in the background with a progress bar, then fade in.

::: code-group

```csharp [Unity (C#)]
using System;
using UnityEngine;
using UnityEngine.SceneManagement;

public class SceneLoader : MonoBehaviour      // lives in the Core scene
{
    [SerializeField] CanvasGroup loadingScreen;
    [SerializeField] UnityEngine.UI.Image progressBar;

    public string CurrentLevel { get; private set; }
    public bool IsLoading { get; private set; }
    public event Action<string> LevelLoaded;

    public async Awaitable LoadLevel(string level)
    {
        if (IsLoading) return;
        IsLoading = true;
        try
        {
            await Fade(1f);                                        // cover the screen first

            if (!string.IsNullOrEmpty(CurrentLevel))
            {
                await SceneManager.UnloadSceneAsync(CurrentLevel);
                await Resources.UnloadUnusedAssets();              // free textures and meshes from the old level
            }

            var op = SceneManager.LoadSceneAsync(level, LoadSceneMode.Additive);
            op.allowSceneActivation = false;                       // load fully, but don't activate yet
            while (op.progress < 0.9f)                             // 0.9 = loaded, waiting for activation
            {
                progressBar.fillAmount = op.progress / 0.9f;
                await Awaitable.NextFrameAsync();
            }
            progressBar.fillAmount = 1f;
            op.allowSceneActivation = true;
            await op;

            SceneManager.SetActiveScene(SceneManager.GetSceneByName(level));   // lighting + Instantiate target
            CurrentLevel = level;
            LevelLoaded?.Invoke(level);

            await Fade(0f);
        }
        finally { IsLoading = false; }
    }

    async Awaitable Fade(float target)
    {
        loadingScreen.blocksRaycasts = true;
        while (!Mathf.Approximately(loadingScreen.alpha, target))
        {
            loadingScreen.alpha = Mathf.MoveTowards(loadingScreen.alpha, target, Time.unscaledDeltaTime * 3f);
            await Awaitable.NextFrameAsync();
        }
        loadingScreen.blocksRaycasts = target > 0f;
    }
}
```

```gdscript [Godot (GDScript)]
# scene_loader.gd: autoload named SceneLoader, with a CanvasLayer child holding the loading UI.
# Levels are instanced under a container node instead of replacing the whole tree, so autoloads
# and the core UI persist.
extends Node

signal level_loaded(path: String)

@onready var _fade: ColorRect = $LoadingLayer/Fade
@onready var _progress: ProgressBar = $LoadingLayer/Progress

var current_level: Node
var is_loading := false


func load_level(path: String, container: Node) -> void:
	if is_loading:
		return
	is_loading = true
	await _fade_to(1.0)  # cover the screen first

	if current_level:
		current_level.queue_free()
		await get_tree().process_frame  # let it be freed before loading the next one

	ResourceLoader.load_threaded_request(path)  # load on a background thread
	var progress := []
	while ResourceLoader.load_threaded_get_status(path, progress) == ResourceLoader.THREAD_LOAD_IN_PROGRESS:
		_progress.value = progress[0] * 100.0
		await get_tree().process_frame
	var scene := ResourceLoader.load_threaded_get(path) as PackedScene

	current_level = scene.instantiate()
	container.add_child(current_level)
	level_loaded.emit(path)

	await _fade_to(0.0)
	is_loading = false


func _fade_to(alpha: float) -> void:
	_fade.mouse_filter = Control.MOUSE_FILTER_STOP
	var tween := create_tween()
	tween.tween_property(_fade, "color:a", alpha, 0.35)
	await tween.finished
	if alpha == 0.0:
		_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
```

```cpp [Unreal (C++)]
// LevelLoaderSubsystem.h: streams sub-levels into a persistent level, so the persistent level
// (game mode, core UI, managers) never unloads. Full map changes use OpenLevel instead.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Kismet/GameplayStatics.h"
#include "LevelLoaderSubsystem.generated.h"

UCLASS()
class ULevelLoaderSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	DECLARE_MULTICAST_DELEGATE_OneParam(FOnLevelLoaded, FName);
	FOnLevelLoaded OnLevelLoaded;

	void LoadLevel(FName Level)
	{
		if (bLoading) return;
		bLoading = true;
		Next = Level;
		ShowLoadingScreen();                                          // cover the screen first

		if (!Current.IsNone())
			UGameplayStatics::UnloadStreamLevel(this, Current, Latent(TEXT("OnUnloaded")), /*bShouldBlock*/ false);
		else
			OnUnloaded();
	}

private:
	UFUNCTION() void OnUnloaded()
	{
		// Loads on the async loading thread; OnLoaded runs when the level is visible.
		UGameplayStatics::LoadStreamLevel(this, Next, /*bMakeVisible*/ true, /*bShouldBlock*/ false, Latent(TEXT("OnLoaded")));
	}

	UFUNCTION() void OnLoaded()
	{
		Current = Next;
		bLoading = false;
		HideLoadingScreen();
		OnLevelLoaded.Broadcast(Current);
	}

	FLatentActionInfo Latent(const TCHAR* Callback)
	{
		FLatentActionInfo Info;
		Info.CallbackTarget = this;
		Info.ExecutionFunction = Callback;
		Info.Linkage = 0;
		Info.UUID = ++LatentId;                                        // unique per request
		return Info;
	}

	void ShowLoadingScreen() { /* add a widget, or use the MoviePlayer for full map changes */ }
	void HideLoadingScreen() { /* remove it */ }

	FName Current, Next;
	bool bLoading = false;
	int32 LatentId = 0;
};
```

:::

Streaming areas of a larger world by distance, with hysteresis so areas at the boundary do not load and unload repeatedly:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;
using UnityEngine.SceneManagement;

public class StreamingVolume : MonoBehaviour
{
    [SerializeField] string sceneName;
    [SerializeField] float loadDistance = 80f, unloadDistance = 110f;
    [SerializeField] Transform player;

    bool loaded, busy;

    async void Update()
    {
        if (busy) return;
        float d = Vector3.Distance(player.position, transform.position);

        if (!loaded && d < loadDistance)
        {
            busy = true;
            await SceneManager.LoadSceneAsync(sceneName, LoadSceneMode.Additive);
            loaded = true; busy = false;
        }
        else if (loaded && d > unloadDistance)
        {
            busy = true;
            await SceneManager.UnloadSceneAsync(sceneName);
            loaded = false; busy = false;
        }
    }
}
```

```gdscript [Godot (GDScript)]
# streaming_area.gd: place one per area of the world; it instances the area's scene as a child.
extends Node3D

@export_file("*.tscn") var scene_path: String
@export var load_distance := 80.0
@export var unload_distance := 110.0
@export var player: Node3D

var _instance: Node
var _busy := false


func _process(_delta: float) -> void:
	if _busy:
		return
	var d := global_position.distance_to(player.global_position)
	if _instance == null and d < load_distance:
		_load()
	elif _instance != null and d > unload_distance:
		_instance.queue_free()
		_instance = null


func _load() -> void:
	_busy = true
	ResourceLoader.load_threaded_request(scene_path)
	while ResourceLoader.load_threaded_get_status(scene_path) == ResourceLoader.THREAD_LOAD_IN_PROGRESS:
		await get_tree().process_frame
	_instance = (ResourceLoader.load_threaded_get(scene_path) as PackedScene).instantiate()
	add_child(_instance)
	_busy = false
```

```cpp [Unreal (C++)]
// Built in: place a Level Streaming Volume in the persistent level and assign it to sub-levels
// in the Levels window; the engine loads them while the player's viewpoint is inside.
// For open worlds, World Partition streams cells by distance automatically, no code needed.
//
// A manual distance check, if you want the exact Unity / Godot behaviour:
void AStreamingArea::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!Player || bBusy) return;
	const float D = FVector::Dist(Player->GetActorLocation(), GetActorLocation());

	FLatentActionInfo Info;
	Info.CallbackTarget = this;
	Info.ExecutionFunction = TEXT("OnStreamingDone");   // a UFUNCTION that clears bBusy
	Info.UUID = GetUniqueID();
	Info.Linkage = 0;

	if (!bLoaded && D < LoadDistance)
	{
		bBusy = bLoaded = true;
		UGameplayStatics::LoadStreamLevel(this, LevelName, true, false, Info);
	}
	else if (bLoaded && D > UnloadDistance)
	{
		bBusy = true;
		bLoaded = false;
		UGameplayStatics::UnloadStreamLevel(this, LevelName, Info, false);
	}
}
```

:::

**Engine notes**

- **Unity:** scene names as strings are fragile, because renaming a scene breaks them silently. Use a small serialisable scene-reference type that stores the asset in the editor and the name at build time, or load scenes through **Addressables**, which also handles content downloaded after install.
- **Godot:** `get_tree().change_scene_to_packed()` replaces the current scene wholesale, which is fine for simple games; instancing levels under a container, as above, keeps a persistent core. Use `@export_file` paths or UIDs (`uid://`) so renames don't break references.
- **Unreal:** reference levels with `TSoftObjectPtr<UWorld>` instead of names where you can. Full map changes (`OpenLevel`) destroy everything except the game instance and its subsystems, which is why persistent services live there.

## When to use

- Every game with more than one level, or with persistent systems that must survive level changes.
- Large worlds that cannot fit in memory at once.
- Teams where several people edit the same level, split into layer scenes.

## When not to use

- Single-scene games such as puzzle or arcade games. Resetting objects in place is faster and simpler than reloading.
- Splitting into many additive scenes before you need to. Each split adds cross-scene references that Unity can't serialize.
- Very large open worlds. Plain scene loading isn't enough; see [Open-World Streaming](../recipes/open-world-streaming).

## Pitfalls

- **Cross-scene references.** An object in the level cannot hold an inspector reference to an object in the Core scene. Use the [Service Locator](./service-locator), events, or [ScriptableObject Architecture](./scriptable-object-architecture) to connect scenes.
- **Wrong active scene.** `Instantiate` puts new objects in the active scene. If the Core scene is active, spawned enemies survive the level unload. Set the level as active after loading.
- **Duplicate persistent objects.** If levels also contain a camera, an EventSystem or an AudioListener "for testing", you get duplicates when they load additively. Keep them only in Core, and add an editor helper that loads Core when you play a level directly.
- **Memory not released.** Unloading a scene does not free assets that are still referenced, for example from a static list or a ScriptableObject. Call `Resources.UnloadUnusedAssets`, and check the Memory Profiler between levels.
- **Hitches on activation.** Activation runs `Awake` and `Start` for everything in the scene on one frame. Keep scene startup light, and spread heavy setup over frames.

## Related

- [Bootstrapper](./bootstrapper) — loads the Core scene and services before any level.
- [Game State Manager](./game-state-manager) — *Loading* and *Playing* states call the scene loader.
- [Save System](./save-system) — saves level state before unloading, and restores it after loading.
- [Spatial Partition](./spatial-partition) — streaming is spatial partitioning at the level of whole scenes.
- [Asset References & Addressing](./asset-reference) — loading scenes and assets by key.
