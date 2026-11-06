# Factory

> Centralise object creation so callers ask for "an enemy" rather than constructing one.

**Category:** Architecture & Structure

## Problem

Creating an enemy properly takes more than `Instantiate(prefab)`. The prefab must be looked up, an instance taken from a pool, stats applied from its [type](./type-object), services injected, it must be registered with the AI director and the minimap, and it must be scaled for difficulty. The spawner, the boss's summon ability, the debug console and the tutorial each do this slightly differently, and each forgets a different step. Changing how enemies are created means finding every place that creates them.

## Solution

Put creation in **one object whose job is creating things**: a factory. Callers say *what* they want ("a goblin at this position"), and the factory decides *how*: which prefab, pooled or new, which dependencies, which registrations.

Common variations:

| Variation | Idea | Game example |
| --- | --- | --- |
| **Factory method** | A method that returns a new object, often chosen by a key or type | `EnemyFactory.Create("goblin", pos)` |
| **Registry factory** | A map from IDs to creation recipes, filled from data | Spawn anything by ID from a spreadsheet or the debug console |
| **Abstract factory** | An interface for creating *families* of related objects, with one implementation per family | `IUiFactory` with "fantasy" and "sci-fi" skins, or "console" and "mobile" layouts |

## Example (Unity C#)

A registry factory that combines [Type Object](./type-object), [Object Pool](./object-pool) and [Dependency Injection](./dependency-injection) behind one call:

```csharp
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Pool;

public interface IEnemyFactory
{
    Enemy Create(string typeId, Vector3 position);
    void Despawn(Enemy enemy);
}

public class EnemyFactory : IEnemyFactory
{
    readonly Dictionary<string, EnemyType> types = new();
    readonly Dictionary<EnemyType, ObjectPool<Enemy>> pools = new();
    readonly IAnalytics analytics;                   // dependencies the enemies need
    readonly DifficultySettings difficulty;
    readonly Transform parent;

    public EnemyFactory(IEnumerable<EnemyType> allTypes, IAnalytics analytics,
                        DifficultySettings difficulty, Transform parent)
    {
        foreach (var t in allTypes) types[t.name] = t;
        this.analytics = analytics; this.difficulty = difficulty; this.parent = parent;
    }

    public Enemy Create(string typeId, Vector3 position)
    {
        if (!types.TryGetValue(typeId, out var type))
        {
            Debug.LogError($"Unknown enemy type '{typeId}'");
            return null;
        }

        var enemy = PoolFor(type).Get();
        enemy.transform.SetPositionAndRotation(position, Quaternion.identity);
        enemy.Init(type, difficulty.HealthMultiplier);              // stats from data, scaled
        enemy.Construct(analytics);                                  // inject dependencies
        EnemyRegistry.Add(enemy);                                    // minimap, director, quests
        return enemy;
    }

    public void Despawn(Enemy enemy)
    {
        EnemyRegistry.Remove(enemy);
        PoolFor(enemy.Type).Release(enemy);
    }

    ObjectPool<Enemy> PoolFor(EnemyType type)
    {
        if (pools.TryGetValue(type, out var pool)) return pool;
        pool = new ObjectPool<Enemy>(
            () => Object.Instantiate(type.Prefab, parent).GetComponent<Enemy>(),
            e => e.gameObject.SetActive(true),
            e => e.gameObject.SetActive(false),
            e => Object.Destroy(e.gameObject));
        pools[type] = pool;
        return pool;
    }
}

// Every caller creates enemies the same way:
// factory.Create("goblin", spawnPoint.position);        // wave spawner
// factory.Create("skeleton", boss.transform.position);  // boss summon
// factory.Create(args[0], player.position + Vector3.forward * 3);   // debug console
```

An abstract factory for a family of related objects, chosen once at startup:

```csharp
public interface IUiFactory
{
    Button CreateButton(string label, Transform parent);
    Panel CreatePanel(Transform parent);
}

// MobileUiFactory makes large touch targets; DesktopUiFactory makes compact, hover-enabled ones.
// The bootstrapper registers the right one; menus never check the platform themselves.
```

Callers depend on `IEnemyFactory`, so tests can pass a fake factory that records what was created.

## When to use

- Creation involves more than `new` or `Instantiate`: pooling, data lookup, injection, registration.
- Many places create the same kinds of objects.
- Objects are chosen by ID from data, the network or the console.
- Families of objects must be swapped together (platforms, themes, difficulty sets).

## Pitfalls

- **Factories for trivial objects.** A factory that wraps a single `new Vector3(...)` is ceremony. Introduce one when creation has real steps.
- **God factories.** One factory that creates enemies, items, UI and effects grows huge. Use one factory per family of objects.
- **Destruction not going through the factory.** If creation registers and pools, destruction must unregister and release. Pair `Create` with `Despawn` in the same class, and make it the only way to remove objects.
- **Stringly-typed IDs.** A typo in `"gobiln"` fails at runtime. Validate IDs at load time, or prefer references to type assets in serialised data.

## Related

- [Type Object](./type-object) — what the factory reads to configure each object.
- [Object Pool](./object-pool) — where the factory gets instances from.
- [Dependency Injection](./dependency-injection) — the factory passes dependencies to runtime-created objects.
- [Prototype](./prototype) and [Builder](./builder) — other ways to create objects.
- [Spawner / Wave System](./spawner) — a typical caller.
