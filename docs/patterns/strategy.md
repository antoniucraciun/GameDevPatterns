# Strategy

> Swap an algorithm (movement, targeting, damage formula) at runtime behind one interface.

**Category:** Behavioral & Communication

## Problem

A tower-defence turret picks targets with a `switch` on an enum: nearest, first along the path, strongest, weakest. Every new targeting mode means editing the turret. Some turrets need a mode no other turret uses. Designers want to try "lowest health within range, preferring flying enemies" without a programmer. Players want to change a turret's targeting at runtime. The turret has become a pile of unrelated algorithms behind one `switch`.

## Solution

Pull each algorithm out into its own object behind a common interface: the **strategy**. The **context** (the turret) holds a reference to a strategy and calls it, without knowing which one it is.

- New algorithms are new classes, or new assets, and the context never changes.
- Strategies can be swapped at runtime, for example from a UI dropdown.
- Each algorithm is small and testable on its own.

In Unity, strategies are often **ScriptableObject assets**. Designers then pick a strategy in the inspector, and tune its parameters per asset ("nearest, but ignore targets beyond 15 m").

## Example

Tower-defense targeting. Each engine makes strategies editor-selectable: ScriptableObject assets in Unity, `Resource` subclasses in Godot, and instanced `UObject`s in Unreal.

### The strategies

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public interface ITargetable
{
    Vector3 Position { get; }
    float Health { get; }
    float PathProgress { get; }    // 0 at the spawn, 1 at the goal
    bool IsFlying { get; }
}

// The strategy interface, as an abstract ScriptableObject so strategies are assets.
public abstract class TargetingStrategy : ScriptableObject
{
    public abstract ITargetable Choose(Vector3 from, IReadOnlyList<ITargetable> inRange);
}

[CreateAssetMenu(menuName = "Targeting/Nearest")]
public class NearestTargeting : TargetingStrategy
{
    public override ITargetable Choose(Vector3 from, IReadOnlyList<ITargetable> inRange)
    {
        ITargetable best = null;
        float bestDistance = float.MaxValue;
        foreach (var t in inRange)
        {
            float d = (t.Position - from).sqrMagnitude;
            if (d < bestDistance) { best = t; bestDistance = d; }
        }
        return best;
    }
}

[CreateAssetMenu(menuName = "Targeting/First Along Path")]
public class FirstTargeting : TargetingStrategy
{
    public override ITargetable Choose(Vector3 from, IReadOnlyList<ITargetable> inRange)
    {
        ITargetable best = null;
        foreach (var t in inRange)
            if (best == null || t.PathProgress > best.PathProgress) best = t;
        return best;
    }
}

[CreateAssetMenu(menuName = "Targeting/Weakest (Prefer Flying)")]
public class WeakestTargeting : TargetingStrategy
{
    [SerializeField] bool preferFlying = true;           // tunable per asset

    public override ITargetable Choose(Vector3 from, IReadOnlyList<ITargetable> inRange)
    {
        ITargetable best = null;
        foreach (var t in inRange)
        {
            if (best == null) { best = t; continue; }
            if (preferFlying && t.IsFlying != best.IsFlying) { if (t.IsFlying) best = t; continue; }
            if (t.Health < best.Health) best = t;
        }
        return best;
    }
}
```

```gdscript [Godot (GDScript)]
# creep.gd: enemies follow a Path3D, so the path progress comes for free.
class_name Creep
extends PathFollow3D

@export var health := 100.0
@export var is_flying := false
# progress_ratio (built in): 0 at the spawn, 1 at the goal


# targeting_strategy.gd: the strategy interface, as a Resource so strategies are .tres files.
class_name TargetingStrategy
extends Resource


func choose(_from: Vector3, _in_range: Array[Creep]) -> Creep:
	return null  # overridden by each strategy


# nearest_targeting.gd
class_name NearestTargeting
extends TargetingStrategy


func choose(from: Vector3, in_range: Array[Creep]) -> Creep:
	var best: Creep = null
	var best_distance := INF
	for c in in_range:
		var d := from.distance_squared_to(c.global_position)
		if d < best_distance:
			best = c
			best_distance = d
	return best


# first_targeting.gd
class_name FirstTargeting
extends TargetingStrategy


func choose(_from: Vector3, in_range: Array[Creep]) -> Creep:
	var best: Creep = null
	for c in in_range:
		if best == null or c.progress_ratio > best.progress_ratio:
			best = c
	return best


