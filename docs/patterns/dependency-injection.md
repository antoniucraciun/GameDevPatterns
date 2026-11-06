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
| **Method injection** | A `Construct(...)` / `Init(...)` method called right after creation | MonoBehaviours, which Unity creates, so you cannot use their constructors |
| **Inspector injection** | `[SerializeField]` references assigned in the editor | Scene-local wiring. This is DI too, done by hand. |

Dependencies are usually **interfaces** (`ISaveService`), so the composition root decides which implementation each object gets. Tests pass in fakes.

## Example (Unity C#)

Plain C# logic with constructor injection, with no Unity dependency, so it can be unit tested:

```csharp
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

A MonoBehaviour view with method injection:

```csharp
public class ShopView : MonoBehaviour
{
    [SerializeField] UnityEngine.UI.Button buySwordButton;
    Shop shop;

    public void Construct(Shop shop) => this.shop = shop;   // called by the composition root

    void Start() => buySwordButton.onClick.AddListener(() => shop.Buy("sword", 100));
}
```

The composition root, the one place that knows the concrete types:

```csharp
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

Objects created at runtime get their dependencies from a **factory** that the root built. The factory holds the dependencies and passes them on, so spawned enemies never look anything up:

```csharp
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
```

And a test, with fakes and no scene:

```csharp
[NUnit.Framework.Test]
public void Buy_FailsWithoutEnoughGold()
{
    var shop = new Shop(new Wallet(startingGold: 50), new Inventory(), new NullAnalytics());
    NUnit.Framework.Assert.IsFalse(shop.Buy("sword", 100));
}
```

In larger projects, a DI container such as **VContainer** or **Zenject/Extenject** automates the wiring: you register types, and it builds the graph and injects into scene objects and prefabs.

## When to use

- Logic you want to unit test.
- Services with more than one implementation: platform-specific saves, offline versus online analytics, fakes in tests.
- Teams and long-lived projects, where explicit dependencies keep the code understandable.

## Pitfalls

- **Wiring sprawl.** Hand-written composition roots grow with the project. Split them per scene or feature, or adopt a container.
- **Containers hide the graph.** Container "magic" can make it as hard to see what depends on what as singletons did. Keep registrations in one obvious place.
- **Using objects before injection.** A MonoBehaviour's `Awake` runs *before* `Construct` is called. Do dependency-related setup in `Construct` or `Start`, never in `Awake`.
- **Injecting everything.** Value objects, math helpers and data do not need injection. Inject *services*, meaning things with behaviour you might want to replace.
- **Too many parameters.** A constructor with eight dependencies usually means the class does too much. Split it.

## Related

- [Service Locator](./service-locator) — dependencies are looked up instead of passed in. Simpler, but hidden.
- [Singleton](./singleton) — what DI typically replaces.
- Factory — creates runtime objects with their dependencies.
- Bootstrapper — the scene or entry point that hosts the composition root.
