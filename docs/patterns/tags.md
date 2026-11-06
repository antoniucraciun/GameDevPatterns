# Gameplay Tags

> Hierarchical tags (State.Stunned, Damage.Fire) for queries instead of booleans.

**Category:** Gameplay Systems

## Problem

A character class grows booleans: `isStunned`, `isSilenced`, `isBurning`, `isInvulnerable`, `isInCutscene`. Each new effect needs a new field and code that checks it. "Can this character act?" becomes `!isStunned && !isFrozen && !isSleeping && !isInCutscene`, repeated and inconsistent across the codebase. Two effects that both stun the character overwrite each other's flag, so ending one un-stuns the character while the other is still active. String tags fix the field explosion, but `"Stunned"` versus `"Stun"` typos fail silently.

## Solution

Give objects a **tag container**, and define tags as a **hierarchy**:

```
State
├── State.Debuff
│   ├── State.Debuff.Stun
│   ├── State.Debuff.Silence
│   └── State.Debuff.Burning
└── State.Invulnerable
Damage
├── Damage.Fire
└── Damage.Ice
```

- **Hierarchical matching.** Asking "has `State.Debuff`?" is true if the container holds *any* debuff. "Cleanse all debuffs" and "immune to all debuffs" become one query.
- **Reference counting.** The container counts each tag. Two stuns add the tag twice, and the character stays stunned until *both* have been removed.
- **Queries.** *Has any of*, *has all of*, *has none of*. An ability can declare "blocked by `State.Debuff.Stun` or `State.Debuff.Silence`, requires `State.Grounded`".
- **Typo-proof tags.** Tags are assets (or interned constants) picked from a list in the inspector, not free strings.

Unreal Engine's Gameplay Ability System popularised this approach. The pattern works in any engine.

## Example (Unity C#)

Tags as ScriptableObject assets, so they are typo-proof, selectable in the inspector, and know their parent:

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(menuName = "Tags/Gameplay Tag")]
public class GameplayTag : ScriptableObject
{
    [SerializeField] GameplayTag parent;
    public GameplayTag Parent => parent;

    // True if this tag is `other` or a descendant of it: Stun.IsA(Debuff) == true.
    public bool IsA(GameplayTag other)
    {
        for (var t = this; t != null; t = t.parent)
            if (t == other) return true;
        return false;
    }

    public string FullName => parent ? $"{parent.FullName}.{name}" : name;
}

public class TagContainer
{
    readonly Dictionary<GameplayTag, int> counts = new();
    public event Action<GameplayTag, bool> Changed;          // (tag, nowPresent)

    public void Add(GameplayTag tag)
    {
        counts.TryGetValue(tag, out int c);
        counts[tag] = c + 1;
        if (c == 0) Changed?.Invoke(tag, true);              // only the first source raises "added"
    }

    public void Remove(GameplayTag tag)
    {
        if (!counts.TryGetValue(tag, out int c)) return;
        if (c <= 1) { counts.Remove(tag); Changed?.Invoke(tag, false); }
        else counts[tag] = c - 1;                            // another source still holds it
    }

    // Hierarchical: Has(Debuff) is true while Stun is present.
    public bool Has(GameplayTag query)
    {
        foreach (var tag in counts.Keys)
            if (tag.IsA(query)) return true;
        return false;
    }

    public bool HasAny(IEnumerable<GameplayTag> tags) { foreach (var t in tags) if (Has(t)) return true; return false; }
    public bool HasAll(IEnumerable<GameplayTag> tags) { foreach (var t in tags) if (!Has(t)) return false; return true; }

    public void RemoveAllUnder(GameplayTag root)              // "cleanse all debuffs"
    {
        var toRemove = new List<GameplayTag>();
        foreach (var tag in counts.Keys) if (tag.IsA(root)) toRemove.Add(tag);
        foreach (var tag in toRemove) { counts.Remove(tag); Changed?.Invoke(tag, false); }
    }
}

// A reusable requirement, editable in the inspector.
[Serializable]
public class TagRequirement
{
    public List<GameplayTag> requireAll = new();
    public List<GameplayTag> blockedByAny = new();

    public bool IsMetBy(TagContainer tags) => tags.HasAll(requireAll) && !tags.HasAny(blockedByAny);
}
```

Using tags instead of booleans:

```csharp
public class Character : MonoBehaviour
{
    public readonly TagContainer Tags = new();
    [SerializeField] GameplayTag stunTag, debuffTag;
    [SerializeField] TagRequirement canAct;                  // e.g. blockedByAny: [Stun, Frozen, Sleep, Cutscene]

    public bool CanAct => canAct.IsMetBy(Tags);

    public void Cleanse() => Tags.RemoveAllUnder(debuffTag);
}

// A status effect adds its tag on apply and removes it on expiry.
// Two overlapping stuns keep the character stunned until both expire, thanks to counting.
```

Matching walks up the parent chain for each held tag, which is fine for a few dozen tags per object. For heavy use, cache each tag's ancestors in a set, or assign tags integer IDs and bitmasks at startup.

## When to use

- Status effects, abilities, AI conditions, damage types, factions and interaction rules: anywhere "does this thing have property X?" is asked across systems.
- Data-driven designs, where designers express requirements and immunities without code.

## When not to use

- A few boolean properties. Bools or an enum are type-safe and easier to find.
- Data that needs values, not just presence. A tag says *has fire resistance*, not *how much*; use stats.
- Tags as strings typed by hand everywhere. Typos fail silently; use a registry or constants.

## Pitfalls

- **Tags as a dumping ground.** Hundreds of tags with no structure are as bad as hundreds of booleans. Design the hierarchy, and review new tags.
- **Unbalanced add/remove.** Every `Add` needs exactly one `Remove` from the same source. Tie them to an owner (an effect instance), and remove everything an owner added when it ends.
- **`RemoveAllUnder` versus counting.** Cleansing ignores counts and removes tags that other sources still hold. Either cleanse the *sources* (remove the effects, which remove their tags), or accept that cleansing overrides everything.
- **Renaming string tags.** If you use strings for simplicity, a rename silently breaks data. Asset-based tags survive renames, because references are by asset.
- **Tags instead of data.** Tags answer yes/no questions. "How stunned?" or "stun remaining" belong in the effect, not in more tags.

## Related

- [Status Effects](./status-effects) — the main source of tags.
- [Ability System](./ability-system) — requirements and blocks expressed as tag queries.
- [Damage Pipeline](./damage-pipeline) — immunities and damage types as tags.
- [Type Object](./type-object) and [ScriptableObject Architecture](./scriptable-object-architecture) — tags as assets.
- [Blackboard](./blackboard) — key-value facts, where tags are yes/no facts.
