# Feedback Layering (Juice)

> Stack sound, particles, animation and shake on every meaningful action.

**Also known as:** Juice, Game Feel Feedback · **Category:** Game Feel & Input

## Problem

The mechanics work: the sword hits, the coin is collected, the button is pressed. But the game feels flat. A hit takes away health with nothing else happening, a coin quietly disappears, a jump has no anticipation and no landing. The fixes are known (shake, particles, sounds, squash and stretch), but they get added ad hoc. Every hit site calls six systems with hand-tuned magic numbers, different weapons feel inconsistent, and designers cannot adjust any of it without a programmer.

## Solution

Treat feedback as a **layered response to an event**, authored as data:

1. **Identify meaningful events.** Hits, kills, pickups, jumps, landings, UI confirmations, level-ups.
2. **Respond on several channels at once.** Each layer is small, and together they sell the moment:

| Layer | Examples |
| --- | --- |
| **Time** | [Hit Stop](./hit-stop), brief slow motion |
| **Camera** | [Screen Shake](./screen-shake), small zoom punch, FOV kick |
| **Object** | Squash and stretch, flash white, knockback, recoil ([Tweening](./tweening)) |
| **Particles** | Sparks, dust, debris, trails |
| **Audio** | Layered sounds with random pitch and volume variation |
| **UI** | Damage numbers, counter punch, screen flash, controller rumble |

3. **Bundle each response into a reusable feedback asset**: "Light Hit", "Heavy Hit", "Coin Pickup". Gameplay plays one asset, and designers tune the layers inside it.
4. **Scale with magnitude.** One asset can scale its layers by intensity (damage dealt, fall height), so small and big versions of an event feel related.

## Example

A feedback asset made of composable layers, each a small serialisable object edited in place in the inspector: `[SerializeReference]` classes in a ScriptableObject in Unity, sub-resources in a `Resource` in Godot, and instanced objects in a Data Asset in Unreal.

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public struct FeedbackContext
{
    public Vector3 Position;
    public Transform Target;          // the object that was hit / collected / landed
    public float Intensity;           // 0..1, e.g. damage / maxDamage
}

[Serializable]
public abstract class FeedbackLayer
{
    public abstract void Play(in FeedbackContext ctx);
}

[Serializable]
public class ShakeLayer : FeedbackLayer
{
    public float trauma = 0.3f;
    public override void Play(in FeedbackContext ctx) => TraumaShake.Instance.AddTrauma(trauma * ctx.Intensity);
}

[Serializable]
public class HitStopLayer : FeedbackLayer
{
    public float minDuration = 0.03f, maxDuration = 0.12f;
    public override void Play(in FeedbackContext ctx) =>
        HitStop.Instance.Trigger(Mathf.Lerp(minDuration, maxDuration, ctx.Intensity));
}

[Serializable]
public class SoundLayer : FeedbackLayer
{
    public AudioClip[] clips;                         // several variants avoid repetition
    [Range(0f, 0.3f)] public float volumeVariation = 0.1f;
    public float volume = 1f;

    public override void Play(in FeedbackContext ctx)
    {
        if (clips.Length == 0) return;
        var clip = clips[UnityEngine.Random.Range(0, clips.Length)];
        // Route through the Event Queue so many identical hits in one frame merge.
        // (Add a pitch parameter to the queue to vary pitch too, which hides repetition even better.)
        AudioQueue.Instance.Request(clip, ctx.Position,
            volume * Mathf.Lerp(0.7f, 1f, ctx.Intensity) * (1f + UnityEngine.Random.Range(-volumeVariation, volumeVariation)));
    }
}

[Serializable]
public class ParticleLayer : FeedbackLayer
{
    public ParticleSystem prefab;
    public int minCount = 5, maxCount = 25;

    public override void Play(in FeedbackContext ctx)
    {
        var ps = UnityEngine.Object.Instantiate(prefab, ctx.Position, Quaternion.identity);   // pool in production
        ps.Emit(Mathf.RoundToInt(Mathf.Lerp(minCount, maxCount, ctx.Intensity)));
        UnityEngine.Object.Destroy(ps.gameObject, ps.main.duration + ps.main.startLifetime.constantMax);
    }
}

[Serializable]
public class SquashLayer : FeedbackLayer
{
    public Vector3 squash = new(1.3f, 0.7f, 1.3f);
    public float duration = 0.25f;

