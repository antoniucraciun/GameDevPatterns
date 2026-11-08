# Perception System

> Centralised sight, hearing and memory so agents react to stimuli consistently.

**Also known as:** Sensors, Stimuli · **Category:** AI & Decision Making

## Problem

Each enemy script decides for itself whether it can see the player: one uses a distance check, another a raycast, a third forgets the field of view. Gunshots alert enemies through the gun searching the whole scene for enemies. Enemies react *instantly* to a pixel of the player at the edge of their vision, then forget them the moment they step behind a pillar. With 50 enemies raycasting every frame, the AI is both unfair and expensive.

## Solution

Give agents **senses** that turn the world into **stimuli**, and a **memory** that turns stimuli into **knowledge**:

- **Stimulus sources** register themselves (the player is *visible*; a gunshot is a *sound* at a position, with a loudness radius). Agents never search the scene.
- **Sight sensor**: range → field-of-view cone → line-of-sight raycast, cheapest test first. It runs a few times per second, not every frame, with agents staggered over time.
- **Hearing**: sounds are events with a position and radius. Each agent in range receives them, optionally reduced by walls.
- **Awareness**: seeing the target *raises* an awareness value over time, faster when close or in the centre of view. The agent reacts only when it crosses a threshold. This gives players the familiar "?" then "!" moment.
- **Memory**: the agent remembers the last known position and time after losing sight, and writes these facts into its [Blackboard](./blackboard) for decision-making to use.

## Pseudocode

```text
visible_targets      // every target registers itself, with a visibility (lower when crouching)
emit_noise(position, radius, source):  tell every listening agent

Perception:
    sight_range, half_fov, sight_interval
    awareness ← 0                    // 0 = unaware, 1 = fully alerted
    seen, seen_strength              // the best target from the last sight check
    blackboard                       // where knowledge goes

    every sight_interval (each agent starting at a random offset):
        seen ← none, seen_strength ← 0
        for each target t in visible_targets:     // cheapest test first
            if distance to t > sight_range: skip it
            if angle between eyes' forward and t > half_fov: skip it
            if a ray from the eyes to t hits a wall: skip it
            strength ← t.visibility × (1 − distance / sight_range)
                                    × (1 − 0.5 × angle / half_fov)   // close and central
            if strength > seen_strength: seen ← t, seen_strength ← strength

    every frame (dt):
        before ← awareness
        if seen: awareness ← min(1, awareness + gain × seen_strength × dt)
        else:    awareness ← max(0, awareness − decay × dt)
        if seen and awareness ≥ 1:                 // memory: what and where
            blackboard.set(target, seen)
            blackboard.set(last known position, seen.position)   // also stamps the time
        if before < 1 and awareness ≥ 1:
            raise alerted                          // the "!" moment

    on noise(position, radius, source):
        if source is this agent: ignore it
        d ← distance to position
        if d > radius: ignore it
        blackboard.set(noise location, position)   // go and investigate
        awareness ← max(awareness, 0.5 × (1 − d / radius))   // suspicious, not alerted
```

## Example

Sight with a range, a field of view and an occlusion ray; hearing through noise events; an awareness meter that fills while the target is seen; and memory written to the agent's [Blackboard](./blackboard). Unreal ships this as the **AI Perception** system, so its tabs configure that and add only the awareness meter on top.

### Stimulus sources and sounds

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public class VisibleTarget : MonoBehaviour
{
    public static readonly List<VisibleTarget> All = new();
    [Range(0f, 2f)] public float Visibility = 1f;     // lower when crouching or in shadow

    void OnEnable()  => All.Add(this);
    void OnDisable() => All.Remove(this);
}

public static class Noise
{
    public static event Action<Vector3, float, GameObject> Emitted;   // position, radius, source

    public static void Emit(Vector3 position, float radius, GameObject source) =>
        Emitted?.Invoke(position, radius, source);
}

// Gunshot:   Noise.Emit(transform.position, 25f, gameObject);
// Footstep:  Noise.Emit(transform.position, running ? 6f : 2f, gameObject);
```

```gdscript [Godot (GDScript)]
# visible_target.gd: a child of anything that can be seen, placed where eyes should aim (the head).
class_name VisibleTarget
extends Node3D

