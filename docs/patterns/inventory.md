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

## Example

### Item data

Definitions are shared, read-only assets; a stack is one slot's worth of a definition plus any per-instance data.

::: code-group

```csharp [Unity (C#)]
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
```

```gdscript [Godot (GDScript)]
# item_definition.gd: one .tres per kind of item; shared, read-only.
class_name ItemDefinition
extends Resource

@export var id: StringName  # stable id for saving
@export var display_name := ""
@export var icon: Texture2D
@export_range(1, 999) var max_stack := 1  # 1 = does not stack
@export var has_durability := false
@export var max_durability := 100


# item_stack.gd
class_name ItemStack
extends RefCounted

var definition: ItemDefinition
var count: int
var durability: int  # per-instance data; only meaningful for non-stacking items


func _init(def: ItemDefinition, p_count: int) -> void:
	definition = def
	count = p_count
	durability = def.max_durability if def.has_durability else 0


# Stacks merge only if they are the same kind AND have no differing per-instance data.
func can_merge_with(other: ItemStack) -> bool:
	return other != null and other.definition == definition and definition.max_stack > 1
```

```cpp [Unreal (C++)]
// ItemDefinition.h: a Primary Data Asset, so the Asset Manager can find and load items by id.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "ItemDefinition.generated.h"

UCLASS(BlueprintType)
class UItemDefinition : public UPrimaryDataAsset                 // shared, read-only
{
	GENERATED_BODY()

public:
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Item") FText DisplayName;
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Item") TObjectPtr<UTexture2D> Icon;
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Item", meta = (ClampMin = 1)) int32 MaxStack = 1;   // 1 = does not stack
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Item") bool bHasDurability = false;
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Item") int32 MaxDurability = 100;

	// Stable id for saving: "Item:IronSword" (the asset's name under the Item type).
	virtual FPrimaryAssetId GetPrimaryAssetId() const override { return FPrimaryAssetId(TEXT("Item"), GetFName()); }
};

// ItemStack.h: a value type; an empty slot has no Definition.
USTRUCT(BlueprintType)
struct FItemStack
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Item") TObjectPtr<const UItemDefinition> Definition;
	UPROPERTY(BlueprintReadOnly, Category = "Item") int32 Count = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Item") int32 Durability = 0;   // only meaningful for non-stacking items

	FItemStack() = default;
	FItemStack(const UItemDefinition* Def, int32 InCount)
		: Definition(Def), Count(InCount), Durability(Def->bHasDurability ? Def->MaxDurability : 0) {}

	bool IsEmpty() const { return Definition == nullptr; }
	bool CanMergeWith(const FItemStack& Other) const
	{
		return !Other.IsEmpty() && Other.Definition == Definition && Definition->MaxStack > 1;
	}
};
```

:::

### The container

The container is engine-free logic over an array of slots: top up, fill, remove all-or-nothing, and move between any two containers.

::: code-group

```csharp [Unity (C#)]
using System;
using UnityEngine;

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
```

```gdscript [Godot (GDScript)]
# item_container.gd: not "Container", which is Godot's base class for layout controls.
class_name ItemContainer
extends RefCounted

signal changed

var slots: Array[ItemStack] = []  # null = empty slot


func _init(size: int) -> void:
	slots.resize(size)


# Adds as much as fits. Returns how many did NOT fit (0 = all added).
func try_add(def: ItemDefinition, count: int) -> int:
	# 1. Top up existing stacks of the same kind.
	for s in slots:
		if count == 0:
			break
		if s == null or s.definition != def or def.max_stack <= 1:
			continue
		var moved := mini(count, def.max_stack - s.count)
		s.count += moved
		count -= moved
	# 2. Fill empty slots with new stacks.
	for i in slots.size():
		if count == 0:
			break
		if slots[i] != null:
			continue
		var moved := mini(count, def.max_stack)
		slots[i] = ItemStack.new(def, moved)
		count -= moved
	changed.emit()
	return count


func count_of(def: ItemDefinition) -> int:
	var total := 0
	for s in slots:
		if s != null and s.definition == def:
			total += s.count
	return total


func try_remove(def: ItemDefinition, count: int) -> bool:
	if count_of(def) < count:
		return false  # all or nothing
	for i in range(slots.size() - 1, -1, -1):  # take from the last stacks first
		var s := slots[i]
		if count == 0:
			break
		if s == null or s.definition != def:
			continue
		var taken := mini(count, s.count)
		s.count -= taken
		count -= taken
		if s.count == 0:
			slots[i] = null
	changed.emit()
	return true


# Drag and drop between any two containers: merge, swap, or move. amount < 0 = the whole stack.
static func move(src: ItemContainer, src_slot: int, dst: ItemContainer, dst_slot: int, amount := -1) -> void:
	var source := src.slots[src_slot]
	if source == null:
		return
	var target := dst.slots[dst_slot]
	amount = source.count if amount < 0 else mini(amount, source.count)

	if target == null:  # move or split into an empty slot
		if amount == source.count:
			dst.slots[dst_slot] = source
			src.slots[src_slot] = null
		else:
			dst.slots[dst_slot] = ItemStack.new(source.definition, amount)
			source.count -= amount
	elif target.can_merge_with(source):  # top up the target stack
		var moved := mini(amount, target.definition.max_stack - target.count)
		target.count += moved
		source.count -= moved
		if source.count == 0:
			src.slots[src_slot] = null
	elif amount == source.count:  # different items: swap
		dst.slots[dst_slot] = source
		src.slots[src_slot] = target

	src.changed.emit()
	if dst != src:
		dst.changed.emit()
```

