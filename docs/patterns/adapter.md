# Adapter

> Wrap a third-party or platform API so the game depends only on your own interface.

**Category:** Architecture & Structure

## Problem

The game ships on Steam, PlayStation, Xbox and mobile. Each platform has its own achievements API with different method names, threading rules, ID formats and error handling. Calling them directly from gameplay (`if STEAM ... #elif PS5 ...`) spreads `#if` blocks across the codebase, makes every platform's quirks everyone's problem, and makes the game impossible to run in the editor without the SDKs. The same happens with analytics vendors, ad networks, voice chat and older internal code with awkward interfaces.

## Solution

Define the interface **your game wants**, then write an **adapter** per external API that translates between the two:

- **Target interface:** `IAchievements.Unlock(AchievementId id)`, designed from the game's point of view.
- **Adapters:** `SteamAchievements`, `PlayStationAchievements`, `NullAchievements` (editor, tests). Each converts IDs, calls the SDK, and handles its threading and errors.
- The game depends only on the target interface. The [Bootstrapper](./bootstrapper) picks the adapter for the current platform.

All platform `#if`s and SDK quirks live in the adapters. Gameplay code never sees them.

## Example

The game wants a simple, typed achievements API. Each platform SDK has its own shape; an adapter per platform translates between them.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public enum AchievementId { FirstBlood, Centurion, NoDamageBoss, Completionist }

// The interface the GAME wants: simple, typed, platform-neutral.
public interface IAchievements
{
    void Unlock(AchievementId id);
    void SetProgress(AchievementId id, int current, int total);
}

// Editor, tests, and platforms without achievements: does nothing, but logs.
public class NullAchievements : IAchievements
{
    public void Unlock(AchievementId id) => Debug.Log($"[Achievements] Unlock {id}");
    public void SetProgress(AchievementId id, int current, int total) { }
}

#if STEAMWORKS_NET
// Adapter: translates our interface to the Steamworks.NET API.
public class SteamAchievements : IAchievements
{
    // Our enum → Steam's string API names, configured in one place.
    static readonly Dictionary<AchievementId, string> apiNames = new()
    {
        { AchievementId.FirstBlood, "ACH_FIRST_BLOOD" },
        { AchievementId.Centurion, "ACH_KILL_100" },
        { AchievementId.NoDamageBoss, "ACH_FLAWLESS_BOSS" },
        { AchievementId.Completionist, "ACH_100_PERCENT" },
    };

    public void Unlock(AchievementId id)
    {
        if (!Steamworks.SteamManager.Initialized) return;               // SDK quirk handled here
        Steamworks.SteamUserStats.SetAchievement(apiNames[id]);
        Steamworks.SteamUserStats.StoreStats();                         // Steam requires an explicit store
    }

    public void SetProgress(AchievementId id, int current, int total) =>
        Steamworks.SteamUserStats.IndicateAchievementProgress(apiNames[id], (uint)current, (uint)total);
}
#endif

// The bootstrapper chooses once:
public static class AchievementsInstaller
{
    public static IAchievements Create()
    {
#if STEAMWORKS_NET && !UNITY_EDITOR
        return new SteamAchievements();
#else
        return new NullAchievements();
#endif
    }
}

// Gameplay never knows which platform it runs on:
//   achievements.Unlock(AchievementId.Centurion);
```

```gdscript [Godot (GDScript)]
# achievements.gd: the interface the GAME wants, as a base class. This one is also the
# null version for the editor, tests and platforms without achievements.
class_name Achievements
extends RefCounted

enum Id { FIRST_BLOOD, CENTURION, NO_DAMAGE_BOSS, COMPLETIONIST }


func unlock(id: Id) -> void:
	print("[Achievements] Unlock %s" % Id.keys()[id])


func set_progress(_id: Id, _current: int, _total: int) -> void:
	pass


# steam_achievements.gd: adapter over the GodotSteam add-on's API.
class_name SteamAchievements
extends Achievements

# Our enum → Steam's string API names, configured in one place.
const API_NAMES := {
	Id.FIRST_BLOOD: "ACH_FIRST_BLOOD",
	Id.CENTURION: "ACH_KILL_100",
	Id.NO_DAMAGE_BOSS: "ACH_FLAWLESS_BOSS",
	Id.COMPLETIONIST: "ACH_100_PERCENT",
}


func unlock(id: Id) -> void:
	if not Steam.isSteamRunning():  # SDK quirk handled here
		return
	Steam.setAchievement(API_NAMES[id])
	Steam.storeStats()  # Steam requires an explicit store


func set_progress(id: Id, current: int, total: int) -> void:
	Steam.indicateAchievementProgress(API_NAMES[id], current, total)


# The boot autoload chooses once:
#   var achievements: Achievements = SteamAchievements.new() \
#       if Engine.has_singleton("Steam") and not OS.has_feature("editor") else Achievements.new()
```

```cpp [Unreal (C++)]
// Unreal's Online Subsystem is itself an adapter layer over Steam, EOS, consoles and more.
// This game-side adapter maps our enum to its achievement ids and hides the write objects.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "OnlineSubsystem.h"
#include "OnlineSubsystemUtils.h"
#include "Interfaces/OnlineAchievementsInterface.h"
#include "AchievementsSubsystem.generated.h"

