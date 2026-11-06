# ScriptableObject Architecture

> Use Unity assets as shared variables, events and configuration between scenes.

**Category:** Architecture & Structure

## Problem

The health bar needs the player's health, the low-health vignette needs it too, and the music should change when it drops. The player lives in the gameplay scene, while the HUD is in a separate UI scene. Every option has a cost. A `Player.Instance` singleton couples all three to the player class. Passing references across scenes needs bootstrap code. `FindObjectOfType` is slow and fragile. And designers cannot hook up a new reaction without a programmer.

## Solution

Use **ScriptableObject assets** as the shared meeting point. An asset exists outside any scene, so any scene object can reference it in the inspector. Three building blocks cover most uses:

| Building block | What it is | Replaces |
| --- | --- | --- |
| **Variable** | An asset holding one runtime value (`FloatVariable PlayerHealth`) | Singletons for shared state |
| **Event channel** | An asset that objects raise and listen to (`VoidEventChannel OnPlayerDied`) | Direct references for notifications |
| **Runtime set** | An asset holding the list of currently active objects of a kind (`EnemySet`) | `FindObjectsOfType`, manager registries |

The player *writes* `PlayerHealth`, and the HUD *reads* it. Neither references the other, and the connection is made by dragging the same asset into both inspectors. Scenes can load and unload independently, and designers can wire new reactions themselves.

## Example (Unity C#)

### A variable with a separate runtime value

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(menuName = "Variables/Float")]
public class FloatVariable : ScriptableObject
{
    [SerializeField] float initialValue;          // edited by designers, never changed at runtime
    [NonSerialized] float runtimeValue;           // NonSerialized: never written back into the asset

    public event Action<float> Changed;

    public float Value
    {
        get => runtimeValue;
        set
        {
            if (Mathf.Approximately(runtimeValue, value)) return;
            runtimeValue = value;
            Changed?.Invoke(runtimeValue);
        }
    }

    // Reset on load and on entering play mode, so values never leak between sessions.
    void OnEnable() => runtimeValue = initialValue;
}
```

### An event channel

```csharp
[CreateAssetMenu(menuName = "Events/Void Event Channel")]
public class VoidEventChannel : ScriptableObject
{
    event Action raised;

    public void Raise() => raised?.Invoke();
    public void Subscribe(Action handler) => raised += handler;
    public void Unsubscribe(Action handler) => raised -= handler;
}

// A designer-friendly listener: react to a channel with UnityEvents set up in the inspector.
public class VoidEventListener : MonoBehaviour
{
    [SerializeField] VoidEventChannel channel;
    [SerializeField] UnityEngine.Events.UnityEvent response;

    void OnEnable()  => channel.Subscribe(response.Invoke);
    void OnDisable() => channel.Unsubscribe(response.Invoke);
}
```

`response.Invoke` creates a new delegate each time, but delegates compare by target and method, so `Unsubscribe` still removes the right one.

### A runtime set

```csharp
public abstract class RuntimeSet<T> : ScriptableObject
{
    [NonSerialized] readonly List<T> items = new();
    public IReadOnlyList<T> Items => items;

    public void Add(T item) { if (!items.Contains(item)) items.Add(item); }
    public void Remove(T item) => items.Remove(item);

    void OnDisable() => items.Clear();
}

[CreateAssetMenu(menuName = "Sets/Enemy Set")]
public class EnemySet : RuntimeSet<Enemy> { }

public class Enemy : MonoBehaviour
{
    [SerializeField] EnemySet activeEnemies;
    void OnEnable()  => activeEnemies.Add(this);
    void OnDisable() => activeEnemies.Remove(this);
}
```

### Wiring: no component references another

```csharp
public class PlayerHealth : MonoBehaviour
{
    [SerializeField] FloatVariable health;          // same asset as the HUD's
    [SerializeField] VoidEventChannel onPlayerDied;

    public void TakeDamage(float amount)
    {
        health.Value = Mathf.Max(0f, health.Value - amount);
        if (health.Value <= 0f) onPlayerDied.Raise();
    }
}

public class HealthBar : MonoBehaviour              // lives in a different scene
{
    [SerializeField] FloatVariable health;
    [SerializeField] float max = 100f;
    [SerializeField] UnityEngine.UI.Image fill;

    void OnEnable()  { health.Changed += Refresh; Refresh(health.Value); }
    void OnDisable() => health.Changed -= Refresh;

    void Refresh(float value) => fill.fillAmount = value / max;
}
```

## When to use

- Sharing state and events across scenes and prefabs without singletons.
- Teams where designers wire behaviour in the editor.
- Configuration data: game settings, difficulty curves, item and enemy definitions. This is the [Flyweight](./flyweight) use of ScriptableObjects, and the least controversial one.

## Pitfalls

- **Runtime changes persisting in the editor.** Changing a *serialised* field of a ScriptableObject in play mode changes the asset, and it stays changed after you stop. Keep runtime values `[NonSerialized]` and reset them in `OnEnable`, as above.
- **Assets unloaded in builds.** If nothing references a ScriptableObject for a while, such as during a scene transition, Unity may unload it, and its runtime value resets on reload. Keep a reference alive from a persistent object, or do not use variables for state that must survive scene loads.
- **Invisible wiring.** Connections live in inspector fields across many scenes and prefabs, and "who changes PlayerHealth?" has no code search answer. Name assets clearly and organise them in folders. "Find References in Scene" helps.
- **Asset sprawl.** Hundreds of tiny variable and event assets become hard to navigate. Use them for genuinely shared things, not for every value.
- **One shared instance.** An asset is global. Two players in co-op cannot share `PlayerHealth`. Per-instance state belongs on the instance.

## Related

- [Singleton](./singleton) — the problem this pattern most often replaces.
- [Event Bus](./event-bus) — the same decoupling, keyed by type in code rather than by asset in the inspector.
- [Observer](./observer) — variables and channels are observable subjects.
- [Flyweight](./flyweight) — ScriptableObjects as shared, read-only definitions.
