# Health / Damageable Interface

> One interface lets anything take damage without the attacker knowing its type.

**Category:** Gameplay Systems

## Problem

The sword script checks what it hit: `if (other is Enemy) ... else if (other is Player) ... else if (other is Crate)`. Every new destructible type means editing every weapon. The player can die twice in one frame, playing the death animation twice and awarding two game-overs. Hits on a child collision shape (the head) do not find the health on the root object. Enemies keep taking damage while their death animation plays, and nobody can tell *who* dealt the killing blow.

## Solution

Two small pieces:

- **`IDamageable`**: the contract every damage source uses. `TakeDamage(DamageInfo)` is all a weapon needs to know.
- **`Health`**: the standard implementation. It holds current and max health, handles **invulnerability windows** (i-frames), guarantees **exactly one death**, and raises **events** (`Damaged`, `Healed`, `Died`) for UI, audio, AI and loot to react to.

`DamageInfo` is a small struct describing the hit: amount, type, source and point. Listeners know who did what, and later a [Damage Pipeline](./damage-pipeline) can transform it.

**Hurtboxes** on child colliders forward hits to the `Health` on the root, optionally with a multiplier (head ×2, armour plate ×0.5).

## Example

A health component with i-frames and events, plus hurtboxes that scale damage by body part. Weapons only know "something damageable", never the concrete class.

::: code-group

```csharp [Unity (C#)]
using System;
using UnityEngine;

public enum DamageType { Physical, Fire, Ice, Poison, True }

public struct DamageInfo
{
    public float Amount;
    public DamageType Type;
    public GameObject Source;        // who caused it: kill credit, aggro, thorns
    public Vector3 Point;            // where: hit effects, knockback direction
    public bool IsCritical;
}

public interface IDamageable
{
    bool IsAlive { get; }
    void TakeDamage(DamageInfo info);
}

public class Health : MonoBehaviour, IDamageable
{
    [SerializeField] float max = 100f;
    [SerializeField] float invulnerableAfterHit = 0f;      // i-frames, e.g. 0.5 s for the player

    public float Current { get; private set; }
    public float Max => max;
    public bool IsAlive => Current > 0f;
    public float Fraction => Current / max;

    public event Action<DamageInfo> Damaged;
    public event Action<float> Healed;
    public event Action<DamageInfo> Died;                  // carries the killing blow

    float invulnerableUntil;

    void Awake() => Current = max;

    public void TakeDamage(DamageInfo info)
    {
        if (!IsAlive || info.Amount <= 0f) return;          // no damage after death
        if (Time.time < invulnerableUntil) return;          // i-frames

        Current = Mathf.Max(0f, Current - info.Amount);
        invulnerableUntil = Time.time + invulnerableAfterHit;
        Damaged?.Invoke(info);

        if (Current <= 0f) Died?.Invoke(info);              // exactly once: IsAlive is false from now on
    }

    public void Heal(float amount)
    {
        if (!IsAlive || amount <= 0f) return;               // healing doesn't revive
        float before = Current;
        Current = Mathf.Min(max, Current + amount);
        if (Current > before) Healed?.Invoke(Current - before);
    }

    public void Revive(float fraction = 1f)
    {
        Current = max * Mathf.Clamp01(fraction);
        invulnerableUntil = 0f;
    }
}

// On child colliders: forwards hits to the root's Health, with a location multiplier.
public class Hurtbox : MonoBehaviour, IDamageable
{
    [SerializeField] Health owner;
    [SerializeField] float multiplier = 1f;                 // head 2.0, armour plate 0.5

    public bool IsAlive => owner.IsAlive;

    public void TakeDamage(DamageInfo info)
    {
        info.Amount *= multiplier;                          // DamageInfo is a struct: this is our copy
        owner.TakeDamage(info);
    }

    void Reset() => owner = GetComponentInParent<Health>();
}
```

