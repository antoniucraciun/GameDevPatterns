# Flocking

> Separation, alignment and cohesion produce emergent group motion.

**Also known as:** Boids · **Category:** AI & Decision Making

## Problem

A school of fish, a flock of birds or a swarm of insects should move as a group: turning together, splitting around obstacles and merging again. Scripting a path for each animal looks mechanical. Having them all seek one target collapses them into a single point. Controlling the group as one object loses the individual motion that makes it look alive.

## Solution

Give every agent three simple [steering](./steering-behaviors) rules, each looking only at **neighbours within a radius**:

| Rule | Steers toward | Effect |
| --- | --- | --- |
| **Separation** | Away from neighbours that are too close (stronger when closer) | No collisions or clumping |
| **Alignment** | The average heading of neighbours | Turning together |
| **Cohesion** | The average position (centre) of neighbours | Staying a group |

The weighted sum of the three forces, plus optional goals (*seek the food*, *flee the shark*, *avoid walls*), drives each agent. Nobody controls the group. Its motion **emerges** from local rules, which is why flocks split around obstacles and rejoin naturally.

Finding neighbours is the expensive part, O(n²) if every boid checks every other. A [Spatial Partition](./spatial-partition) grid with cells the size of the neighbour radius limits each boid to the 3×3 cells around it.

## Example

One flock object simulates every boid, with a uniform grid (cells as wide as the neighbour radius) so each boid only checks the 27 cells around it. Unity keeps one GameObject per boid; Godot and Unreal keep positions and velocities in arrays and draw all boids as instances of one mesh, which is the idiomatic way to show hundreds of identical things there.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public class Flock : MonoBehaviour
{
    [SerializeField] Boid prefab;
    [SerializeField] int count = 300;
    [SerializeField] float spawnRadius = 10f;

    [Header("Rules")]
    public float neighbourRadius = 2.5f;
    public float separationRadius = 1f;
    public float separationWeight = 1.8f, alignmentWeight = 1f, cohesionWeight = 0.8f;
    public float boundsRadius = 25f, boundsWeight = 2f;
    public float maxSpeed = 6f, maxForce = 8f;

    readonly List<Boid> boids = new();
    readonly List<Vector3> nextVelocity = new();
    readonly Dictionary<Vector3Int, List<Boid>> grid = new();
    readonly List<Boid> neighbours = new();

    void Start()
    {
        for (int i = 0; i < count; i++)
        {
            var b = Instantiate(prefab, transform.position + Random.insideUnitSphere * spawnRadius, Random.rotation, transform);
            b.Velocity = Random.onUnitSphere * maxSpeed * 0.5f;
            boids.Add(b);
        }
    }

    Vector3Int Cell(Vector3 p) => Vector3Int.FloorToInt(p / neighbourRadius);

    void Update()
    {
        // Rebuild the spatial grid once per frame.
        foreach (var list in grid.Values) list.Clear();
        foreach (var b in boids)
        {
            var c = Cell(b.transform.position);
            if (!grid.TryGetValue(c, out var list)) grid[c] = list = new List<Boid>();
            list.Add(b);
        }

        float dt = Time.deltaTime;
        nextVelocity.Clear();
        foreach (var b in boids)
        {
            Vector3 pos = b.transform.position;
            GatherNeighbours(pos);

            Vector3 separation = Vector3.zero, heading = Vector3.zero, centre = Vector3.zero;
            int n = 0;
            foreach (var other in neighbours)
            {
                if (other == b) continue;
                Vector3 offset = pos - other.transform.position;
                float d = offset.magnitude;
                if (d > neighbourRadius || d < 0.0001f) continue;

                if (d < separationRadius) separation += offset / d * (1f - d / separationRadius);
                heading += other.Velocity;
                centre += other.transform.position;
                n++;
            }

            Vector3 force = Vector3.zero;
            if (n > 0)
            {
                force += Steer(b, separation) * separationWeight;
                force += Steer(b, heading / n) * alignmentWeight;
                force += Steer(b, centre / n - pos) * cohesionWeight;
            }

            // Stay inside a sphere around the flock's origin.
            Vector3 fromCentre = pos - transform.position;
            if (fromCentre.magnitude > boundsRadius) force += Steer(b, -fromCentre) * boundsWeight;

            nextVelocity.Add(Vector3.ClampMagnitude(b.Velocity + Vector3.ClampMagnitude(force, maxForce) * dt, maxSpeed));
        }

        // Apply after all boids decided, so every boid reacted to the same snapshot of positions and velocities.
        for (int i = 0; i < boids.Count; i++)
        {
            var b = boids[i];
            b.Velocity = nextVelocity[i];
            b.transform.position += b.Velocity * dt;
            if (b.Velocity.sqrMagnitude > 0.01f) b.transform.rotation = Quaternion.LookRotation(b.Velocity);
        }
    }

    // Reynolds steering: desired velocity in the given direction, minus current velocity.
    Vector3 Steer(Boid b, Vector3 direction) =>
        direction.sqrMagnitude < 0.0001f ? Vector3.zero : direction.normalized * maxSpeed - b.Velocity;

    void GatherNeighbours(Vector3 p)
    {
        neighbours.Clear();
        var c = Cell(p);
        for (int x = -1; x <= 1; x++)
        for (int y = -1; y <= 1; y++)
        for (int z = -1; z <= 1; z++)
            if (grid.TryGetValue(new Vector3Int(c.x + x, c.y + y, c.z + z), out var list))
                neighbours.AddRange(list);
    }
}

