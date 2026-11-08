# Abstract Factory

> Create families of objects that must match (per platform, UI skin or biome) through one interface.

**Also known as:** Kit · **Category:** Architecture & Structure

## Problem

The game ships as a desktop build and as a trade-show kiosk build, and the team is preparing a console port. Three systems differ between them: where saves go, where achievements are recorded, and which button names the prompts show ("[Space] Jump" or "(A) Jump"). On the kiosk, nothing may persist between visitors and the stand only has a gamepad; on the console, certification requires the platform's own save API and button names.

Each system checks the build on its own: an `#if` in the save screen, another in the prompt widget, a third in the achievement code. They drift apart. A kiosk build ships that still writes a save file to the demo PC, so the next visitor starts at the boss; a test run unlocks achievements in a developer's real profile. Nothing in the code says these three choices belong together, so nothing stops one of them being wrong.

## Solution

Make the *set* of related objects one choice. An **abstract factory** is an interface with one creation method per product, and each implementation creates a whole family that is known to fit together:

- **Abstract products:** `ISaveStorage`, `IAchievements`, `IButtonPrompts`: the interfaces the game uses.
- **Concrete products:** `FileSaveStorage`, `MemorySaveStorage`, `KeyboardPrompts`, `GamepadPrompts`…
- **Abstract factory:** `IPlatformFactory` with `CreateSaveStorage()`, `CreateAchievements()`, `CreateButtonPrompts()`.
- **Concrete factories (families):** `DesktopPlatform`, `KioskPlatform`, `InMemoryPlatform` for tests, and later `ConsolePlatform`.

```
                    IPlatformFactory
          ┌────────────────┼─────────────────┐
   DesktopPlatform    KioskPlatform     InMemoryPlatform
   files + keyboard   memory + gamepad  memory + names (tests)
```

The startup code picks **one** factory, and every product comes from it, so a kiosk build cannot end up with desktop saves. Adding a platform means writing one new family; no gameplay code changes. Families may share products (two of these use the same in-memory storage), and each product is often an [Adapter](./adapter) over a platform SDK.

Compared with the [Factory](./factory) page: a plain factory decides *how* to create one kind of thing. An abstract factory decides *which family* every related thing comes from.

## Example

Platform services for a desktop build, a trade-show kiosk build and tests. The **core** is plain code with no engine types: the product interfaces, the factory interface and three families. The **engine wiring** chooses a family at startup and uses one of its products in the UI.

### Core

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using System.IO;
using System.Text;

public enum GameAction { Confirm, Cancel, Jump, Pause }

// ── Abstract products: the only types gameplay code sees ──
public interface ISaveStorage
{
    void Write(string slot, byte[] data);
    byte[] Read(string slot);                       // null if the slot is empty
}

public interface IAchievements { void Unlock(string id); }

public interface IButtonPrompts { string Label(GameAction action); }

// ── Abstract factory: one creation method per product ──
public interface IPlatformFactory
{
    ISaveStorage CreateSaveStorage();
    IAchievements CreateAchievements();
    IButtonPrompts CreateButtonPrompts();
}

// ── Families: each one creates a set that is known to fit together ──
public class DesktopPlatform : IPlatformFactory
{
    readonly string profileDir;
    public DesktopPlatform(string profileDir) => this.profileDir = profileDir;

    public ISaveStorage CreateSaveStorage() => new FileSaveStorage(profileDir);
    public IAchievements CreateAchievements() => new LocalAchievements(new FileSaveStorage(profileDir));
    public IButtonPrompts CreateButtonPrompts() => new KeyboardPrompts();
}

// Trade-show build: nothing outlives the visitor, and the stand only has a gamepad.
public class KioskPlatform : IPlatformFactory
{
    public ISaveStorage CreateSaveStorage() => new MemorySaveStorage();
    public IAchievements CreateAchievements() => new LocalAchievements(new MemorySaveStorage());
    public IButtonPrompts CreateButtonPrompts() => new GamepadPrompts();
}

// Tests: one shared in-memory store that the test can inspect afterwards.
public class InMemoryPlatform : IPlatformFactory
{
    public readonly MemorySaveStorage Storage = new();

    public ISaveStorage CreateSaveStorage() => Storage;
    public IAchievements CreateAchievements() => new LocalAchievements(Storage);
    public IButtonPrompts CreateButtonPrompts() => new GamepadPrompts();
}

// A console family has the same shape, written against that console's SDK and compiled
// only into its build, so its saves, trophies and pad prompts always arrive together.