```gdscript [Godot (GDScript)]
# damage_info.gd
class_name DamageInfo
extends RefCounted

enum Type { PHYSICAL, FIRE, ICE, POISON, TRUE_DAMAGE }

var amount: float
var type: Type
var source: Node  # who caused it: kill credit, aggro, thorns
var point: Vector3  # where: hit effects, knockback direction
var is_critical := false


func _init(p_amount := 0.0, p_type := Type.PHYSICAL, p_source: Node = null, p_point := Vector3.ZERO) -> void:
	amount = p_amount
	type = p_type
	source = p_source
	point = p_point


# DamageInfo is an object, shared by reference: anything that changes the amount works on a copy.
func with_amount(new_amount: float) -> DamageInfo:
	var copy := DamageInfo.new(new_amount, type, source, point)
	copy.is_critical = is_critical
	return copy


# health.gd: a child node of anything that can be hurt.
class_name Health
extends Node

signal damaged(info: DamageInfo)
signal healed(amount: float)
signal died(info: DamageInfo)  # carries the killing blow

@export var max_health := 100.0  # not "max": that shadows the built-in function
@export var invulnerable_after_hit := 0.0  # i-frames, e.g. 0.5 s for the player

var current := 0.0
var _invulnerable_left := 0.0


func _ready() -> void:
	current = max_health


func _process(delta: float) -> void:
	_invulnerable_left = maxf(0.0, _invulnerable_left - delta)  # game time: stops while paused


func is_alive() -> bool:
	return current > 0.0


func take_damage(info: DamageInfo) -> void:
	if not is_alive() or info.amount <= 0.0:
		return  # no damage after death
	if _invulnerable_left > 0.0:
		return  # i-frames
	current = maxf(0.0, current - info.amount)
	_invulnerable_left = invulnerable_after_hit
	damaged.emit(info)
	if current <= 0.0:
		died.emit(info)  # exactly once: is_alive() is false from now on


func heal(amount: float) -> void:
	if not is_alive() or amount <= 0.0:
		return  # healing doesn't revive
	var before := current
	current = minf(max_health, current + amount)
	if current > before:
		healed.emit(current - before)


func revive(fraction := 1.0) -> void:
	current = max_health * clampf(fraction, 0.0, 1.0)
	_invulnerable_left = 0.0


# hurtbox.gd: an Area3D on a body part that forwards hits to the character's Health.
class_name Hurtbox
extends Area3D

@export var health: Health  # not "owner": every Node already has an owner property
@export var multiplier := 1.0  # head 2.0, armour plate 0.5


func take_damage(info: DamageInfo) -> void:
	health.take_damage(info.with_amount(info.amount * multiplier))
```

