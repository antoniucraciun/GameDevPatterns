# Scene / Level Management

> Load, unload and transition between levels, including additive and streamed scenes.

**Category:** Architecture & Structure

## Problem

Each level is one scene that contains everything: the player, the HUD, the camera rig, the audio manager and the level geometry. Loading level 2 with `SceneManager.LoadScene` destroys all of it and recreates it, so music restarts, the HUD flashes, managers are duplicated or lost, and the game freezes for two seconds with no loading screen. Two designers cannot edit the same level because it is one huge scene file. Open-world areas are too big to load at once.

## Solution

Split the game into **scenes with distinct lifetimes**, and load them **additively** and **asynchronously**:

| Scene | Lifetime | Contains |
| --- | --- | --- |
| **Core / Persistent** | Whole session | Services, audio, camera rig, player (if it persists), event system |
| **UI** | Whole session, or per mode | HUD, menus, loading screen |
| **Level** | Per level | Geometry, lighting, enemies, level logic |
| **Level sub-scenes** | Streamed in and out | Areas of an open world, interiors, or *Art* / *Gameplay* / *Audio* layers for parallel editing |

A **scene loader** owns all loading:

- **Load additively, asynchronously:** `LoadSceneAsync(name, LoadSceneMode.Additive)`, with a loading screen and progress.
- **Unload the previous level**, then free memory with `Resources.UnloadUnusedAssets`.
- **Set the active scene** to the level, so lighting settings and newly instantiated objects belong to it.
- **Hold activation** (`allowSceneActivation = false`) until the loading screen has faded in and other work has finished, so the swap happens off-screen.

## Example (Unity C#)

```csharp
using System;
using UnityEngine;
using UnityEngine.SceneManagement;

public class SceneLoader : MonoBehaviour      // lives in the Core scene
{
    [SerializeField] CanvasGroup loadingScreen;
    [SerializeField] UnityEngine.UI.Image progressBar;

    public string CurrentLevel { get; private set; }
    public bool IsLoading { get; private set; }
    public event Action<string> LevelLoaded;

    public async Awaitable LoadLevel(string level)
    {
        if (IsLoading) return;
        IsLoading = true;
        try
        {
            await Fade(1f);                                        // cover the screen first

            if (!string.IsNullOrEmpty(CurrentLevel))
            {
                await SceneManager.UnloadSceneAsync(CurrentLevel);
                await Resources.UnloadUnusedAssets();              // free textures and meshes from the old level
            }

            var op = SceneManager.LoadSceneAsync(level, LoadSceneMode.Additive);
            op.allowSceneActivation = false;                       // load fully, but don't activate yet
            while (op.progress < 0.9f)                             // 0.9 = loaded, waiting for activation
            {
                progressBar.fillAmount = op.progress / 0.9f;
                await Awaitable.NextFrameAsync();
            }
            progressBar.fillAmount = 1f;
            op.allowSceneActivation = true;
            await op;

            SceneManager.SetActiveScene(SceneManager.GetSceneByName(level));   // lighting + Instantiate target
            CurrentLevel = level;
            LevelLoaded?.Invoke(level);

            await Fade(0f);
        }
        finally { IsLoading = false; }
    }

    async Awaitable Fade(float target)
    {
        loadingScreen.blocksRaycasts = true;
        while (!Mathf.Approximately(loadingScreen.alpha, target))
        {
            loadingScreen.alpha = Mathf.MoveTowards(loadingScreen.alpha, target, Time.unscaledDeltaTime * 3f);
            await Awaitable.NextFrameAsync();
        }
        loadingScreen.blocksRaycasts = target > 0f;
    }
}
```

Streaming areas of a larger world by distance, with hysteresis so areas at the boundary do not load and unload repeatedly:

```csharp
public class StreamingVolume : MonoBehaviour
{
    [SerializeField] string sceneName;
    [SerializeField] float loadDistance = 80f, unloadDistance = 110f;
    [SerializeField] Transform player;

    bool loaded, busy;

    async void Update()
    {
        if (busy) return;
        float d = Vector3.Distance(player.position, transform.position);

        if (!loaded && d < loadDistance)
        {
            busy = true;
            await SceneManager.LoadSceneAsync(sceneName, LoadSceneMode.Additive);
            loaded = true; busy = false;
        }
        else if (loaded && d > unloadDistance)
        {
            busy = true;
            await SceneManager.UnloadSceneAsync(sceneName);
            loaded = false; busy = false;
        }
    }
}
```

Scene names as strings are fragile, because renaming a scene breaks them silently. Use a small serialisable scene-reference type that stores the asset in the editor and the name at build time, or load scenes through **Addressables**, which also handles content downloaded after install.

## When to use

- Every game with more than one level, or with persistent systems that must survive level changes.
- Large worlds that cannot fit in memory at once.
- Teams where several people edit the same level, split into layer scenes.

## Pitfalls

- **Cross-scene references.** An object in the level cannot hold an inspector reference to an object in the Core scene. Use the [Service Locator](./service-locator), events, or [ScriptableObject Architecture](./scriptable-object-architecture) to connect scenes.
- **Wrong active scene.** `Instantiate` puts new objects in the active scene. If the Core scene is active, spawned enemies survive the level unload. Set the level as active after loading.
- **Duplicate persistent objects.** If levels also contain a camera, an EventSystem or an AudioListener "for testing", you get duplicates when they load additively. Keep them only in Core, and add an editor helper that loads Core when you play a level directly.
- **Memory not released.** Unloading a scene does not free assets that are still referenced, for example from a static list or a ScriptableObject. Call `Resources.UnloadUnusedAssets`, and check the Memory Profiler between levels.
- **Hitches on activation.** Activation runs `Awake` and `Start` for everything in the scene on one frame. Keep scene startup light, and spread heavy setup over frames.

## Related

- [Bootstrapper](./bootstrapper) — loads the Core scene and services before any level.
- [Game State Manager](./game-state-manager) — *Loading* and *Playing* states call the scene loader.
- [Save System](./save-system) — saves level state before unloading, and restores it after loading.
- [Spatial Partition](./spatial-partition) — streaming is spatial partitioning at the level of whole scenes.
- [Asset References & Addressing](./asset-reference) — loading scenes and assets by key.