// ── Concrete products ──
public class FileSaveStorage : ISaveStorage
{
    readonly string dir;
    public FileSaveStorage(string dir) { this.dir = dir; Directory.CreateDirectory(dir); }

    public void Write(string slot, byte[] data) => File.WriteAllBytes(PathOf(slot), data);
    public byte[] Read(string slot) => File.Exists(PathOf(slot)) ? File.ReadAllBytes(PathOf(slot)) : null;
    string PathOf(string slot) => Path.Combine(dir, slot + ".sav");
}

public class MemorySaveStorage : ISaveStorage
{
    public readonly Dictionary<string, byte[]> Slots = new();
    public void Write(string slot, byte[] data) => Slots[slot] = data;
    public byte[] Read(string slot) => Slots.TryGetValue(slot, out var data) ? data : null;
}

// Keeps unlocks in whatever storage its family gives it. A Steam family would use an
// adapter over the Steam SDK here instead.
public class LocalAchievements : IAchievements
{
    readonly ISaveStorage storage;
    readonly HashSet<string> unlocked = new();

    public LocalAchievements(ISaveStorage storage)
    {
        this.storage = storage;
        var data = storage.Read("achievements");
        if (data != null) unlocked.UnionWith(Encoding.UTF8.GetString(data).Split('\n'));
    }

    public void Unlock(string id)
    {
        if (unlocked.Add(id))
            storage.Write("achievements", Encoding.UTF8.GetBytes(string.Join("\n", unlocked)));
    }
}

public class KeyboardPrompts : IButtonPrompts
{
    public string Label(GameAction action) => action switch
    {
        GameAction.Confirm => "[Enter]",
        GameAction.Cancel => "[Esc]",
        GameAction.Jump => "[Space]",
        _ => "[P]",
    };
}

public class GamepadPrompts : IButtonPrompts
{
    public string Label(GameAction action) => action switch
    {
        GameAction.Confirm or GameAction.Jump => "(A)",
        GameAction.Cancel => "(B)",
        _ => "(Start)",
    };
}
```

```gdscript [Godot (GDScript)]
# GDScript has no interfaces, so the products and the factory are base classes whose
# methods each family overrides. Callers type their variables with the base class.

# save_storage.gd: abstract product.
class_name SaveStorage
extends RefCounted

func write(_slot: String, _data: PackedByteArray) -> void:
	pass

func read(_slot: String) -> PackedByteArray:  # empty if the slot doesn't exist
	return PackedByteArray()


# file_save_storage.gd
class_name FileSaveStorage
extends SaveStorage

var _dir: String

func _init(dir: String) -> void:
	_dir = dir
	DirAccess.make_dir_recursive_absolute(dir)

func write(slot: String, data: PackedByteArray) -> void:
	var file := FileAccess.open(_dir.path_join(slot + ".sav"), FileAccess.WRITE)
	if file:
		file.store_buffer(data)

func read(slot: String) -> PackedByteArray:
	var path := _dir.path_join(slot + ".sav")
	return FileAccess.get_file_as_bytes(path) if FileAccess.file_exists(path) else PackedByteArray()


# memory_save_storage.gd
class_name MemorySaveStorage
extends SaveStorage

var slots := {}  # String -> PackedByteArray

func write(slot: String, data: PackedByteArray) -> void:
	slots[slot] = data

func read(slot: String) -> PackedByteArray:
	return slots.get(slot, PackedByteArray())


# achievements.gd: keeps unlocks in whatever storage its family gives it.
# A Steam family would extend this and call the SDK as well (see Adapter).
class_name Achievements
extends RefCounted

var _storage: SaveStorage
var _unlocked := {}  # used as a set

func _init(storage: SaveStorage) -> void:
	_storage = storage
	for id in storage.read("achievements").get_string_from_utf8().split("\n", false):
		_unlocked[id] = true

func unlock(id: String) -> void:
	if _unlocked.has(id):
		return
	_unlocked[id] = true
	_storage.write("achievements", "\n".join(PackedStringArray(_unlocked.keys())).to_utf8_buffer())


# button_prompts.gd: abstract product, with keyboard and gamepad versions.
class_name ButtonPrompts
extends RefCounted

enum Action { CONFIRM, CANCEL, JUMP, PAUSE }

func label(_action: Action) -> String:
	return ""


# keyboard_prompts.gd
class_name KeyboardPrompts
extends ButtonPrompts

func label(action: Action) -> String:
	return ["[Enter]", "[Esc]", "[Space]", "[P]"][action]


