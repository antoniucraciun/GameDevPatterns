# Observer

> Let objects announce that something happened without knowing who is listening.

**Also known as:** Events, Signals · **Category:** Behavioral & Communication

## Problem

When the player dies, the HUD must update, a sound plays, the achievement system checks "die 100 times", analytics logs it and the music changes. If `Player.Die()` calls all of these directly, the player class depends on audio, UI, achievements and analytics. Adding one more reaction means editing the player again.

## Solution

The **subject** (the player) exposes an event. **Observers** subscribe to it. When something happens, the subject raises the event and every subscriber is notified. The subject knows nothing about who is listening. New reactions are added by subscribing, without touching the subject.

## Example (Unity C#)

C# events are the idiomatic implementation:

```csharp
public class Player : MonoBehaviour
{
    public event System.Action<Player> Died;
    public event System.Action<int, int> HealthChanged;  // (current, max)

    int health = 100;

    public void TakeDamage(int amount)
    {
        health = Mathf.Max(0, health - amount);
        HealthChanged?.Invoke(health, 100);
        if (health == 0) Died?.Invoke(this);
    }
}

public class HealthBar : MonoBehaviour
{
    [SerializeField] Player player;
    [SerializeField] UnityEngine.UI.Image fill;

    void OnEnable()  => player.HealthChanged += OnHealthChanged;
    void OnDisable() => player.HealthChanged -= OnHealthChanged;  // always unsubscribe

    void OnHealthChanged(int current, int max) => fill.fillAmount = (float)current / max;
}
```

Use `UnityEvent` when designers need to wire up responses in the Inspector, and plain C# events when the wiring lives in code. C# events are faster and cannot be broken by renaming a method.

## When to use

- One thing happens and several unrelated systems care: UI, audio, achievements, analytics.
- Lower-level systems that need to inform higher-level ones without depending on them.
- Replacing per-frame polling of state that rarely changes.

## Pitfalls

- **Forgetting to unsubscribe.** The subject keeps the observer alive (a memory leak), or calls into a destroyed object and throws `MissingReferenceException`. Pair `OnEnable` with `OnDisable`.
- **Hard-to-follow control flow.** "Who reacts to this?" requires a search. Keep event names explicit and the number of hops low.
- **Re-entrancy.** An observer that triggers the same event, or unsubscribes during notification, can cause surprises. Keep handlers small.
- **Order of observers is not guaranteed.** Do not rely on it.
- **Synchronous by default.** A slow handler stalls the caller. Use an [Event Queue](./event-queue) for deferred delivery.

## Related

- [Event Bus](./event-bus) — decouples through a central channel, when listeners have no reference to the subject.
- [Event Queue](./event-queue) — decouples in time: events are processed later.
- [Command](./command) — the counterpart: a request to do something, rather than a notice that something was done.
- [Component](./component) — components often talk to each other through events.
