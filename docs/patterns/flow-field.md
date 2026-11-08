# Flow Field

> Precompute a direction per cell so thousands of units can share one path.

**Category:** AI & Decision Making

## Problem

An RTS player selects 800 units and clicks across the map. Running [A*](./a-star) 800 times is expensive, and every unit gets the same narrow optimal line, so they queue single file through the same tiles. In a horde game, 3,000 zombies chase one player. They all need a path to the same goal, and that goal moves every frame.

## Solution

Flip the problem: instead of one path per unit, compute **one field for the goal**, and let every unit read it.

1. **Cost field.** Each grid cell has a movement cost (1 for floor, 3 for mud, impassable for walls).
2. **Integration field.** Starting from the goal, a breadth-first or Dijkstra flood fills every cell with its total cost to reach the goal.
3. **Flow field.** Each cell stores a direction toward its cheapest neighbour.
4. **Movement.** Each unit looks up the direction of the cell it stands on, and steers that way, combined with separation so the crowd spreads naturally.

The cost depends on the **size of the map, not the number of units**. 10 units or 10,000, the field is computed once. When the goal moves, recompute the field, possibly at a lower rate or only in the area around the goal.

<FlowFieldViz />

## Pseudocode

```text
cost[cell]         = 1 for floor, more for mud, WALL for impassable
integration[cell]  = total cost from cell to the goal, ∞ until reached
direction[cell]    = unit vector toward the cheapest neighbour

build(goal):
    set every integration to ∞ and every direction to zero
    // 1. Integration field: flood outward from the goal (4-way).
    integration[goal] ← 0
    queue ← [goal]
    while queue is not empty:
        c ← take the first cell out of queue
        for each of the 4 neighbours n of c that is not a WALL:
            total ← integration[c] + cost[n]
            if total < integration[n]:
                integration[n] ← total
                add n to queue          // re-queue whenever it improves

    // 2. Flow field: point each reached cell at its cheapest neighbour (8-way).
    for each cell c that is not a WALL and was reached:
        best ← integration[c]
        for each of the 8 neighbours n of c:
            if n is diagonal and either cell beside the diagonal is a WALL:
                skip it                 // don't cut between two walls
            if integration[n] < best:
                best ← integration[n]
                direction[c] ← normalised (n − c)

// Engine wiring: one owner, many readers.
when the goal enters a new cell, at most every 0.25 s:
    build(goal cell)
every frame, for each unit:
    desired ← direction[cell under the unit] × max_speed   // plus separation
    move velocity toward desired by at most acceleration × dt
```

## Example

The **core** builds the field: a cost grid, an integration field flooded out from the goal, and a direction per cell. The **engine wiring** marks walls from the level's collision, rebuilds the field when the goal changes cell, and moves units along it.