# gamepad_prompts.gd
class_name GamepadPrompts
extends ButtonPrompts

func label(action: Action) -> String:
	return ["(A)", "(B)", "(A)", "(Start)"][action]


# platform_factory.gd: the abstract factory. Every family overrides all three methods.
class_name PlatformFactory
extends RefCounted

func create_save_storage() -> SaveStorage:
	return null

func create_achievements() -> Achievements:
	return null

func create_button_prompts() -> ButtonPrompts:
	return null


# desktop_platform.gd
class_name DesktopPlatform
extends PlatformFactory

const PROFILE_DIR := "user://profile"

func create_save_storage() -> SaveStorage:
	return FileSaveStorage.new(PROFILE_DIR)

func create_achievements() -> Achievements:
	return Achievements.new(FileSaveStorage.new(PROFILE_DIR))

func create_button_prompts() -> ButtonPrompts:
	return KeyboardPrompts.new()


# kiosk_platform.gd: trade-show build. Nothing outlives the visitor; the stand only has a pad.
class_name KioskPlatform
extends PlatformFactory

func create_save_storage() -> SaveStorage:
	return MemorySaveStorage.new()

func create_achievements() -> Achievements:
	return Achievements.new(MemorySaveStorage.new())

func create_button_prompts() -> ButtonPrompts:
	return GamepadPrompts.new()

# InMemoryPlatform for tests follows the same shape, sharing one MemorySaveStorage
# between saves and achievements so a test can inspect it.
```

```cpp [Unreal (C++)]
// PlatformFactory.h: plain C++, no UObjects, so tests can build any family directly.
#pragma once

#include "CoreMinimal.h"
#include "Kismet/GameplayStatics.h"
#include "Serialization/MemoryReader.h"
#include "Serialization/MemoryWriter.h"

enum class EGameAction : uint8 { Confirm, Cancel, Jump, Pause };

// ── Abstract products ──
class ISaveStorage
{
public:
	virtual ~ISaveStorage() = default;
	virtual bool Write(const FString& Slot, const TArray<uint8>& Data) = 0;
	virtual bool Read(const FString& Slot, TArray<uint8>& OutData) = 0;
};

class IAchievements
{
public:
	virtual ~IAchievements() = default;
	virtual void Unlock(const FString& Id) = 0;
};

class IButtonPrompts
{
public:
	virtual ~IButtonPrompts() = default;
	virtual FText Label(EGameAction Action) const = 0;
};

// ── Abstract factory ──
class IPlatformFactory
{
public:
	virtual ~IPlatformFactory() = default;
	virtual TSharedRef<ISaveStorage> CreateSaveStorage() = 0;
	virtual TSharedRef<IAchievements> CreateAchievements() = 0;
	virtual TSharedRef<IButtonPrompts> CreateButtonPrompts() = 0;
};

// ── Concrete products ──
// Goes through the engine's platform save system, so it is already correct per platform.
class FSlotSaveStorage : public ISaveStorage
{
public:
	virtual bool Write(const FString& Slot, const TArray<uint8>& Data) override
	{
		return UGameplayStatics::SaveDataToSlot(Data, Slot, 0);
	}
	virtual bool Read(const FString& Slot, TArray<uint8>& OutData) override
	{
		return UGameplayStatics::LoadDataFromSlot(OutData, Slot, 0);
	}
};

class FMemorySaveStorage : public ISaveStorage
{
public:
	virtual bool Write(const FString& Slot, const TArray<uint8>& Data) override { Slots.Add(Slot, Data); return true; }
	virtual bool Read(const FString& Slot, TArray<uint8>& OutData) override
	{
		const TArray<uint8>* Found = Slots.Find(Slot);
		if (Found) OutData = *Found;
		return Found != nullptr;
	}
	TMap<FString, TArray<uint8>> Slots;
};

// Keeps unlocks in whatever storage its family gives it.
class FLocalAchievements : public IAchievements
{
public:
	explicit FLocalAchievements(TSharedRef<ISaveStorage> InStorage) : Storage(MoveTemp(InStorage))
	{
		TArray<uint8> Bytes;
		if (Storage->Read(TEXT("achievements"), Bytes))
		{
			FMemoryReader Reader(Bytes);
			TArray<FString> Ids;
			Reader << Ids;
			Unlocked.Append(Ids);
		}
	}

