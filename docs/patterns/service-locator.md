# Service Locator

> Provide a global access point to a service without coupling callers to its concrete type.

**Category:** Architecture & Structure

## Problem

Audio, analytics, save data and input are needed from all over the codebase. Passing them through every constructor is tedious. Making each one a [singleton](./singleton) ties every caller to one concrete class, so you cannot swap in a silent audio service for tests or a different analytics backend per platform.

## Solution

Callers depend on an **interface** (`IAudioService`). A central **locator** maps interfaces to the instances currently providing them. A bootstrap step registers the real implementations at startup. Callers ask the locator for the interface and never learn which implementation they received. A **null object** can be registered as a safe default so missing services do not crash.

## Example

A registry that maps a service type to its current implementation, so callers ask for "the audio service" without knowing which one is running.

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public static class Services
{
    static readonly Dictionary<Type, object> map = new();

    public static void Register<T>(T service) where T : class => map[typeof(T)] = service;

    public static T Get<T>() where T : class =>
        map.TryGetValue(typeof(T), out var s)
            ? (T)s
            : throw new InvalidOperationException($"Service {typeof(T).Name} not registered");

    // Clear between play sessions when Domain Reload is disabled.
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
    static void Reset() => map.Clear();
}

public interface IAudioService { void Play(string clipId, Vector3 at); }

public class NullAudio : IAudioService { public void Play(string clipId, Vector3 at) { } }

public class Bootstrap : MonoBehaviour
{
    [SerializeField] AudioService audioService;   // a MonoBehaviour implementing IAudioService

    void Awake()
    {
        Services.Register<IAudioService>(Application.isBatchMode ? new NullAudio() : audioService);
    }
}

// Anywhere:
//   Services.Get<IAudioService>().Play("explosion", transform.position);
```

```gdscript [Godot (GDScript)]
# services.gd: autoload named Services. GDScript has no interfaces, so services are looked up
# by name and called by duck typing: anything with the expected methods will do.
extends Node

var _map := {}


func register(key: StringName, service: Object) -> void:
	_map[key] = service


func locate(key: StringName) -> Object:
	assert(_map.has(key), "Service %s not registered" % key)
	return _map[key]


# null_audio.gd: does nothing, for headless servers and tests.
class_name NullAudio
extends RefCounted

func play(_clip_id: StringName, _at: Vector3) -> void:
	pass


# bootstrap.gd: on the first scene, or another autoload.
extends Node

@export var audio_service: Node  # a node with play(clip_id, at)


func _ready() -> void:
	var headless := DisplayServer.get_name() == "headless"
	Services.register(&"audio", NullAudio.new() if headless else audio_service)

# Anywhere:
#   Services.locate(&"audio").play(&"explosion", global_position)
```

```cpp [Unreal (C++)]
// Unreal's subsystems are a built-in service locator: the engine creates one instance per
// game instance (or world, or local player) and finds it by class. An abstract base with
// ShouldCreateSubsystem on each implementation picks which one runs.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "AudioService.generated.h"

UCLASS(Abstract)
class UAudioService : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Play(FName ClipId, FVector At) PURE_VIRTUAL(UAudioService::Play, );
};

UCLASS()
class UGameAudioService : public UAudioService
{
	GENERATED_BODY()

public:
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override { return !IsRunningDedicatedServer(); }
	virtual void Play(FName ClipId, FVector At) override { /* look up the cue, play it at At */ }
};

UCLASS()
class UNullAudioService : public UAudioService
{
	GENERATED_BODY()

public:
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override { return IsRunningDedicatedServer(); }
	virtual void Play(FName, FVector) override {}
};

// Anywhere with access to the game instance:
//   GetGameInstance()->GetSubsystem<UAudioService>()->Play("Explosion", GetActorLocation());
```

:::

**Engine notes**

- **Unity:** with **Enter Play Mode Options** (no domain reload), statics survive between play sessions, hence the `Reset` hook.
- **Godot:** autoloads are already global, named services. A registry like this adds what autoloads lack: swapping the implementation at runtime (null services in tests, platform-specific ones).
- **Unreal:** pick the subsystem lifetime that matches the service: `UEngineSubsystem`, `UGameInstanceSubsystem`, `UWorldSubsystem` or `ULocalPlayerSubsystem`. Looking a subsystem up by an abstract base class returns the implementation that was created.

## When to use

- A small number of truly cross-cutting services: audio, logging, analytics, platform APIs.
- When you need to swap implementations per platform, per test or at runtime.

## When not to use

- Dependencies that only a few objects need. Pass them in via a serialized field, a constructor or [Dependency Injection](./dependency-injection) so the dependency is visible.
- As a way to reach everything from everywhere. If most classes call the locator, it is a [Singleton](./singleton) with extra steps, and it hides what depends on what.
- Small games with one implementation of each service and no tests that need fakes.

## Pitfalls

- **Hidden dependencies.** A class's needs are no longer visible in its constructor. Keep lookups at the edges (in `Awake`) and cache them, rather than calling `Get` throughout the logic.
- **Order of registration.** Something may ask for a service before it is registered. Use a bootstrap scene, or fall back to a null object.
- **It is still global state.** If most of your code needs the locator, [Dependency Injection](./dependency-injection) is usually the better tool.

## Related

- [Singleton](./singleton) — the simpler, more tightly coupled alternative.
- [Dependency Injection](./dependency-injection) — makes dependencies explicit instead of looked up.
- [Component](./component) — services are often provided by components on a persistent object.