```cpp [Unreal (C++)]
// HealthComponent.h: damage is built into AActor. UGameplayStatics::ApplyDamage calls the target's
// TakeDamage, which broadcasts OnTakeAnyDamage; this component listens to that.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "HealthComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnDamaged, float, Amount, AActor*, Causer);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnHealed, float, Amount);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnDied, AActor*, Killer);    // the killing blow's causer

UCLASS(ClassGroup = (Gameplay), meta = (BlueprintSpawnableComponent))
class UHealthComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Health") float Max = 100.f;
	UPROPERTY(EditAnywhere, Category = "Health") float InvulnerableAfterHit = 0.f;   // i-frames

	UPROPERTY(BlueprintAssignable) FOnDamaged OnDamaged;
	UPROPERTY(BlueprintAssignable) FOnHealed OnHealed;
	UPROPERTY(BlueprintAssignable) FOnDied OnDied;

	UFUNCTION(BlueprintPure, Category = "Health") bool IsAlive() const { return Current > 0.f; }
	UFUNCTION(BlueprintPure, Category = "Health") float GetCurrent() const { return Current; }
	UFUNCTION(BlueprintCallable, Category = "Health") void Heal(float Amount);
	UFUNCTION(BlueprintCallable, Category = "Health") void Revive(float Fraction = 1.f);

protected:
	virtual void BeginPlay() override;

private:
	UFUNCTION()
	void HandleAnyDamage(AActor* DamagedActor, float Damage, const UDamageType* DamageType,
		AController* InstigatedBy, AActor* DamageCauser);

	float Current = 0.f;
	float InvulnerableUntil = 0.f;
};

// HealthComponent.cpp
#include "HealthComponent.h"

void UHealthComponent::BeginPlay()
{
	Super::BeginPlay();
	Current = Max;
	GetOwner()->OnTakeAnyDamage.AddDynamic(this, &UHealthComponent::HandleAnyDamage);
}

void UHealthComponent::HandleAnyDamage(AActor*, float Damage, const UDamageType*, AController*, AActor* DamageCauser)
{
	const float Now = GetWorld()->GetTimeSeconds();
	if (!IsAlive() || Damage <= 0.f || Now < InvulnerableUntil) return;

	Current = FMath::Max(0.f, Current - Damage);
	InvulnerableUntil = Now + InvulnerableAfterHit;
	OnDamaged.Broadcast(Damage, DamageCauser);
	if (Current <= 0.f) OnDied.Broadcast(DamageCauser);              // exactly once
}

void UHealthComponent::Heal(float Amount)
{
	if (!IsAlive() || Amount <= 0.f) return;                        // healing doesn't revive
	const float Before = Current;
	Current = FMath::Min(Max, Current + Amount);
	if (Current > Before) OnHealed.Broadcast(Current - Before);
}

void UHealthComponent::Revive(float Fraction)
{
	Current = Max * FMath::Clamp(Fraction, 0.f, 1.f);
	InvulnerableUntil = 0.f;
}

// EnemyCharacter.cpp: Unreal's "hurtbox" is the hit bone. Point damage carries the FHitResult,
// so the actor scales it before the engine broadcasts OnTakeAnyDamage.
float AEnemyCharacter::TakeDamage(float Damage, const FDamageEvent& DamageEvent, AController* EventInstigator, AActor* DamageCauser)
{
	if (DamageEvent.IsOfType(FPointDamageEvent::ClassID))
	{
		const FPointDamageEvent& Point = static_cast<const FPointDamageEvent&>(DamageEvent);
		if (Point.HitInfo.BoneName == TEXT("head")) Damage *= 2.f;
	}
	return Super::TakeDamage(Damage, DamageEvent, EventInstigator, DamageCauser);
}
```

:::

Weapons only know the damage entry point:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class MeleeWeapon : MonoBehaviour
{
    void OnTriggerEnter(Collider other)
    {
        // Hurtboxes on children are found first; otherwise fall back to the parent's Health.
        if (!other.TryGetComponent(out IDamageable target))
            target = other.GetComponentInParent<IDamageable>();

        target?.TakeDamage(new DamageInfo
        {
            Amount = 25f, Type = DamageType.Physical, Source = gameObject, Point = other.ClosestPoint(transform.position),
        });
    }
}
```

```gdscript [Godot (GDScript)]
# weapon_hitbox.gd: an Area3D whose collision mask includes the hurtbox layer.
# Give enemies without location damage one Hurtbox that covers the whole body.
extends Area3D

@export var damage := 25.0


func _ready() -> void:
	area_entered.connect(_on_area_entered)


func _on_area_entered(area: Area3D) -> void:
	# GDScript has no interfaces: check the class (or duck-type with has_method).
	var hurtbox := area as Hurtbox
	if hurtbox:
		# owner: the root of the scene this hitbox is saved in, i.e. the attacker.
		hurtbox.take_damage(DamageInfo.new(damage, DamageInfo.Type.PHYSICAL, owner, area.global_position))
```

```cpp [Unreal (C++)]
// Weapon.h (excerpt)
UFUNCTION()
void OnHitboxOverlap(UPrimitiveComponent* OverlappedComp, AActor* Other, UPrimitiveComponent* OtherComp,
	int32 OtherBodyIndex, bool bFromSweep, const FHitResult& Sweep);