const GROUP := &"visible_targets"

@export_range(0.0, 2.0) var visibility := 1.0  # lower when crouching or in shadow


func _ready() -> void:
	add_to_group(GROUP)


# noise_events.gd: an autoload named "NoiseEvents" (Godot already has a Noise class, for procedural noise).
extends Node

signal emitted(position: Vector3, radius: float, source: Node)


func make_noise(position: Vector3, radius: float, source: Node) -> void:
	emitted.emit(position, radius, source)

# Gunshot:   NoiseEvents.make_noise(global_position, 25.0, self)
# Footstep:  NoiseEvents.make_noise(global_position, 6.0 if running else 2.0, self)
```

```cpp [Unreal (C++)]
// Targets: pawns register as sight stimuli automatically (Project Settings → AI System →
// "Auto Register All Pawns as Sources"). For other actors, add a UAIPerceptionStimuliSourceComponent
// and register it for sight, in the editor or in code:
//
//   StimuliSource = CreateDefaultSubobject<UAIPerceptionStimuliSourceComponent>(TEXT("StimuliSource"));
//   StimuliSource->RegisterForSense(UAISense_Sight::StaticClass());

// Noises: one call reports a hearing stimulus to every listener in range.
// ShooterCharacter.cpp (excerpt)
#include "Perception/AISense_Hearing.h"

void AShooterCharacter::OnFired()
{
	// Loudness scales the listener's hearing range; MaxRange caps how far this noise carries.
	UAISense_Hearing::ReportNoiseEvent(this, GetActorLocation(), /*Loudness=*/1.f, /*Instigator=*/this,
		/*MaxRange=*/2500.f);
}