### Core

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public class FlowField
{
    public readonly int Width, Height;
    public readonly float CellSize;
    public readonly Vector3 Origin;

    readonly byte[] cost;             // 1..254 = cost, 255 = impassable
    readonly ushort[] integration;    // total cost to the goal
    readonly Vector2[] direction;     // per cell: normalised direction toward the goal

    static readonly Vector2Int[] Neighbours =
    {
        new(1, 0), new(-1, 0), new(0, 1), new(0, -1),
        new(1, 1), new(1, -1), new(-1, 1), new(-1, -1),
    };

    public FlowField(int width, int height, float cellSize, Vector3 origin)
    {
        Width = width; Height = height; CellSize = cellSize; Origin = origin;
        cost = new byte[width * height];
        integration = new ushort[width * height];
        direction = new Vector2[width * height];
        for (int i = 0; i < cost.Length; i++) cost[i] = 1;
    }

    int Index(int x, int y) => y * Width + x;
    bool InBounds(int x, int y) => x >= 0 && y >= 0 && x < Width && y < Height;

    public void SetCost(int x, int y, byte value) => cost[Index(x, y)] = value;

    public Vector2Int CellOf(Vector3 world) =>
        new(Mathf.FloorToInt((world.x - Origin.x) / CellSize), Mathf.FloorToInt((world.z - Origin.z) / CellSize));

    public Vector3 CenterOf(int x, int y) => Origin + new Vector3((x + 0.5f) * CellSize, 0f, (y + 0.5f) * CellSize);

    // Rebuild the whole field toward a goal. Cost depends on map size, not unit count.
    public void Build(Vector3 goalWorld)
    {
        for (int i = 0; i < integration.Length; i++) { integration[i] = ushort.MaxValue; direction[i] = Vector2.zero; }

        var goal = CellOf(goalWorld);
        if (!InBounds(goal.x, goal.y)) return;

        // 1. Integration field: Dijkstra-like flood from the goal (a simple queue is fine for small costs).
        var open = new Queue<Vector2Int>();
        integration[Index(goal.x, goal.y)] = 0;
        open.Enqueue(goal);
        while (open.Count > 0)
        {
            var c = open.Dequeue();
            int here = integration[Index(c.x, c.y)];
            for (int n = 0; n < 4; n++)                            // 4-way flood keeps costs simple
            {
                int nx = c.x + Neighbours[n].x, ny = c.y + Neighbours[n].y;
                if (!InBounds(nx, ny)) continue;
                int i = Index(nx, ny);
                if (cost[i] == 255) continue;                       // wall
                int total = here + cost[i];
                if (total < integration[i])
                {
                    integration[i] = (ushort)total;
                    open.Enqueue(new Vector2Int(nx, ny));            // re-queue when improved
                }
            }
        }

        // 2. Flow field: point each cell at its cheapest neighbour (8-way for smoother motion).
        for (int y = 0; y < Height; y++)
        for (int x = 0; x < Width; x++)
        {
            int i = Index(x, y);
            if (cost[i] == 255 || integration[i] == ushort.MaxValue) { direction[i] = Vector2.zero; continue; }

            int best = integration[i];
            Vector2 dir = Vector2.zero;
            foreach (var d in Neighbours)
            {
                int nx = x + d.x, ny = y + d.y;
                if (!InBounds(nx, ny)) continue;
                // Don't cut diagonally between two walls.
                if (d.x != 0 && d.y != 0 && (cost[Index(x + d.x, y)] == 255 || cost[Index(x, y + d.y)] == 255)) continue;
                int v = integration[Index(nx, ny)];
                if (v < best) { best = v; dir = ((Vector2)d).normalized; }
            }
            direction[i] = dir;
        }
    }

    public Vector3 DirectionAt(Vector3 world)
    {
        var c = CellOf(world);
        if (!InBounds(c.x, c.y)) return Vector3.zero;
        var d = direction[Index(c.x, c.y)];
        return new Vector3(d.x, 0f, d.y);
    }
}
```

```gdscript [Godot (GDScript)]
# flow_field.gd: cells lie on the XZ plane, starting at origin.
class_name FlowField
extends RefCounted

const WALL := 255
const UNREACHED := 65535
const NEIGHBOURS: Array[Vector2i] = [
	Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1),
	Vector2i(1, 1), Vector2i(1, -1), Vector2i(-1, 1), Vector2i(-1, -1),
]

var width: int
var height: int
var cell_size: float
var origin: Vector3

var _cost := PackedByteArray()          # 1..254 = cost, 255 = impassable
var _integration := PackedInt32Array()  # total cost to the goal
var _direction := PackedVector2Array()  # per cell: normalised direction toward the goal


func _init(p_width: int, p_height: int, p_cell_size: float, p_origin: Vector3) -> void:
	width = p_width
	height = p_height
	cell_size = p_cell_size
	origin = p_origin
	_cost.resize(width * height)
	_cost.fill(1)
	_integration.resize(width * height)
	_direction.resize(width * height)


func set_cost(x: int, y: int, value: int) -> void:
	_cost[_index(Vector2i(x, y))] = value


func cell_of(world: Vector3) -> Vector2i:
	return Vector2i(floori((world.x - origin.x) / cell_size), floori((world.z - origin.z) / cell_size))


func center_of(x: int, y: int) -> Vector3:
	return origin + Vector3((x + 0.5) * cell_size, 0.0, (y + 0.5) * cell_size)


