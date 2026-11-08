# Weighted Random & Loot Tables

> Pick outcomes by weight, with pity timers and shuffle bags to control streaks.

**Category:** Data, Content & Procedural Generation

## Problem

A chest should drop common items often, rare items sometimes and legendaries almost never. Hard-coding this as `if (rand() < 0.01) ... else if (rand() < 0.1) ...` is wrong (each branch rolls again) and impossible for designers to tune. Pure randomness also feels unfair. A 10% drop can fail 40 times in a row, and players remember that much more vividly than the times they got lucky.

## Solution

**Weighted selection.** Give each entry a weight. Sum the weights, roll a number in `[0, total)`, and walk the entries subtracting weights until the roll falls inside one. A weight is relative, not a percentage: weights of 70 / 25 / 5 mean 70%, 25% and 5%.

**Loot tables as data.** Store entries in an asset that designers edit. Entries can point to *other tables* ("roll on the gem table"), and a table can roll several times or include guaranteed drops.

**Controlling streaks.** Choose the tool based on what should feel fair:

| Technique | How it works | Use when |
| --- | --- | --- |
| **Pity timer** | Each failure raises the chance, and a success resets it. There may be a hard guarantee after N failures. | Rare rewards should never feel impossible. |
| **Shuffle bag** | Put N tokens in a bag in the exact proportions, draw without replacement, refill when empty. | Exact distribution over a short run, such as critical hits or Tetris-style pieces. |
| **Pseudo-random distribution** | Start with a low chance that grows each attempt, tuned so the average equals the nominal chance. | Proc chances that should be regular but not predictable. |

## Example

A loot table rolled by weight, a pity timer and a shuffle bag. Each takes an explicit, seeded random stream rather than the engine's global one.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

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

```gdscript [Godot (GDScript)]
# loot_entry.gd: ItemDefinition is the item resource from the Inventory page.
class_name LootEntry
extends Resource

@export var item: ItemDefinition
@export_range(0.0, 1000.0, 0.01, "or_greater") var weight := 1.0


# loot_table.gd
class_name LootTable
extends Resource

@export var entries: Array[LootEntry] = []


func roll(rng: RandomNumberGenerator) -> ItemDefinition:
	var weights := PackedFloat32Array()
	var total := 0.0
	for entry in entries:
		weights.append(entry.weight)
		total += entry.weight
	if total <= 0.0:
		return null
	# Built in since Godot 4.3: an index chosen with probability proportional to its weight.
	return entries[rng.rand_weighted(weights)].item


# pity_roll.gd: the chance grows with each miss and resets on a hit.
class_name PityRoll
extends RefCounted

var _base_chance: float
var _increase_per_miss: float
var _guarantee_after: int
var _misses := 0


func _init(base_chance: float, increase_per_miss: float, guarantee_after: int) -> void:
	_base_chance = base_chance
	_increase_per_miss = increase_per_miss
	_guarantee_after = guarantee_after


func roll(rng: RandomNumberGenerator) -> bool:
	var chance := _base_chance + _misses * _increase_per_miss
	var hit := _misses + 1 >= _guarantee_after or rng.randf() < chance
	_misses = 0 if hit else _misses + 1
	return hit


# shuffle_bag.gd: exact proportions over each refill.
class_name ShuffleBag
extends RefCounted

var _source := []
var _bag := []
var _rng: RandomNumberGenerator


func _init(rng: RandomNumberGenerator) -> void:
	_rng = rng


func add(item: Variant, count: int) -> void:
	for i in count:
		_source.append(item)


func next() -> Variant:
	if _bag.is_empty():
		_bag.append_array(_source)
	var i := _rng.randi_range(0, _bag.size() - 1)
	var value: Variant = _bag[i]
	_bag[i] = _bag.back()  # swap-remove: O(1)
	_bag.pop_back()
	return value
```

