# Proxy

> Stand in for another object behind the same interface to defer, guard or forward access (lazy-loaded assets).

**Also known as:** Surrogate · **Category:** Architecture & Structure

## Problem

A town in an RPG has forty NPCs, each with a voice bank of a few hundred recorded lines. Loading every bank with the town costs over a gigabyte of memory and a long loading screen, and the player talks to perhaps five of them. So the dialogue code starts loading banks on demand: `if (bank == null) bank = Load(...)`. The same check is then copied into ambient barks, quest cutscenes and the shop UI. One path forgets it and plays silence; another reloads the bank on every line; nobody unloads anything, so memory climbs as the player walks around town.

The callers only want to say "play this line". Whether the clips are in memory yet is a separate concern, and it ended up in every caller.

## Solution

Put a **proxy** in front of the real object. The proxy has **the same interface** as the real subject, so callers can't tell them apart, and it controls access to it:

- **Subject interface:** `IVoiceBank.Play(line)`, what callers use.
- **Real subject:** `VoiceBank`, which holds every clip and is expensive to create.
- **Proxy:** `LazyVoiceBank`, which holds only the bank's *path*, loads the real bank on the first `Play`, forwards every call, and can release it again.

Proxies come in a few kinds, all with the same shape:

| Kind | What the proxy does | Game example |
| --- | --- | --- |
| **Virtual (lazy)** | Creates or loads the real object on first use | Voice banks, high-detail models, level chunks |
| **Protection** | Checks permissions before forwarding | The API that mods or level scripts call |
| **Remote** | Forwards calls over the network to the real object | A networked player whose method calls become RPCs |
| **Caching** | Returns a recent result instead of calling again | Leaderboards or store prices fetched from a server |

It is easy to confuse Proxy with its neighbours, because all three wrap another object:

| Pattern | Interface | Purpose |
| --- | --- | --- |
| **Proxy** | Same | Controls *access* to the real object: when it exists, who may call it, where it lives. |
| [Decorator](./decorator) | Same | Adds *behaviour*, and is stacked freely by the caller. |
| [Adapter](./adapter) | Different | *Converts* one interface into another. |

## Example

### Virtual proxy: load on first use

Each NPC's voice bank is loaded the first time the NPC speaks, and released when the player walks away. Dialogue, barks and cutscenes call the same `Play` either way.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

// What dialogue, barks and cutscenes call. They never know whether the clips are loaded.
public interface IVoiceBank
{
    void Play(string line, AudioSource source);
}

// Real subject: creating it loads every clip in the folder.
public class VoiceBank : IVoiceBank
{
    readonly Dictionary<string, AudioClip> clips = new();

    public VoiceBank(string resourcesFolder)
    {
        foreach (var clip in Resources.LoadAll<AudioClip>(resourcesFolder)) clips[clip.name] = clip;
    }

    public void Play(string line, AudioSource source)
    {
        if (clips.TryGetValue(line, out var clip)) source.PlayOneShot(clip);
        else Debug.LogWarning($"No voice line '{line}'");
    }

    public void Unload()
    {
        foreach (var clip in clips.Values) Resources.UnloadAsset(clip);
        clips.Clear();
    }
}

// Virtual proxy: same interface, holds only the folder until the first Play.
public class LazyVoiceBank : IVoiceBank
{
    readonly string resourcesFolder;
    VoiceBank real;                                       // null until the NPC first speaks

    public LazyVoiceBank(string resourcesFolder) => this.resourcesFolder = resourcesFolder;

    public bool IsLoaded => real != null;

    public void Play(string line, AudioSource source)
    {
        real ??= new VoiceBank(resourcesFolder);          // the first call pays for the load
        real.Play(line, source);
    }

    // Only the proxy has this: drop the clips. The next Play loads them again.
    public void Release()
    {
        real?.Unload();
        real = null;
    }
}

public class NpcVoice : MonoBehaviour
{
    [SerializeField] string voiceFolder = "Voices/Blacksmith";
    [SerializeField] AudioSource source;
    [SerializeField] Transform player;
    [SerializeField] float releaseDistance = 60f;

    LazyVoiceBank bank;

    // Dialogue and barks get the interface, not the proxy.
    public IVoiceBank Voice => bank;
    public AudioSource Source => source;

    void Awake() => bank = new LazyVoiceBank(voiceFolder);

    void Update()
    {
        if (bank.IsLoaded && (player.position - transform.position).sqrMagnitude > releaseDistance * releaseDistance)
            bank.Release();
    }
}