# weakest_targeting.gd
class_name WeakestTargeting
extends TargetingStrategy

@export var prefer_flying := true  # tunable per .tres


func choose(_from: Vector3, in_range: Array[Creep]) -> Creep:
	var best: Creep = null
	for c in in_range:
		if best == null:
			best = c
		elif prefer_flying and c.is_flying != best.is_flying:
			if c.is_flying:
				best = c
		elif c.health < best.health:
			best = c
	return best
```

```cpp [Unreal (C++)]
// TargetingStrategy.h
#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "TargetingStrategy.generated.h"

class ACreep;

// EditInlineNew + DefaultToInstanced: a turret's Details panel shows a class picker,
// and each turret gets its own instance with its own settings.
UCLASS(Abstract, EditInlineNew, DefaultToInstanced, CollapseCategories)
class UTargetingStrategy : public UObject
{
	GENERATED_BODY()

public:
	virtual ACreep* Choose(const FVector& From, TConstArrayView<ACreep*> InRange) const
		PURE_VIRTUAL(UTargetingStrategy::Choose, return nullptr;);
};

UCLASS(meta = (DisplayName = "Nearest"))
class UNearestTargeting : public UTargetingStrategy
{
	GENERATED_BODY()

public:
	virtual ACreep* Choose(const FVector& From, TConstArrayView<ACreep*> InRange) const override;
};

UCLASS(meta = (DisplayName = "First Along Path"))
class UFirstTargeting : public UTargetingStrategy
{
	GENERATED_BODY()

public:
	virtual ACreep* Choose(const FVector& From, TConstArrayView<ACreep*> InRange) const override;
};

UCLASS(meta = (DisplayName = "Weakest (Prefer Flying)"))
class UWeakestTargeting : public UTargetingStrategy
{
	GENERATED_BODY()

public:
	virtual ACreep* Choose(const FVector& From, TConstArrayView<ACreep*> InRange) const override;

	UPROPERTY(EditAnywhere, Category = "Targeting") bool bPreferFlying = true;   // tunable per turret
};

// TargetingStrategy.cpp
#include "TargetingStrategy.h"
#include "Creep.h"   // ACreep: an actor with Health, PathProgress (0 at the spawn, 1 at the goal), bFlying

ACreep* UNearestTargeting::Choose(const FVector& From, TConstArrayView<ACreep*> InRange) const
{
	ACreep* Best = nullptr;
	double BestDistance = TNumericLimits<double>::Max();
	for (ACreep* C : InRange)
	{
		const double D = FVector::DistSquared(C->GetActorLocation(), From);
		if (D < BestDistance) { Best = C; BestDistance = D; }
	}
	return Best;
}

ACreep* UFirstTargeting::Choose(const FVector& From, TConstArrayView<ACreep*> InRange) const
{
	ACreep* Best = nullptr;
	for (ACreep* C : InRange)
		if (!Best || C->PathProgress > Best->PathProgress) Best = C;
	return Best;
}

ACreep* UWeakestTargeting::Choose(const FVector& From, TConstArrayView<ACreep*> InRange) const
{
	ACreep* Best = nullptr;
	for (ACreep* C : InRange)
	{
		if (!Best) { Best = C; continue; }
		if (bPreferFlying && C->bFlying != Best->bFlying) { if (C->bFlying) Best = C; continue; }
		if (C->Health < Best->Health) Best = C;
	}
	return Best;
}
```

:::

### The context only knows the interface

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public class Turret : MonoBehaviour
{
    [SerializeField] TargetingStrategy targeting;          // chosen per prefab, in the inspector
    [SerializeField] float range = 12f;

    public TargetingStrategy Targeting { get => targeting; set => targeting = value; }   // UI can swap it

    readonly List<ITargetable> inRange = new();
    ITargetable current;

    void Update()
    {
        GatherTargetsInRange(inRange);
        current = targeting.Choose(transform.position, inRange);
        if (current != null) { /* rotate toward current.Position and fire */ }
    }

    void GatherTargetsInRange(List<ITargetable> results)
    {
        results.Clear();
        /* fill from a spatial query within range, e.g. Physics.OverlapSphereNonAlloc + TryGetComponent<ITargetable> */
    }
}
```

