# Bridge

> Split two dimensions that vary independently into two hierarchies (weapons × delivery mechanisms).

**Also known as:** Handle/Body · **Category:** Architecture & Structure

## Problem

A spell system has four **deliveries** (beam, nova, projectile, cone) and four **elements** (fire, force, frost, poison). Designers want every combination, so the first version has a class per pair: `FireBeam`, `FireNova`, `ForceBeam`, `FrostCone`… Sixteen classes, and every new element adds four more. The burning logic is pasted into four fire classes, and when the burn duration changes, the fix lands in three of them. The nova's hit detection is pasted into four nova classes, and only one of them got the "don't hit yourself" check.

The two choices have nothing to do with each other. *How* a spell reaches its targets does not depend on *what* it does when it hits them, but the class hierarchy forces them into one.

## Solution

Give each dimension its own hierarchy and connect them with a reference, the **bridge**:

- **Abstraction:** `Delivery` (beam, nova…): the side callers use. It finds the targets.
- **Implementor:** `Element` (fire, force…): the side the abstraction delegates to. It decides what happens to each target.
- Each delivery **holds an element** and calls it for every target it finds.

```
Delivery ───────────────► Element
├─ Beam                   ├─ Fire
├─ Nova                   ├─ Force
└─ Projectile             └─ Frost
```

Four deliveries and four elements are now eight classes instead of sixteen, and a new element works with every delivery immediately. Each hierarchy grows on its own.

Other game examples of the same split: renderable shapes × render back ends (a debug-draw back end and a real mesh back end), weapons × firing mechanisms (hitscan, projectile, melee sweep), and UI widgets × input platforms.

It is easy to confuse Bridge with its neighbours, because the code looks alike: one object holding a reference to another behind an interface.

| Pattern | What it is for |
| --- | --- |
| **Bridge** | Designed up front, so two dimensions can vary independently. *Both* sides have subclasses. |
| [Adapter](./adapter) | Added after the fact, to make an existing interface fit the one you need. |
| [Strategy](./strategy) | One object swaps *one* behaviour. The object holding it usually has no subclasses of its own. |
| [Decorator](./decorator) | Wraps an object with the *same* interface to add to its behaviour. |

A bridge is often described as "a strategy whose holder also has subclasses". The difference is intent: a strategy is about swapping an algorithm, a bridge is about keeping two hierarchies from multiplying into each other.

## Pseudocode

```text
// Implementor: WHAT happens to each target.
Element:
    tint
    apply(target, direction, power)

Fire is an Element:
    apply(target, direction, power):
        target takes power damage
        target gains "burning" for 3 seconds

Force is an Element:
    apply(target, direction, power):
        target takes power × 0.25 damage
        push target along direction × power     // knockback instead of damage

// Abstraction: HOW the spell finds its targets.
Delivery:
    element                       // the bridge
    cast(origin, direction, power)

Beam is a Delivery:
    range
    cast(origin, direction, power):
        target ← first hittable thing along a ray from origin, up to range
        if target found: element.apply(target, direction, power)

Nova is a Delivery:
    radius
    cast(origin, direction, power):
        for each hittable target within radius of origin, except the caster:
            away ← direction from origin to target
            element.apply(target, away, power × 0.5)   // everyone, for less

// Any delivery takes any element: two choices, no class per pair.
spell ← new Nova(element = new Force, radius = 6)
spell.cast(caster position, caster forward, 20)
```

## Example

Spells built from a delivery and an element. The first group defines both hierarchies; the second lets a designer combine them on a caster.

### Two hierarchies

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

// What a spell can do to a target. Health, status and physics components implement it.
public interface IHittable
{
    Vector3 Position { get; }
    void TakeDamage(float amount);
    void AddStatus(string statusId, float seconds);
    void Push(Vector3 impulse);
}

// ── Implementor hierarchy: WHAT happens to each target ──
public abstract class Element
{
    public abstract Color Tint { get; }
    public abstract void Apply(IHittable target, Vector3 direction, float power);
}

public class FireElement : Element
{
    public override Color Tint => new Color(1f, 0.45f, 0.1f);
    public override void Apply(IHittable target, Vector3 direction, float power)
    {
        target.TakeDamage(power);
        target.AddStatus("burning", 3f);
    }
}