// Anywhere:  npc.Voice.Play("greeting", npc.Source);
```

```gdscript [Godot (GDScript)]
# voice_lines.gd: the subject "interface", a base Resource. An NPC exports one of these,
# so a designer can assign either a real bank or a lazy proxy to it.
class_name VoiceLines
extends Resource

func play(_line: String, _player: AudioStreamPlayer3D) -> void:
	pass


# voice_bank.gd: real subject. Loading this .tres loads every stream in it.
class_name VoiceBank
extends VoiceLines

@export var lines: Dictionary = {}  # String -> AudioStream

func play(line: String, player: AudioStreamPlayer3D) -> void:
	var stream: AudioStream = lines.get(line)
	if stream == null:
		push_warning("No voice line '%s'" % line)
		return
	player.stream = stream
	player.play()


# lazy_voice_bank.gd: virtual proxy. Saved inside the NPC scene, it stores only a path,
# so loading the town does not load the bank.
class_name LazyVoiceBank
extends VoiceLines

@export_file("*.tres") var bank_path: String
var _real: VoiceBank


# Start loading on a background thread, e.g. when the player enters the NPC's area.
func prefetch() -> void:
	if _real == null:
		ResourceLoader.load_threaded_request(bank_path)


func play(line: String, player: AudioStreamPlayer3D) -> void:
	if _real == null:  # the first call pays for the load
		if ResourceLoader.load_threaded_get_status(bank_path) != ResourceLoader.THREAD_LOAD_INVALID_RESOURCE:
			_real = ResourceLoader.load_threaded_get(bank_path)  # waits if still loading
		else:
			_real = load(bank_path)
	_real.play(line, player)


# Only the proxy has this. The bank is freed once nothing else references it.
func release() -> void:
	_real = null


# npc_voice.gd
class_name NpcVoice
extends Node3D

@export var voice: VoiceLines  # a VoiceBank or a LazyVoiceBank: callers can't tell
@onready var _player: AudioStreamPlayer3D = $VoicePlayer


func say(line: String) -> void:
	voice.play(line, _player)
```

```cpp [Unreal (C++)]
// NpcVoice.h: TSoftObjectPtr is Unreal's built-in virtual proxy for an asset. This small
// struct wraps it with the bank's own Play(), so callers don't care whether it is loaded.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Engine/AssetManager.h"
#include "Engine/DataAsset.h"
#include "Kismet/GameplayStatics.h"
#include "Sound/SoundBase.h"
#include "NpcVoice.generated.h"

// Real subject: loading it loads every sound it references.
UCLASS()
class UVoiceBank : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	void Play(FName Line, const UObject* WorldContext, const FVector& Location) const
	{
		if (const TObjectPtr<USoundBase>* Sound = Lines.Find(Line))
			UGameplayStatics::PlaySoundAtLocation(WorldContext, *Sound, Location);
		else
			UE_LOG(LogTemp, Warning, TEXT("No voice line '%s'"), *Line.ToString());
	}

	UPROPERTY(EditAnywhere) TMap<FName, TObjectPtr<USoundBase>> Lines;
};

// Virtual proxy: stores a path; loads the real bank on first use.
USTRUCT()
struct FLazyVoiceBank
{
	GENERATED_BODY()

	void Play(FName Line, const UObject* WorldContext, const FVector& Location)
	{
		if (!Loaded) Loaded = Bank.LoadSynchronous();      // the first call pays for the load
		if (Loaded) Loaded->Play(Line, WorldContext, Location);
	}

	// Start loading in the background, e.g. when the player enters the NPC's area.
	void Prefetch()
	{
		if (!Loaded && !Handle.IsValid())
			Handle = UAssetManager::GetStreamableManager().RequestAsyncLoad(Bank.ToSoftObjectPath());
	}

	// Only the proxy has this. The garbage collector frees the bank once nothing else holds it.
	void Release()
	{
		Loaded = nullptr;
		Handle.Reset();
	}

	bool IsLoaded() const { return Loaded != nullptr; }

	UPROPERTY(EditAnywhere) TSoftObjectPtr<UVoiceBank> Bank;   // a path, not a loaded asset

private:
	UPROPERTY(Transient) TObjectPtr<UVoiceBank> Loaded;          // keeps it alive while in use
	TSharedPtr<FStreamableHandle> Handle;
};

