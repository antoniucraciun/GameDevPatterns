# Dependency Injection

> Hand objects the services they need instead of letting them look them up.

**Also known as:** DI, Inversion of Control · **Category:** Architecture & Structure

## Problem

A `ShopController` calls `SaveService.Instance`, `Analytics.Instance` and `PlayerWallet.Instance`. You cannot tell what it needs without reading every line. You cannot test "buying fails with insufficient gold" without real files and a real analytics backend. A second shop for a co-op player would need a second wallet, which the singleton cannot express.

## Solution

An object **declares** its dependencies, usually as constructor parameters, and **someone else provides them**. The object never reaches out to a global. One place, the **composition root**, creates the services and wires everything together at startup.

Three ways to inject:

| Style | How | Use for |
| --- | --- | --- |
| **Constructor injection** | Dependencies are constructor parameters | Plain C# classes: the default |
| **Method injection** | A `Construct(...)` / `Init(...)` method called right after creation | Engine-created objects (MonoBehaviours, nodes instanced from scenes, actors), whose constructors you don't call with arguments |
| **Editor injection** | References assigned in the editor (`[SerializeField]`, `@export`, `UPROPERTY(EditAnywhere)`) | Scene-local wiring. This is DI too, done by hand. |

Dependencies are usually **interfaces** (`ISaveService`), so the composition root decides which implementation each object gets. Tests pass in fakes.

## Pseudocode

```text
// The shop declares what it needs and never looks anything up.
Shop:
    wallet, inventory, analytics      // interfaces, handed in from outside

    create(wallet, inventory, analytics):   // constructor injection
        keep all three

    buy(item, price):
        if not wallet.try_spend(price): return false
        inventory.add(item)
        analytics.track("purchase", item)
        return true

// Composition root: the one place that knows the concrete types.
on startup:
    analytics ← LogAnalytics if in the editor, else RemoteAnalytics
    wallet    ← Wallet(starting gold 250)
    inventory ← Inventory
    shop_view.construct(Shop(wallet, inventory, analytics))   // method injection
    enemy_spawner.construct(EnemyFactory(wallet, analytics))

// Objects spawned later get their dependencies from the factory.
EnemyFactory.create(template, position):
    enemy ← new instance of template
    enemy.construct(wallet, analytics)   // before its startup code runs
    place enemy at position
    return enemy

// A test passes fakes and needs no scene.
shop ← Shop(Wallet(50), Inventory, NullAnalytics)
expect shop.buy("sword", 100) to be false
```

## Example

Plain logic with constructor injection and no engine dependency, so it can be unit tested:

::: code-group

```csharp [Unity (C#)]
public interface IWallet { int Gold { get; } bool TrySpend(int amount); }
public interface IInventory { void Add(string itemId); }
public interface IAnalytics { void Track(string evt, string data); }

public class Shop
{
    readonly IWallet wallet;
    readonly IInventory inventory;
    readonly IAnalytics analytics;

    public Shop(IWallet wallet, IInventory inventory, IAnalytics analytics)   // needs are explicit
    {
        this.wallet = wallet; this.inventory = inventory; this.analytics = analytics;
    }

    public bool Buy(string itemId, int price)
    {
        if (!wallet.TrySpend(price)) return false;
        inventory.Add(itemId);
        analytics.Track("purchase", itemId);
        return true;
    }
}
```

```gdscript [Godot (GDScript)]
# shop.gd: plain logic, no nodes. GDScript has no interfaces: any object with the
# methods noted below can be passed in, including fakes in tests.
class_name Shop
extends RefCounted

var _wallet     # try_spend(amount: int) -> bool
var _inventory  # add(item_id: String)
var _analytics  # track(event: String, data: String)


func _init(wallet, inventory, analytics) -> void:  # needs are explicit
	_wallet = wallet
	_inventory = inventory
	_analytics = analytics


func buy(item_id: String, price: int) -> bool:
	if not _wallet.try_spend(price):
		return false
	_inventory.add(item_id)
	_analytics.track("purchase", item_id)
	return true
```