public class Boid : MonoBehaviour
{
    public Vector3 Velocity;
}
```

```gdscript [Godot (GDScript)]
# flock.gd: simulates every boid and draws them all through one MultiMesh.
# Positions are local to this node, so the flock's origin is Vector3.ZERO.
extends MultiMeshInstance3D

@export var boid_mesh: Mesh
@export var count := 300
@export var spawn_radius := 10.0

@export_group("Rules")
@export var neighbour_radius := 2.5
@export var separation_radius := 1.0
@export var separation_weight := 1.8
@export var alignment_weight := 1.0
@export var cohesion_weight := 0.8
@export var bounds_radius := 25.0
@export var bounds_weight := 2.0
@export var max_speed := 6.0
@export var max_force := 8.0

var _positions := PackedVector3Array()
var _velocities := PackedVector3Array()
var _next_velocity := PackedVector3Array()
var _grid := {}  # Vector3i cell -> Array of boid indices
var _neighbours: Array[int] = []


func _ready() -> void:
	multimesh = MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D  # set before instance_count
	multimesh.mesh = boid_mesh
	multimesh.instance_count = count
	_positions.resize(count)
	_velocities.resize(count)
	_next_velocity.resize(count)
	for i in count:
		_positions[i] = _random_direction() * spawn_radius * pow(randf(), 1.0 / 3.0)
		_velocities[i] = _random_direction() * max_speed * 0.5


func _cell(p: Vector3) -> Vector3i:
	return Vector3i((p / neighbour_radius).floor())


func _process(delta: float) -> void:
	# Rebuild the spatial grid once per frame.
	_grid.clear()
	for i in count:
		var c := _cell(_positions[i])
		if not _grid.has(c):
			_grid[c] = []
		_grid[c].append(i)

	for i in count:
		var pos := _positions[i]
		_gather_neighbours(pos)

		var separation := Vector3.ZERO
		var heading := Vector3.ZERO
		var centre := Vector3.ZERO
		var n := 0
		for j in _neighbours:
			if j == i:
				continue
			var offset := pos - _positions[j]
			var d := offset.length()
			if d > neighbour_radius or d < 0.0001:
				continue
			if d < separation_radius:
				separation += offset / d * (1.0 - d / separation_radius)
			heading += _velocities[j]
			centre += _positions[j]
			n += 1

		var force := Vector3.ZERO
		if n > 0:
			force += _steer(i, separation) * separation_weight
			force += _steer(i, heading / n) * alignment_weight
			force += _steer(i, centre / n - pos) * cohesion_weight

		# Stay inside a sphere around the flock's origin.
		if pos.length() > bounds_radius:
			force += _steer(i, -pos) * bounds_weight

		_next_velocity[i] = (_velocities[i] + force.limit_length(max_force) * delta).limit_length(max_speed)

	# Apply after all boids decided, so every boid reacted to the same snapshot.
	for i in count:
		_velocities[i] = _next_velocity[i]
		_positions[i] += _velocities[i] * delta
		multimesh.set_instance_transform(i, Transform3D(_facing(_velocities[i]), _positions[i]))


# Reynolds steering: desired velocity in the given direction, minus current velocity.
func _steer(i: int, direction: Vector3) -> Vector3:
	if direction.length_squared() < 0.0001:
		return Vector3.ZERO
	return direction.normalized() * max_speed - _velocities[i]