```cpp [Unreal (C++)]
// InventoryComponent.h: the container lives on an actor (player, chest), so UI and replication can find it.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "ItemStack.h"
#include "InventoryComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnInventoryChanged);

UCLASS(ClassGroup = (Gameplay), meta = (BlueprintSpawnableComponent))
class UInventoryComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Inventory") int32 Size = 24;
	UPROPERTY(BlueprintAssignable) FOnInventoryChanged OnChanged;

	const TArray<FItemStack>& GetSlots() const { return Slots; }

	// Adds as much as fits. Returns how many did NOT fit (0 = all added).
	UFUNCTION(BlueprintCallable, Category = "Inventory") int32 TryAdd(const UItemDefinition* Def, int32 Count);
	UFUNCTION(BlueprintPure, Category = "Inventory") int32 CountOf(const UItemDefinition* Def) const;
	UFUNCTION(BlueprintCallable, Category = "Inventory") bool TryRemove(const UItemDefinition* Def, int32 Count);

	// Drag and drop between any two containers: merge, swap, or move.
	static void Move(UInventoryComponent* From, int32 FromSlot, UInventoryComponent* To, int32 ToSlot, int32 Amount = MAX_int32);

protected:
	virtual void BeginPlay() override { Super::BeginPlay(); Slots.SetNum(Size); }

private:
	UPROPERTY() TArray<FItemStack> Slots;
};

// InventoryComponent.cpp
#include "InventoryComponent.h"

int32 UInventoryComponent::TryAdd(const UItemDefinition* Def, int32 Count)
{
	if (!Def) return Count;
	for (FItemStack& S : Slots)                                   // 1. top up stacks of the same kind
	{
		if (Count == 0) break;
		if (S.Definition != Def || Def->MaxStack <= 1) continue;
		const int32 Moved = FMath::Min(Count, Def->MaxStack - S.Count);
		S.Count += Moved;
		Count -= Moved;
	}
	for (FItemStack& S : Slots)                                   // 2. fill empty slots
	{
		if (Count == 0) break;
		if (!S.IsEmpty()) continue;
		const int32 Moved = FMath::Min(Count, Def->MaxStack);
		S = FItemStack(Def, Moved);
		Count -= Moved;
	}
	OnChanged.Broadcast();
	return Count;
}

int32 UInventoryComponent::CountOf(const UItemDefinition* Def) const
{
	int32 Total = 0;
	for (const FItemStack& S : Slots) if (S.Definition == Def) Total += S.Count;
	return Total;
}

bool UInventoryComponent::TryRemove(const UItemDefinition* Def, int32 Count)
{
	if (!Def || CountOf(Def) < Count) return false;               // all or nothing
	for (int32 i = Slots.Num() - 1; i >= 0 && Count > 0; --i)     // take from the last stacks first
	{
		FItemStack& S = Slots[i];
		if (S.Definition != Def) continue;
		const int32 Taken = FMath::Min(Count, S.Count);
		S.Count -= Taken;
		Count -= Taken;
		if (S.Count == 0) S = FItemStack();
	}
	OnChanged.Broadcast();
	return true;
}

void UInventoryComponent::Move(UInventoryComponent* From, int32 FromSlot, UInventoryComponent* To, int32 ToSlot, int32 Amount)
{
	FItemStack& Source = From->Slots[FromSlot];                   // references: FItemStack is a value type
	FItemStack& Target = To->Slots[ToSlot];
	if (Source.IsEmpty()) return;
	Amount = FMath::Min(Amount, Source.Count);

	if (Target.IsEmpty())                                         // move or split into an empty slot
	{
		Target = FItemStack(Source.Definition, Amount);
		Target.Durability = Source.Durability;
		Source.Count -= Amount;
		if (Source.Count == 0) Source = FItemStack();
	}
	else if (Target.CanMergeWith(Source))                         // top up the target stack
	{
		const int32 Moved = FMath::Min(Amount, Target.Definition->MaxStack - Target.Count);
		Target.Count += Moved;
		Source.Count -= Moved;
		if (Source.Count == 0) Source = FItemStack();
	}
	else if (Amount == Source.Count)                              // different items: swap
	{
		Swap(Source, Target);
	}

	From->OnChanged.Broadcast();
	if (To != From) To->OnChanged.Broadcast();
}
```