void AShooterCharacter::OnFootstep(bool bRunning)
{
	UAISense_Hearing::ReportNoiseEvent(this, GetActorLocation(), 1.f, this, bRunning ? 600.f : 200.f);
}
```

:::

### An agent's senses, awareness and memory

::: code-group

```csharp [Unity (C#)]
using System;
using UnityEngine;

public class Perception : MonoBehaviour
{
    [Header("Sight")]
    [SerializeField] float sightRange = 20f;
    [SerializeField, Range(0f, 180f)] float halfFov = 60f;
    [SerializeField] Transform eyes;
    [SerializeField] LayerMask occluders;
    [SerializeField] float sightInterval = 0.2f;        // seconds between sight checks

    [Header("Awareness")]
    [SerializeField] float awarenessGain = 1.5f;        // per second while seen at the centre, up close
    [SerializeField] float awarenessDecay = 0.25f;      // per second while not seen

    public Blackboard Blackboard { get; } = new();
    public float Awareness { get; private set; }         // 0 = unaware, 1 = fully alerted
    public event Action Alerted;

    float nextSightCheck;
    VisibleTarget seen;
    float seenStrength;

    void OnEnable()
    {
        Noise.Emitted += OnNoise;
        nextSightCheck = Time.time + UnityEngine.Random.value * sightInterval;   // stagger agents
    }

    void OnDisable() => Noise.Emitted -= OnNoise;

    void Update()
    {
        if (Time.time >= nextSightCheck)
        {
            nextSightCheck += sightInterval;
            (seen, seenStrength) = LookForTargets();
        }

        float before = Awareness;
        Awareness = seen != null
            ? Mathf.Min(1f, Awareness + awarenessGain * seenStrength * Time.deltaTime)
            : Mathf.Max(0f, Awareness - awarenessDecay * Time.deltaTime);

        if (seen != null && Awareness >= 1f)
        {
            Blackboard.Set(Keys.Target, seen.transform);                       // memory: what and where
            Blackboard.Set(Keys.LastKnownPosition, seen.transform.position);   // timestamp refreshed
        }
        if (before < 1f && Awareness >= 1f) Alerted?.Invoke();
    }

    (VisibleTarget, float) LookForTargets()
    {
        VisibleTarget best = null;
        float bestStrength = 0f;

        foreach (var t in VisibleTarget.All)
        {
            Vector3 toTarget = t.transform.position - eyes.position;
            float distance = toTarget.magnitude;
            if (distance > sightRange) continue;                               // cheapest test first

            float angle = Vector3.Angle(eyes.forward, toTarget);
            if (angle > halfFov) continue;

            if (Physics.Raycast(eyes.position, toTarget / distance, distance, occluders)) continue;   // blocked

            // Closer and more central targets are noticed faster.
            float strength = t.Visibility * (1f - distance / sightRange) * (1f - angle / halfFov * 0.5f);
            if (strength > bestStrength) { best = t; bestStrength = strength; }
        }
        return (best, bestStrength);
    }

    void OnNoise(Vector3 position, float radius, GameObject source)
    {
        if (source == gameObject) return;
        float distance = Vector3.Distance(transform.position, position);
        if (distance > radius) return;

        Blackboard.Set(Keys.NoiseLocation, position);                          // investigate this
        Awareness = Mathf.Max(Awareness, 0.5f * (1f - distance / radius));    // noises raise suspicion
    }
}
```

```gdscript [Godot (GDScript)]
# perception.gd: a child of the agent's body.
class_name Perception
extends Node3D

signal alerted

@export_group("Sight")
@export var sight_range := 20.0
@export_range(0.0, 180.0) var half_fov := 60.0
@export var eyes: Node3D
@export_flags_3d_physics var occluders := 1  # walls only: if characters are on it, they block their own rays
@export var sight_interval := 0.2  # seconds between sight checks

@export_group("Awareness")
@export var awareness_gain := 1.5    # per second while seen at the centre, up close
@export var awareness_decay := 0.25  # per second while not seen

var blackboard := Blackboard.new()
var awareness := 0.0  # 0 = unaware, 1 = fully alerted

var _time_to_look := 0.0
var _seen: VisibleTarget
var _seen_strength := 0.0


func _ready() -> void:
	NoiseEvents.emitted.connect(_on_noise)
	_time_to_look = randf() * sight_interval  # stagger agents


func _physics_process(delta: float) -> void:  # raycasts belong in the physics step
	_time_to_look -= delta
	if _time_to_look <= 0.0:
		_time_to_look += sight_interval
		_look_for_targets()

	var before := awareness
	if is_instance_valid(_seen):  # the target may have been freed
		awareness = minf(1.0, awareness + awareness_gain * _seen_strength * delta)
	else:
		awareness = maxf(0.0, awareness - awareness_decay * delta)

	if is_instance_valid(_seen) and awareness >= 1.0:
		blackboard.set_value(Blackboard.TARGET, _seen)  # memory: what and where
		blackboard.set_value(Blackboard.LAST_KNOWN_POSITION, _seen.global_position)
	if before < 1.0 and awareness >= 1.0:
		alerted.emit()


func _look_for_targets() -> void:
	_seen = null
	_seen_strength = 0.0
	var space := get_world_3d().direct_space_state
	var forward := -eyes.global_transform.basis.z

	for t: VisibleTarget in get_tree().get_nodes_in_group(VisibleTarget.GROUP):
		var to_target := t.global_position - eyes.global_position
		var distance := to_target.length()
		if distance > sight_range:
			continue  # cheapest test first

		var angle := rad_to_deg(forward.angle_to(to_target))
		if angle > half_fov:
			continue

		var query := PhysicsRayQueryParameters3D.create(eyes.global_position, t.global_position, occluders)
		if not space.intersect_ray(query).is_empty():
			continue  # blocked

		# Closer and more central targets are noticed faster.
		var strength := t.visibility * (1.0 - distance / sight_range) * (1.0 - angle / half_fov * 0.5)
		if strength > _seen_strength:
			_seen = t
			_seen_strength = strength


func _on_noise(noise_position: Vector3, radius: float, source: Node) -> void:
	if source == owner or source == get_parent():
		return  # our own footsteps
	var distance := global_position.distance_to(noise_position)
	if distance > radius:
		return
	blackboard.set_value(Blackboard.NOISE_LOCATION, noise_position)  # investigate this
	awareness = maxf(awareness, 0.5 * (1.0 - distance / radius))  # noises raise suspicion
```

```cpp [Unreal (C++)]
// GuardAIController.h: the AI Perception component does range, field of view, line of sight,
// hearing and forgetting (Max Age). The controller adds the gradual awareness meter on top.
#pragma once

#include "CoreMinimal.h"
#include "AIController.h"
#include "Perception/AIPerceptionTypes.h"
#include "GuardAIController.generated.h"

class UAISenseConfig_Hearing;
class UAISenseConfig_Sight;

DECLARE_MULTICAST_DELEGATE(FOnAlerted);

UCLASS()
class AGuardAIController : public AAIController
{
	GENERATED_BODY()

public:
	AGuardAIController();

	float GetAwareness() const { return Awareness; }   // 0 = unaware, 1 = fully alerted
	FOnAlerted OnAlerted;

protected:
	UPROPERTY(VisibleAnywhere, Category = "Perception") TObjectPtr<UAIPerceptionComponent> Perception;
	UPROPERTY() TObjectPtr<UAISenseConfig_Sight> SightConfig;
	UPROPERTY() TObjectPtr<UAISenseConfig_Hearing> HearingConfig;

	UPROPERTY(EditAnywhere, Category = "Awareness") float AwarenessGain = 1.5f;    // per second, up close
	UPROPERTY(EditAnywhere, Category = "Awareness") float AwarenessDecay = 0.25f;  // per second while not seen

	virtual void Tick(float DeltaSeconds) override;

private:
	UFUNCTION()
	void OnTargetPerceptionUpdated(AActor* Actor, FAIStimulus Stimulus);

	TWeakObjectPtr<AActor> Seen;
	float Awareness = 0.f;
};

// GuardAIController.cpp
#include "GuardAIController.h"
#include "BehaviorTree/BlackboardComponent.h"
#include "Perception/AIPerceptionComponent.h"
#include "Perception/AIPerceptionSystem.h"
#include "Perception/AISenseConfig_Hearing.h"
#include "Perception/AISenseConfig_Sight.h"
#include "Perception/AISense_Hearing.h"
#include "Perception/AISense_Sight.h"

AGuardAIController::AGuardAIController()
{
	PrimaryActorTick.bCanEverTick = true;
	Perception = CreateDefaultSubobject<UAIPerceptionComponent>(TEXT("Perception"));
	SetPerceptionComponent(*Perception);

	SightConfig = CreateDefaultSubobject<UAISenseConfig_Sight>(TEXT("Sight"));
	SightConfig->SightRadius = 2000.f;
	SightConfig->LoseSightRadius = 2500.f;           // a little hysteresis before losing the target
	SightConfig->PeripheralVisionAngleDegrees = 60.f;  // half angle, like halfFov
	SightConfig->DetectionByAffiliation.bDetectEnemies = true;
	SightConfig->DetectionByAffiliation.bDetectNeutrals = true;   // without team setup, the player is neutral
	SightConfig->SetMaxAge(10.f);                    // forget a lost target after 10 s
	Perception->ConfigureSense(*SightConfig);

	HearingConfig = CreateDefaultSubobject<UAISenseConfig_Hearing>(TEXT("Hearing"));
	HearingConfig->HearingRange = 3000.f;
	HearingConfig->DetectionByAffiliation.bDetectEnemies = true;
	HearingConfig->DetectionByAffiliation.bDetectNeutrals = true;
	Perception->ConfigureSense(*HearingConfig);

	Perception->SetDominantSense(UAISense_Sight::StaticClass());
	Perception->OnTargetPerceptionUpdated.AddDynamic(this, &AGuardAIController::OnTargetPerceptionUpdated);
}

void AGuardAIController::OnTargetPerceptionUpdated(AActor* Actor, FAIStimulus Stimulus)
{
	const TSubclassOf<UAISense> Sense = UAIPerceptionSystem::GetSenseClassForStimulus(this, Stimulus);
	if (Sense == UAISense_Sight::StaticClass())
	{
		if (Stimulus.WasSuccessfullySensed()) Seen = Actor;          // gained sight
		else if (Seen == Actor) Seen.Reset();                        // lost sight
	}
	else if (Sense == UAISense_Hearing::StaticClass() && Stimulus.WasSuccessfullySensed() && GetPawn())
	{
		GetBlackboardComponent()->SetValueAsVector(TEXT("NoiseLocation"), Stimulus.StimulusLocation);   // investigate
		const float Distance = FVector::Dist(GetPawn()->GetActorLocation(), Stimulus.StimulusLocation);
		Awareness = FMath::Max(Awareness, 0.5f * (1.f - Distance / HearingConfig->HearingRange));
	}
}

void AGuardAIController::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!GetPawn() || !GetBlackboardComponent()) return;

	const float Before = Awareness;
	if (AActor* Target = Seen.Get())
	{
		// Perception only reports gaining and losing sight, so closeness is measured here.
		const float Distance = FVector::Dist(GetPawn()->GetActorLocation(), Target->GetActorLocation());
		const float Strength = FMath::Max(0.f, 1.f - Distance / SightConfig->SightRadius);
		Awareness = FMath::Min(1.f, Awareness + AwarenessGain * Strength * DeltaSeconds);

		if (Awareness >= 1.f)                   // memory: what, where and when
		{
			UBlackboardComponent* BB = GetBlackboardComponent();
			BB->SetValueAsObject(TEXT("Target"), Target);
			BB->SetValueAsVector(TEXT("LastKnownPosition"), Target->GetActorLocation());
			BB->SetValueAsFloat(TEXT("LastSeenTime"), GetWorld()->GetTimeSeconds());
		}
	}
	else
	{
		Awareness = FMath::Max(0.f, Awareness - AwarenessDecay * DeltaSeconds);
	}
	if (Before < 1.f && Awareness >= 1.f) OnAlerted.Broadcast();
}
```

:::

`Keys` (Godot: the `Blackboard` constants) are the keys from [Blackboard](./blackboard). Decision-making reads `LastKnownPosition` and its age to choose between chasing, searching and giving up, and never casts a ray itself.

**Engine notes**

- **Unity:** no built-in perception system. Sight checks on a staggered interval, as above, keep the raycast count flat as the number of agents grows; `Physics.RaycastCommand` batches them in a job for large crowds.
- **Godot:** no built-in perception system. Iterating a group works for a handful of targets; with many, put an `Area3D` with a sphere of radius `sight_range` on the agent and check only `get_overlapping_bodies()`. `PhysicsRayQueryParameters3D` has an `exclude` list (of RIDs) for skipping the agent's own collider.
- **Unreal:** the **AI Perception** component covers sight, hearing, damage (`UAISense_Damage::ReportDamageEvent`), team and touch senses, with the `'` gameplay debugger showing each sense's cones and stimuli. Affiliation needs `IGenericTeamAgentInterface` on controllers to tell friends from enemies; until then everyone is neutral. Targets can refine the sight test (aim points on the body, crouching) by implementing `IAISightTargetInterface`, whose function signature differs between engine versions.