## Rebuild the whole field toward a goal. Cost depends on map size, not unit count.
func build(goal_world: Vector3) -> void:
	_integration.fill(UNREACHED)
	_direction.fill(Vector2.ZERO)
	var goal := cell_of(goal_world)
	if not _in_bounds(goal):
		return

	# 1. Integration field: flood from the goal. Arrays have no cheap pop_front, so read with a head index.
	var open: Array[Vector2i] = [goal]
	var head := 0
	_integration[_index(goal)] = 0
	while head < open.size():
		var c := open[head]
		head += 1
		var here := _integration[_index(c)]
		for n in 4:  # 4-way flood keeps costs simple
			var next := c + NEIGHBOURS[n]
			if not _in_bounds(next):
				continue
			var i := _index(next)
			if _cost[i] == WALL:
				continue
			var total := here + _cost[i]
			if total < _integration[i]:
				_integration[i] = total
				open.append(next)  # re-queue when improved

	# 2. Flow field: point each cell at its cheapest neighbour (8-way for smoother motion).
	for y in height:
		for x in width:
			var i := _index(Vector2i(x, y))
			if _cost[i] == WALL or _integration[i] == UNREACHED:
				continue
			var best := _integration[i]
			var dir := Vector2.ZERO
			for d: Vector2i in NEIGHBOURS:
				var next := Vector2i(x, y) + d
				if not _in_bounds(next):
					continue
				# Don't cut diagonally between two walls.
				if d.x != 0 and d.y != 0 and (_cost[_index(Vector2i(x + d.x, y))] == WALL \
						or _cost[_index(Vector2i(x, y + d.y))] == WALL):
					continue
				var v := _integration[_index(next)]
				if v < best:
					best = v
					dir = Vector2(d).normalized()
			_direction[i] = dir


func direction_at(world: Vector3) -> Vector3:
	var c := cell_of(world)
	if not _in_bounds(c):
		return Vector3.ZERO
	var d := _direction[_index(c)]
	return Vector3(d.x, 0.0, d.y)


func _index(c: Vector2i) -> int:
	return c.y * width + c.x


func _in_bounds(c: Vector2i) -> bool:
	return c.x >= 0 and c.y >= 0 and c.x < width and c.y < height
```

```cpp [Unreal (C++)]
// FlowField.h: plain C++. Unreal is Z-up, so cells lie on the XY plane.
#pragma once

#include "CoreMinimal.h"

class FFlowField
{
public:
	static constexpr uint8 Wall = 255;          // 1..254 = cost, 255 = impassable

	FFlowField(int32 InWidth, int32 InHeight, float InCellSize, const FVector& InOrigin);

	int32 GetWidth() const { return Width; }
	int32 GetHeight() const { return Height; }
	void SetCost(int32 X, int32 Y, uint8 Value) { Cost[Index(X, Y)] = Value; }
	FIntPoint CellOf(const FVector& World) const;
	FVector CenterOf(int32 X, int32 Y) const;

	// Rebuild the whole field toward a goal. Cost depends on map size, not unit count.
	void Build(const FVector& GoalWorld);
	FVector DirectionAt(const FVector& World) const;

private:
	int32 Index(int32 X, int32 Y) const { return Y * Width + X; }
	bool InBounds(int32 X, int32 Y) const { return X >= 0 && Y >= 0 && X < Width && Y < Height; }

	int32 Width, Height;
	float CellSize;
	FVector Origin;
	TArray<uint8> Cost;
	TArray<uint16> Integration;                 // total cost to the goal
	TArray<FVector2f> Direction;                // per cell: normalised direction toward the goal
	TArray<FIntPoint> Open;                     // flood queue, kept between builds
};

// FlowField.cpp
#include "FlowField.h"

static const FIntPoint Neighbours[] = {
	{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1},
};

FFlowField::FFlowField(int32 InWidth, int32 InHeight, float InCellSize, const FVector& InOrigin)
	: Width(InWidth), Height(InHeight), CellSize(InCellSize), Origin(InOrigin)
{
	Cost.Init(1, Width * Height);
	Integration.SetNumUninitialized(Width * Height);
	Direction.SetNumZeroed(Width * Height);
}

FIntPoint FFlowField::CellOf(const FVector& World) const
{
	return FIntPoint(FMath::FloorToInt((World.X - Origin.X) / CellSize), FMath::FloorToInt((World.Y - Origin.Y) / CellSize));
}