	virtual void Unlock(const FString& Id) override
	{
		if (Unlocked.Contains(Id)) return;
		Unlocked.Add(Id);
		TArray<uint8> Bytes;
		FMemoryWriter Writer(Bytes);
		TArray<FString> Ids = Unlocked.Array();
		Writer << Ids;
		Storage->Write(TEXT("achievements"), Bytes);
	}

private:
	TSharedRef<ISaveStorage> Storage;
	TSet<FString> Unlocked;
};

class FKeyboardPrompts : public IButtonPrompts
{
public:
	virtual FText Label(EGameAction Action) const override
	{
		switch (Action)
		{
		case EGameAction::Confirm: return INVTEXT("[Enter]");
		case EGameAction::Cancel:  return INVTEXT("[Esc]");
		case EGameAction::Jump:    return INVTEXT("[Space]");
		default:                   return INVTEXT("[P]");
		}
	}
};

class FGamepadPrompts : public IButtonPrompts
{
public:
	virtual FText Label(EGameAction Action) const override
	{
		switch (Action)
		{
		case EGameAction::Cancel: return INVTEXT("(B)");
		case EGameAction::Pause:  return INVTEXT("(Start)");
		default:                  return INVTEXT("(A)");
		}
	}
};

// ── Families ──
class FDesktopPlatform : public IPlatformFactory
{
public:
	virtual TSharedRef<ISaveStorage> CreateSaveStorage() override { return MakeShared<FSlotSaveStorage>(); }
	virtual TSharedRef<IAchievements> CreateAchievements() override
	{
		return MakeShared<FLocalAchievements>(MakeShared<FSlotSaveStorage>());
	}
	virtual TSharedRef<IButtonPrompts> CreateButtonPrompts() override { return MakeShared<FKeyboardPrompts>(); }
};

// Trade-show build: nothing outlives the visitor, and the stand only has a gamepad.
class FKioskPlatform : public IPlatformFactory
{
public:
	virtual TSharedRef<ISaveStorage> CreateSaveStorage() override { return MakeShared<FMemorySaveStorage>(); }
	virtual TSharedRef<IAchievements> CreateAchievements() override
	{
		return MakeShared<FLocalAchievements>(MakeShared<FMemorySaveStorage>());
	}
	virtual TSharedRef<IButtonPrompts> CreateButtonPrompts() override { return MakeShared<FGamepadPrompts>(); }
};

// FInMemoryPlatform for automation tests follows the same shape, sharing one
// FMemorySaveStorage between saves and achievements so the test can inspect it.
```

:::

### Engine wiring

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

// Picks one family before the first scene loads. Nothing else checks which build it is.
public static class Platform
{
    public static ISaveStorage Saves { get; private set; }
    public static IAchievements Achievements { get; private set; }
    public static IButtonPrompts Prompts { get; private set; }

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    static void Init()
    {
#if KIOSK_BUILD
        Use(new KioskPlatform());
#else
        Use(new DesktopPlatform(System.IO.Path.Combine(Application.persistentDataPath, "profile")));
#endif
    }

    // The only place products are created. Tests call it with an InMemoryPlatform.
    public static void Use(IPlatformFactory family)
    {
        Saves = family.CreateSaveStorage();
        Achievements = family.CreateAchievements();
        Prompts = family.CreateButtonPrompts();
    }
}

// A prompt such as "[Space] Jump" or "(A) Jump", depending on the family.
public class PromptLabel : MonoBehaviour
{
    [SerializeField] GameAction action = GameAction.Jump;
    [SerializeField] string verb = "Jump";
    [SerializeField] TMPro.TMP_Text label;

    void OnEnable() => label.text = $"{Platform.Prompts.Label(action)} {verb}";
}
```

```gdscript [Godot (GDScript)]
# platform.gd: autoload named "Platform". Picks one family at startup.
extends Node

var saves: SaveStorage
var achievements: Achievements
var prompts: ButtonPrompts


func _init() -> void:
	# "kiosk" is a custom feature tag set in the kiosk export preset.
	use(KioskPlatform.new() if OS.has_feature("kiosk") else DesktopPlatform.new())


# The only place products are created. Tests call it with an in-memory family.
func use(family: PlatformFactory) -> void:
	saves = family.create_save_storage()
	achievements = family.create_achievements()
	prompts = family.create_button_prompts()


# prompt_label.gd: shows "[Space] Jump" or "(A) Jump", depending on the family.
extends Label

@export var action: ButtonPrompts.Action = ButtonPrompts.Action.JUMP
@export var verb := "Jump"


func _ready() -> void:
	text = "%s %s" % [Platform.prompts.label(action), verb]
```