UCLASS(ClassGroup = (Gameplay), meta = (BlueprintSpawnableComponent))
class UNpcVoiceComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, Category = "Voice")
	void Say(FName Line) { Voice.Play(Line, this, GetOwner()->GetActorLocation()); }

	UFUNCTION(BlueprintCallable, Category = "Voice")
	void Release() { Voice.Release(); }

	UPROPERTY(EditAnywhere, Category = "Voice") FLazyVoiceBank Voice;
};
```

:::

### Protection proxy: a safe API for mods

Mods and level scripts call the same world API as the game, through a proxy that checks what each mod was granted in its manifest.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

// What the game exposes to scripts and mods.
public interface IWorldApi
{
    void SpawnItem(string itemId, Vector3 position);
    void GiveGold(int amount);
    void SetTimeOfDay(float hours);
}

// Protection proxy: same interface, but checks every call against this mod's permissions.
public class SandboxedWorldApi : IWorldApi
{
    const int MaxGoldPerSession = 1000;

    readonly IWorldApi real;
    readonly string modName;
    readonly HashSet<string> permissions;
    int goldGiven;

    public SandboxedWorldApi(IWorldApi real, string modName, IEnumerable<string> permissions)
    {
        this.real = real;
        this.modName = modName;
        this.permissions = new HashSet<string>(permissions);
    }

    public void SpawnItem(string itemId, Vector3 position)
    {
        if (Allowed("spawn")) real.SpawnItem(itemId, position);
    }

    public void GiveGold(int amount)
    {
        if (!Allowed("economy")) return;
        int granted = Mathf.Clamp(amount, 0, MaxGoldPerSession - goldGiven);   // cap, not just allow
        goldGiven += granted;
        if (granted > 0) real.GiveGold(granted);
    }

    public void SetTimeOfDay(float hours)
    {
        if (Allowed("world")) real.SetTimeOfDay(Mathf.Repeat(hours, 24f));
    }

    bool Allowed(string permission)
    {
        if (permissions.Contains(permission)) return true;
        Debug.LogWarning($"Mod '{modName}' needs the '{permission}' permission for that.");
        return false;
    }
}

// The mod loader gives each mod its own proxy; the mod never receives the real API:
//   IWorldApi api = new SandboxedWorldApi(world, manifest.Name, manifest.Permissions);
```

```gdscript [Godot (GDScript)]
# sandboxed_world_api.gd: protection proxy over the game's World API. It has the same
# methods as the real one (duck typing stands in for a shared interface).
class_name SandboxedWorldApi
extends RefCounted

const MAX_GOLD_PER_SESSION := 1000

var _real: Object  # the real World API, e.g. an autoload
var _mod_name: String
var _permissions: PackedStringArray
var _gold_given := 0


func _init(real: Object, mod_name: String, permissions: PackedStringArray) -> void:
	_real = real
	_mod_name = mod_name
	_permissions = permissions


func spawn_item(item_id: StringName, position: Vector3) -> void:
	if _allowed("spawn"):
		_real.spawn_item(item_id, position)


func give_gold(amount: int) -> void:
	if not _allowed("economy"):
		return
	var granted := clampi(amount, 0, MAX_GOLD_PER_SESSION - _gold_given)  # cap, not just allow
	_gold_given += granted
	if granted > 0:
		_real.give_gold(granted)


func set_time_of_day(hours: float) -> void:
	if _allowed("world"):
		_real.set_time_of_day(fposmod(hours, 24.0))


func _allowed(permission: String) -> bool:
	if permission in _permissions:
		return true
	push_warning("Mod '%s' needs the '%s' permission for that." % [_mod_name, permission])
	return false

# The mod loader gives each mod its own proxy:
#   var api := SandboxedWorldApi.new(World, manifest.name, manifest.permissions)
```

```cpp [Unreal (C++)]
// WorldApi.h: plain C++, so the scripting layer (an embedded Lua, a custom bytecode VM)
// only ever receives an IWorldApi.
#pragma once

#include "CoreMinimal.h"

class IWorldApi
{
public:
	virtual ~IWorldApi() = default;
	virtual void SpawnItem(FName ItemId, const FVector& Location) = 0;
	virtual void GiveGold(int32 Amount) = 0;
	virtual void SetTimeOfDay(float Hours) = 0;
};

// Protection proxy: same interface, but checks every call against this mod's permissions.
class FSandboxedWorldApi : public IWorldApi
{
public:
	FSandboxedWorldApi(TSharedRef<IWorldApi> InReal, FString InModName, TSet<FName> InPermissions)
		: Real(MoveTemp(InReal)), ModName(MoveTemp(InModName)), Permissions(MoveTemp(InPermissions)) {}

	virtual void SpawnItem(FName ItemId, const FVector& Location) override
	{
		if (Allowed(TEXT("Spawn"))) Real->SpawnItem(ItemId, Location);
	}

	virtual void GiveGold(int32 Amount) override
	{
		if (!Allowed(TEXT("Economy"))) return;
		const int32 Granted = FMath::Clamp(Amount, 0, MaxGoldPerSession - GoldGiven);   // cap, not just allow
		GoldGiven += Granted;
		if (Granted > 0) Real->GiveGold(Granted);
	}

	virtual void SetTimeOfDay(float Hours) override
	{
		if (Allowed(TEXT("World"))) Real->SetTimeOfDay(FMath::Fmod(FMath::Fmod(Hours, 24.f) + 24.f, 24.f));
	}

private:
	bool Allowed(FName Permission) const
	{
		if (Permissions.Contains(Permission)) return true;
		UE_LOG(LogTemp, Warning, TEXT("Mod '%s' needs the '%s' permission for that."), *ModName, *Permission.ToString());
		return false;
	}

	static constexpr int32 MaxGoldPerSession = 1000;
	TSharedRef<IWorldApi> Real;
	FString ModName;
	TSet<FName> Permissions;
	int32 GoldGiven = 0;
};

// The mod loader gives each mod its own proxy:
//   TSharedRef<IWorldApi> Api = MakeShared<FSandboxedWorldApi>(World, Manifest.Name, Manifest.Permissions);
```

