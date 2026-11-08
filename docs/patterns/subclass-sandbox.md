# Subclass Sandbox

> A base class offers a set of safe operations that subclasses compose into behaviour.

**Category:** Architecture & Structure

## Problem

A superhero game has dozens of powers: Sky Launch, Ground Slam, Lightning Arc, Phase Dash. Each is a subclass, and each one reaches into whatever systems it needs: it finds the audio manager, spawns particles its own way, applies physics forces directly, queries enemies with its own overlap code. Soon every power depends on every engine system, the same tasks are done ten different ways, and changing how particles spawn means editing forty classes. Power designers, often junior programmers or technical designers, need to touch dangerous parts of the codebase to add simple effects.

## Solution

Give the base class a **toolbox of protected operations**, the **sandbox**, and one abstract method that subclasses implement **using only those operations**:

- The base class provides `PlaySound`, `SpawnEffect`, `Launch`, `DamageInArea`, `Wait`: small, safe, consistent building blocks.
- Subclasses implement `Activate()` by **composing** those calls. They do not touch audio, physics or effects systems directly.
- All coupling to engine systems lives in the **one** base class. Change how effects spawn there, and every power changes with it.

It is the opposite of [Template Method](./template-method): instead of the base class calling the subclass's steps in a fixed order, the subclass freely calls the base class's tools.

## Pseudocode

```text
// The base class owns every link to engine systems and offers them
// as a small set of safe operations: the sandbox.
Power:
    cooldown
    ready_at ← 0

    // ── The sandbox: the only operations powers may use ──
    play_sound(cue)                  // through the audio service
    spawn_effect(effect, at)         // removed again after a short lifetime
    launch(velocity)                 // set the owner's velocity
    damage_in_area(center, radius, damage):
        for each target overlapping the sphere, except the owner:
            if target can take damage: target.take_damage(damage)
    is_grounded()
    wait(seconds)

    activate()                       // each power fills this in

    try_use():
        if now < ready_at: return false
        ready_at ← now + cooldown
        start activate()             // may run over several frames
        return true

// A power only composes sandbox calls.
GroundSlam is a Power:
    activate():
        play_sound(jump_sound)
        launch(up × 12)
        wait(0.35)
        launch(down × 30)
        wait until is_grounded()
        play_sound(slam_sound)
        spawn_effect(shockwave, owner position)
        damage_in_area(owner position, radius 5, damage 40)

SkyLaunch is a Power:
    activate():
        play_sound(whoosh)
        spawn_effect(trail, owner position)
        launch(up × 20)
```

## Example

A base class for powers provides a small set of safe operations; each power is a short subclass that uses only those.

::: code-group

```csharp [Unity (C#)]
using System.Collections;
using UnityEngine;

public abstract class Power : MonoBehaviour
{
    [SerializeField] protected float cooldown = 3f;
    float readyAt;

    // ── The sandbox: the ONLY operations powers may use ──

    protected Transform Owner => transform;

    protected void PlaySound(SoundCue cue) => Services.Get<IAudio>().PlaySfx(cue, Owner.position);

    protected void SpawnEffect(GameObject effect, Vector3 at, float lifetime = 2f) =>
        Destroy(Instantiate(effect, at, Quaternion.identity), lifetime);            // pooled in production

    protected void Launch(Vector3 velocity)
    {
        var body = Owner.GetComponent<Rigidbody>();
        body.linearVelocity = Vector3.zero;
        body.AddForce(velocity, ForceMode.VelocityChange);
    }

    protected int DamageInArea(Vector3 center, float radius, float damage)
    {
        int hits = 0;
        foreach (var c in Physics.OverlapSphere(center, radius))
        {
            if (c.transform.root == Owner.root) continue;                              // never hit yourself
            if (c.TryGetComponent(out IDamageable d))
            {
                d.TakeDamage(new DamageInfo { Amount = damage, Source = Owner.gameObject, Point = c.transform.position });
                hits++;
            }
        }
        return hits;
    }

    protected bool IsGrounded() => Physics.Raycast(Owner.position + Vector3.up * 0.1f, Vector3.down, 0.3f);

    protected IEnumerator Wait(float seconds) { yield return new WaitForSeconds(seconds); }

    // ── What subclasses implement ──
    protected abstract IEnumerator Activate();

    public bool TryUse()
    {
        if (Time.time < readyAt) return false;
        readyAt = Time.time + cooldown;
        StartCoroutine(Activate());
        return true;
    }
}

// Powers are short, readable, and touch nothing but the sandbox.
public class GroundSlam : Power
{
    [SerializeField] SoundCue jumpSound, slamSound;
    [SerializeField] GameObject shockwave;

    protected override IEnumerator Activate()
    {
        PlaySound(jumpSound);
        Launch(Vector3.up * 12f);
        yield return Wait(0.35f);
        Launch(Vector3.down * 30f);
        while (!IsGrounded()) yield return null;
        PlaySound(slamSound);
        SpawnEffect(shockwave, Owner.position);
        DamageInArea(Owner.position, radius: 5f, damage: 40f);
    }
}

public class SkyLaunch : Power
{
    [SerializeField] SoundCue whoosh;
    [SerializeField] GameObject trail;

    protected override IEnumerator Activate()
    {
        PlaySound(whoosh);
        SpawnEffect(trail, Owner.position, lifetime: 1f);
        Launch(Vector3.up * 20f);
        yield break;
    }
}
```

