# Service Locator

> Provide a global access point to a service without coupling callers to its concrete type.

**Category:** Architecture & Structure

## Problem

Audio, analytics, save data and input are needed from all over the codebase. Passing them through every constructor is tedious. Making each one a singleton ties every caller to one concrete class, so you cannot swap in a silent audio service for tests or a different analytics backend per platform.

## Solution

Callers depend on an **interface** (`IAudioService`). A central **locator** maps interfaces to the instances currently providing them. A bootstrap step registers the real implementations at startup. Callers ask the locator for the interface and never learn which implementation they received. A **null object** can be registered as a safe default so missing services do not crash.

## Example (Unity C#)

```csharp
public static class Services
{
    static readonly Dictionary<System.Type, object> map = new();

    public static void Register<T>(T service) where T : class => map[typeof(T)] = service;

    public static T Get<T>() where T : class =>
        map.TryGetValue(typeof(T), out var s)
            ? (T)s
            : throw new System.InvalidOperationException($"Service {typeof(T).Name} not registered");

    // Clear between play sessions when Domain Reload is disabled.
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
    static void Reset() => map.Clear();
}

public interface IAudioService { void Play(string clipId, Vector3 at); }

public class NullAudio : IAudioService { public void Play(string clipId, Vector3 at) { } }

public class Bootstrap : MonoBehaviour
{
    [SerializeField] AudioService audio;   // a MonoBehaviour implementing IAudioService

    void Awake()
    {
        Services.Register<IAudioService>(Application.isBatchMode ? new NullAudio() : audio);
    }
}

// Anywhere:
Services.Get<IAudioService>().Play("explosion", transform.position);
```

## When to use

- A small number of truly cross-cutting services: audio, logging, analytics, platform APIs.
- When you need to swap implementations per platform, per test or at runtime.

## Pitfalls

- **Hidden dependencies.** A class's needs are no longer visible in its constructor. Keep lookups at the edges (in `Awake`) and cache them, rather than calling `Get` throughout the logic.
- **Order of registration.** Something may ask for a service before it is registered. Use a bootstrap scene, or fall back to a null object.
- **It is still global state.** If most of your code needs the locator, Dependency Injection is usually the better tool.

## Related

- Singleton — the simpler, more tightly coupled alternative.
- Dependency Injection — makes dependencies explicit instead of looked up.
- [Component](./component) — services are often provided by components on a persistent object.
