# Prototype

> Create new objects by cloning a configured example (Unity prefabs).

**Category:** Architecture & Structure

## Problem

A spawner needs to create goblins, but a goblin is not just a class. It is a specific combination of mesh, materials, colliders, components and tuned values, assembled by a designer. Writing code that builds that combination (add a renderer, set the material, add a health component, set health to 40) is fragile, and duplicates work the designer already did. Some variations exist only at runtime: an "elite" goblin buffed by the AI Director, or a monster a player customised in a creator. You need more of *that exact thing*, whatever it turned out to be.

## Solution

Create new objects by **copying an existing, fully configured one**: the **prototype**. The code that creates the copy does not need to know what the object contains.

In Unity this pattern is everywhere:

- **Prefabs** are prototypes stored as assets. `Instantiate(prefab)` clones them, components, values and children included.
- **Prefab variants** are prototypes of prototypes: an "Elite Goblin" variant overrides a few values of "Goblin" and inherits the rest.
- **`Instantiate(anyGameObject)`** clones a *runtime* object in its current state, including changes made during play.
- For **plain C# data**, a `Clone()` method copies configured objects. The critical question is how deep the copy goes.

## Example (Unity C#)

Spawning copies of a runtime-modified prototype, such as "this wave's buffed enemy":

```csharp
using UnityEngine;

public class EliteWaveSpawner : MonoBehaviour
{
    [SerializeField] Enemy basePrefab;
    Enemy elitePrototype;                     // configured once, cloned many times

    public void PrepareEliteWave(float healthBonus, Material eliteMaterial)
    {
        // Build the prototype once, from the prefab, then customise it at runtime.
        elitePrototype = Instantiate(basePrefab, transform);
        elitePrototype.gameObject.SetActive(false);          // a template, not part of the game
        elitePrototype.MaxHealth *= 1f + healthBonus;
        elitePrototype.GetComponentInChildren<Renderer>().sharedMaterial = eliteMaterial;
        elitePrototype.gameObject.AddComponent<EliteAura>();
    }

    public Enemy SpawnElite(Vector3 position)
    {
        // Clone the configured prototype: every customisation comes along.
        var e = Instantiate(elitePrototype, position, Quaternion.identity);
        e.gameObject.SetActive(true);
        return e;
    }
}
```

Plain data prototypes, with an explicit deep copy:

```csharp
using System.Collections.Generic;

public class CharacterLoadout
{
    public string ClassName;
    public int Level;
    public List<string> Items = new();
    public Dictionary<string, int> Skills = new();

    // Deep copy: the clone gets its own lists, so editing it never changes the prototype.
    public CharacterLoadout Clone() => new()
    {
        ClassName = ClassName,
        Level = Level,
        Items = new List<string>(Items),
        Skills = new Dictionary<string, int>(Skills),
    };
}

// Templates the player can start from, cloned and then customised:
// var warrior = presets["Warrior"].Clone();
// warrior.Items.Add("lucky_charm");          // presets["Warrior"] is unchanged
```

`MemberwiseClone()` makes a **shallow** copy: value fields are copied, but reference fields (lists, dictionaries, other objects) are *shared* between the original and the clone. That is the most common prototype bug.

## When to use

- Spawning configured objects whose setup lives in data or the editor (prefabs, variants).
- Variations created at runtime that you then need many copies of: buffed enemies, player-customised units, procedurally assembled objects.
- Templates and presets: starting loadouts, character presets, level chunks.

## Pitfalls

- **Shallow copies.** Cloned objects that share a list with the prototype change each other. Write explicit deep-copy methods for data that contains collections or references.
- **Runtime prototypes in the scene.** A template GameObject left active takes part in the game (it moves, it counts as an enemy). Deactivate it, or keep it outside the scene's gameplay registries.
- **Cloning unwanted state.** `Instantiate` copies *current* state: half-played animations, damage taken, running timers. Clone from clean templates, not from objects in use.
- **Expensive clones.** Instantiating complex prefabs causes hitches. Combine prototypes with an [Object Pool](./object-pool).
- **Deep variant chains.** Variant of variant of variant becomes hard to reason about ("where does this value come from?"). Keep chains shallow.

## Related

- [Type Object](./type-object) — defines kinds as data, and often references a prototype prefab.
- [Factory](./factory) — decides *which* prototype to clone, and does the setup around it.
- [Object Pool](./object-pool) — reuses clones instead of creating new ones.
- [Memento](./memento) — a copy of state for restoring, rather than for creating new objects.
- [Flyweight](./flyweight) — shares data between instances instead of copying it.