FVector FFlowField::CenterOf(int32 X, int32 Y) const
{
	return Origin + FVector((X + 0.5f) * CellSize, (Y + 0.5f) * CellSize, 0.f);
}

void FFlowField::Build(const FVector& GoalWorld)
{
	for (uint16& V : Integration) V = MAX_uint16;
	for (FVector2f& D : Direction) D = FVector2f::ZeroVector;

	const FIntPoint Goal = CellOf(GoalWorld);
	if (!InBounds(Goal.X, Goal.Y)) return;

	// 1. Integration field: flood from the goal, reading the queue with a head index.
	Open.Reset();
	Open.Add(Goal);
	Integration[Index(Goal.X, Goal.Y)] = 0;
	for (int32 Head = 0; Head < Open.Num(); ++Head)
	{
		const FIntPoint C = Open[Head];
		const int32 Here = Integration[Index(C.X, C.Y)];
		for (int32 N = 0; N < 4; ++N)           // 4-way flood keeps costs simple
		{
			const FIntPoint Next = C + Neighbours[N];
			if (!InBounds(Next.X, Next.Y)) continue;
			const int32 I = Index(Next.X, Next.Y);
			if (Cost[I] == Wall) continue;
			const int32 Total = Here + Cost[I];
			if (Total < Integration[I])
			{
				Integration[I] = static_cast<uint16>(Total);
				Open.Add(Next);                 // re-queue when improved
			}
		}
	}

	// 2. Flow field: point each cell at its cheapest neighbour (8-way for smoother motion).
	for (int32 Y = 0; Y < Height; ++Y)
	for (int32 X = 0; X < Width; ++X)
	{
		const int32 I = Index(X, Y);
		if (Cost[I] == Wall || Integration[I] == MAX_uint16) continue;

		int32 Best = Integration[I];
		for (const FIntPoint& D : Neighbours)
		{
			const int32 NX = X + D.X, NY = Y + D.Y;
			if (!InBounds(NX, NY)) continue;
			// Don't cut diagonally between two walls.
			if (D.X != 0 && D.Y != 0 && (Cost[Index(X + D.X, Y)] == Wall || Cost[Index(X, Y + D.Y)] == Wall)) continue;
			const int32 V = Integration[Index(NX, NY)];
			if (V < Best) { Best = V; Direction[I] = FVector2f(D.X, D.Y).GetSafeNormal(); }
		}
	}
}

FVector FFlowField::DirectionAt(const FVector& World) const
{
	const FIntPoint C = CellOf(World);
	if (!InBounds(C.X, C.Y)) return FVector::ZeroVector;
	const FVector2f D = Direction[Index(C.X, C.Y)];
	return FVector(D.X, D.Y, 0.f);
}
```

:::

### Engine wiring

One object owns the field and rebuilds it when the goal enters a new cell, at most a few times per second; every unit just reads its cell's direction.

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class FlowFieldGoal : MonoBehaviour
{
    [SerializeField] Transform goal;
    [SerializeField] int width = 128, height = 128;
    [SerializeField] float cellSize = 1f;
    [SerializeField] LayerMask walls;
    [SerializeField] float minRebuildInterval = 0.25f;

    public FlowField Field { get; private set; }
    Vector2Int goalCell = new(int.MinValue, int.MinValue);
    float nextRebuild;

    void Awake()
    {
        Field = new FlowField(width, height, cellSize, transform.position);
        var halfExtents = new Vector3(cellSize * 0.45f, 1f, cellSize * 0.45f);
        for (int y = 0; y < height; y++)
        for (int x = 0; x < width; x++)
            if (Physics.CheckBox(Field.CenterOf(x, y), halfExtents, Quaternion.identity, walls))
                Field.SetCost(x, y, 255);         // blocked by a wall collider
    }

    void Update()
    {
        var cell = Field.CellOf(goal.position);
        if (cell == goalCell || Time.time < nextRebuild) return;
        goalCell = cell;
        nextRebuild = Time.time + minRebuildInterval;
        Field.Build(goal.position);
    }
}

public class FlowFieldUnit : MonoBehaviour
{
    [SerializeField] FlowFieldGoal flow;
    [SerializeField] float maxSpeed = 4f, acceleration = 10f;
    Vector3 velocity;

    void Update()
    {
        // Add separation from Steering Behaviors / Flocking so units don't stack in one cell.
        Vector3 desired = flow.Field.DirectionAt(transform.position) * maxSpeed;
        velocity = Vector3.MoveTowards(velocity, desired, acceleration * Time.deltaTime);
        transform.position += velocity * Time.deltaTime;
    }
}
```

