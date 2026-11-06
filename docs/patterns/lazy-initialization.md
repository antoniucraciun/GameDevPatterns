# Lazy Initialization

> Create expensive resources on first use instead of up front.

**Category:** Performance & Memory

## Problem

At startup, the game builds every object pool, loads every sound bank, precomputes every lookup table and creates every UI screen, including the credits screen most players never open. Startup takes 12 seconds, and memory is full of things this session will never use. Yet some of it is needed eventually, and creating it at an unpredictable moment mid-game causes a hitch.

## Solution

Defer creating something **until it is first needed**, then keep it:

```
Thing Instance => instance ??= CreateThing();
```

Lazy initialisation trades **startup time and memory** for a **one-time cost at first use**. That trade-off is the whole pattern. Use it deliberately, with three variations:

| Variation | When it is created | Use for |
| --- | --- | --- |
| **Pure lazy** | On first access | Rarely used things: credits, debug tools, optional features |
| **Lazy with warm-up** | On first access, *or* earlier during a loading screen | Things that would hitch if created mid-gameplay: pools, shaders, effects |
| **Lazy per context** | First access within a level, released with the level | Level-specific content |

For thread safety, .NET's `Lazy<T>` guarantees the factory runs once even with concurrent access. On Unity's main thread, a null-coalescing field is enough.

## Example (Unity C#)

The basic form, plus a warm-up hook so the cost can be moved to a loading screen:

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

public class EffectLibrary : MonoBehaviour
{
    [SerializeField] ParticleSystem[] prefabs;

    Dictionary<string, ParticleSystem> byName;        // built on first use, not in Awake

    Dictionary<string, ParticleSystem> ByName => byName ??= BuildIndex();

    Dictionary<string, ParticleSystem> BuildIndex()
    {
        var d = new Dictionary<string, ParticleSystem>(prefabs.Length);
        foreach (var p in prefabs) d[p.name] = p;
        return d;
    }

    public ParticleSystem Get(string name) => ByName.TryGetValue(name, out var p) ? p : null;
}

// A lazily created pool per effect type, with optional warm-up.
public class LazyPools
{
    readonly Dictionary<GameObject, UnityEngine.Pool.ObjectPool<GameObject>> pools = new();

    UnityEngine.Pool.ObjectPool<GameObject> PoolFor(GameObject prefab)
    {
        if (pools.TryGetValue(prefab, out var pool)) return pool;      // already created

        pool = new UnityEngine.Pool.ObjectPool<GameObject>(
            () => UnityEngine.Object.Instantiate(prefab),
            go => go.SetActive(true),
            go => go.SetActive(false),
            UnityEngine.Object.Destroy);
        pools[prefab] = pool;
        return pool;
    }

    public GameObject Get(GameObject prefab) => PoolFor(prefab).Get();
    public void Release(GameObject prefab, GameObject instance) => PoolFor(prefab).Release(instance);

    // Call during loading for effects this level is known to use: the first explosion won't hitch.
    public void WarmUp(GameObject prefab, int count)
    {
        var pool = PoolFor(prefab);
        var temp = new List<GameObject>(count);
        for (int i = 0; i < count; i++) temp.Add(pool.Get());
        foreach (var go in temp) pool.Release(go);
    }
}
```

Thread-safe, with `Lazy<T>`, for data that worker threads may also request:

```csharp
public static class TerrainTables
{
    // The factory runs exactly once, even if several threads ask at the same time.
    static readonly Lazy<float[]> erosionTable = new(() =>
    {
        var t = new float[4096];
        for (int i = 0; i < t.Length; i++) t[i] = Mathf.Pow(i / 4095f, 2.2f);
        return t;
    });

    public static float[] Erosion => erosionTable.Value;
}
```

## When to use

- Resources that are expensive and may not be needed this session: optional screens, rarely visited areas, debug tools, large tables.
- Shortening startup time, by moving creation from boot to first use.
- Combined with warm-up for things that are needed, but whose first-use cost must not hit gameplay.

## Pitfalls

- **Hitch at the worst moment.** The first explosion of the game also creates the explosion pool, loads its textures and compiles its shader, freezing the frame the player cares about most. Warm up things that are likely needed during loading, and keep pure laziness for things that are truly optional.
- **Hidden cost in a getter.** A property that looks cheap (`Library.Effects`) but sometimes takes 200 ms surprises callers. Name it clearly, or expose an explicit `EnsureLoaded()`.
- **Unity objects and `??=`.** `??=` uses C# null, not Unity's "destroyed" check. A destroyed `GameObject` is not null to `??=`, so the cache keeps a dead object. Use `if (cached == null) cached = Create();` for `UnityEngine.Object` fields.
- **Initialisation order bugs.** Lazy creation can hide dependency problems until an unusual code path runs first. Keep factories free of dependencies on other lazy objects, or document them.
- **Static lazies and Domain Reload.** Static lazy fields survive between play sessions when Domain Reload is disabled, and may hold stale references. Reset them on play mode entry.

## Related

- [Object Pool](./object-pool) — pools are often created lazily, then warmed up.
- [Asset References & Addressing](./asset-reference) — load content when needed rather than at startup.
- [Bootstrapper](./bootstrapper) — decides what is created eagerly at startup.
- [Memoization / Caching](./memoization) and [Dirty Flag](./dirty-flag) — also compute on demand and keep the result.
- [Singleton](./singleton) — lazy creation of the single instance is common, with the same pitfalls.