func _gather_neighbours(p: Vector3) -> void:
	_neighbours.clear()
	var c := _cell(p)
	for x in range(-1, 2):
		for y in range(-1, 2):
			for z in range(-1, 2):
				var cell := c + Vector3i(x, y, z)
				if _grid.has(cell):
					_neighbours.append_array(_grid[cell])


static func _facing(v: Vector3) -> Basis:
	if v.length_squared() < 0.0001:
		return Basis.IDENTITY
	var up := Vector3.UP if absf(v.normalized().y) < 0.99 else Vector3.FORWARD  # avoid a parallel up vector
	return Basis.looking_at(v, up)


static func _random_direction() -> Vector3:
	return Vector3(randfn(0.0, 1.0), randfn(0.0, 1.0), randfn(0.0, 1.0)).normalized()
```

```cpp [Unreal (C++)]
// Flock.h: simulates every boid and draws them all as instances of one static mesh.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Flock.generated.h"

class UInstancedStaticMeshComponent;

UCLASS()
class AFlock : public AActor
{
	GENERATED_BODY()

public:
	AFlock();

protected:
	UPROPERTY(VisibleAnywhere, Category = "Flock")
	TObjectPtr<UInstancedStaticMeshComponent> Boids;   // pick the boid mesh on this component

	UPROPERTY(EditAnywhere, Category = "Flock") int32 Count = 300;
	UPROPERTY(EditAnywhere, Category = "Flock") float SpawnRadius = 1000.f;

	UPROPERTY(EditAnywhere, Category = "Rules") float NeighbourRadius = 250.f;
	UPROPERTY(EditAnywhere, Category = "Rules") float SeparationRadius = 100.f;
	UPROPERTY(EditAnywhere, Category = "Rules") float SeparationWeight = 1.8f;
	UPROPERTY(EditAnywhere, Category = "Rules") float AlignmentWeight = 1.f;
	UPROPERTY(EditAnywhere, Category = "Rules") float CohesionWeight = 0.8f;
	UPROPERTY(EditAnywhere, Category = "Rules") float BoundsRadius = 2500.f;
	UPROPERTY(EditAnywhere, Category = "Rules") float BoundsWeight = 2.f;
	UPROPERTY(EditAnywhere, Category = "Rules") float MaxSpeed = 600.f;
	UPROPERTY(EditAnywhere, Category = "Rules") float MaxForce = 800.f;

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

private:
	FIntVector Cell(const FVector& P) const;
	FVector Steer(int32 Index, const FVector& Direction) const;
	void GatherNeighbours(const FVector& P);

	TArray<FVector> Positions, Velocities, NextVelocity;   // component space: the flock's origin is zero
	TMap<FIntVector, TArray<int32>> Grid;                  // cell -> boid indices
	TArray<int32> Neighbours;
};

// Flock.cpp
#include "Flock.h"
#include "Components/InstancedStaticMeshComponent.h"

AFlock::AFlock()
{
	PrimaryActorTick.bCanEverTick = true;
	Boids = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("Boids"));
	RootComponent = Boids;
}

void AFlock::BeginPlay()
{
	Super::BeginPlay();
	for (int32 I = 0; I < Count; ++I)
	{
		Positions.Add(FMath::VRand() * SpawnRadius * FMath::Pow(FMath::FRand(), 1.f / 3.f));
		Velocities.Add(FMath::VRand() * MaxSpeed * 0.5f);
		Boids->AddInstance(FTransform(Positions[I]));
	}
	NextVelocity.SetNumZeroed(Count);
}

FIntVector AFlock::Cell(const FVector& P) const
{
	return FIntVector(FMath::FloorToInt(P.X / NeighbourRadius), FMath::FloorToInt(P.Y / NeighbourRadius),
		FMath::FloorToInt(P.Z / NeighbourRadius));
}