    public override void Play(in FeedbackContext ctx)
    {
        var t = ctx.Target;
        if (t == null) return;
        Vector3 rest = Vector3.one, peak = Vector3.LerpUnclamped(rest, squash, ctx.Intensity);
        // Snap to the squashed shape, then spring back with overshoot.
        Tweener.Run(t, duration, Ease.OutElastic, p => t.localScale = Vector3.LerpUnclamped(peak, rest, p));
    }
}

[CreateAssetMenu(menuName = "Feedback/Feedback")]
public class Feedback : ScriptableObject
{
    [SerializeReference] public List<FeedbackLayer> layers = new();

    public void Play(Vector3 position, Transform target = null, float intensity = 1f)
    {
        var ctx = new FeedbackContext { Position = position, Target = target, Intensity = Mathf.Clamp01(intensity) };
        foreach (var layer in layers)
        {
            try { layer.Play(ctx); }
            catch (Exception e) { Debug.LogException(e, this); }   // one broken layer must not kill the rest
        }
    }
}

// Gameplay: one line per event, and all the feel lives in the asset.
// heavyHitFeedback.Play(hit.point, enemy.transform, damage / 50f);
```

```gdscript [Godot (GDScript)]
# Each script is its own file. In the inspector, add layers to a Feedback resource's array and
# pick "New ShakeLayer", "New SoundLayer"… for each element.

# feedback_context.gd
class_name FeedbackContext
extends RefCounted

var source: Node  # gives layers access to the scene tree
var position: Vector3
var target: Node3D  # the object that was hit / collected / landed
var intensity: float  # 0..1, e.g. damage / max_damage


# feedback_layer.gd
class_name FeedbackLayer
extends Resource


func play(_ctx: FeedbackContext) -> void:
	pass


# shake_layer.gd: TraumaShake from Screen Shake is in the "camera_shake" group.
class_name ShakeLayer
extends FeedbackLayer

@export var trauma := 0.3


func play(ctx: FeedbackContext) -> void:
	ctx.source.get_tree().call_group("camera_shake", "add_trauma", trauma * ctx.intensity)


# hit_stop_layer.gd: HitStop is the autoload from Hit Stop.
class_name HitStopLayer
extends FeedbackLayer

@export var min_duration := 0.03
@export var max_duration := 0.12


func play(ctx: FeedbackContext) -> void:
	HitStop.trigger(lerpf(min_duration, max_duration, ctx.intensity))


# sound_layer.gd: use an AudioStreamRandomizer as the stream for variants and pitch/volume jitter.
class_name SoundLayer
extends FeedbackLayer

@export var stream: AudioStream
@export var volume := 1.0


func play(ctx: FeedbackContext) -> void:
	var player := AudioStreamPlayer3D.new()
	player.stream = stream
	player.volume_db = linear_to_db(volume * lerpf(0.7, 1.0, ctx.intensity))
	ctx.source.get_tree().current_scene.add_child(player)
	player.global_position = ctx.position
	player.finished.connect(player.queue_free)
	player.play()


# particle_layer.gd: the scene's root is a one-shot GPUParticles3D.
class_name ParticleLayer
extends FeedbackLayer

@export var scene: PackedScene
@export var min_count := 5
@export var max_count := 25


func play(ctx: FeedbackContext) -> void:
	var particles := scene.instantiate() as GPUParticles3D  # pool in production
	particles.amount = roundi(lerpf(min_count, max_count, ctx.intensity))
	ctx.source.get_tree().current_scene.add_child(particles)
	particles.global_position = ctx.position
	particles.emitting = true
	ctx.source.get_tree().create_timer(particles.lifetime + 0.5).timeout.connect(particles.queue_free)


# squash_layer.gd
class_name SquashLayer
extends FeedbackLayer

@export var squash := Vector3(1.3, 0.7, 1.3)
@export var duration := 0.25


func play(ctx: FeedbackContext) -> void:
	var target := ctx.target
	if target == null:
		return
	var peak := Vector3.ONE.lerp(squash, ctx.intensity)
	# Snap to the squashed shape, then spring back with overshoot (Ease from Tweening).
	var tween := target.create_tween()
	tween.tween_method(func(p: float) -> void: target.scale = peak.lerp(Vector3.ONE, Ease.out_elastic(p)),
		0.0, 1.0, duration)