```gdscript [Godot (GDScript)]
# turret.gd: the Range child is an Area3D sized to the turret's range;
# each Creep has an Area3D child, so overlapping areas are creeps' hitboxes.
extends Node3D

@export var targeting: TargetingStrategy  # pick a .tres in the inspector; UI can swap it at runtime

@onready var _range: Area3D = $Range


func _physics_process(_delta: float) -> void:
	var in_range: Array[Creep] = []
	for area in _range.get_overlapping_areas():
		var creep := area.get_parent() as Creep
		if creep:
			in_range.append(creep)

	var current := targeting.choose(global_position, in_range)
	if current:
		look_at(current.global_position)  # and fire
```

```cpp [Unreal (C++)]
// Turret.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Turret.generated.h"

class UTargetingStrategy;

UCLASS()
class ATurret : public AActor
{
	GENERATED_BODY()

public:
	ATurret() { PrimaryActorTick.bCanEverTick = true; }

	// Instanced: the Details panel offers every UTargetingStrategy subclass, with its settings inline.
	UPROPERTY(EditAnywhere, Instanced, Category = "Turret") TObjectPtr<UTargetingStrategy> Targeting;
	UPROPERTY(EditAnywhere, Category = "Turret") float Range = 1200.f;

protected:
	virtual void Tick(float DeltaSeconds) override;
};

// Turret.cpp
#include "Turret.h"
#include "Creep.h"
#include "EngineUtils.h"
#include "TargetingStrategy.h"

void ATurret::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!Targeting) return;

	TArray<ACreep*, TInlineAllocator<32>> InRange;
	for (ACreep* Creep : TActorRange<ACreep>(GetWorld()))   // or an overlap query for many actors
		if (FVector::DistSquared(Creep->GetActorLocation(), GetActorLocation()) <= FMath::Square(Range))
			InRange.Add(Creep);

	if (ACreep* Current = Targeting->Choose(GetActorLocation(), InRange))
		SetActorRotation((Current->GetActorLocation() - GetActorLocation()).Rotation());   // and fire
}
```

:::

When a strategy needs no parameters and no inspector support, a plain interface or even a delegate (`Func<Vector3, IReadOnlyList<ITargetable>, ITargetable>`) works just as well.

**Engine notes**

- **Unity:** ScriptableObject strategies are shared assets: every turret using `WeakestTargeting.asset` shares its settings. For per-instance settings, use `[SerializeReference]` with a plain C# class instead.
- **Godot:** An exported `TargetingStrategy` property lists every subclass with a `class_name` under **New …** in the inspector. A saved `.tres` is shared by everything that uses it; turn on **Local To Scene** (or **Make Unique**) for per-instance settings. A `Callable` works as a lightweight strategy when no settings are needed.
- **Unreal:** `EditInlineNew` + `Instanced` gives each turret its own strategy object; for a shared, asset-based strategy like Unity's, derive from `UDataAsset` instead and reference the asset. To swap strategies at runtime, assign a new one: `Targeting = NewObject<UNearestTargeting>(this);`.

## When to use

- Several interchangeable ways to do one job: targeting, movement styles, damage formulas, difficulty rules, AI personalities, save formats, camera behaviours.
- Behaviour that designers or players should choose, or that changes at runtime.
- Replacing a growing `switch` on a "mode" enum.

## When not to use

- A choice that never changes and has only two options. An `if` is clearer.
- Options that differ only in numbers. Use data, such as a [Type Object](./type-object).
- Single-method strategies in C#. A delegate or `Func<>` is often enough without a class hierarchy.

## Pitfalls

- **Strategies that need too much context.** If a strategy needs ten parameters from the context, the interface is wrong. Pass a small context object, or reconsider the split.
- **State in shared assets.** A ScriptableObject strategy is shared by every turret that uses it. Storing per-turret state in it (such as "the last target") mixes turrets up. Keep strategies stateless, and keep state in the context.
- **Over-engineering.** Two fixed options that will never change are clearer as an `if`. Introduce strategies when the variation is real.
- **Allocation per call.** LINQ in strategies (`inRange.OrderBy(...)`) allocates every frame. Write the loops by hand in hot paths.

## Related

- [State](./state) — similar structure, but states switch *themselves*. Strategies are chosen from outside.
- [Type Object](./type-object) — a type asset can reference strategy assets to vary behaviour per kind.
- [ScriptableObject Architecture](./scriptable-object-architecture) — strategies as assets.
- [Template Method](./template-method) — varies steps of one algorithm through inheritance, rather than swapping the whole algorithm.