```cpp [Unreal (C++)]
// LootTable.h: UItemDefinition is the item Data Asset from the Inventory page.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "LootTable.generated.h"

class UItemDefinition;

USTRUCT(BlueprintType)
struct FLootEntry
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Loot") TObjectPtr<UItemDefinition> Item;
	UPROPERTY(EditAnywhere, Category = "Loot", meta = (ClampMin = "0")) float Weight = 1.f;
};

UCLASS(BlueprintType)
class ULootTable : public UDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Loot") TArray<FLootEntry> Entries;

	UItemDefinition* Roll(FRandomStream& Rng) const;
};

// Pity timer: the chance grows with each miss and resets on a hit.
class FPityRoll
{
public:
	FPityRoll(float InBaseChance, float InIncreasePerMiss, int32 InGuaranteeAfter)
		: BaseChance(InBaseChance), IncreasePerMiss(InIncreasePerMiss), GuaranteeAfter(InGuaranteeAfter) {}

	bool Roll(FRandomStream& Rng)
	{
		const float Chance = BaseChance + Misses * IncreasePerMiss;
		const bool bHit = Misses + 1 >= GuaranteeAfter || Rng.FRand() < Chance;
		Misses = bHit ? 0 : Misses + 1;
		return bHit;
	}

private:
	float BaseChance, IncreasePerMiss;
	int32 GuaranteeAfter;
	int32 Misses = 0;
};

// Shuffle bag: exact proportions over each refill. The stream must outlive the bag.
template <typename T>
class TShuffleBag
{
public:
	explicit TShuffleBag(FRandomStream& InRng) : Rng(InRng) {}

	void Add(const T& Item, int32 Count) { for (int32 I = 0; I < Count; ++I) Source.Add(Item); }

	T Next()
	{
		if (Bag.Num() == 0) Bag = Source;
		const int32 I = Rng.RandRange(0, Bag.Num() - 1);   // both bounds inclusive
		T Value = Bag[I];
		Bag.RemoveAtSwap(I);                               // swap-remove: O(1)
		return Value;
	}

private:
	FRandomStream& Rng;
	TArray<T> Source, Bag;
};

// LootTable.cpp
#include "LootTable.h"
#include "ItemDefinition.h"

UItemDefinition* ULootTable::Roll(FRandomStream& Rng) const
{
	float Total = 0.f;
	for (const FLootEntry& E : Entries) Total += E.Weight;
	if (Total <= 0.f) return nullptr;

	float Pick = Rng.FRand() * Total;
	for (const FLootEntry& E : Entries)
	{
		if (Pick < E.Weight) return E.Item;
		Pick -= E.Weight;
	}
	return Entries.Last().Item;   // guard against floating-point leftovers
}
```

:::

The example passes an explicit stream (`System.Random`, `RandomNumberGenerator`, `FRandomStream`) instead of using the engine's global random functions, so each system can have its own **seeded** stream. Loot stays reproducible for replays and debugging, and VFX randomness cannot shift loot outcomes.

**Engine notes**

- **Unity:** no built-in weighted pick. `ScriptableObject` loot tables are edited in the inspector; `[Min(0)]` keeps weights non-negative.
- **Godot:** `RandomNumberGenerator.rand_weighted()` (Godot 4.3+) does the weighted pick; on earlier versions, use the same running-subtraction loop as the other tabs. Loot tables as `Resource`s are edited in the inspector like ScriptableObjects.
- **Unreal:** no built-in weighted pick in C++. Loot tables are commonly Data Assets (as here) or Data Tables imported from a spreadsheet. `FRandomStream` is the seedable stream; Blueprints can take one by reference too.

## When to use

## When to use

- Loot drops, enemy spawn selection, random events, procedural content choices, critical hits and proc chances.
- Whenever designers need to tune probabilities without touching code.

## When not to use

- Choices where players expect fairness over a session, such as card draws. Use a shuffled bag or pity timers.
- A few equally likely options. A single random index is enough.

## Pitfalls

- **Rolling once per branch** (`if (rand() < a) … else if (rand() < b)`) silently changes the probabilities. Roll once and compare against cumulative weights.
- **Shared global RNG.** Unrelated systems consuming random numbers make outcomes impossible to reproduce. Use separate seeded streams.
- **Displayed odds must be true.** Pity systems change the effective probability. Many platforms and regions legally require accurate odds disclosure for paid random rewards.
- **Large tables rolled very often.** Precompute cumulative weights and binary-search them, or use the alias method for O(1) picks.

## Related

- [Flyweight](./flyweight) — loot entries reference shared item definitions.
- [Seeded Randomness](./seeded-randomness) — reproducible RNG streams.
- [Stat & Modifier System](./stat-modifier-system) — "+X% drop chance" bonuses are modifiers on weights.