```gdscript [Godot (GDScript)]
# power.gd: a child node of a RigidBody3D. GDScript has no "protected", so the sandbox is a
# convention: powers call only the methods in this section.
class_name Power
extends Node

@export var cooldown := 3.0
var _ready_at := 0.0

# ── The sandbox: the ONLY operations powers may use ──

var body: RigidBody3D:
	get:
		return get_parent() as RigidBody3D


func play_sound(cue: SoundCue) -> void:
	Audio.play_sfx(cue, body.global_position)  # Audio: the facade autoload


func spawn_effect(effect: PackedScene, at: Vector3, lifetime := 2.0) -> void:
	var fx: Node3D = effect.instantiate()  # pooled in production
	get_tree().current_scene.add_child(fx)
	fx.global_position = at
	get_tree().create_timer(lifetime).timeout.connect(fx.queue_free)


func launch(velocity: Vector3) -> void:
	body.linear_velocity = velocity


func damage_in_area(center: Vector3, radius: float, damage: float) -> int:
	var sphere := SphereShape3D.new()
	sphere.radius = radius
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = sphere
	query.transform = Transform3D(Basis.IDENTITY, center)
	query.exclude = [body.get_rid()]  # never hit yourself
	var hits := 0
	for result in body.get_world_3d().direct_space_state.intersect_shape(query):
		var target: Object = result.collider
		if target.has_method("take_damage"):
			target.take_damage(damage, body)
			hits += 1
	return hits


func is_grounded() -> bool:
	var from := body.global_position + Vector3.UP * 0.1
	var query := PhysicsRayQueryParameters3D.create(from, from + Vector3.DOWN * 0.3, 0xFFFFFFFF, [body.get_rid()])
	return not body.get_world_3d().direct_space_state.intersect_ray(query).is_empty()


func wait(seconds: float) -> void:
	await get_tree().create_timer(seconds).timeout


# ── What subclasses implement (may await) ──
func _activate() -> void:
	pass


func try_use() -> bool:
	var now := Time.get_ticks_msec() / 1000.0
	if now < _ready_at:
		return false
	_ready_at = now + cooldown
	_activate()
	return true


# ground_slam.gd: powers are short, readable, and touch nothing but the sandbox.
class_name GroundSlam
extends Power

@export var jump_sound: SoundCue
@export var slam_sound: SoundCue
@export var shockwave: PackedScene


func _activate() -> void:
	play_sound(jump_sound)
	launch(Vector3.UP * 12.0)
	await wait(0.35)
	launch(Vector3.DOWN * 30.0)
	while not is_grounded():
		await get_tree().physics_frame
	play_sound(slam_sound)
	spawn_effect(shockwave, body.global_position)
	damage_in_area(body.global_position, 5.0, 40.0)


# sky_launch.gd
class_name SkyLaunch
extends Power

@export var whoosh: SoundCue
@export var trail: PackedScene


func _activate() -> void:
	play_sound(whoosh)
	spawn_effect(trail, body.global_position, 1.0)
	launch(Vector3.UP * 20.0)
```