```cpp [Unreal (C++)]
// PlatformSubsystem.h: picks one family when the game instance starts.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "PlatformFactory.h"
#include "PlatformSubsystem.generated.h"

UCLASS()
class UPlatformSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override
	{
		Super::Initialize(Collection);
#if KIOSK_BUILD                       // set in the kiosk Target.cs: GlobalDefinitions.Add("KIOSK_BUILD=1")
		FKioskPlatform Family;
#else
		FDesktopPlatform Family;
#endif
		Use(Family);
	}

	// The only place products are created. Automation tests call it with an in-memory family.
	void Use(IPlatformFactory& Family)
	{
		Saves = Family.CreateSaveStorage();
		Achievements = Family.CreateAchievements();
		Prompts = Family.CreateButtonPrompts();
	}

	ISaveStorage& GetSaves() const { return *Saves; }
	IAchievements& GetAchievements() const { return *Achievements; }
	const IButtonPrompts& GetPrompts() const { return *Prompts; }

private:
	TSharedPtr<ISaveStorage> Saves;
	TSharedPtr<IAchievements> Achievements;
	TSharedPtr<IButtonPrompts> Prompts;
};

// In a widget: "[Space] Jump" or "(A) Jump", depending on the family.
//   const IButtonPrompts& Prompts = GetGameInstance()->GetSubsystem<UPlatformSubsystem>()->GetPrompts();
//   Label->SetText(FText::Format(INVTEXT("{0} Jump"), Prompts.Label(EGameAction::Jump)));
```

:::

**Engine notes**

- **Unity:** there is no built-in platform-services split; `Application.platform`, scripting define symbols (`KIOSK_BUILD` above, set per build profile) and `#if UNITY_PS5`-style platform defines are the usual way to pick the family. The Input System's control paths and `InputControl.displayName` can supply the actual glyph names for a gamepad family.
- **Godot:** with no interfaces, base classes (as above) or duck typing stand in for the abstract types; base classes let you type variables and catch typos earlier. Custom feature tags in export presets, checked with `OS.has_feature()`, are the natural switch between families.
- **Unreal:** the engine already splits this way: `UGameplayStatics::SaveDataToSlot` goes through each platform's save system, the Online Subsystem returns a matching set of interfaces (identity, achievements, leaderboards) per platform, and platform modules and subsystems keep each platform's code in its own module. The game-side factory is mostly for choosing between the real platform, kiosk or demo builds and an in-memory family for automation tests. CommonUI's input data provides per-platform button glyphs.

## When to use

- Several related objects must be swapped *together*: platform services, kiosk or demo builds, a test double for every service at once.
- Themed sets whose members differ in behaviour, not only in assets: a "fantasy" and a "sci-fi" UI kit whose widgets build different layouts, or biomes whose hazards and enemies run different code.
- You want tests or the editor to run with a complete fake environment from one switch.

## When not to use

- The families differ only in **which assets** they use (a biome's enemy template, prop and loot table). Put the set in one data asset per biome, a [Type Object](./type-object), and pick the asset; no factory classes needed.
- There is one product, not a family. A plain [Factory](./factory) or a single [Adapter](./adapter) chosen at startup is enough.
- There is only one family and no test needs another. Create the objects directly until a second platform is real.

## Pitfalls

- **Adding a product touches every family.** A new `CreateLeaderboards()` must be written in every factory. Keep the factory to the services that truly must match, and give the others their own simple choice.
- **Products from different families mixed anyway.** If code still news up a `FileSaveStorage` directly, the guarantee is gone. Make the factory the only place products are created, ideally once, at startup.
- **Checking the family at runtime.** `if (factory is KioskPlatform)` puts the scattered `#if`s back. Add a capability to a product instead (`IAchievements.ShowsToasts`).
- **Creating products repeatedly.** Calling `CreateSaveStorage()` on every save makes new objects with their own state. Create each product once and pass it around, via [Dependency Injection](./dependency-injection) or a [Service Locator](./service-locator).

## Related

- [Factory](./factory) — creates one kind of object. An abstract factory groups several creation methods so a whole family is chosen at once.
- [Adapter](./adapter) — each product in a platform family is often an adapter over that platform's SDK.
- [Bootstrapper](./bootstrapper) — where the family is chosen, once, at startup.
- [Dependency Injection](./dependency-injection) and [Service Locator](./service-locator) — hand the created products to the rest of the game.
- [Type Object](./type-object) — when families differ only in data, a data asset per family replaces the factory classes.
- [Bridge](./bridge) — an abstract factory is often how the matching implementation side of a bridge is created.
