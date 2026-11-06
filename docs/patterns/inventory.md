# Inventory

> Separate item definitions, item instances and containers with slots and stacking.

**Category:** Gameplay Systems

## Problem

The first inventory is a `List<GameObject>`. Then potions need to stack to 20, swords must not stack, a sword needs its own durability, the chest and the player's bag need to share logic, dragging an item onto a full stack should split the overflow, and the whole thing needs saving. Every one of these hits a different shortcut, and the "inventory" becomes a tangle of special cases for each item kind.

## Solution

Use three clearly separated layers:

| Layer | What it is | Example |
| --- | --- | --- |
| **Definition** ([Type Object](./type-object) / [Flyweight](./flyweight)) | Shared, read-only data about a *kind* of item | "Health Potion": icon, max stack 20, heals 50 |
| **Stack** | A definition + a count + per-instance data | 7 × Health Potion, or 1 × Iron Sword with durability 63 |
| **Container** | Fixed slots that hold stacks, with the rules for adding, removing, moving and splitting | Player bag (24 slots), chest (12 slots), equipment (head, chest, hands…) |

The container's operations return results, not just `true` or `false`. `TryAdd` returns the **remainder** that did not fit, so picking up 30 arrows into a bag with room for 12 leaves 18 on the ground. Containers raise a `Changed` event for the UI ([Observer](./observer)), and save as plain data: definition IDs, counts and instance data.

## Example (Unity C#)

```csharp
using System;
using UnityEngine;

[CreateAssetMenu(menuName = "Items/Item Definition")]
public class ItemDefinition : ScriptableObject          // shared, read-only
{
    public string id;                                    // stable id for saving
    public string displayName;
    public Sprite icon;
    [Min(1)] public int maxStack = 1;                    // 1 = does not stack
    public bool hasDurability;
    public int maxDurability = 100;
}

[Serializable]
public class ItemStack
{
    public ItemDefinition Definition;
    public int Count;
    public int Durability;                               // per-instance data; only meaningful for non-stacking items

    public ItemStack(ItemDefinition def, int count)
    {
        Definition = def;
        Count = count;
        Durability = def.hasDurability ? def.maxDurability : 0;
    }

    // Stacks merge only if they are the same kind AND have no differing per-instance data.
    public bool CanMergeWith(ItemStack other) =>
        other != null && other.Definition == Definition && Definition.maxStack > 1;
}

public class Container
{
    readonly ItemStack[] slots;
    public int Size => slots.Length;
    public ItemStack this[int i] => slots[i];
    public event Action Changed;

    public Container(int size) => slots = new ItemStack[size];

    // Adds as much as fits. Returns how many did NOT fit (0 = all added).
    public int TryAdd(ItemDefinition def, int count)
    {
        // 1. Top up existing stacks of the same kind.
        for (int i = 0; i < slots.Length && count > 0; i++)
        {
            var s = slots[i];
            if (s == null || s.Definition != def || def.maxStack <= 1) continue;
            int moved = Mathf.Min(count, def.maxStack - s.Count);
            s.Count += moved;
            count -= moved;
        }
        // 2. Fill empty slots with new stacks.
        for (int i = 0; i < slots.Length && count > 0; i++)
        {
            if (slots[i] != null) continue;
            int moved = Mathf.Min(count, def.maxStack);
            slots[i] = new ItemStack(def, moved);
            count -= moved;
        }
        Changed?.Invoke();
        return count;
    }

    public int CountOf(ItemDefinition def)
    {
        int total = 0;
        foreach (var s in slots) if (s != null && s.Definition == def) total += s.Count;
        return total;
    }

    public bool TryRemove(ItemDefinition def, int count)
    {
        if (CountOf(def) < count) return false;                       // all or nothing
        for (int i = slots.Length - 1; i >= 0 && count > 0; i--)       // take from the last stacks first
        {
            var s = slots[i];
            if (s == null || s.Definition != def) continue;
            int taken = Mathf.Min(count, s.Count);
            s.Count -= taken;
            count -= taken;
            if (s.Count == 0) slots[i] = null;
        }
        Changed?.Invoke();
        return true;
    }

    // Drag and drop between any two containers: merge, swap, or move.
    public static void Move(Container from, int fromSlot, Container to, int toSlot, int amount = int.MaxValue)
    {
        var source = from.slots[fromSlot];
        if (source == null) return;
        var target = to.slots[toSlot];
        amount = Mathf.Min(amount, source.Count);

        if (target == null)                                            // move or split into an empty slot
        {
            if (amount == source.Count) { to.slots[toSlot] = source; from.slots[fromSlot] = null; }
            else { to.slots[toSlot] = new ItemStack(source.Definition, amount); source.Count -= amount; }
        }
        else if (target.CanMergeWith(source))                          // top up the target stack
        {
            int moved = Mathf.Min(amount, target.Definition.maxStack - target.Count);
            target.Count += moved;
            source.Count -= moved;
            if (source.Count == 0) from.slots[fromSlot] = null;
        }
        else if (amount == source.Count)                               // different items: swap
        {
            to.slots[toSlot] = source;
            from.slots[fromSlot] = target;
        }

        from.Changed?.Invoke();
        if (to != from) to.Changed?.Invoke();
    }
}

// Picking up: whatever does not fit stays on the ground.
// int left = bag.TryAdd(arrowDef, 30);
// if (left > 0) pickup.Count = left; else Destroy(pickup.gameObject);
```

For saving, convert each slot to `{ definitionId, count, durability }` and look definitions up by `id` from a registry on load. See [Save System](./save-system).

## When to use

- RPGs, survival and crafting games, looter shooters, shops, chests, equipment screens and hotbars.
- Anywhere items move between several containers with different rules.

## When not to use

- A fixed set of items with no containers, such as keys or ammo counts. A few fields or a dictionary of counts is enough.
- A single equipped weapon. A reference to it is enough.

## Pitfalls

- **Merging items with per-instance data.** Stacking two swords with different durability loses data. Only stack items without instance data, or compare it in `CanMergeWith`.
- **Shared mutable stacks.** Putting the *same* `ItemStack` object into two slots (by copying references) means changing one changes both. Always create new stacks when splitting.
- **Non-atomic operations.** Crafting that removes the ingredients, then fails to add the result because the bag is full, loses items. Check capacity first, or roll back on failure.
- **UI as the source of truth.** Drag-and-drop code that edits the UI and then "syncs" to the data drifts out of sync. The container is the truth, and the UI only renders it and calls container operations ([MVC / MVP / MVVM](./mvp-mvvm)).
- **Networked inventories.** Clients must request moves, and the server validates and applies them. Never trust a client-sent inventory state.

## Related

- [Type Object](./type-object) and [Flyweight](./flyweight) — item definitions.
- [Observer](./observer) — `Changed` drives the inventory UI.
- [MVC / MVP / MVVM](./mvp-mvvm) — a full inventory screen built on top of this.
- [Save System](./save-system) — persisting containers as plain data.
- [Weighted Random & Loot Tables](./weighted-random) — where items come from.
