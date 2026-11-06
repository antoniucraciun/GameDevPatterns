# Component

> Build entities from small, independent pieces of behaviour instead of deep inheritance.

**Category:** Architecture & Structure

## Problem

Inheritance hierarchies for game objects collapse under real requirements. You start with `Enemy → FlyingEnemy` and `Enemy → ShootingEnemy`. Then design asks for a flying enemy that shoots, a turret that shoots but is not an enemy, and a destructible crate that has health but no AI. Every new combination forces you to duplicate code or bolt features onto a bloated base class.

## Solution

An entity becomes a thin container. Each capability (movement, health, shooting, rendering) is a separate **component** that does one job. You build a new kind of entity by choosing which components to attach. Components can find their siblings on the same entity when they need to cooperate. Prefer interfaces or events for that, so components do not depend on concrete sibling types.

## Example (Unity C#)

Unity's GameObject/MonoBehaviour model is this pattern. Keep each component focused:

```csharp
public class Health : MonoBehaviour
{
    [SerializeField] int max = 100;
    public int Current { get; private set; }
    public event System.Action Died;

    void Awake() => Current = max;

    public void TakeDamage(int amount)
    {
        if (Current <= 0) return;
        Current = Mathf.Max(0, Current - amount);
        if (Current == 0) Died?.Invoke();
    }
}

public class DropLootOnDeath : MonoBehaviour
{
    [SerializeField] GameObject lootPrefab;

    void Awake() => GetComponent<Health>().Died += () =>
        Instantiate(lootPrefab, transform.position, Quaternion.identity);
}

[RequireComponent(typeof(Health))]
public class DestroyOnDeath : MonoBehaviour
{
    void Awake() => GetComponent<Health>().Died += () => Destroy(gameObject);
}
```

A crate is `Health + DropLootOnDeath + DestroyOnDeath`. An enemy reuses the same three components and adds `Patrol` and `Shooter`. You never have to choose a base class.

## When to use

- Entities that mix and match capabilities.
- Teams where designers assemble objects in the editor from existing parts.

## When not to use

- Tiny games or prototypes with a handful of entity types. A plain class per type can be easier to read than many small components.
- Splitting an object into components that always appear together and talk to each other constantly. Keep them as one class until you genuinely need to mix them separately.
- Very large numbers of similar objects where performance matters. Use [Entity Component System](./entity-component-system).

## Pitfalls

- **Hidden coupling between components.** Calling `GetComponent<Concrete>()` everywhere recreates the coupling you were escaping. Depend on interfaces such as `IDamageable`, or use events.
- **Too fine-grained.** Thirty one-line components on an object are hard to follow. A component should be a meaningful capability.
- **Initialisation order.** Do not read sibling state in `Awake` if the sibling initialises in its own `Awake`. Cache references in `Awake` and read values in `Start`.
- **Per-object overhead.** With tens of thousands of objects, consider an [Entity Component System](./entity-component-system) instead.

## Related

- [Update Method](./update-method) — components usually update themselves.
- [Observer](./observer) — the cleanest way for components to cooperate.
- [Health / Damageable Interface](./health-component) — the `Health` component above, developed fully.
- [Entity Component System](./entity-component-system) — the data-oriented evolution of this idea.