# feedback.gd
class_name Feedback
extends Resource

@export var layers: Array[FeedbackLayer] = []


func play(source: Node, position: Vector3, target: Node3D = null, intensity := 1.0) -> void:
	var ctx := FeedbackContext.new()
	ctx.source = source
	ctx.position = position
	ctx.target = target
	ctx.intensity = clampf(intensity, 0.0, 1.0)
	for layer in layers:
		if layer != null:  # empty slots are common while editing
			layer.play(ctx)


# Gameplay: one line per event, and all the feel lives in the resource.
# heavy_hit_feedback.play(self, hit_position, enemy, damage / 50.0)
```

```cpp [Unreal (C++)]
// Feedback.h
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "Feedback.generated.h"

class UCameraShakeBase;
class UNiagaraSystem;
class USoundBase;

USTRUCT(BlueprintType)
struct FFeedbackContext
{
	GENERATED_BODY()

	UPROPERTY() TObjectPtr<UObject> WorldContext;
	UPROPERTY() FVector Location = FVector::ZeroVector;
	UPROPERTY() TObjectPtr<AActor> Target;            // the actor that was hit / collected / landed
	UPROPERTY() float Intensity = 1.f;                // 0..1, e.g. Damage / MaxDamage
};

// EditInlineNew + Instanced: layers are created and edited inside the asset's details panel.
UCLASS(Abstract, EditInlineNew, DefaultToInstanced, CollapseCategories)
class UFeedbackLayer : public UObject
{
	GENERATED_BODY()

public:
	virtual void Play(const FFeedbackContext& Ctx) const PURE_VIRTUAL(UFeedbackLayer::Play, );
};

UCLASS()
class UShakeLayer : public UFeedbackLayer
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere) TSubclassOf<UCameraShakeBase> Shake;
	UPROPERTY(EditAnywhere) float InnerRadius = 300.f;
	UPROPERTY(EditAnywhere) float OuterRadius = 2000.f;
	virtual void Play(const FFeedbackContext& Ctx) const override;
};

UCLASS()
class UHitStopLayer : public UFeedbackLayer
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere) float MinDuration = 0.03f;
	UPROPERTY(EditAnywhere) float MaxDuration = 0.12f;
	virtual void Play(const FFeedbackContext& Ctx) const override;
};

UCLASS()
class USoundLayer : public UFeedbackLayer
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere) TObjectPtr<USoundBase> Sound;   // a MetaSound or Sound Cue with random variants
	UPROPERTY(EditAnywhere) float Volume = 1.f;
	virtual void Play(const FFeedbackContext& Ctx) const override;
};

UCLASS()
class UParticleLayer : public UFeedbackLayer
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere) TObjectPtr<UNiagaraSystem> System;
	UPROPERTY(EditAnywhere) int32 MinCount = 5;
	UPROPERTY(EditAnywhere) int32 MaxCount = 25;
	virtual void Play(const FFeedbackContext& Ctx) const override;
};

UCLASS(BlueprintType)
class UFeedback : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Instanced, Category = "Feedback")
	TArray<TObjectPtr<UFeedbackLayer>> Layers;

	UFUNCTION(BlueprintCallable, Category = "Feedback")
	void Play(UObject* WorldContext, FVector Location, AActor* Target = nullptr, float Intensity = 1.f) const;
};

// Feedback.cpp
#include "Feedback.h"
#include "HitStopSubsystem.h"
#include "Kismet/GameplayStatics.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"

void UShakeLayer::Play(const FFeedbackContext& Ctx) const
{
	// Intensity scales the radii: a weak hit shakes only nearby cameras.
	UGameplayStatics::PlayWorldCameraShake(Ctx.WorldContext, Shake, Ctx.Location,
		InnerRadius * Ctx.Intensity, OuterRadius * Ctx.Intensity);
}

void UHitStopLayer::Play(const FFeedbackContext& Ctx) const
{
	if (UWorld* World = Ctx.WorldContext->GetWorld())
	{
		World->GetSubsystem<UHitStopSubsystem>()->Trigger(FMath::Lerp(MinDuration, MaxDuration, Ctx.Intensity));
	}
}

