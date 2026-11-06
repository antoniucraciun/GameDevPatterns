# Event Bus

> A central channel where any system can publish or subscribe to typed events.

**Also known as:** Pub/Sub, Event Aggregator · **Category:** Behavioral & Communication

## Problem

[Observer](./observer) works when the listener can reach the subject: the health bar holds a reference to the player. Many reactions have no such link. The achievement system cares about *every* enemy death, but enemies are spawned and destroyed constantly, so subscribing to each one is tedious and leak-prone. The music system should react to "boss fight started", raised by a trigger in some scene it has never heard of. Wiring direct references between all of these couples systems that otherwise have nothing to do with each other.

## Solution

Put a **bus** in the middle. Publishers announce typed events to the bus, and subscribers register with the bus for event types they care about. Neither side knows the other exists, and neither needs a reference to the other. They only share the **event type**, a small data struct that describes what happened.

```
Enemy ─Publish(EnemyKilled)─►┐                 ┌─► AchievementSystem
Boss trigger ─Publish(...)──►├── Event Bus ────┼─► MusicDirector
Player ─Publish(PlayerDied)─►┘                 └─► Analytics
```

Compared with Observer, the bus trades *explicitness* (who is connected to whom is no longer visible in the code) for *decoupling* (publishers and subscribers can come and go independently).

## Example (Unity C#)

A small, type-safe, allocation-free bus:

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

public interface IEvent { }

// Events are small immutable structs: "what happened", plus the data listeners need.
public readonly struct EnemyKilled : IEvent
{
    public readonly int EnemyTypeId;
    public readonly Vector3 Position;
    public EnemyKilled(int enemyTypeId, Vector3 position) { EnemyTypeId = enemyTypeId; Position = position; }
}

public readonly struct BossFightStarted : IEvent { public readonly string BossId; public BossFightStarted(string id) => BossId = id; }

public static class EventBus<T> where T : struct, IEvent
{
    // Copy-on-write: publishing iterates a snapshot, so handlers may (un)subscribe during Publish.
    static Action<T>[] handlers = Array.Empty<Action<T>>();

    static EventBus() => EventBusRegistry.Register(() => handlers = Array.Empty<Action<T>>());

    public static void Subscribe(Action<T> handler)
    {
        var copy = new Action<T>[handlers.Length + 1];
        handlers.CopyTo(copy, 0);
        copy[^1] = handler;
        handlers = copy;
    }

    public static void Unsubscribe(Action<T> handler)
    {
        int i = Array.IndexOf(handlers, handler);
        if (i < 0) return;
        var copy = new Action<T>[handlers.Length - 1];
        Array.Copy(handlers, 0, copy, 0, i);
        Array.Copy(handlers, i + 1, copy, i, handlers.Length - i - 1);
        handlers = copy;
    }

    public static void Publish(in T evt)
    {
        var snapshot = handlers;                     // no allocation per publish
        for (int i = 0; i < snapshot.Length; i++)
        {
            try { snapshot[i](evt); }
            catch (Exception e) { Debug.LogException(e); }   // one bad listener must not stop the others
        }
    }
}

// Clears every bus between play sessions when Domain Reload is disabled.
public static class EventBusRegistry
{
    static readonly List<Action> resets = new();
    public static void Register(Action reset) => resets.Add(reset);

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
    static void ResetAll() { foreach (var r in resets) r(); }
}
```

Publishing and subscribing:

```csharp
public class Enemy : MonoBehaviour
{
    [SerializeField] int typeId;

    public void Die()
    {
        EventBus<EnemyKilled>.Publish(new EnemyKilled(typeId, transform.position));
        Destroy(gameObject);
    }
}

public class AchievementSystem : MonoBehaviour
{
    int kills;

    void OnEnable()  => EventBus<EnemyKilled>.Subscribe(OnEnemyKilled);
    void OnDisable() => EventBus<EnemyKilled>.Unsubscribe(OnEnemyKilled);

    void OnEnemyKilled(EnemyKilled e)
    {
        if (++kills == 100) Unlock("centurion");
    }

    void Unlock(string id) { /* platform achievements */ }
}
```

`EventBus<T>` is one static class per event type, so dispatching is a direct array loop, with no dictionary lookup and no boxing.

## When to use

- Cross-cutting reactions between systems with no natural reference to each other: achievements, analytics, audio, tutorials, quest progress.
- Events raised by short-lived objects (enemies, projectiles, pickups) that long-lived systems care about.
- Decoupling features, so one can be removed without breaking the others.

## When not to use

- Systems that already have a natural reference to each other. A direct call or [Observer](./observer) is easier to trace.
- Request-response interactions ("give me the player's health"). The bus is for announcements, not queries.
- Small projects. A global bus hides the flow of control, and finding every listener of an event becomes a search.

## Pitfalls

- **Invisible control flow.** "What happens when an enemy dies?" now needs a search for `EventBus<EnemyKilled>`. Keep event types few and well named, and consider a debug window that lists subscribers.
- **Everything becomes an event.** Request/response ("give me the player's gold") does not belong on a bus. Use it for *notifications* of things that happened.
- **Forgotten unsubscriptions.** Static buses hold handlers forever, so destroyed objects keep receiving events and throw. Pair `Subscribe` and `Unsubscribe` in `OnEnable`/`OnDisable`.
- **Re-entrancy and ordering.** A handler that publishes another event runs it immediately, nested. Do not depend on the order of subscribers. If ordering matters, use an [Event Queue](./event-queue) and process events at a defined point in the frame.
- **Global by nature.** A static bus is shared by everything, including tests. Reset it between tests, or inject an instance-based bus with [Dependency Injection](./dependency-injection).

## Related

- [Observer](./observer) — direct subscription to a known subject. Prefer it when the reference is natural.
- [Event Queue](./event-queue) — deferred delivery. Events are processed later, at a defined point in the frame.
- [ScriptableObject Architecture](./scriptable-object-architecture) — event channels as assets, wired in the inspector instead of by type.
- [Mediator](./mediator) — a central object that coordinates participants, rather than just relaying messages.
