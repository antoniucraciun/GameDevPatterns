# Bootstrapper

> One entry point initialises core services in a known order before gameplay starts.

**Also known as:** Composition Root, Init Scene · **Category:** Architecture & Structure

## Problem

Services initialise themselves in their own startup callbacks (`Awake`, `_ready`, `BeginPlay`): the audio manager, the save system, analytics, input, the platform SDK. Their order depends on the order in which the engine creates objects, so it differs between scenes and between editor and build. The save system reads settings before they are loaded. Analytics fires before the SDK is ready. Starting the game from the level scene in the editor skips the menu scene that normally creates the managers, so half the game throws `NullReferenceException`. Developers end up always starting from scene 0, which slows down iteration.

## Solution

Have **one place** that runs first and initialises everything the game needs, in an explicit order, before any gameplay code runs.

- **Run first, from any scene.** `[RuntimeInitializeOnLoadMethod(BeforeSceneLoad)]` runs before the first scene loads, whichever scene you press Play in. Alternatively, keep a dedicated *Boot* scene at build index 0, plus an editor hook that loads it first.
- **Ordered, possibly asynchronous steps.** Load settings, then the platform SDK, then sign in, then analytics, then the save data. Each step can await, for example on a network call, and the order is written down in code.
- **Persistent services.** Create services under one root that survives level loads (a `DontDestroyOnLoad` root or persistent scene in Unity, an autoload in Godot, `GameInstance` subsystems in Unreal), and register them with the [Service Locator](./service-locator) or DI container. This is the composition root from [Dependency Injection](./dependency-injection).
- **A "ready" signal.** Gameplay waits for the bootstrapper to finish, instead of each system checking whether its dependencies happen to exist.

## Example

Ordered boot steps that run before the first level, whichever level you start from, with a way for gameplay to wait until boot has finished.

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public interface IBootStep
{
    string Name { get; }
    Awaitable Run();
}

public static class Bootstrapper
{
    public static bool IsReady { get; private set; }
    public static event Action Ready;

    // Runs before the first scene loads, whichever scene you pressed Play in.
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    static async void Boot()
    {
        IsReady = false;

        // 1. A persistent root for services, from a prefab in Resources so it carries inspector settings.
        var root = UnityEngine.Object.Instantiate(Resources.Load<GameObject>("Systems"));
        root.name = "[Systems]";
        UnityEngine.Object.DontDestroyOnLoad(root);

        // 2. Ordered steps: each may depend on the ones before it.
        var steps = new List<IBootStep>
        {
            new LoadSettingsStep(),
            new PlatformStep(),          // console/mobile SDK, sign-in
            new AnalyticsStep(),         // needs the platform user id
            new LoadSaveStep(),          // needs settings (slot) and platform (cloud saves)
        };

        foreach (var step in steps)
        {
            float start = Time.realtimeSinceStartup;
            try { await step.Run(); }
            catch (Exception e)
            {
                Debug.LogException(e);
                Debug.LogError($"Boot step '{step.Name}' failed; continuing in degraded mode.");
            }
            Debug.Log($"[Boot] {step.Name} ({(Time.realtimeSinceStartup - start) * 1000f:0} ms)");
        }

        IsReady = true;
        Ready?.Invoke();
    }

    // Lets gameplay wait for boot without polling.
    public static async Awaitable WaitUntilReady()
    {
        while (!IsReady) await Awaitable.NextFrameAsync();
    }
}

public class LoadSettingsStep : IBootStep
{
    public string Name => "Settings";
    public async Awaitable Run()
    {
        await Awaitable.BackgroundThreadAsync();         // file IO off the main thread
        var json = System.IO.File.Exists(SettingsPath) ? System.IO.File.ReadAllText(SettingsPath) : "{}";
        await Awaitable.MainThreadAsync();                // back to the main thread to touch Unity APIs
        Services.Register(JsonUtility.FromJson<GameSettings>(json));
    }

    static string SettingsPath => System.IO.Path.Combine(Application.persistentDataPath, "settings.json");
}

// Gameplay that needs services waits for boot:
public class LevelStart : MonoBehaviour
{
    async void Start()
    {
        await Bootstrapper.WaitUntilReady();
        var settings = Services.Get<GameSettings>();
        // ... start the level
    }
}
```

```gdscript [Godot (GDScript)]
# boot_step.gd: base class for steps. GDScript has no exceptions, so steps report failure in `ok`.
class_name BootStep
extends RefCounted

var step_name := "Step"
var ok := true


func run() -> void:  # may await
	pass


# load_settings_step.gd
class_name LoadSettingsStep
extends BootStep

func _init() -> void:
	step_name = "Settings"


func run() -> void:
	var path := "user://settings.json"
	var text := FileAccess.get_file_as_string(path) if FileAccess.file_exists(path) else "{}"
	var data = JSON.parse_string(text)
	ok = data is Dictionary
	Services.register(&"settings", GameSettings.from_dict(data if ok else {}))


# boot.gd: autoload named Boot, listed FIRST in Project Settings → Globals. Autoloads are created
# in list order before any scene, so boot runs whichever scene you press Play in.
extends Node

signal finished

var is_ready := false


func _ready() -> void:
	_boot()


