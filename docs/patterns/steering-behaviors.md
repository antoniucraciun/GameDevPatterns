# Steering Behaviors

> Combine simple forces (seek, flee, arrive, avoid) into lifelike movement.

**Category:** AI & Decision Making

## Problem

An enemy that sets `transform.position = Vector3.MoveTowards(...)` toward the player moves like a cursor. It turns instantly, overshoots or stops dead, walks through other enemies, and twenty of them stack into one blob. Pathfinding tells an agent *where* to go, but not *how* to move there in a way that looks alive.

## Solution

Model each agent as a simple **vehicle**: a position, a velocity, a maximum speed and a maximum steering force. Each frame, behaviours each compute a **desired velocity**. The **steering force** is the difference between desired and current velocity, clamped to the maximum force. Because acceleration is limited, agents curve, ease in and out, and react with a little inertia.

The classic behaviours are tiny functions:

| Behaviour | Desired velocity |
| --- | --- |
| **Seek** | Full speed toward the target |
| **Flee** | Full speed away from the target |
| **Arrive** | Toward the target, slowing down inside a braking radius |
| **Pursue / Evade** | Seek or flee the target's *predicted* future position |
| **Wander** | A gently drifting random direction (a point jittering on a circle ahead of the agent) |
| **Separation** | Away from nearby neighbours, stronger when closer |
| **Obstacle avoidance** | Away from obstacles detected by feelers (raycasts) ahead |

Complex movement comes from **combining** them: a weighted sum (for example, arrive × 1 + separation × 1.5 + avoidance × 3), or priorities, where avoidance gets its share of the force budget first.

<SteeringViz />

## Example

A ground agent that blends Arrive, Separation, obstacle avoidance and Wander, each a steering force (desired velocity minus current velocity) with a weight. The behaviours are plain vector maths; only the neighbour list and the obstacle feelers touch the engine.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public class SteeringAgent : MonoBehaviour
{
    public static readonly List<SteeringAgent> All = new();   // use a spatial partition for large crowds

    [SerializeField] float maxSpeed = 5f;
    [SerializeField] float maxForce = 12f;
    [SerializeField] float arriveRadius = 3f;
    [SerializeField] float separationRadius = 1.5f;
    [SerializeField] float avoidDistance = 3f;
    [SerializeField] LayerMask obstacles;

    [Header("Weights")]
    [SerializeField] float arriveWeight = 1f;
    [SerializeField] float separationWeight = 1.5f;
    [SerializeField] float avoidWeight = 3f;
    [SerializeField] float wanderWeight = 0f;

    public Vector3 Velocity { get; private set; }
    public Vector3? Target;                                     // set by AI decisions or a path follower

    float wanderAngle;

    void OnEnable()  => All.Add(this);
    void OnDisable() => All.Remove(this);

    void Update()
    {
        Vector3 force = Vector3.zero;
        if (Target is { } t) force += Arrive(t) * arriveWeight;
        force += Separation() * separationWeight;
        force += AvoidObstacles() * avoidWeight;
        force += Wander() * wanderWeight;

        force = Vector3.ClampMagnitude(Flat(force), maxForce);
        Velocity = Vector3.ClampMagnitude(Velocity + force * Time.deltaTime, maxSpeed);
        transform.position += Velocity * Time.deltaTime;

        if (Velocity.sqrMagnitude > 0.01f)                       // face the direction of travel, smoothly
            transform.rotation = Quaternion.Slerp(transform.rotation,
                Quaternion.LookRotation(Velocity), 1f - Mathf.Exp(-10f * Time.deltaTime));
    }

    // ── Behaviours: each returns a steering force (desired velocity - current velocity) ──

    Vector3 Seek(Vector3 target) => Flat(target - transform.position).normalized * maxSpeed - Velocity;

    Vector3 Flee(Vector3 threat) => Flat(transform.position - threat).normalized * maxSpeed - Velocity;

    Vector3 Arrive(Vector3 target)
    {
        Vector3 offset = Flat(target - transform.position);
        float distance = offset.magnitude;
        if (distance < 0.05f) return -Velocity;                  // brake to a stop
        float speed = maxSpeed * Mathf.Min(1f, distance / arriveRadius);   // slow down when close
        return offset / distance * speed - Velocity;
    }

    Vector3 Pursue(SteeringAgent quarry)
    {
        float lookAhead = Vector3.Distance(transform.position, quarry.transform.position) / maxSpeed;
        return Seek(quarry.transform.position + quarry.Velocity * lookAhead);
    }

    Vector3 Separation()
    {
        Vector3 push = Vector3.zero;
        foreach (var other in All)
        {
            if (other == this) continue;
            Vector3 away = Flat(transform.position - other.transform.position);
            float d = away.magnitude;
            if (d > 0.001f && d < separationRadius)
                push += away / d * (1f - d / separationRadius);   // stronger when closer
        }
        return push * maxSpeed;
    }

    static readonly float[] FeelerAngles = { 0f, -30f, 30f };

    Vector3 AvoidObstacles()
    {
        if (Velocity.sqrMagnitude < 0.01f) return Vector3.zero;
        Vector3 dir = Velocity.normalized;
        float length = avoidDistance * Velocity.magnitude / maxSpeed;

        // Three feelers: straight ahead and angled to each side.
        foreach (float angle in FeelerAngles)
        {
            Vector3 feeler = Quaternion.Euler(0f, angle, 0f) * dir;
            if (Physics.Raycast(transform.position + Vector3.up * 0.5f, feeler, out var hit, length, obstacles))
                return Flat(hit.normal) * maxSpeed * (1f - hit.distance / length);
        }
        return Vector3.zero;
    }

    Vector3 Wander()
    {
        wanderAngle += Random.Range(-1f, 1f) * 3f * Time.deltaTime;   // drift slowly, not jitter
        Vector3 forward = Velocity.sqrMagnitude > 0.01f ? Velocity.normalized : transform.forward;
        Vector3 circleCenter = forward * 2f;
        Vector3 offset = new Vector3(Mathf.Cos(wanderAngle), 0f, Mathf.Sin(wanderAngle));
        return (circleCenter + offset).normalized * maxSpeed - Velocity;
    }

    static Vector3 Flat(Vector3 v) => new(v.x, 0f, v.z);         // ground-based agents
}
```

```gdscript [Godot (GDScript)]
# steering_agent.gd
class_name SteeringAgent
extends Node3D