public class ForceElement : Element
{
    public override Color Tint => new Color(0.6f, 0.7f, 1f);
    public override void Apply(IHittable target, Vector3 direction, float power)
    {
        target.TakeDamage(power * 0.25f);
        target.Push(direction * power);                     // knockback instead of damage
    }
}

// ── Abstraction hierarchy: HOW the spell reaches its targets ──
public abstract class Delivery
{
    protected readonly Element element;                     // the bridge
    protected Delivery(Element element) => this.element = element;

    public abstract void Cast(Vector3 origin, Vector3 direction, float power);
}

public class Beam : Delivery
{
    readonly float range;
    public Beam(Element element, float range) : base(element) => this.range = range;

    public override void Cast(Vector3 origin, Vector3 direction, float power)
    {
        if (Physics.Raycast(origin, direction, out var hit, range) &&
            hit.collider.TryGetComponent(out IHittable target))
            element.Apply(target, direction, power);
        Debug.DrawRay(origin, direction * range, element.Tint, 0.2f);
    }
}

public class Nova : Delivery
{
    static readonly Collider[] buffer = new Collider[32];
    readonly float radius;
    public Nova(Element element, float radius) : base(element) => this.radius = radius;

    public override void Cast(Vector3 origin, Vector3 direction, float power)
    {
        int count = Physics.OverlapSphereNonAlloc(origin, radius, buffer);
        for (int i = 0; i < count; i++)
        {
            if (!buffer[i].TryGetComponent(out IHittable target)) continue;
            var away = target.Position - origin;
            if (away.sqrMagnitude < 0.01f) continue;        // the caster itself
            element.Apply(target, away.normalized, power * 0.5f);   // hits everyone, for less
        }
    }
}

// Projectile and Cone follow the same shape; Frost and Poison follow Fire's.
```

```gdscript [Godot (GDScript)]
# Both hierarchies are Resources, so a designer can build a spell in the Inspector:
# pick a Delivery for the caster, then pick an Element inside it.
# Targets are duck-typed: anything with take_damage() can be hit.

# element.gd: implementor hierarchy, WHAT happens to each target.
class_name Element
extends Resource

@export var tint := Color.WHITE

func apply(_target: Object, _direction: Vector3, _power: float) -> void:
	pass


# fire_element.gd
class_name FireElement
extends Element

func apply(target: Object, _direction: Vector3, power: float) -> void:
	target.take_damage(power)
	if target.has_method("add_status"):
		target.add_status(&"burning", 3.0)


# force_element.gd
class_name ForceElement
extends Element

func apply(target: Object, direction: Vector3, power: float) -> void:
	target.take_damage(power * 0.25)
	if target.has_method("push"):
		target.push(direction * power)  # knockback instead of damage


# delivery.gd: abstraction hierarchy, HOW the spell reaches its targets.
class_name Delivery
extends Resource

@export var element: Element  # the bridge

func cast(_caster: Node3D, _power: float) -> void:
	pass


# beam.gd
class_name Beam
extends Delivery

@export var length := 30.0

func cast(caster: Node3D, power: float) -> void:
	var direction := -caster.global_transform.basis.z
	var from := caster.global_position
	var query := PhysicsRayQueryParameters3D.create(from, from + direction * length)
	if caster is CollisionObject3D:
		query.exclude = [(caster as CollisionObject3D).get_rid()]
	var hit := caster.get_world_3d().direct_space_state.intersect_ray(query)
	if hit and hit.collider.has_method("take_damage"):
		element.apply(hit.collider, direction, power)


# nova.gd
class_name Nova
extends Delivery

@export var radius := 6.0

func cast(caster: Node3D, power: float) -> void:
	var sphere := SphereShape3D.new()
	sphere.radius = radius
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = sphere
	query.transform = Transform3D(Basis(), caster.global_position)
	for result in caster.get_world_3d().direct_space_state.intersect_shape(query, 32):
		var target: Object = result.collider
		if target == caster or not target.has_method("take_damage"):
			continue
		var away: Vector3 = (target.global_position - caster.global_position).normalized()
		element.apply(target, away, power * 0.5)  # hits everyone, for less
```

```cpp [Unreal (C++)]
// Spells.h: both hierarchies are instanced UObjects, so a designer picks a delivery
// in the Details panel and then picks an element inside it.
#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "DrawDebugHelpers.h"
#include "Engine/OverlapResult.h"
#include "Engine/World.h"
#include "GameFramework/Character.h"
#include "Kismet/GameplayStatics.h"
#include "Spells.generated.h"