```gdscript [Godot (GDScript)]
# flow_field_goal.gd
class_name FlowFieldGoal
extends Node3D

@export var goal: Node3D
@export var width := 128
@export var height := 128
@export var cell_size := 1.0
@export_flags_3d_physics var walls := 1
@export var min_rebuild_interval := 0.25

var field: FlowField
var _goal_cell := Vector2i(-999999, -999999)
var _cooldown := 0.0
var _walls_marked := false


func _ready() -> void:
	field = FlowField.new(width, height, cell_size, global_position)


func _physics_process(delta: float) -> void:
	if not _walls_marked:  # physics queries belong in _physics_process, so mark walls on the first one
		_mark_walls()
		_walls_marked = true

	_cooldown -= delta
	var cell := field.cell_of(goal.global_position)
	if cell == _goal_cell or _cooldown > 0.0:
		return
	_goal_cell = cell
	_cooldown = min_rebuild_interval
	field.build(goal.global_position)


func _mark_walls() -> void:
	var box := BoxShape3D.new()
	box.size = Vector3(cell_size * 0.9, 2.0, cell_size * 0.9)
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = box
	query.collision_mask = walls
	var space := get_world_3d().direct_space_state
	for y in height:
		for x in width:
			query.transform = Transform3D(Basis.IDENTITY, field.center_of(x, y))
			if not space.intersect_shape(query, 1).is_empty():
				field.set_cost(x, y, FlowField.WALL)


# flow_field_unit.gd
extends CharacterBody3D

@export var flow: FlowFieldGoal
@export var max_speed := 4.0
@export var acceleration := 10.0


func _physics_process(delta: float) -> void:
	# Add separation from Steering Behaviors / Flocking so units don't stack in one cell.
	var desired := flow.field.direction_at(global_position) * max_speed
	velocity = velocity.move_toward(desired, acceleration * delta)
	move_and_slide()
```

```cpp [Unreal (C++)]
// FlowFieldGoal.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "FlowField.h"
#include "FlowFieldGoal.generated.h"

UCLASS()
class AFlowFieldGoal : public AActor
{
	GENERATED_BODY()

public:
	AFlowFieldGoal() { PrimaryActorTick.bCanEverTick = true; }
	const FFlowField* GetField() const { return Field.Get(); }

protected:
	UPROPERTY(EditAnywhere, Category = "Flow Field") TObjectPtr<AActor> Goal;
	UPROPERTY(EditAnywhere, Category = "Flow Field") int32 Width = 128;
	UPROPERTY(EditAnywhere, Category = "Flow Field") int32 Height = 128;
	UPROPERTY(EditAnywhere, Category = "Flow Field") float CellSize = 100.f;
	UPROPERTY(EditAnywhere, Category = "Flow Field") TEnumAsByte<ECollisionChannel> WallChannel = ECC_WorldStatic;
	UPROPERTY(EditAnywhere, Category = "Flow Field") float MinRebuildInterval = 0.25f;

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

private:
	TUniquePtr<FFlowField> Field;               // plain C++, so no UPROPERTY
	FIntPoint GoalCell = FIntPoint(MIN_int32, MIN_int32);
	float NextRebuild = 0.f;
};

// FlowFieldGoal.cpp
#include "FlowFieldGoal.h"
#include "Engine/World.h"

void AFlowFieldGoal::BeginPlay()
{
	Super::BeginPlay();
	Field = MakeUnique<FFlowField>(Width, Height, CellSize, GetActorLocation());

	const FCollisionShape Box = FCollisionShape::MakeBox(FVector(CellSize * 0.45f, CellSize * 0.45f, 100.f));
	for (int32 Y = 0; Y < Height; ++Y)
	for (int32 X = 0; X < Width; ++X)
		if (GetWorld()->OverlapAnyTestByChannel(Field->CenterOf(X, Y), FQuat::Identity, WallChannel, Box))
			Field->SetCost(X, Y, FFlowField::Wall);  // blocked by wall collision
}

void AFlowFieldGoal::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!Goal) return;
	const FIntPoint Cell = Field->CellOf(Goal->GetActorLocation());
	const float Now = GetWorld()->GetTimeSeconds();
	if (Cell == GoalCell || Now < NextRebuild) return;
	GoalCell = Cell;
	NextRebuild = Now + MinRebuildInterval;
	Field->Build(Goal->GetActorLocation());
}

// FlowFieldFollowerComponent.h: on each unit pawn; its movement component handles speed and collision.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "FlowFieldFollowerComponent.generated.h"

class AFlowFieldGoal;

UCLASS(ClassGroup = (AI), meta = (BlueprintSpawnableComponent))
class UFlowFieldFollowerComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UFlowFieldFollowerComponent() { PrimaryComponentTick.bCanEverTick = true; }

	UPROPERTY(EditAnywhere, Category = "Flow Field")
	TObjectPtr<AFlowFieldGoal> Flow;

protected:
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;
};

// FlowFieldFollowerComponent.cpp
#include "FlowFieldFollowerComponent.h"
#include "FlowFieldGoal.h"
#include "GameFramework/Pawn.h"

void UFlowFieldFollowerComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	APawn* Pawn = Cast<APawn>(GetOwner());
	if (!Pawn || !Flow || !Flow->GetField()) return;
	Pawn->AddMovementInput(Flow->GetField()->DirectionAt(Pawn->GetActorLocation()));
}
```