```cpp [Unreal (C++)]
// Shop.h: plain C++, no UObjects, so it can be tested with automation tests.
#pragma once

#include "CoreMinimal.h"

class IWallet { public: virtual ~IWallet() = default; virtual int32 GetGold() const = 0; virtual bool TrySpend(int32 Amount) = 0; };
class IInventory { public: virtual ~IInventory() = default; virtual void Add(FName ItemId) = 0; };
class IAnalytics { public: virtual ~IAnalytics() = default; virtual void Track(const FString& Event, const FString& Data) = 0; };

class FShop
{
public:
	FShop(TSharedRef<IWallet> InWallet, TSharedRef<IInventory> InInventory, TSharedRef<IAnalytics> InAnalytics)   // needs are explicit
		: Wallet(InWallet), Inventory(InInventory), Analytics(InAnalytics) {}

	bool Buy(FName ItemId, int32 Price)
	{
		if (!Wallet->TrySpend(Price)) return false;
		Inventory->Add(ItemId);
		Analytics->Track(TEXT("purchase"), ItemId.ToString());
		return true;
	}

private:
	TSharedRef<IWallet> Wallet;
	TSharedRef<IInventory> Inventory;
	TSharedRef<IAnalytics> Analytics;
};
```

:::

The **composition root** is the one place that knows the concrete types. It builds the services, hands them to scene objects, and gives a factory to whatever spawns objects at runtime, so spawned objects never look anything up:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class ShopView : MonoBehaviour
{
    [SerializeField] UnityEngine.UI.Button buySwordButton;
    Shop shop;

    public void Construct(Shop shop) => this.shop = shop;   // method injection, called by the root

    void Start() => buySwordButton.onClick.AddListener(() => shop.Buy("sword", 100));
}

public class EnemyFactory
{
    readonly IWallet wallet;
    readonly IAnalytics analytics;

    public EnemyFactory(IWallet wallet, IAnalytics analytics) { this.wallet = wallet; this.analytics = analytics; }

    public Enemy Create(Enemy prefab, Vector3 position)
    {
        var enemy = Object.Instantiate(prefab, position, Quaternion.identity);
        enemy.Construct(wallet, analytics);   // gold reward on death, kill tracking
        return enemy;
    }
}

public class GameInstaller : MonoBehaviour
{
    [SerializeField] ShopView shopView;           // scene objects, assigned in the inspector
    [SerializeField] EnemySpawner enemySpawner;

    void Awake()
    {
        // Create services once.
        IAnalytics analytics = Application.isEditor ? new LogAnalytics() : new RemoteAnalytics();
        var wallet = new Wallet(startingGold: 250);
        var inventory = new Inventory();

        // Wire objects.
        shopView.Construct(new Shop(wallet, inventory, analytics));
        enemySpawner.Construct(new EnemyFactory(wallet, analytics));
    }
}
```

```gdscript [Godot (GDScript)]
# game_installer.gd: the composition root, at the top of the level scene.
extends Node

@export var shop_view: ShopView          # scene nodes, assigned in the inspector
@export var enemy_spawner: EnemySpawner


func _ready() -> void:
	# Create services once.
	var analytics = LogAnalytics.new() if OS.has_feature("editor") else RemoteAnalytics.new()
	var wallet := Wallet.new(250)
	var inventory := Inventory.new()

	# Wire objects.
	shop_view.construct(Shop.new(wallet, inventory, analytics))
	enemy_spawner.construct(EnemyFactory.new(wallet, analytics))


# shop_view.gd
class_name ShopView
extends Control

@export var buy_sword_button: Button
var _shop: Shop


func construct(shop: Shop) -> void:  # method injection, called by the root
	_shop = shop


func _ready() -> void:
	buy_sword_button.pressed.connect(func(): _shop.buy("sword", 100))


# enemy_factory.gd
class_name EnemyFactory
extends RefCounted

var _wallet
var _analytics


func _init(wallet, analytics) -> void:
	_wallet = wallet
	_analytics = analytics


func create(scene: PackedScene, parent: Node, position: Vector3) -> Enemy:
	var enemy: Enemy = scene.instantiate()
	enemy.construct(_wallet, _analytics)  # before add_child, so _ready already has its dependencies
	parent.add_child(enemy)
	enemy.global_position = position
	return enemy
```

```cpp [Unreal (C++)]
// ShopGameMode.cpp: the composition root. A GameMode (or GameInstance) builds services once.
void AShopGameMode::BeginPlay()
{
	Super::BeginPlay();

	// Create services once.
	TSharedRef<IAnalytics> Analytics = GIsEditor
		? StaticCastSharedRef<IAnalytics>(MakeShared<FLogAnalytics>())
		: StaticCastSharedRef<IAnalytics>(MakeShared<FRemoteAnalytics>());
	TSharedRef<FWallet> Wallet = MakeShared<FWallet>(/*StartingGold*/ 250);
	TSharedRef<FInventory> Inventory = MakeShared<FInventory>();

	// Wire objects: the shop widget gets its logic object instead of finding it.
	ShopWidget = CreateWidget<UShopWidget>(GetWorld(), ShopWidgetClass);
	ShopWidget->Init(MakeShared<FShop>(Wallet, Inventory, Analytics));
	ShopWidget->AddToViewport();

	EnemyFactory = MakeShared<FEnemyFactory>(GetWorld(), Wallet, Analytics);
}