// ── Implementor hierarchy: WHAT happens to each target ──
UCLASS(Abstract, EditInlineNew, DefaultToInstanced)
class USpellElement : public UObject
{
	GENERATED_BODY()

public:
	virtual void Apply(AActor* Target, const FVector& Direction, float Power, AActor* Caster) const
		PURE_VIRTUAL(USpellElement::Apply, );

	UPROPERTY(EditAnywhere) FLinearColor Tint = FLinearColor::White;
};

UCLASS()
class UFireElement : public USpellElement
{
	GENERATED_BODY()

public:
	virtual void Apply(AActor* Target, const FVector& Direction, float Power, AActor* Caster) const override
	{
		UGameplayStatics::ApplyDamage(Target, Power, Caster->GetInstigatorController(), Caster, BurnDamageType);
		// Burning over time: a GameplayEffect, or the Status Effects component.
	}

	UPROPERTY(EditAnywhere) TSubclassOf<UDamageType> BurnDamageType;
};

UCLASS()
class UForceElement : public USpellElement
{
	GENERATED_BODY()

public:
	virtual void Apply(AActor* Target, const FVector& Direction, float Power, AActor* Caster) const override
	{
		UGameplayStatics::ApplyDamage(Target, Power * 0.25f, Caster->GetInstigatorController(), Caster, nullptr);
		if (ACharacter* Character = Cast<ACharacter>(Target))
			Character->LaunchCharacter(Direction * Power * 10.f, true, false);   // knockback instead of damage
	}
};

// ── Abstraction hierarchy: HOW the spell reaches its targets ──
UCLASS(Abstract, EditInlineNew, DefaultToInstanced)
class USpellDelivery : public UObject
{
	GENERATED_BODY()

public:
	virtual void Cast(AActor* Caster, float Power) const PURE_VIRTUAL(USpellDelivery::Cast, );

protected:
	UPROPERTY(EditAnywhere, Instanced) TObjectPtr<USpellElement> Element;   // the bridge
};

UCLASS()
class UBeamDelivery : public USpellDelivery
{
	GENERATED_BODY()

public:
	virtual void Cast(AActor* Caster, float Power) const override
	{
		if (!Element) return;
		const FVector Direction = Caster->GetActorForwardVector();
		const FVector Start = Caster->GetActorLocation();
		const FVector End = Start + Direction * Range;
		FCollisionQueryParams Params;
		Params.AddIgnoredActor(Caster);
		FHitResult Hit;
		if (Caster->GetWorld()->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Params) && Hit.GetActor())
			Element->Apply(Hit.GetActor(), Direction, Power, Caster);
		DrawDebugLine(Caster->GetWorld(), Start, End, Element->Tint.ToFColor(true), false, 0.2f);
	}

	UPROPERTY(EditAnywhere) float Range = 3000.f;
};

UCLASS()
class UNovaDelivery : public USpellDelivery
{
	GENERATED_BODY()

public:
	virtual void Cast(AActor* Caster, float Power) const override
	{
		if (!Element) return;
		const FVector Origin = Caster->GetActorLocation();
		FCollisionQueryParams Params;
		Params.AddIgnoredActor(Caster);
		TArray<FOverlapResult> Overlaps;
		Caster->GetWorld()->OverlapMultiByChannel(Overlaps, Origin, FQuat::Identity, ECC_Pawn,
			FCollisionShape::MakeSphere(Radius), Params);

		TSet<AActor*> Done;                  // an actor with several components overlaps more than once
		for (const FOverlapResult& Overlap : Overlaps)
		{
			AActor* Target = Overlap.GetActor();
			if (!Target || Done.Contains(Target)) continue;
			Done.Add(Target);
			const FVector Away = (Target->GetActorLocation() - Origin).GetSafeNormal();
			Element->Apply(Target, Away, Power * 0.5f, Caster);   // hits everyone, for less
		}
	}

	UPROPERTY(EditAnywhere) float Radius = 600.f;
};
```

:::

### Combining them

Any delivery works with any element, so the caster only has to pick one of each.

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class SpellCaster : MonoBehaviour
{
    public enum DeliveryKind { Beam, Nova }
    public enum ElementKind { Fire, Force }

    [SerializeField] DeliveryKind delivery;
    [SerializeField] ElementKind element;
    [SerializeField] float power = 20f;

    Delivery spell;

    // Two lists of choices, not one list of every combination. A new element is one line here.
    void Awake()
    {
        Element e = element == ElementKind.Fire ? new FireElement() : new ForceElement();
        spell = delivery == DeliveryKind.Beam ? new Beam(e, 30f) : new Nova(e, 6f);
    }

    public void Cast() => spell.Cast(transform.position, transform.forward, power);
}
```