const GROUP := &"steering_agents"  # use a spatial partition for large crowds
const FEELER_ANGLES: Array[float] = [0.0, -30.0, 30.0]

@export var max_speed := 5.0
@export var max_force := 12.0
@export var arrive_radius := 3.0
@export var separation_radius := 1.5
@export var avoid_distance := 3.0
@export_flags_3d_physics var obstacles := 1

@export_group("Weights")
@export var arrive_weight := 1.0
@export var separation_weight := 1.5
@export var avoid_weight := 3.0
@export var wander_weight := 0.0

var velocity := Vector3.ZERO
var target: Variant = null  # a Vector3 or null; set by AI decisions or a path follower

var _wander_angle := 0.0


func _ready() -> void:
	add_to_group(GROUP)


func _physics_process(delta: float) -> void:
	var force := Vector3.ZERO
	if target != null:
		force += _arrive(target) * arrive_weight
	force += _separation() * separation_weight
	force += _avoid_obstacles() * avoid_weight
	force += _wander(delta) * wander_weight

	force = _flat(force).limit_length(max_force)
	velocity = (velocity + force * delta).limit_length(max_speed)
	global_position += velocity * delta

	if velocity.length_squared() > 0.01:  # face the direction of travel (-Z), smoothly
		var facing := Basis.looking_at(velocity)
		global_transform.basis = global_transform.basis.slerp(facing, 1.0 - exp(-10.0 * delta))


# ── Behaviours: each returns a steering force (desired velocity - current velocity) ──

func _seek(point: Vector3) -> Vector3:
	return _flat(point - global_position).normalized() * max_speed - velocity


func _flee(threat: Vector3) -> Vector3:
	return _flat(global_position - threat).normalized() * max_speed - velocity


