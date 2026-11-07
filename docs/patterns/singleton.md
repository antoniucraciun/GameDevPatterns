# Singleton

> Ensure a class has one instance with global access — and know why that is risky.

**Category:** Architecture & Structure

## Problem

Some things really exist once: the audio mixer, the save system, the platform's achievements API. Code all over the game needs them. Dragging a reference through every prefab and constructor is tedious, so you want a way to say "give me *the* audio manager" from anywhere, and to be sure there are never two.

## Solution

The class controls its own instantiation and exposes the single instance through a static property. That gives two guarantees: **one instance**, and **global access**.

Global access is what makes singletons convenient, and also what makes them hurt. Any code can reach the instance, so any code can depend on it and change it. Dependencies become invisible, the order of initialisation becomes implicit, and tests cannot substitute a fake. A good rule of thumb:

| Usually fine | Usually a problem |
| --- | --- |
| Stateless or read-mostly services: logging, platform APIs, a config lookup | Gameplay state: the player, the current level, the score |
| Something that genuinely cannot exist twice (wrapping a native SDK) | Something that is "one for now", such as a single player before co-op arrives |
| Small projects and jams, where speed matters more than structure | Code that needs unit tests or alternative implementations |

## Example

A plain singleton, for services that don't need to be part of the scene:

::: code-group

```csharp [Unity (C#)]
using System.IO;
using UnityEngine;

public sealed class SaveService
{
    static SaveService instance;
    public static SaveService Instance => instance ??= new SaveService();

    SaveService() { }   // private: nobody else can create one

    public void Save(string slot, string json) =>
        File.WriteAllText(Path.Combine(Application.persistentDataPath, slot), json);

    // With "Enter Play Mode Options" (no Domain Reload), statics survive between play sessions.
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
    static void ResetStatics() => instance = null;
}
```

```gdscript [Godot (GDScript)]
# save_service.gd: a plain-class singleton using a static variable (Godot 4.1+).
class_name SaveService
extends RefCounted

static var _instance: SaveService


static func instance() -> SaveService:
	if _instance == null:
		_instance = SaveService.new()
	return _instance


func save(slot: String, json: String) -> void:
	var file := FileAccess.open("user://" + slot, FileAccess.WRITE)
	file.store_string(json)
```

```cpp [Unreal (C++)]
// SaveService.h: a plain C++ singleton. A function-local static is created on first use
// and is thread-safe to initialise in C++11 and later.
#pragma once

#include "CoreMinimal.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

class FSaveService
{
public:
	static FSaveService& Get()
	{
		static FSaveService Instance;
		return Instance;
	}

	bool Save(const FString& Slot, const FString& Json) const
	{
		return FFileHelper::SaveStringToFile(Json, *(FPaths::ProjectSavedDir() / Slot));
	}

	FSaveService(const FSaveService&) = delete;             // nobody else can create or copy one
	FSaveService& operator=(const FSaveService&) = delete;

private:
	FSaveService() = default;
};
```

:::

An engine-managed singleton, for services that need the engine (audio, settings from the editor) and must survive level changes:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class AudioManager : MonoBehaviour
{
    public static AudioManager Instance { get; private set; }

    [SerializeField] AudioSource musicSource;

    void Awake()
    {
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);           // a second copy, e.g. from reloading the start scene
            return;
        }
        Instance = this;
        DontDestroyOnLoad(gameObject);     // survives scene changes
    }

    void OnDestroy()
    {
        if (Instance == this) Instance = null;
    }

    public void PlayMusic(AudioClip clip)
    {
        musicSource.clip = clip;
        musicSource.Play();
    }
}

// Anywhere:
//   AudioManager.Instance.PlayMusic(bossTheme);
```

```gdscript [Godot (GDScript)]
# audio_manager.gd: register as an autoload named AudioManager (Project Settings → Globals).
# Godot creates exactly one, before the first scene, and keeps it across scene changes,
# so there is no instance check to write.
extends Node

@onready var _music: AudioStreamPlayer = $Music


func play_music(stream: AudioStream) -> void:
	_music.stream = stream
	_music.play()

# Anywhere:
#   AudioManager.play_music(boss_theme)
```

```cpp [Unreal (C++)]
// MusicSubsystem.h: a game-instance subsystem is Unreal's engine-managed singleton:
// one per game instance, created before the first level and kept across level changes.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Components/AudioComponent.h"
#include "Kismet/GameplayStatics.h"
#include "MusicSubsystem.generated.h"

UCLASS()
class UMusicSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	void PlayMusic(USoundBase* Track)
	{
		if (Music) Music->Stop();
		// Persist across level transitions instead of being destroyed with the level.
		Music = UGameplayStatics::CreateSound2D(GetGameInstance(), Track, 1.f, 1.f, 0.f, nullptr, /*bPersistAcrossLevelTransition*/ true);
		Music->Play();
	}

private:
	UPROPERTY() TObjectPtr<UAudioComponent> Music;
};

// Anywhere:
//   GetGameInstance()->GetSubsystem<UMusicSubsystem>()->PlayMusic(BossTheme);
```

:::

A safer middle ground: keep the single instance, but hide the concrete class behind an interface and register it in a [Service Locator](./service-locator), or hand it to classes through [Dependency Injection](./dependency-injection). You keep "exactly one", and lose most of the coupling.

**Engine notes**

- **Unity:** the `Instance != this` check handles the duplicate created when the scene that contains the manager is loaded again.
- **Godot:** autoloads are reachable by name from every script, which is exactly the global access singletons are criticised for. Keep them few, and treat them as services.
- **Unreal:** prefer subsystems over hand-written singletons: their lifetime is clear, they work in multiple PIE instances, and the editor's world and the game's world never share one by accident.

## When to use

- Truly unique, application-lifetime services with little mutable state.
- Prototypes and small games, as long as you know what you are trading away.

## When not to use

- Anything with gameplay state that changes per level or per match: the player, the current level, the score. Pass it in, or use [Scene Management](./scene-management) to own it.
- Code you want to unit test, or services with more than one implementation. Use [Dependency Injection](./dependency-injection) or a [Service Locator](./service-locator).
- As the default way to share things. Most "managers" only need to exist once because only one is created, not because a second would be an error.

## Pitfalls

- **Hidden dependencies.** A class that calls `AudioManager.Instance` deep inside a method depends on it, but nothing in its constructor or inspector says so.
- **Initialisation order.** `Instance` is null if read before the singleton's `Awake` runs, such as from another object's `Awake`. Script Execution Order settings are a fragile fix. A bootstrap scene that creates services first is a robust one.
- **Disabled Domain Reload.** Static fields keep values from the previous play session and point at destroyed objects. Reset them with `RuntimeInitializeOnLoadMethod`.
- **Duplicates across scenes.** Every scene that contains the prefab creates one. Guard in `Awake`, as above, or create it from code only.
- **Testing.** You cannot substitute a fake `SaveService` in a unit test without changing the singleton itself.
- **Lazy creation of a MonoBehaviour** (`new GameObject().AddComponent<T>()` inside the getter) can silently create a new instance while the application is quitting, which leaks objects in the editor. Prefer explicit creation.

## Related

- [Service Locator](./service-locator) — global access to an interface instead of a concrete class.
- [Dependency Injection](./dependency-injection) — no global access at all. Dependencies are passed in.
- [ScriptableObject Architecture](./scriptable-object-architecture) — shared assets as an alternative to manager singletons.
- [Bootstrapper](./bootstrapper) — creates services in a known order.