:::

### Picking up

Whatever does not fit stays on the ground.

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class PlayerInventory : MonoBehaviour
{
    [SerializeField] int size = 24;
    public Container Bag { get; private set; }

    void Awake() => Bag = new Container(size);
}

public class ItemPickup : MonoBehaviour
{
    [SerializeField] ItemDefinition item;
    [SerializeField] int count = 1;

    void OnTriggerEnter(Collider other)
    {
        if (!other.TryGetComponent(out PlayerInventory inventory)) return;
        int left = inventory.Bag.TryAdd(item, count);
        if (left > 0) count = left; else Destroy(gameObject);
    }
}
```

```gdscript [Godot (GDScript)]
# player_inventory.gd: a child node named Inventory on the player.
class_name PlayerInventory
extends Node

@export var size := 24

var bag: ItemContainer


func _ready() -> void:
	bag = ItemContainer.new(size)


# item_pickup.gd
extends Area3D

@export var item: ItemDefinition
@export var count := 1


func _ready() -> void:
	body_entered.connect(_on_body_entered)


func _on_body_entered(body: Node3D) -> void:
	var inventory := body.get_node_or_null("Inventory") as PlayerInventory
	if inventory == null:
		return
	var left := inventory.bag.try_add(item, count)
	if left > 0:
		count = left
	else:
		queue_free()
```

```cpp [Unreal (C++)]
// ItemPickup.cpp: a USphereComponent* Trigger set to overlap pawns.
void AItemPickup::BeginPlay()
{
	Super::BeginPlay();
	Trigger->OnComponentBeginOverlap.AddDynamic(this, &AItemPickup::OnOverlap);
}

void AItemPickup::OnOverlap(UPrimitiveComponent*, AActor* Other, UPrimitiveComponent*, int32, bool, const FHitResult&)
{
	UInventoryComponent* Inventory = Other ? Other->FindComponentByClass<UInventoryComponent>() : nullptr;
	if (!Inventory) return;
	const int32 Left = Inventory->TryAdd(Item, Count);              // UPROPERTY(EditAnywhere) Item, Count
	if (Left > 0) Count = Left; else Destroy();
}
```

:::

For saving, convert each slot to `{ definitionId, count, durability }` and look definitions up by id from a registry on load. See [Save System](./save-system).

**Engine notes**

- **Unity:** no built-in inventory. `ItemStack` is a class, so `Move` hands the same object between slots; copy it if a UI keeps references to stacks.
- **Godot:** no built-in inventory. Don't call the class `Container`: that name is taken by Godot's layout control base class. A typed `Array[ItemStack]` can hold `null` for empty slots, and `resize` fills new slots with `null`.
- **Unreal:** no built-in inventory in the engine; the **Lyra** sample has a fuller one (item definitions made of "fragments", plus replicated inventory lists). `FItemStack` is a value type, so the code edits slots through references (`FItemStack&`); a copy would silently change nothing. For multiplayer, replicate `Slots` (a Fast Array Serializer suits large inventories).

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
