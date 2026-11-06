# Bootstrapper

> One entry point initialises core services in a known order before gameplay starts.

**Also known as:** Composition Root, Init Scene · **Category:** Architecture & Structure

## Problem

Services initialise themselves in their own `Awake` methods: the audio manager, the save system, analytics, input, the platform SDK. Their order depends on Unity's script execution order, so it differs between scenes and between editor and build. The save system reads settings before they are loaded. Analytics fires before the SDK is ready. Pressing Play in the level scene skips the menu scene that normally creates the managers, so half the game throws `NullReferenceException`. Developers end up always starting from scene 0, which slows down iteration.

## Solution

Have **one place** that runs first and initialises everything the game needs, in an explicit order, before any gameplay code runs.

- **Run first, from any scene.** `[RuntimeInitializeOnLoadMethod(BeforeSceneLoad)]` runs before the first scene loads, whichever scene you press Play in. Alternatively, keep a dedicated *Boot* scene at build index 0, plus an editor hook that loads it first.
- **Ordered, possibly asynchronous steps.** Load settings, then the platform SDK, then sign in, then analytics, then the save data. Each step can await, for example on a network call, and the order is written down in code.
- **Persistent services.** Create services under one `DontDestroyOnLoad` root, or in a persistent scene, and register them with the [Service Locator](./service-locator) or DI container. This is the composition root from [Dependency Injection](./dependency-injection).
- **A "ready" signal.** Gameplay waits for the bootstrapper to finish, instead of each system checking whether its dependencies happen to exist.

## Example (Unity C#)

```csharp
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
```

Gameplay that needs services waits for boot:

```csharp
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

`Services` is the locator from [Service Locator](./service-locator). `PlatformStep`, `AnalyticsStep` and `LoadSaveStep` follow the same shape as `LoadSettingsStep`. `Awaitable.BackgroundThreadAsync` and `MainThreadAsync` are Unity 6 APIs.

## When to use

- Every project with more than a couple of global services.
- Games that call platform SDKs, online services or cloud saves, which must initialise in a specific order.
- Teams that want to press Play in any scene and have it just work.

## Pitfalls

- **Hidden dependencies on boot.** Code that reads services in `Awake` can run before boot finishes, because boot steps are asynchronous. Await `WaitUntilReady`, or start gameplay from the bootstrapper's `Ready` event.
- **Resources folder abuse.** One prefab in `Resources` is fine. Putting all content there bloats builds and startup. Use Addressables for content (see [Asset References & Addressing](./asset-reference)).
- **Domain reload disabled.** With *Enter Play Mode Options*, statics survive between sessions. Reset them (`IsReady`, event subscribers) in a `SubsystemRegistration` method, or boot can see stale state.
- **Boot doing too much.** Loading every asset at boot makes the first screen slow. Boot only what is needed globally, and let levels load their own content.
- **Failure handling.** If sign-in fails, should the game run offline, retry, or stop? Decide per step, and show the player something useful rather than hanging on a black screen.

## Related

- [Dependency Injection](./dependency-injection) — the bootstrapper is the composition root.
- [Service Locator](./service-locator) and [Singleton](./singleton) — how services become reachable after boot.
- [Game State Manager](./game-state-manager) — boot is its first state, and moves to the main menu when done.
- [Scene / Level Management](./scene-management) — what happens after boot.
- [Save System](./save-system) — usually one of the last boot steps.