// Weapon.cpp
#include "Kismet/GameplayStatics.h"

void AWeapon::BeginPlay()
{
	Super::BeginPlay();
	Hitbox->OnComponentBeginOverlap.AddDynamic(this, &AWeapon::OnHitboxOverlap);   // UPROPERTY() UBoxComponent* Hitbox
}

void AWeapon::OnHitboxOverlap(UPrimitiveComponent*, AActor* Other, UPrimitiveComponent*, int32, bool bFromSweep, const FHitResult& Sweep)
{
	if (!Other || Other == GetOwner()) return;
	AController* By = GetInstigatorController();                   // kill credit and aggro
	if (bFromSweep)                                                // the sweep has the bone: allows headshots
	{
		const FVector Direction = (Other->GetActorLocation() - GetActorLocation()).GetSafeNormal();
		UGameplayStatics::ApplyPointDamage(Other, 25.f, Direction, Sweep, By, this, UDamageType::StaticClass());
	}
	else
	{
		UGameplayStatics::ApplyDamage(Other, 25.f, By, this, UDamageType::StaticClass());
	}
}
```

:::

Everything else reacts to events: the health bar listens to the damaged and healed events, the loot dropper and score listen to died, and AI uses the damage source to pick who to fight back against.

**Engine notes**

- **Unity:** `target?.` is safe in the weapon because `target` is a C# interface reference returned this frame. The destroyed-object problem only applies to stored `UnityEngine.Object` references. `GetComponentInParent<IDamageable>()` works with interfaces.
- **Godot:** there are no interfaces, so duck typing (`has_method`) or a shared base class does the job. Don't name an exported reference `owner` (every node already has one) or a variable `max` (a built-in function). `DamageInfo` is a reference type, so `with_amount` copies it before a hurtbox scales it.
- **Unreal:** damage is built in: `ApplyDamage`, `ApplyPointDamage` and `ApplyRadialDamage` call `AActor::TakeDamage`, which fires `OnTakeAnyDamage` (and `OnTakePointDamage` / `OnTakeRadialDamage`). Damage types are `UDamageType` subclasses. The actor must have **Can Be Damaged** enabled (the default). In a GAS project, health is usually an attribute and damage a Gameplay Effect instead (see [Damage Pipeline](./damage-pipeline)).

## When to use

- Every game where more than one kind of thing can be damaged: players, enemies, props, vehicles, buildings.
- When weapons, traps, explosions and status effects should all hurt things in the same way.

## When not to use

- Games where only the player can be damaged, and only in one way. A health field on the player is enough.
- One-hit objects such as pickups or breakable crates. A simple `OnHit` call or destroy is clearer.

## Pitfalls

- **Double death.** Two hits in the same frame both see `Current <= 0` and raise `Died` twice, unless the "already dead" check comes first, as above.
- **Hitting several hurtboxes of one character.** An explosion overlapping the head, chest and arm hurtboxes damages the same character three times. Deduplicate by owner per attack.
- **Damage after death.** The death animation keeps colliders active, so the corpse soaks up bullets and plays hit effects. Ignore damage when not alive, and disable hurtboxes on death.
- **Integer health.** Fractional damage (DoT ticks, multipliers) rounds away with `int`. Use `float` internally, and round only for display.
- **Event order.** Listeners to `Died` that destroy the object (or return it to a pool) can break other listeners that run after them. Defer destruction to the end of the frame, or have one owner handle it.

## Related

- [Damage Pipeline](./damage-pipeline) — transforms `DamageInfo` before it reaches `Health`: armour, resistances, shields.
- [Component](./component) — `Health` is the classic reusable component.
- [Observer](./observer) — `Damaged`, `Healed` and `Died` drive UI, audio, loot and AI.
- [Status Effects](./status-effects) — damage over time goes through the same interface.
- [Juicy Combat Hits](../recipes/juicy-combat-hits) — feedback built on top of these events.