func _boot() -> void:
	# Ordered steps: each may depend on the ones before it.
	var steps: Array[BootStep] = [
		LoadSettingsStep.new(),
		PlatformStep.new(),   # console/mobile SDK, sign-in
		AnalyticsStep.new(),  # needs the platform user id
		LoadSaveStep.new(),   # needs settings (slot) and platform (cloud saves)
	]
	for step in steps:
		var start := Time.get_ticks_msec()
		await step.run()
		if not step.ok:
			push_error("Boot step '%s' failed; continuing in degraded mode." % step.step_name)
		print("[Boot] %s (%d ms)" % [step.step_name, Time.get_ticks_msec() - start])
	is_ready = true
	finished.emit()


# Lets gameplay wait for boot without polling.
func wait_until_ready() -> void:
	if not is_ready:
		await finished


# level_start.gd: gameplay that needs services waits for boot.
extends Node

func _ready() -> void:
	await Boot.wait_until_ready()
	var settings: GameSettings = Services.locate(&"settings")
	# ... start the level
```

```cpp [Unreal (C++)]
// Unreal boots services as subsystems. The game instance creates them before the first
// level loads, and InitializeDependency guarantees ordering between them.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Async/Async.h"
#include "Misc/FileHelper.h"
#include "BootSubsystems.generated.h"

UCLASS()
class USettingsSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override
	{
		Super::Initialize(Collection);
		// File IO off the game thread, then back to the game thread to publish the result.
		const FString Path = FPaths::ProjectSavedDir() / TEXT("settings.json");
		Async(EAsyncExecution::ThreadPool, [WeakThis = TWeakObjectPtr<USettingsSubsystem>(this), Path]
		{
			FString Json;
			if (!FFileHelper::LoadFileToString(Json, *Path)) Json = TEXT("{}");
			AsyncTask(ENamedThreads::GameThread, [WeakThis, Json]
			{
				if (USettingsSubsystem* Self = WeakThis.Get()) Self->Apply(Json);
			});
		});
	}

	bool IsLoaded() const { return bLoaded; }
	FSimpleMulticastDelegate OnLoaded;

private:
	void Apply(const FString& Json) { /* parse into settings */ bLoaded = true; OnLoaded.Broadcast(); }
	bool bLoaded = false;
};

UCLASS()
class UAnalyticsSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override
	{
		// Ordered steps: the platform subsystem (sign-in, user id) initialises first.
		Collection.InitializeDependency<UPlatformSubsystem>();
		Super::Initialize(Collection);
		/* start a session with the platform user id */
	}
};

// LevelStart.cpp: gameplay that needs a service waits for it without polling.
void ALevelStart::BeginPlay()
{
	Super::BeginPlay();
	USettingsSubsystem* Settings = GetGameInstance()->GetSubsystem<USettingsSubsystem>();
	if (Settings->IsLoaded()) StartLevel();
	else Settings->OnLoaded.AddUObject(this, &ALevelStart::StartLevel);
}
```

:::

**Engine notes**

- **Unity:** `Services` is the locator from [Service Locator](./service-locator). `PlatformStep`, `AnalyticsStep` and `LoadSaveStep` follow the same shape as `LoadSettingsStep`. `Awaitable.BackgroundThreadAsync` and `MainThreadAsync` are Unity 6 APIs.
- **Godot:** autoload order *is* boot order, so put the boot autoload first. For heavy work, `WorkerThreadPool.add_task` moves it off the main thread; keep scene-tree access on the main thread.
- **Unreal:** `UGameInstance::Init` runs before the first level and is the classic place for boot code; subsystems with `InitializeDependency` are the modular version. Platform sign-in and other online calls are asynchronous with completion delegates, so a step "finishes" when its delegate fires.

## When to use

- Every project with more than a couple of global services.
- Games that call platform SDKs, online services or cloud saves, which must initialise in a specific order.
- Teams that want to press Play in any scene and have it just work.

## When not to use

- Small games with one or two global services. `[RuntimeInitializeOnLoadMethod]` or one object in the first scene is enough.
- Moving all initialisation into the bootstrapper, including per-level objects. Keep it for services that live for the whole app; levels set themselves up.

## Pitfalls

- **Hidden dependencies on boot.** Code that reads services in its startup callback can run before boot finishes, because boot steps are asynchronous. Await `WaitUntilReady`, or start gameplay from the bootstrapper's `Ready` event.
- **Hard-referencing all content from boot.** A boot object that directly references every level, enemy and item (or Unity's `Resources` folder used for all content) loads all of it at startup and bloats builds. Use soft references for content (see [Asset References & Addressing](./asset-reference)).
- **Statics surviving editor play sessions.** Unity with Domain Reload disabled (*Enter Play Mode Options*) and Unreal's Play In Editor run the game inside the editor process, so statics keep their values between sessions. Reset them (`IsReady`, event subscribers) when play starts (a `SubsystemRegistration` method in Unity), or keep state in objects the engine recreates, such as Unreal subsystems; otherwise boot can see stale state. Godot runs the game in a separate process, so it starts clean.
- **Boot doing too much.** Loading every asset at boot makes the first screen slow. Boot only what is needed globally, and let levels load their own content.
- **Failure handling.** If sign-in fails, should the game run offline, retry, or stop? Decide per step, and show the player something useful rather than hanging on a black screen.

## Related

- [Dependency Injection](./dependency-injection) — the bootstrapper is the composition root.
- [Service Locator](./service-locator) and [Singleton](./singleton) — how services become reachable after boot.
- [Game State Manager](./game-state-manager) — boot is its first state, and moves to the main menu when done.
- [Scene / Level Management](./scene-management) — what happens after boot.
- [Save System](./save-system) — usually one of the last boot steps.