void USoundLayer::Play(const FFeedbackContext& Ctx) const
{
	UGameplayStatics::PlaySoundAtLocation(Ctx.WorldContext, Sound, Ctx.Location,
		Volume * FMath::Lerp(0.7f, 1.f, Ctx.Intensity));
}

void UParticleLayer::Play(const FFeedbackContext& Ctx) const
{
	// The Niagara system reads a "User.Count" int parameter in its spawn burst.
	if (UNiagaraComponent* Effect = UNiagaraFunctionLibrary::SpawnSystemAtLocation(Ctx.WorldContext, System, Ctx.Location))
	{
		Effect->SetVariableInt(TEXT("User.Count"), FMath::RoundToInt(FMath::Lerp<float>(MinCount, MaxCount, Ctx.Intensity)));
	}
}

void UFeedback::Play(UObject* WorldContext, FVector Location, AActor* Target, float Intensity) const
{
	FFeedbackContext Ctx;
	Ctx.WorldContext = WorldContext;
	Ctx.Location = Location;
	Ctx.Target = Target;
	Ctx.Intensity = FMath::Clamp(Intensity, 0.f, 1.f);

	for (const UFeedbackLayer* Layer : Layers)
	{
		if (Layer) Layer->Play(Ctx);                       // empty slots are common while editing
	}
}

// Gameplay: one line per event, and all the feel lives in the asset.
// HeavyHitFeedback->Play(this, Hit.ImpactPoint, Enemy, Damage / 50.f);
// A squash layer would drive a Timeline on the target (see Tweening).
```

:::

`TraumaShake`, `HitStop`, `AudioQueue`, `Tweener` and `Ease` come from [Screen Shake](./screen-shake), [Hit Stop](./hit-stop), [Event Queue](./event-queue) and [Tweening](./tweening).

**Engine notes**

- **Unity:** `[SerializeReference]` lists need a small custom inspector to add layers of different types. The commercial asset **Feel** (More Mountains) is a full-featured version of this pattern.
- **Godot:** typed arrays of a custom `Resource` class get a "New …" menu listing every subclass, so no custom inspector is needed. `AudioStreamRandomizer` (4.0+) handles sound variants with random pitch and volume. GDScript has no `try`/`catch`: a layer that errors stops at that line but doesn't stop the others in a release build, so keep layers simple and null-checked.
- **Unreal:** `EditInlineNew` with an `Instanced` array gives the same "pick a class, edit it in place" workflow without editor code. In projects that use the Gameplay Ability System, **Gameplay Cues** are the built-in feedback layer: abilities and effects fire a cue tag, and cue notifies play the sound, particles and shake. The particle layer needs the **Niagara** module in your `Build.cs`.

## When to use

- Every player action that matters, and especially the core loop: hitting, collecting, jumping, scoring.
- UI interactions: buttons, rewards, level-ups, purchases.
- When different weapons, enemies or abilities should feel distinct but consistent.

## When not to use

- Before the core mechanic is fun. Feedback can't fix a game that doesn't work.
- Routine actions that repeat constantly, such as menu navigation. Too much feedback makes everything noisy; scale the feedback to the event's importance.
- Without accessibility options. Flashes and shake need settings to reduce them.

## Pitfalls

- **Noise instead of signal.** If everything shakes, flashes and booms, nothing stands out, and important events get lost. Budget intensity: frequent events stay subtle, rare events go big.
- **Readability.** Particles and flashes can hide hitboxes and telegraphs. Keep gameplay-critical information visible through the effects.
- **Accessibility.** Shake, flashing and rumble can cause discomfort, motion sickness or seizure risk. Offer settings to reduce them, and avoid rapid full-screen flashes.
- **Inconsistency.** Hand-tuned feedback at each call site drifts apart. Reusable assets keep "a heavy hit" feeling the same everywhere.
- **Cost.** Instantiating particles and sources for every hit allocates. Pool effects and route audio through a queue, as in [Wave Spawning](../recipes/wave-spawning) and [Event Queue](./event-queue).

## Related

- [Hit Stop](./hit-stop), [Screen Shake](./screen-shake) and [Tweening & Easing](./tweening) — individual layers.
- [Event Queue](./event-queue) — merges simultaneous feedback such as sounds.
- [Observer](./observer) and [Event Bus](./event-bus) — trigger feedback from gameplay events without coupling.
- [Camera Follow & Smoothing](./camera-smoothing) — the camera that the shake and zoom layers act on.