// EnemyFactory.cpp: SpawnActorDeferred lets you inject before BeginPlay runs.
AEnemy* FEnemyFactory::Create(TSubclassOf<AEnemy> Class, const FTransform& Where)
{
	AEnemy* Enemy = World->SpawnActorDeferred<AEnemy>(Class, Where);
	Enemy->Init(Wallet, Analytics);   // gold reward on death, kill tracking
	Enemy->FinishSpawning(Where);     // BeginPlay runs now, with its dependencies in place
	return Enemy;
}
```

:::

And a test, with fakes and no scene:

::: code-group

```csharp [Unity (C#)]
using NUnit.Framework;

public class ShopTests
{
    [Test]
    public void Buy_FailsWithoutEnoughGold()
    {
        var shop = new Shop(new Wallet(startingGold: 50), new Inventory(), new NullAnalytics());
        Assert.IsFalse(shop.Buy("sword", 100));
    }
}
```

```gdscript [Godot (GDScript)]
# test_shop.gd: a GUT test (the Godot Unit Test add-on). GdUnit4 tests look much the same.
extends GutTest


func test_buy_fails_without_enough_gold() -> void:
	var shop := Shop.new(Wallet.new(50), Inventory.new(), NullAnalytics.new())
	assert_false(shop.buy("sword", 100))
```

```cpp [Unreal (C++)]
// ShopTests.cpp: an automation test (Session Frontend → Automation, or the command line).
#include "Misc/AutomationTest.h"
#include "Shop.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FShopFailsWithoutGoldTest, "Game.Shop.FailsWithoutEnoughGold",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FShopFailsWithoutGoldTest::RunTest(const FString& Parameters)
{
	FShop Shop(MakeShared<FWallet>(50), MakeShared<FInventory>(), MakeShared<FNullAnalytics>());
	TestFalse(TEXT("Buying a 100-gold sword with 50 gold"), Shop.Buy("Sword", 100));
	return true;
}
```

:::

**Engine notes**

- **Unity:** in larger projects, a DI container such as **VContainer** or **Zenject/Extenject** automates the wiring: you register types, and it builds the graph and injects into scene objects and prefabs.
- **Godot:** inject *before* `add_child`, as the factory does, so `_ready` already has its dependencies. Exported node references in the inspector are dependency injection done by the editor.
- **Unreal:** `SpawnActorDeferred` + `FinishSpawning` is the idiomatic way to inject into actors. `UPROPERTY` references set in the editor and **subsystems** cover most other wiring.

## When to use

- Logic you want to unit test.
- Services with more than one implementation: platform-specific saves, offline versus online analytics, fakes in tests.
- Teams and long-lived projects, where explicit dependencies keep the code understandable.

## When not to use

- Prototypes, game jams and small projects. Editor-assigned references and component lookups are dependency injection already, done by the editor.
- Adopting a DI framework (Zenject, VContainer) on a team that doesn't know it. Plain constructor injection gives most of the benefit with no framework to learn.
- Wiring scene objects that designers set up. Editor-assigned references are clearer to them than a container's bindings.

## Pitfalls

- **Wiring sprawl.** Hand-written composition roots grow with the project. Split them per scene or feature, or adopt a container.
- **Containers hide the graph.** Container "magic" can make it as hard to see what depends on what as singletons did. Keep registrations in one obvious place.
- **Using objects before injection.** Engine startup callbacks can run *before* `Construct` is called: Unity runs `Awake` inside `Instantiate`, and Unreal runs `BeginPlay` inside `SpawnActor` (use `SpawnActorDeferred` to inject first). Godot runs `_ready` only when the node enters the tree, so call `construct` before `add_child`. Do dependency-related setup in `Construct` or a later callback.
- **Injecting everything.** Value objects, math helpers and data do not need injection. Inject *services*, meaning things with behaviour you might want to replace.
- **Too many parameters.** A constructor with eight dependencies usually means the class does too much. Split it.

## Related

- [Service Locator](./service-locator) — dependencies are looked up instead of passed in. Simpler, but hidden.
- [Singleton](./singleton) — what DI typically replaces.
- [Factory](./factory) — creates runtime objects with their dependencies.
- [Bootstrapper](./bootstrapper) — the scene or entry point that hosts the composition root.