func _arrive(point: Vector3) -> Vector3:
	var offset := _flat(point - global_position)
	var distance := offset.length()
	if distance < 0.05:
		return -velocity  # brake to a stop
	var speed := max_speed * minf(1.0, distance / arrive_radius)  # slow down when close
	return offset / distance * speed - velocity


func _pursue(quarry: SteeringAgent) -> Vector3:
	var look_ahead := global_position.distance_to(quarry.global_position) / max_speed
	return _seek(quarry.global_position + quarry.velocity * look_ahead)


func _separation() -> Vector3:
	var push := Vector3.ZERO
	for other: SteeringAgent in get_tree().get_nodes_in_group(GROUP):
		if other == self:
			continue
		var away := _flat(global_position - other.global_position)
		var d := away.length()
		if d > 0.001 and d < separation_radius:
			push += away / d * (1.0 - d / separation_radius)  # stronger when closer
	return push * max_speed


func _avoid_obstacles() -> Vector3:
	if velocity.length_squared() < 0.01:
		return Vector3.ZERO
	var dir := velocity.normalized()
	var length := avoid_distance * velocity.length() / max_speed
	var space := get_world_3d().direct_space_state  # only safe to query during physics processing
	var origin := global_position + Vector3.UP * 0.5

	# Three feelers: straight ahead and angled to each side.
	for angle in FEELER_ANGLES:
		var feeler := dir.rotated(Vector3.UP, deg_to_rad(angle))
		var query := PhysicsRayQueryParameters3D.create(origin, origin + feeler * length, obstacles)
		var hit := space.intersect_ray(query)
		if not hit.is_empty():
			var hit_position: Vector3 = hit["position"]
			var hit_normal: Vector3 = hit["normal"]
			return _flat(hit_normal) * max_speed * (1.0 - origin.distance_to(hit_position) / length)
	return Vector3.ZERO


func _wander(delta: float) -> Vector3:
	_wander_angle += randf_range(-1.0, 1.0) * 3.0 * delta  # drift slowly, not jitter
	var forward := velocity.normalized() if velocity.length_squared() > 0.01 else -global_transform.basis.z
	var circle_center := forward * 2.0
	var offset := Vector3(cos(_wander_angle), 0.0, sin(_wander_angle))
	return (circle_center + offset).normalized() * max_speed - velocity


static func _flat(v: Vector3) -> Vector3:  # ground-based agents
	return Vector3(v.x, 0.0, v.z)
```

```cpp [Unreal (C++)]
// SteeringComponent.h: Unreal is Z-up and measures in centimetres.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "SteeringComponent.generated.h"

UCLASS(ClassGroup = (AI), meta = (BlueprintSpawnableComponent))
class USteeringComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	USteeringComponent();

	FVector GetVelocity() const { return Velocity; }
	TOptional<FVector> Target;                  // set by AI decisions or a path follower

protected:
	UPROPERTY(EditAnywhere, Category = "Steering") float MaxSpeed = 500.f;
	UPROPERTY(EditAnywhere, Category = "Steering") float MaxForce = 1200.f;
	UPROPERTY(EditAnywhere, Category = "Steering") float ArriveRadius = 300.f;
	UPROPERTY(EditAnywhere, Category = "Steering") float SeparationRadius = 150.f;
	UPROPERTY(EditAnywhere, Category = "Steering") float AvoidDistance = 300.f;
	UPROPERTY(EditAnywhere, Category = "Steering") TEnumAsByte<ECollisionChannel> ObstacleChannel = ECC_WorldStatic;

	UPROPERTY(EditAnywhere, Category = "Steering|Weights") float ArriveWeight = 1.f;
	UPROPERTY(EditAnywhere, Category = "Steering|Weights") float SeparationWeight = 1.5f;
	UPROPERTY(EditAnywhere, Category = "Steering|Weights") float AvoidWeight = 3.f;
	UPROPERTY(EditAnywhere, Category = "Steering|Weights") float WanderWeight = 0.f;

	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