## When to use

- Stealth games, where perception *is* the gameplay.
- Any game with more than a handful of enemies that should notice, lose and search for the player believably.
- When AI reactions must be tunable (vision cones, hearing ranges, reaction times) by designers.

## When not to use

- Enemies that always know where the player is, as in many arcade or horde games. Read the player's position directly.
- A single sense with a simple rule, such as "within 10 metres". One distance check is enough.
- When the game design doesn't reward stealth or being noticed. The extra tuning won't be visible.

## Pitfalls

- **Perfect information.** Reading the player's position directly instead of the *remembered* one makes AI omniscient. Decision-making should only see what perception wrote.
- **Instant reactions.** Without gradual awareness, enemies feel unfair. Without decay, they never calm down. Tune both, and show awareness to the player (an indicator, a voice line).
- **Cost.** Many agents × many targets × raycasts every frame adds up. Check at intervals, stagger agents, test range and angle before raycasting, and use a [Spatial Partition](./spatial-partition) when there are many targets.
- **Raycasting from the wrong place.** A ray from the agent's feet to the player's pivot is blocked by small bumps, and partial cover is ignored. Cast from the eyes to several points on the target (head, chest).
- **Sounds through walls.** A plain radius lets enemies hear through a mountain. Reduce loudness when the path is occluded, or measure distance along the navmesh.

## Related

- [Blackboard](./blackboard) — where perception writes what the agent knows.
- [Behavior Tree](./behavior-tree) — reads that knowledge to decide what to do.
- [Event Bus](./event-bus) and [Observer](./observer) — sounds as events.
- [Spatial Partition](./spatial-partition) — finding nearby targets cheaply.
- [Influence Map](./influence-map) and [AI Director](./director-ai) — higher-level awareness for groups and pacing.