:::

For moving targets in big maps, compute the field only within a radius of the goal, and have far units use a coarse field.

**Engine notes**

- **Unity:** for thousands of units, store the directions in a `NativeArray` and move units in a Burst-compiled job; the build itself can be a job too.
- **Godot:** no built-in flow field; `NavigationServer` answers one path per query, which is what flow fields avoid for large crowds. Typed packed arrays (`PackedByteArray`, `PackedVector2Array`) keep the grids compact.
- **Unreal:** no built-in flow field either. `FVector2f` is the single-precision 2D vector from UE 5.0 on (with Large World Coordinates, `FVector` is double precision). **MassCrowd** moves large crowds along ZoneGraph lanes rather than a flow field.

## When to use

- RTS games: large groups ordered to one destination.
- Horde and swarm games: thousands of enemies converging on the player.
- Crowd simulation: evacuations, stadiums, cities, where many agents share a few destinations.

## When not to use

- Few agents, or agents with different destinations. Separate [A*](./a-star) paths are cheaper.
- Very large maps at high resolution. A field per destination costs memory and time; use coarse fields or hierarchical paths.
- When agents need exact paths, such as along roads. A flow field gives directions, not routes.

## Pitfalls

- **One field per goal.** Fifty different destinations need fifty fields. Group units by destination, cache fields per goal, and fall back to individual A* for lone units.
- **Unit clumping at choke points.** Every unit follows the same gradient into the same doorway. Add separation, and let costs include crowd density (cells with many units cost more).
- **Grid resolution.** Coarse cells produce blocky movement and ignore thin gaps. Fine cells cost memory and time. Choose a cell size near the unit size, and smooth the sampled direction (bilinear interpolation between cells).
- **Moving goals.** Rebuilding the full field every frame for a moving player is wasteful. Rebuild when the goal changes cells, at a capped rate, possibly on a [Job](./job-system).
- **Unreachable areas.** Cells cut off from the goal have no direction. Units there need a fallback (wander, or move toward the nearest reachable cell).

## Related

- [A* Pathfinding](./a-star) — one path for one unit. Flow fields are one field for many units.
- [Steering Behaviors](./steering-behaviors) and [Flocking](./flocking) — combine the flow direction with separation.
- [Navigation Mesh](./navigation-mesh) — for individual agents in irregular 3D spaces.
- [Influence Map](./influence-map) — another grid of values that agents read.
- [Job System](./job-system) — building fields and moving thousands of units in parallel.
