# Weighted Random & Loot Tables

> Pick outcomes by weight, with pity timers and shuffle bags to control streaks.

**Category:** Data, Content & Procedural Generation

## Problem

A chest should drop common items often, rare items sometimes and legendaries almost never. Hard-coding this as `if (Random.value < 0.01f) ... else if (Random.value < 0.1f) ...` is wrong (each branch rolls again) and impossible for designers to tune. Pure randomness also feels unfair. A 10% drop can fail 40 times in a row, and players remember that much more vividly than the times they got lucky.

## Solution

**Weighted selection.** Give each entry a weight. Sum the weights, roll a number in `[0, total)`, and walk the entries subtracting weights until the roll falls inside one. A weight is relative, not a percentage: weights of 70 / 25 / 5 mean 70%, 25% and 5%.

**Loot tables as data.** Store entries in an asset that designers edit. Entries can point to *other tables* ("roll on the gem table"), and a table can roll several times or include guaranteed drops.

**Controlling streaks.** Choose the tool based on what should feel fair:

| Technique | How it works | Use when |
| --- | --- | --- |
| **Pity timer** | Each failure raises the chance, and a success resets it. There may be a hard guarantee after N failures. | Rare rewards should never feel impossible. |
| **Shuffle bag** | Put N tokens in a bag in the exact proportions, draw without replacement, refill when empty. | Exact distribution over a short run, such as critical hits or Tetris-style pieces. |
| **Pseudo-random distribution** | Start with a low chance that grows each attempt, tuned so the average equals the nominal chance. | Proc chances that should be regular but not predictable. |

## Example (Unity C#)

```csharp
[System.Serializable]
public class LootEntry
{
    public ItemDefinition item;
    [Min(0)] public float weight = 1f;
}

[CreateAssetMenu(menuName = "Loot/Loot Table")]
public class LootTable : ScriptableObject
{
    public List<LootEntry> entries = new();

    public ItemDefinition Roll(System.Random rng)
    {
        float total = 0f;
        foreach (var e in entries) total += e.weight;
        if (total <= 0f) return null;

        double roll = rng.NextDouble() * total;
        foreach (var e in entries)
        {
            if (roll < e.weight) return e.item;
            roll -= e.weight;
        }
        return entries[^1].item;   // guard against floating-point leftovers
    }
}

// Pity timer: the chance grows with each miss and resets on a hit.
public class PityRoll
{
    readonly float baseChance, increasePerMiss;
    readonly int guaranteeAfter;
    int misses;

    public PityRoll(float baseChance, float increasePerMiss, int guaranteeAfter)
    {
        this.baseChance = baseChance;
        this.increasePerMiss = increasePerMiss;
        this.guaranteeAfter = guaranteeAfter;
    }

    public bool Roll(System.Random rng)
    {
        float chance = baseChance + misses * increasePerMiss;
        bool hit = misses + 1 >= guaranteeAfter || rng.NextDouble() < chance;
        misses = hit ? 0 : misses + 1;
        return hit;
    }
}

// Shuffle bag: exact proportions over each refill.
public class ShuffleBag<T>
{
    readonly List<T> source = new(), bag = new();
    readonly System.Random rng;

    public ShuffleBag(System.Random rng) => this.rng = rng;

    public void Add(T item, int count) { for (int i = 0; i < count; i++) source.Add(item); }

    public T Next()
    {
        if (bag.Count == 0) bag.AddRange(source);
        int i = rng.Next(bag.Count);
        T value = bag[i];
        bag[i] = bag[^1];          // swap-remove: O(1)
        bag.RemoveAt(bag.Count - 1);
        return value;
    }
}
```

The example passes an explicit `System.Random` instead of using `UnityEngine.Random`, so each system can have its own **seeded** stream. Loot stays reproducible for replays and debugging, and VFX randomness cannot shift loot outcomes.

## When to use

- Loot drops, enemy spawn selection, random events, procedural content choices, critical hits and proc chances.
- Whenever designers need to tune probabilities without touching code.

## Pitfalls

- **Rolling once per branch** (`if (Random.value < a) … else if (Random.value < b)`) silently changes the probabilities. Roll once and compare against cumulative weights.
- **Shared global RNG.** Unrelated systems consuming random numbers make outcomes impossible to reproduce. Use separate seeded streams.
- **Displayed odds must be true.** Pity systems change the effective probability. Many platforms and regions legally require accurate odds disclosure for paid random rewards.
- **Large tables rolled very often.** Precompute cumulative weights and binary-search them, or use the alias method for O(1) picks.

## Related

- [Flyweight](./flyweight) — loot entries reference shared item definitions.
- Seeded Randomness — reproducible RNG streams.
- [Stat & Modifier System](./stat-modifier-system) — "+X% drop chance" bonuses are modifiers on weights.
