# Type Object

> Define new "kinds" of things as data instances rather than as subclasses.

**Category:** Architecture & Structure

## Problem

The game has goblins, orcs and trolls, so you write `Goblin : Enemy`, `Orc : Enemy` and `Troll : Enemy`. Then design wants 60 enemy kinds, plus variants: "Goblin Archer", "Elite Orc", "Frost Troll". Each one becomes a class that differs from the others only in numbers and a few flags. Every new kind needs a programmer, a recompile and a code review. Designers cannot experiment, and the class hierarchy grows sideways forever.

## Solution

Split one class into two:

- A **type object** (`EnemyType`) describes a *kind*: its name, health, speed, attacks, loot and prefab. Each kind is an **instance** of this class, created as data such as an asset or a row in a spreadsheet.
- The **typed object** (`Enemy`) is an individual in the world. It holds a reference to its type plus its own state: current health and position.

New kinds become new data, not new code. Type objects can also **inherit from other type objects**. An "Elite Orc" names "Orc" as its parent and overrides only what differs, so values flow down without a class hierarchy.

This differs from [Flyweight](./flyweight), even though the structure looks alike. Flyweight is about *sharing memory*. Type Object is about *defining kinds as data*. In practice, a type object is usually a flyweight too.

## Example (Unity C#)

```csharp
using UnityEngine;

[CreateAssetMenu(menuName = "Enemies/Enemy Type")]
public class EnemyType : ScriptableObject
{
    [Tooltip("Values left at their 'unset' default are inherited from the parent.")]
    [SerializeField] EnemyType parent;

    [SerializeField] string displayName;
    [SerializeField] int maxHealth;          // 0 = inherit
    [SerializeField] float moveSpeed;        // 0 = inherit
    [SerializeField] int contactDamage;      // 0 = inherit
    [SerializeField] GameObject prefab;      // null = inherit
    [SerializeField] LootTable loot;         // null = inherit

    // Resolved values: walk up the parent chain until a value is set.
    public string DisplayName => !string.IsNullOrEmpty(displayName) ? displayName : parent ? parent.DisplayName : name;
    public int MaxHealth      => maxHealth > 0 ? maxHealth : parent ? parent.MaxHealth : 1;
    public float MoveSpeed    => moveSpeed > 0f ? moveSpeed : parent ? parent.MoveSpeed : 1f;
    public int ContactDamage  => contactDamage > 0 ? contactDamage : parent ? parent.ContactDamage : 0;
    public GameObject Prefab  => prefab ? prefab : parent ? parent.Prefab : null;
    public LootTable Loot     => loot ? loot : parent ? parent.Loot : null;

    // The type object can create its typed objects.
    public Enemy Spawn(Vector3 position)
    {
        var go = Instantiate(Prefab, position, Quaternion.identity);
        var enemy = go.GetComponent<Enemy>();
        enemy.Init(this);
        return enemy;
    }

    void OnValidate()   // catch inheritance cycles in the editor
    {
        for (var p = parent; p != null; p = p.parent)
            if (p == this) { Debug.LogError($"{name}: parent chain loops back to itself", this); parent = null; break; }
    }
}

public class Enemy : MonoBehaviour
{
    public EnemyType Type { get; private set; }   // the kind
    int health;                                   // the individual's own state

    public void Init(EnemyType type)
    {
        Type = type;
        health = type.MaxHealth;
        name = type.DisplayName;
    }

    void Update() { /* move at Type.MoveSpeed toward the player */ }

    public void TakeDamage(int amount)
    {
        if ((health -= amount) > 0) return;
        // Drop from Type.Loot, raise a "killed" event with Type for achievements, then:
        Destroy(gameObject);
    }
}
```

Designers now create `Orc.asset` with `maxHealth = 40`, then `Elite Orc.asset` with `parent = Orc` and `maxHealth = 120`. Everything else, including prefab, speed and loot, is inherited. No code changes.

Behaviour can be data too. Give `EnemyType` a reference to a behaviour asset (a behaviour tree or an AI profile) or a list of abilities, and kinds can differ in *what they do*, not just their numbers.

## When to use

- Many kinds of a thing that differ mostly in data: enemies, items, weapons, spells, buildings, tiles.
- Designers need to add and tune kinds without programmers.
- Kinds are loaded from external data (spreadsheets, mods, live-ops updates).

## When not to use

- A few kinds that differ in behaviour, not data. Use subclasses or [Strategy](./strategy).
- Two or three kinds that never change. A serialized field on the prefab is enough.
- Kinds that need truly unique logic for each type. Data can't express it, so you end up with a scripting system; consider [Subclass Sandbox](./subclass-sandbox) instead.

## Pitfalls

- **Behaviour that really differs.** If a kind needs genuinely unique logic, numbers are not enough. Combine Type Object with composable behaviour ([strategy](./strategy) objects, ability lists) rather than adding `if (type.isTroll)` flags.
- **"Unset" sentinels.** Using `0` to mean "inherit" makes "0 damage" impossible to express. Use explicit override toggles, or nullable fields with a custom inspector, when that matters.
- **Deep inheritance chains.** "Where does this value come from?" gets hard to answer after three levels. Keep chains shallow, and consider an inspector that shows resolved values.
- **Mutating types at runtime.** Changing `type.maxHealth` affects every enemy of that kind, and edits the asset in the editor. Per-instance changes belong on the instance.

## Related

- [Flyweight](./flyweight) — type objects are typically shared flyweights.
- [Prototype](./prototype) — create kinds by cloning configured examples, as Unity prefab variants do.
- [Ability System](./ability-system) and [Status Effects](./status-effects) — both define their kinds with this pattern.
- [Weighted Random & Loot Tables](./weighted-random) — referenced by types for drops.