```gdscript [Godot (GDScript)]
# spell_caster.gd: in the Inspector, set Spell to a new Nova, then its Element to a new
# ForceElement. Every combination is built the same way, with no code per pair.
class_name SpellCaster
extends Node3D

@export var spell: Delivery
@export var power := 20.0


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("cast") and spell:
		spell.cast(self, power)
```

```cpp [Unreal (C++)]
// SpellCasterComponent.h: in the Details panel, set Spell to a Nova Delivery, then its
// Element to a Force Element. Every combination is built the same way, with no code per pair.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Spells.h"
#include "SpellCasterComponent.generated.h"

UCLASS(ClassGroup = (Gameplay), meta = (BlueprintSpawnableComponent))
class USpellCasterComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, Category = "Spells")
	void CastSpell()
	{
		if (Spell) Spell->Cast(GetOwner(), Power);
	}

	UPROPERTY(EditAnywhere, Instanced, Category = "Spells") TObjectPtr<USpellDelivery> Spell;
	UPROPERTY(EditAnywhere, Category = "Spells") float Power = 20.f;
};
```

:::

**Engine notes**

- **Unity:** plain classes keep the example short. For designer-built spells, make `Element` a `ScriptableObject` (one asset per element) and let the delivery reference it, or store both sides with `[SerializeReference]`, which needs a small custom drawer to pick the subclass in the Inspector. `Physics.OverlapSphereNonAlloc` fills a buffer you own, so casting doesn't allocate.
- **Godot:** making both sides `Resource`s gives the Inspector a built-in type picker for each slot, which is the bridge with no extra tooling. With no interfaces, targets are duck-typed with `has_method()`; a shared base class or a `Hurtbox` node is the stricter alternative. A resource shared by several casters is shared state, so tick **Local to Scene** if a delivery keeps per-caster data.
- **Unreal:** `EditInlineNew` + `Instanced` gives the same inline class picker in the Details panel. Since UE 5.3 `FOverlapResult` needs `Engine/OverlapResult.h`. GAS covers this split at a larger scale: abilities decide how targets are found (target actors, montages) and gameplay effects decide what happens to them.

## When to use

- Two dimensions vary independently and you want every combination: deliveries × elements, weapons × firing mechanisms, shapes × render back ends.
- Subclassing has already started to multiply (`FireBeam`, `FrostBeam`, `FireNova`…), or copies of the same logic have started to drift apart.
- One side must be swapped per platform or per build while the other stays the same (gameplay widgets over different input back ends).

## When not to use

- Only one dimension varies. Hold one swappable behaviour as a [Strategy](./strategy), or just write the few subclasses.
- The "dimensions" are really data: if fire and frost differ only in damage, colour and a status id, one element class with fields, or a [Type Object](./type-object), replaces the implementor hierarchy.
- The combinations are few and fixed (two deliveries, two elements, never more). Four small classes are easier to read than two hierarchies.

## Pitfalls

- **The implementor interface fits only the first abstraction.** If `Element.Apply` takes a hit point, a nova with no single hit point has to invent one. Design the implementor interface from what *every* abstraction can supply.
- **Combinations that make no sense.** "Frost projectile that heals" is reachable once everything combines. Validate combinations in the editor, or make the odd ones work.
- **Logic leaking across the bridge.** A beam that checks `element is FireElement` to add a fire trail undoes the split. Ask the element for what it needs (`element.Tint`, `element.TrailEffect`).
- **Two hierarchies where one would do.** If the second hierarchy never grows past one class, it is indirection with no benefit. Merge it back.

## Related

- [Strategy](./strategy) — swaps one behaviour. A bridge separates two hierarchies that both grow.
- [Adapter](./adapter) — makes an existing interface fit after the fact. A bridge is designed up front so both sides can vary.
- [Abstract Factory](./abstract-factory) — can create the matching implementor for a platform or build.
- [Decorator](./decorator) — wraps one object with the same interface to add behaviour, rather than delegating to a separate hierarchy.
- [Component](./component) — the same "compose instead of subclass" idea applied to whole entities.