```cpp [Unreal (C++)]
// Power.h: an abstract component on a Character. Protected functions are the sandbox.
// C++ in Unreal has no coroutines, so sequences use timer callbacks.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "GameFramework/Character.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Kismet/GameplayStatics.h"
#include "NiagaraFunctionLibrary.h"
#include "Power.generated.h"

UCLASS(Abstract)
class UPower : public UActorComponent
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, Category = "Power")
	bool TryUse()
	{
		const double Now = GetWorld()->GetTimeSeconds();
		if (Now < ReadyAt) return false;
		ReadyAt = Now + Cooldown;
		UsePower();
		return true;
	}

protected:
	UPROPERTY(EditAnywhere, Category = "Power") float Cooldown = 3.f;

	// ── What subclasses implement ──
	virtual void UsePower() PURE_VIRTUAL(UPower::UsePower, );

	// ── The sandbox: the ONLY operations powers may use ──

	FVector Location() const { return GetOwner()->GetActorLocation(); }

	void PlaySound(USoundBase* Cue) { if (Cue) UGameplayStatics::PlaySoundAtLocation(this, Cue, Location()); }

	void SpawnEffect(UNiagaraSystem* Effect, FVector At) { UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, Effect, At); }

	void Launch(FVector Velocity)
	{
		if (ACharacter* Character = Cast<ACharacter>(GetOwner())) Character->LaunchCharacter(Velocity, true, true);
	}

	int32 DamageInArea(FVector Center, float Radius, float Damage)
	{
		TArray<FOverlapResult> Overlaps;
		FCollisionQueryParams Params;
		Params.AddIgnoredActor(GetOwner());                                // never hit yourself
		GetWorld()->OverlapMultiByChannel(Overlaps, Center, FQuat::Identity, ECC_Pawn,
			FCollisionShape::MakeSphere(Radius), Params);
		TSet<AActor*> Damaged;
		for (const FOverlapResult& Overlap : Overlaps)
			if (AActor* Target = Overlap.GetActor(); Target && !Damaged.Contains(Target))
			{
				Damaged.Add(Target);
				UGameplayStatics::ApplyDamage(Target, Damage, nullptr, GetOwner(), nullptr);
			}
		return Damaged.Num();
	}

	bool IsGrounded() const
	{
		const ACharacter* Character = Cast<ACharacter>(GetOwner());
		return Character && Character->GetCharacterMovement()->IsMovingOnGround();
	}

	void After(float Seconds, TFunction<void()> Then)
	{
		FTimerHandle Handle;
		GetWorld()->GetTimerManager().SetTimer(Handle, FTimerDelegate::CreateWeakLambda(this, MoveTemp(Then)), Seconds, false);
	}

	void WhenGrounded(TFunction<void()> Then)
	{
		if (IsGrounded()) { Then(); return; }
		After(0.02f, [this, Then] { WhenGrounded(Then); });
	}

private:
	double ReadyAt = 0.0;
};

// GroundSlam.h: powers are short, readable, and touch nothing but the sandbox.
UCLASS(meta = (BlueprintSpawnableComponent))
class UGroundSlam : public UPower
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Power") TObjectPtr<USoundBase> JumpSound;
	UPROPERTY(EditAnywhere, Category = "Power") TObjectPtr<USoundBase> SlamSound;
	UPROPERTY(EditAnywhere, Category = "Power") TObjectPtr<UNiagaraSystem> Shockwave;

protected:
	virtual void UsePower() override
	{
		PlaySound(JumpSound);
		Launch(FVector::UpVector * 1200.f);
		After(0.35f, [this]
		{
			Launch(FVector::DownVector * 3000.f);
			WhenGrounded([this]
			{
				PlaySound(SlamSound);
				SpawnEffect(Shockwave, Location());
				DamageInArea(Location(), 500.f, 40.f);
			});
		});
	}
};
```

:::

**Engine notes**

- **Unity:** `IAudio`, `SoundCue`, `IDamageable` and `DamageInfo` come from [Facade](./facade) and [Health / Damageable](./health-component). Only the base class knows about them.
- **Godot:** with `extends Power` and no other references, a power can still reach anything through the scene tree; the sandbox is a team rule. A code review checklist or a lint rule keeps it honest.
- **Unreal:** the **Gameplay Ability System** is this pattern at production scale: `UGameplayAbility` is the sandbox base class, and **ability tasks** (wait for a delay, wait until landed, play montage) are its operations, written as latent steps instead of nested callbacks.

## When to use

- Many small subclasses of one concept (powers, spells, interactable props, enemy attacks, cutscene steps) that need the same engine services.
- When subclasses are written by people who should not need to know every engine system.
- When the base class is the right place to enforce consistency: the same sound routing, pooling and damage rules for every power.

## When not to use

- A few subclasses with little shared behaviour. Plain inheritance or composition is simpler.
- When the variations are mostly data. Use [Type Object](./type-object).
- Deep hierarchies. If the sandbox base class keeps growing to serve every subclass, split it into [Components](./component) or [Strategies](./strategy).

## Pitfalls

- **The sandbox grows without limit.** Every power wants one more tool, and the base class becomes huge. Group tools into helper objects (`Effects`, `Physics`, `Audio`) that the base class exposes, and add tools only when several subclasses need them.
- **Subclasses bypassing the sandbox.** Nothing in C# stops `FindFirstObjectByType<AudioManager>()` in a subclass. Code review, analysers, or putting subclasses in an assembly that cannot reference engine systems all help.
- **Inheritance limits.** A power that needs a second base class cannot have one. If powers need to mix and match many capabilities, consider data-driven composition (effects lists, as in the [Ability System](./ability-system)) instead.
- **Coupling moves to the base class.** That is the point, but the base class now depends on many systems. Keep its dependencies behind interfaces, so it stays testable.

## Related

- [Ability System](./ability-system) — the data-driven alternative: abilities as lists of effects instead of subclasses.
- [Template Method](./template-method) — the inverse: the base class defines the steps, and subclasses fill them in.
- [Facade](./facade) — sandbox operations often call facades.
- [Component](./component) — composition instead of inheritance, when subclass trees get awkward.