void AFlock::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// Rebuild the spatial grid once per frame, keeping each cell's allocation.
	for (auto& Pair : Grid) Pair.Value.Reset();
	for (int32 I = 0; I < Count; ++I) Grid.FindOrAdd(Cell(Positions[I])).Add(I);

	for (int32 I = 0; I < Count; ++I)
	{
		const FVector Pos = Positions[I];
		GatherNeighbours(Pos);

		FVector Separation = FVector::ZeroVector, Heading = FVector::ZeroVector, Centre = FVector::ZeroVector;
		int32 N = 0;
		for (const int32 J : Neighbours)
		{
			if (J == I) continue;
			const FVector Offset = Pos - Positions[J];
			const float D = Offset.Size();
			if (D > NeighbourRadius || D < 0.01f) continue;

			if (D < SeparationRadius) Separation += Offset / D * (1.f - D / SeparationRadius);
			Heading += Velocities[J];
			Centre += Positions[J];
			++N;
		}

		FVector Force = FVector::ZeroVector;
		if (N > 0)
		{
			Force += Steer(I, Separation) * SeparationWeight;
			Force += Steer(I, Heading / N) * AlignmentWeight;
			Force += Steer(I, Centre / N - Pos) * CohesionWeight;
		}

		// Stay inside a sphere around the flock's origin.
		if (Pos.Size() > BoundsRadius) Force += Steer(I, -Pos) * BoundsWeight;

		NextVelocity[I] = (Velocities[I] + Force.GetClampedToMaxSize(MaxForce) * DeltaSeconds).GetClampedToMaxSize(MaxSpeed);
	}

	// Apply after all boids decided, so every boid reacted to the same snapshot.
	for (int32 I = 0; I < Count; ++I)
	{
		Velocities[I] = NextVelocity[I];
		Positions[I] += Velocities[I] * DeltaSeconds;
		Boids->UpdateInstanceTransform(I, FTransform(Velocities[I].Rotation(), Positions[I]));
	}
	Boids->MarkRenderStateDirty();              // once for the whole batch
}

// Reynolds steering: desired velocity in the given direction, minus current velocity.
FVector AFlock::Steer(int32 Index, const FVector& Direction) const
{
	return Direction.SizeSquared() < 0.0001f ? FVector::ZeroVector
		: Direction.GetSafeNormal() * MaxSpeed - Velocities[Index];
}

void AFlock::GatherNeighbours(const FVector& P)
{
	Neighbours.Reset();
	const FIntVector C = Cell(P);
	for (int32 X = -1; X <= 1; ++X)
	for (int32 Y = -1; Y <= 1; ++Y)
	for (int32 Z = -1; Z <= 1; ++Z)
		if (const TArray<int32>* List = Grid.Find(C + FIntVector(X, Y, Z)))
			Neighbours.Append(*List);
}
```

:::

One update drives every boid, rather than one update per boid, and all boids decide before any of them moves (a [Double Buffer](./double-buffer) in spirit).

**Engine notes**

- **Unity:** for thousands of boids, move the loop into a Burst-compiled job, or into [ECS](./entity-component-system). Drawing with `Graphics.RenderMeshInstanced` instead of one GameObject per boid removes most of the transform overhead.
- **Godot:** set `MultiMesh.transform_format` before `instance_count`, or the instance buffer is created in the wrong format. GDScript tops out at a few hundred boids per frame; past that, move the loop to C#, a GDExtension or a compute shader.
- **Unreal:** a flock that is only scenery (birds, fish) can run entirely on the GPU in **Niagara**, which has a Neighbor Grid 3D for exactly this neighbour search. For crowds of gameplay agents, look at **Mass** (MassEntity), Unreal's data-oriented entity framework.

## When to use

- Birds, fish, bats, insects, herds and crowds of simple creatures.
- Swarming enemies, drones and particle-like gameplay objects.
- Ambient life that should look organic at low authoring cost.

## When not to use

- A few agents. Hand-animated or scripted movement looks better and is easier to control.
- Units that must obey exact orders, formations or tight spacing. Use formation slots plus [Steering](./steering-behaviors).
- Very large crowds without a [Spatial Partition](./spatial-partition). Naive neighbour checks are O(n²).

## Pitfalls

- **Weights are everything.** Too much cohesion gives a tight ball, too much separation gives a scattered cloud, and too much alignment gives a rigid formation. Expose weights and tune them live.
- **O(n²) neighbour search.** Without a spatial grid, 1,000 boids need about a million distance checks per frame. Partition space.
- **Order-dependent updates.** Moving each boid immediately after computing its force means later boids react to already-moved neighbours, which causes drift. Compute all forces first, then move.
- **Field of view.** Real birds do not react to neighbours directly behind them. Ignoring neighbours behind the agent gives more natural streaming motion.
- **Obstacles.** The three rules do not avoid walls. Add obstacle avoidance from [Steering Behaviors](./steering-behaviors) with a high weight.

## Related

- [Steering Behaviors](./steering-behaviors) — the force model flocking is built on.
- [Spatial Partition](./spatial-partition) — fast neighbour queries.
- [Data Locality](./data-locality) and [Entity Component System](./entity-component-system) — scaling to tens of thousands of agents.
- [Flow Field](./flow-field) — shared navigation for large groups heading somewhere specific.