:::

**Engine notes**

- **Unity:** `Resources` keeps the example self-contained; in production the same proxy wraps an Addressables handle (`Addressables.LoadAssetAsync` and `Release`, see [Asset References](./asset-reference)). Netcode for GameObjects' `NetworkBehaviour` RPCs are a built-in remote proxy: the call runs on another machine.
- **Godot:** `ResourceLoader.load_threaded_request` / `load_threaded_get` is the built-in lazy, background loader; a resource reference stored as an `@export_file` path instead of a resource is what keeps the bank out of the scene's load. With no interfaces, a shared base class (as above) or duck typing makes the proxy substitutable. `@rpc` functions are Godot's remote-proxy mechanism.
- **Unreal:** `TSoftObjectPtr` / `TSoftClassPtr` are built-in virtual proxies: they store a path and load with `LoadSynchronous()` or `FStreamableManager::RequestAsyncLoad`; the loaded object must then be held by a `UPROPERTY` or a streamable handle, or the garbage collector frees it. Replicated actors with Server and Client RPCs are remote proxies built into the engine.

## When to use

- An object is expensive to create or load and is often not needed: voice banks, high-detail meshes, codex entries, level chunks.
- Untrusted or less-trusted code (mods, level scripts, a debug console) calls game APIs and must be limited.
- Calls should go to an object that lives somewhere else (a server, another thread) without callers knowing.
- Repeated expensive calls (server queries, path requests) can reuse a recent answer.

## When not to use

- The object is cheap or always needed. Load it with everything else; the proxy only adds a hitch at the worst moment.
- One caller needs lazy creation. A [Lazy Initialization](./lazy-initialization) field in that caller is simpler than a class with a whole interface.
- The engine already gives you the proxy: soft references, Addressables handles and threaded resource loading. Use them directly and add your own proxy only when callers must not know about loading.
- You want to add behaviour (logging, damage boosts) rather than control access. That is a [Decorator](./decorator).

## Pitfalls

- **The first-use hitch.** A lazy proxy moves the load to the first call, which may be in the middle of a conversation. Offer a prefetch (as above) and call it when the player gets close, or load behind a transition.
- **A protection proxy is not a sandbox.** It only protects the calls that go through it. Mods written in C#, GDScript or C++ can reach the engine directly; real sandboxing needs a restricted language or VM (Lua with a limited environment, your own [Bytecode](./bytecode)) whose only way out is the proxy.
- **Hiding latency behind a synchronous interface.** A remote or loading proxy behind `void Play()` either blocks or silently drops the call. If the real work is asynchronous, make the interface asynchronous (callbacks, `await`, delegates) rather than pretending.
- **Identity.** Code that compares the proxy to the real object, or casts to the concrete type, breaks. Callers should only use the interface.
- **Unloading what others still use.** Releasing a shared asset from one proxy can pull it out from under another. Reference-count, or let the engine's handles and garbage collector decide.

## Related

- [Decorator](./decorator) — same interface and same wrapping, but adds behaviour instead of controlling access.
- [Adapter](./adapter) — also wraps another object, but changes its interface.
- [Lazy Initialization](./lazy-initialization) — the idea inside a virtual proxy, without the separate stand-in object.
- [Asset References & Addressing](./asset-reference) — soft references and handles are the engines' built-in asset proxies.
- [Memoization / Caching](./memoization) — what a caching proxy does behind the interface.
- [Flyweight](./flyweight) — shares one heavy object between many users; a proxy controls access to one.
