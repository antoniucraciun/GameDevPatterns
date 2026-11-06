# Singleton

> Ensure a class has one instance with global access — and know why that is risky.

**Category:** Architecture & Structure

## Problem

Some things really exist once: the audio mixer, the save system, the platform's achievements API. Code all over the game needs them. Dragging a reference through every prefab and constructor is tedious, so you want a way to say "give me *the* audio manager" from anywhere, and to be sure there are never two.

## Solution

The class controls its own instantiation and exposes the single instance through a static property. That gives two guarantees: **one instance**, and **global access**.

Global access is what makes singletons convenient, and also what makes them hurt. Any code can reach the instance, so any code can depend on it and change it. Dependencies become invisible, the order of initialisation becomes implicit, and tests cannot substitute a fake. A good rule of thumb:

| Usually fine | Usually a problem |
| --- | --- |
| Stateless or read-mostly services: logging, platform APIs, a config lookup | Gameplay state: the player, the current level, the score |
| Something that genuinely cannot exist twice (wrapping a native SDK) | Something that is "one for now", such as a single player before co-op arrives |
| Small projects and jams, where speed matters more than structure | Code that needs unit tests or alternative implementations |

## Example (Unity C#)

A plain C# singleton, for services that do not need to be in the scene:

```csharp
public sealed class SaveService
{
    static SaveService instance;
    public static SaveService Instance => instance ??= new SaveService();

    SaveService() { }   // private: nobody else can create one

    public void Save(string slot, string json) =>
        System.IO.File.WriteAllText(System.IO.Path.Combine(UnityEngine.Application.persistentDataPath, slot), json);

    // With "Enter Play Mode Options" (no Domain Reload), statics survive between play sessions.
    [UnityEngine.RuntimeInitializeOnLoadMethod(UnityEngine.RuntimeInitializeLoadType.SubsystemRegistration)]
    static void ResetStatics() => instance = null;
}
```

A MonoBehaviour singleton, for services that need the engine (audio sources, coroutines, inspector settings):

```csharp
public class AudioManager : MonoBehaviour
{
    public static AudioManager Instance { get; private set; }

    [SerializeField] AudioSource musicSource;

    void Awake()
    {
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);           // a second copy, e.g. from reloading the start scene
            return;
        }
        Instance = this;
        DontDestroyOnLoad(gameObject);     // survives scene changes
    }

    void OnDestroy()
    {
        if (Instance == this) Instance = null;
    }

    public void PlayMusic(AudioClip clip)
    {
        musicSource.clip = clip;
        musicSource.Play();
    }
}

// Anywhere:
AudioManager.Instance.PlayMusic(bossTheme);
```

A safer middle ground: keep the single instance, but hide the concrete class behind an interface and register it in a [Service Locator](./service-locator), or hand it to classes through [Dependency Injection](./dependency-injection). You keep "exactly one", and lose most of the coupling.

## When to use

- Truly unique, application-lifetime services with little mutable state.
- Prototypes and small games, as long as you know what you are trading away.

## When not to use

- Anything with gameplay state that changes per level or per match: the player, the current level, the score. Pass it in, or use [Scene Management](./scene-management) to own it.
- Code you want to unit test, or services with more than one implementation. Use [Dependency Injection](./dependency-injection) or a [Service Locator](./service-locator).
- As the default way to share things. Most "managers" only need to exist once because only one is created, not because a second would be an error.

## Pitfalls

- **Hidden dependencies.** A class that calls `AudioManager.Instance` deep inside a method depends on it, but nothing in its constructor or inspector says so.
- **Initialisation order.** `Instance` is null if read before the singleton's `Awake` runs, such as from another object's `Awake`. Script Execution Order settings are a fragile fix. A bootstrap scene that creates services first is a robust one.
- **Disabled Domain Reload.** Static fields keep values from the previous play session and point at destroyed objects. Reset them with `RuntimeInitializeOnLoadMethod`.
- **Duplicates across scenes.** Every scene that contains the prefab creates one. Guard in `Awake`, as above, or create it from code only.
- **Testing.** You cannot substitute a fake `SaveService` in a unit test without changing the singleton itself.
- **Lazy creation of a MonoBehaviour** (`new GameObject().AddComponent<T>()` inside the getter) can silently create a new instance while the application is quitting, which leaks objects in the editor. Prefer explicit creation.

## Related

- [Service Locator](./service-locator) — global access to an interface instead of a concrete class.
- [Dependency Injection](./dependency-injection) — no global access at all. Dependencies are passed in.
- [ScriptableObject Architecture](./scriptable-object-architecture) — shared assets as an alternative to manager singletons.
- [Bootstrapper](./bootstrapper) — creates services in a known order.