private:
	FVector Location() const { return GetOwner()->GetActorLocation(); }
	FVector Seek(const FVector& Point) const;
	FVector Flee(const FVector& Threat) const;
	FVector Arrive(const FVector& Point) const;
	FVector Pursue(const USteeringComponent& Quarry) const;
	FVector Separation() const;
	FVector AvoidObstacles() const;
	FVector Wander(float DeltaTime);
	static FVector Flat(const FVector& V) { return FVector(V.X, V.Y, 0.f); }   // ground-based agents

	FVector Velocity = FVector::ZeroVector;
	float WanderAngle = 0.f;

	// Every active agent. Use a spatial partition for large crowds; a UWorldSubsystem is the
	// cleaner home for this list in a real project (one per world, so PIE sessions don't mix).
	static TArray<USteeringComponent*> All;
};

// SteeringComponent.cpp
#include "SteeringComponent.h"
#include "Engine/World.h"

TArray<USteeringComponent*> USteeringComponent::All;

USteeringComponent::USteeringComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
}

void USteeringComponent::BeginPlay()
{
	Super::BeginPlay();
	All.Add(this);
}

void USteeringComponent::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	All.Remove(this);
	Super::EndPlay(EndPlayReason);
}

void USteeringComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	FVector Force = FVector::ZeroVector;
	if (Target.IsSet()) Force += Arrive(Target.GetValue()) * ArriveWeight;
	Force += Separation() * SeparationWeight;
	Force += AvoidObstacles() * AvoidWeight;
	Force += Wander(DeltaTime) * WanderWeight;

	Force = Flat(Force).GetClampedToMaxSize(MaxForce);
	Velocity = (Velocity + Force * DeltaTime).GetClampedToMaxSize(MaxSpeed);
	GetOwner()->AddActorWorldOffset(Velocity * DeltaTime);

	if (Velocity.SizeSquared() > 1.f)           // face the direction of travel, smoothly
		GetOwner()->SetActorRotation(FMath::RInterpTo(GetOwner()->GetActorRotation(), Velocity.Rotation(), DeltaTime, 10.f));
}

// ── Behaviours: each returns a steering force (desired velocity - current velocity) ──

FVector USteeringComponent::Seek(const FVector& Point) const
{
	return Flat(Point - Location()).GetSafeNormal() * MaxSpeed - Velocity;
}

FVector USteeringComponent::Flee(const FVector& Threat) const
{
	return Flat(Location() - Threat).GetSafeNormal() * MaxSpeed - Velocity;
}

FVector USteeringComponent::Arrive(const FVector& Point) const
{
	const FVector Offset = Flat(Point - Location());
	const float Distance = Offset.Size();
	if (Distance < 5.f) return -Velocity;       // brake to a stop
	const float Speed = MaxSpeed * FMath::Min(1.f, Distance / ArriveRadius);   // slow down when close
	return Offset / Distance * Speed - Velocity;
}

FVector USteeringComponent::Pursue(const USteeringComponent& Quarry) const
{
	const float LookAhead = FVector::Dist(Location(), Quarry.Location()) / MaxSpeed;
	return Seek(Quarry.Location() + Quarry.Velocity * LookAhead);
}

FVector USteeringComponent::Separation() const
{
	FVector Push = FVector::ZeroVector;
	for (const USteeringComponent* Other : All)
	{
		if (Other == this || Other->GetWorld() != GetWorld()) continue;
		const FVector Away = Flat(Location() - Other->Location());
		const float D = Away.Size();
		if (D > 0.1f && D < SeparationRadius)
			Push += Away / D * (1.f - D / SeparationRadius);   // stronger when closer
	}
	return Push * MaxSpeed;
}

FVector USteeringComponent::AvoidObstacles() const
{
	if (Velocity.SizeSquared() < 1.f) return FVector::ZeroVector;
	const FVector Dir = Velocity.GetSafeNormal();
	const float Length = AvoidDistance * Velocity.Size() / MaxSpeed;
	const FVector Start = Location() + FVector(0.f, 0.f, 50.f);
	const FCollisionQueryParams Params(SCENE_QUERY_STAT(SteeringFeeler), false, GetOwner());

	// Three feelers: straight ahead and angled to each side.
	for (const float Angle : {0.f, -30.f, 30.f})
	{
		const FVector Feeler = Dir.RotateAngleAxis(Angle, FVector::UpVector);
		FHitResult Hit;
		if (GetWorld()->LineTraceSingleByChannel(Hit, Start, Start + Feeler * Length, ObstacleChannel, Params))
			return Flat(Hit.ImpactNormal) * MaxSpeed * (1.f - Hit.Distance / Length);
	}
	return FVector::ZeroVector;
}