UENUM() enum class EAchievementId : uint8 { FirstBlood, Centurion, NoDamageBoss, Completionist };

UCLASS()
class UAchievementsSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	void Unlock(EAchievementId Id) { SetProgress(Id, 1, 1); }

	void SetProgress(EAchievementId Id, int32 Current, int32 Total)
	{
		IOnlineSubsystem* Online = Online::GetSubsystem(GetWorld());
		IOnlineAchievementsPtr Achievements = Online ? Online->GetAchievementsInterface() : nullptr;
		const ULocalPlayer* Player = GetGameInstance()->GetFirstGamePlayer();
		if (!Achievements || !Player || !Player->GetPreferredUniqueNetId().IsValid())
		{
			UE_LOG(LogTemp, Log, TEXT("[Achievements] %s %d/%d"), *UEnum::GetValueAsString(Id), Current, Total);
			return;                                                   // editor, tests, no platform
		}

		// Online Subsystem achievements are written as progress from 0 to 100.
		FOnlineAchievementsWriteRef Write = MakeShared<FOnlineAchievementsWrite>();
		Write->SetFloatStat(ApiName(Id), 100.f * Current / FMath::Max(1, Total));
		Achievements->WriteAchievements(*Player->GetPreferredUniqueNetId().GetUniqueNetId(), Write);
	}

private:
	// Our enum → the platform's achievement ids, configured in one place.
	static FString ApiName(EAchievementId Id)
	{
		switch (Id)
		{
		case EAchievementId::FirstBlood:   return TEXT("ACH_FIRST_BLOOD");
		case EAchievementId::Centurion:    return TEXT("ACH_KILL_100");
		case EAchievementId::NoDamageBoss: return TEXT("ACH_FLAWLESS_BOSS");
		default:                           return TEXT("ACH_100_PERCENT");
		}
	}
};

// Gameplay never knows which platform it runs on:
//   GetGameInstance()->GetSubsystem<UAchievementsSubsystem>()->Unlock(EAchievementId::Centurion);
```

:::

Adapters also help *inside* a project. Wrap a legacy system, or a third-party package with an awkward API, behind an interface shaped like the rest of your code, so it can be replaced later.

**Engine notes**

- **Unity:** the Steam calls illustrate the Steamworks.NET wrapper; `SteamManager` comes from its sample scripts. Each platform adapter follows the same shape with its own SDK calls.
- **Godot:** the Steam calls are from the **GodotSteam** add-on, which registers a `Steam` singleton. On consoles, the platform's own Godot port provides its SDK.
- **Unreal:** the newer **Online Services** plugins (OSS v2 / EOS) have a different API from the classic Online Subsystem shown here. The game-side adapter is exactly what lets you switch without touching gameplay.

## When to use

- Platform SDKs: achievements, leaderboards, cloud saves, user accounts, store purchases.
- Third-party services you might switch: analytics, crash reporting, ads, voice chat.
- Old or external code whose interface does not fit your architecture.
- Running in the editor and in tests without real SDKs (null or fake adapters).

## When not to use

- Code you own that you could simply change to fit the interface.
- One SDK on one platform that you have no plan to swap. Calling it directly is simpler; add the adapter when a second platform or a test need appears.
- Adapting large, chatty APIs. A thin adapter over a huge surface leaks everywhere; use a [Facade](./facade) that exposes only what the game needs.

## Pitfalls

- **Lowest common denominator.** If the interface only exposes what *every* platform supports, platform-specific features are lost. Add optional capabilities (`bool SupportsProgress`), or separate interfaces for extras.
- **Leaking SDK types.** An adapter method that returns a `Steamworks.CSteamID` couples callers to Steam again. Convert to your own types at the boundary.
- **Different async models.** One SDK is synchronous, another callback-based, a third returns tasks. Make the interface asynchronous if any implementation is, and adapt the others to it.
- **Error handling.** Each SDK fails differently: not signed in, offline, rate-limited. Decide what the game should see (retry quietly, queue, ignore), and implement that consistently in every adapter.

## Related

- [Facade](./facade) — simplifies a subsystem. An adapter converts one interface into another. They are often combined.
- [Service Locator](./service-locator) and [Dependency Injection](./dependency-injection) — provide the chosen adapter to the game.
- [Bootstrapper](./bootstrapper) — chooses and initialises adapters per platform.
- [Input Abstraction](./input-abstraction) — devices adapted to game actions.
- [Decorator](./decorator) — wraps an object with the *same* interface to add behaviour. An adapter changes the interface.
- [Bridge](./bridge) — also separates an interface from its implementations, but is designed up front so both sides can vary; an adapter is added after the fact.
- [Proxy](./proxy) — wraps an object with the *same* interface to control access to it. An adapter changes the interface.
- [Abstract Factory](./abstract-factory) — creates a matching set of adapters per platform.