FVector USteeringComponent::Wander(float DeltaTime)
{
	WanderAngle += FMath::FRandRange(-1.f, 1.f) * 3.f * DeltaTime;   // drift slowly, not jitter
	const FVector Forward = Velocity.SizeSquared() > 1.f ? Velocity.GetSafeNormal() : GetOwner()->GetActorForwardVector();
	const FVector CircleCenter = Forward * 2.f;
	const FVector Offset(FMath::Cos(WanderAngle), FMath::Sin(WanderAngle), 0.f);
	return (CircleCenter + Offset).GetSafeNormal() * MaxSpeed - Velocity;
}
```

:::

`Seek`, `Flee` and `Pursue` are included for completeness. Swap them into the update to build chasers, prey or interceptors.

**Engine notes**

- **Unity:** `NavMeshAgent` already does seek, arrive and local avoidance between agents along a navmesh path; write your own steering when you want the behaviours above or movement without a navmesh. The feeler angles are a static array so the raycasts don't allocate each frame.
- **Godot:** `NavigationAgent2D/3D` has built-in RVO avoidance (`avoidance_enabled`, then move by the `velocity_computed` signal). Physics queries through `direct_space_state` are only safe in `_physics_process`, which is why the agent steers there. Nodes join a group instead of a static list, so no cleanup is needed when one is freed.
- **Unreal:** the Character Movement Component offers **RVO avoidance** (`bUseRVOAvoidance`), and AI controllers using `UCrowdFollowingComponent` get Detour crowd avoidance along navmesh paths. Moving with `AddActorWorldOffset` as above ignores collision; on a pawn, feed the steering into its movement component (for example `AddMovementInput(Velocity.GetSafeNormal())`) instead.

## When to use

- Movement that should look organic: animals, crowds, flocks, swarms, vehicles, flying enemies.
- The "last metre" of movement on top of pathfinding: follow path waypoints with *Arrive*, while *Separation* keeps agents from overlapping.
- Many simple agents where full pathfinding per agent is too expensive.

## When not to use

- Agents that must follow precise paths, such as tower-defence creeps on a lane. Follow the path directly.
- Navigation through complex level layouts on its own. Steering is local; pair it with [A*](./a-star), a [Navigation Mesh](./navigation-mesh) or a [Flow Field](./flow-field).
- Grid- or tile-based movement. Steering forces fight the grid; move tile by tile instead.

## Pitfalls

- **Weighted sums cancel out.** Separation pushing left and seek pulling right can sum to nearly zero, and the agent stalls or jitters. Use priorities (avoidance first), or limit how much force each behaviour may use.
- **Oscillation.** Agents that overshoot and correct back and forth need *Arrive* instead of *Seek* near targets, and a lower maximum force.
- **Not a pathfinder.** Steering is local: an agent will happily steer into a U-shaped dead end. Combine it with [A*](./a-star) or a NavMesh for global routes.
- **O(n²) neighbours.** Checking every agent against every other is fine for 50 agents and too slow for 2,000. Use a [Spatial Partition](./spatial-partition) for neighbour queries.
- **Mixing with physics.** Setting `transform.position` on a Rigidbody fights the physics engine. Apply the force to the Rigidbody instead, or use kinematic movement consistently.
- **Frame-rate dependence.** Large forces with variable `deltaTime` behave differently at 30 and 144 FPS. Run steering in a [Fixed Timestep](./fixed-timestep) for consistency.

## Related

- [Flocking](./flocking) — Separation + Alignment + Cohesion: steering applied to groups.
- [A* Pathfinding](./a-star), [Navigation Mesh](./navigation-mesh) and [Flow Field](./flow-field) — global routes that steering follows locally.
- [Spatial Partition](./spatial-partition) — fast neighbour queries for separation.
- [Behavior Tree](./behavior-tree) — decides *which* steering behaviours are active and toward what.
