# Navigation Mesh

> Represent walkable space as convex polygons for efficient pathfinding.

**Also known as:** NavMesh · **Category:** AI & Decision Making

## Problem

A grid works for tile-based games, but a 3D level with slopes, stairs, bridges and irregular buildings fits a grid badly. Fine cells are needed to follow walls, which means millions of nodes and slow searches. Coarse cells cut through geometry. Waypoint graphs are hand-placed, break whenever the level changes, and give agents only the lines between waypoints to walk on, so they look robotic and cannot sidestep each other.

## Solution

Represent **walkable surface** as a mesh of **convex polygons**, generated automatically from level geometry:

1. **Bake.** Voxelise the level, find surfaces an agent of a given radius, height, step height and maximum slope can stand on, and simplify them into polygons. Inside a convex polygon, any two points can be connected with a straight line.
2. **Search.** Run [A*](./a-star) over polygons rather than cells. A room is a handful of polygons, not thousands of cells, so searches are fast.
3. **Smooth.** Turn the polygon corridor into the shortest path through it (string pulling, or the "funnel algorithm"), giving natural, corner-hugging paths.
4. **Follow.** Agents steer along the path, and avoid each other locally (see [Steering Behaviors](./steering-behaviors)).

Extras that real games need:
- **Areas with costs** (road 1, mud 3, water 10, or forbidden per agent type).
- **Off-mesh links** for jumps, ladders, doors and teleporters between disconnected areas.
- **Dynamic obstacles** that carve holes into the mesh at runtime (a parked car, a closed door).
- **Agent types:** different bakes for small, large and flying units.

All three engines have one built in:

- **Unity:** the **AI Navigation** package provides `NavMeshSurface` (baking, including at runtime), `NavMeshAgent`, `NavMeshObstacle` (carving), `NavMeshLink` and area costs.
- **Godot:** `NavigationRegion3D` (baking), `NavigationAgent3D`, `NavigationObstacle3D`, `NavigationLink3D`, and region `enter_cost` and `travel_cost`, all backed by `NavigationServer3D`.
- **Unreal:** a **Nav Mesh Bounds Volume** builds a Recast navmesh; nav areas and `UNavModifierComponent` set costs, **Nav Link Proxy** actors add jumps, and `AAIController::MoveTo` follows paths.

## Pseudocode

What the engine's navmesh does underneath once it is baked (search, smooth, follow), and how the Example's agent uses it.

```text
Polygon:
    corners                      // convex, so any two points inside see each other
    neighbours                   // polygons sharing an edge, with that shared edge
    area_cost                    // road 1, mud 5, ...

find_path(start, goal):
    start_poly ← polygon containing start;  goal_poly ← polygon containing goal
    // 1. Search: A* with polygons as nodes. Moving into neighbour n costs the
    //    distance between their edge midpoints × n.area_cost.
    corridor ← a_star(start_poly, goal_poly)          // a list of polygons
    if corridor does not reach goal_poly: return partial
    // 2. Smooth: pull a string through the shared edges ("portals").
    portals ← the shared edge (left end, right end) between each pair of
              consecutive polygons, then (goal, goal)
    return string_pull(start, portals)

string_pull(start, portals):                          // the funnel algorithm
    path ← [start]
    apex, left, right ← start                         // the funnel: apex plus two sides
    i ← 0
    while i < number of portals:
        (new_left, new_right) ← portals[i]
        if new_right does not widen the funnel on the right side:
            if the funnel is a point, or new_right stays right of the left side:
                right ← new_right                     // narrow the funnel
            else:                                     // the sides crossed:
                add left to path                      // the left side is a corner
                apex, right ← left
                i ← the portal after the one that set left
                continue
        do the same for new_left, mirrored
        i ← i + 1
    add the last portal's point (the goal) to path
    return path                                       // the corners to walk through

// The Example's agent.
try_move_to(destination):
    point ← nearest point on the navmesh within 2 m of destination
    if there is none: return false                    // clicked on a wall or prop
    path ← find_path(agent position, point)           // using this agent's area costs
    if path is partial: return false                  // tell the player "can't get there"
    follow(path)
    return true

follow(path):
    every frame:
        corner ← the next corner of path; once close to it, move on to the one after
        steer toward corner                           // arrive at the last one
```

## Example

Every engine here ships a navmesh, so the example is wiring rather than an implementation: runtime baking for a procedurally generated level, and an agent that checks reachability and prefers roads.

### Baking and moving

::: code-group

```csharp [Unity (C#)]
using Unity.AI.Navigation;
using UnityEngine;
using UnityEngine.AI;

public class LevelNavigation : MonoBehaviour
{
    [SerializeField] NavMeshSurface surface;     // collects child geometry and bakes it

    // Call after the procedural level is built (e.g. by a BSP or WFC generator).
    public void Rebuild()
    {
        surface.BuildNavMesh();                   // synchronous: do it behind the loading screen
    }

    // For small changes during play (a destroyed wall), rebake asynchronously.
    public AsyncOperation RebuildAsync() => surface.UpdateNavMesh(surface.navMeshData);
}

public class RoadPreferringAgent : MonoBehaviour
{
    [SerializeField] NavMeshAgent agent;

    void Start()
    {
        // Areas are defined in the Navigation window; here we make "Mud" expensive for this agent only.
        int mud = NavMesh.GetAreaFromName("Mud");
        if (mud >= 0) agent.SetAreaCost(mud, 5f);
    }

    public bool TryMoveTo(Vector3 destination)
    {
        // Snap the requested point onto the navmesh (clicks often land on walls or props).
        if (!NavMesh.SamplePosition(destination, out var hit, 2f, agent.areaMask)) return false;

        // Check reachability first, so we can tell the player "can't get there".
        var path = new NavMeshPath();
        if (!agent.CalculatePath(hit.position, path) || path.status != NavMeshPathStatus.PathComplete)
            return false;

        agent.SetPath(path);
        return true;
    }
}
```

```gdscript [Godot (GDScript)]
# level_navigation.gd
extends NavigationRegion3D

signal rebuilt


## Call after the procedural level is built (e.g. by a BSP or WFC generator).
func rebuild() -> void:
	bake_navigation_mesh()  # bakes on a background thread by default
	await bake_finished
	rebuilt.emit()


# road_preferring_agent.gd
# Costs belong to regions, not agents: mud is its own NavigationRegion3D with travel_cost = 5,
# which every agent pays. To keep one agent off it entirely, use navigation layers instead.
extends CharacterBody3D

@export var speed := 4.0
@onready var agent: NavigationAgent3D = $NavigationAgent3D


func try_move_to(destination: Vector3) -> bool:
	var map := agent.get_navigation_map()

	# Snap the requested point onto the navmesh (clicks often land on walls or props).
	var on_mesh := NavigationServer3D.map_get_closest_point(map, destination)
	if on_mesh.distance_to(destination) > 2.0:
		return false

	# Check reachability first, so we can tell the player "can't get there".
	var path := NavigationServer3D.map_get_path(map, global_position, on_mesh, true, agent.navigation_layers)
	if path.is_empty() or path[path.size() - 1].distance_to(on_mesh) > 0.5:
		return false  # the path stops short: unreachable

	agent.target_position = on_mesh
	return true


func _physics_process(_delta: float) -> void:
	# The agent only plans; the body moves itself toward the next corner.
	if agent.is_navigation_finished():
		return
	var next := agent.get_next_path_position()
	velocity = global_position.direction_to(next) * speed
	move_and_slide()
```

```cpp [Unreal (C++)]
// The navmesh is a Nav Mesh Bounds Volume plus the RecastNavMesh actor it creates. For procedural
// levels, set Project Settings → Navigation Mesh → Runtime Generation to Dynamic: tiles under
// spawned or moved geometry then rebuild on their own, on worker threads.
// Add "NavigationSystem" and "AIModule" to the module's dependencies.

// RoadPreferringController.h
#pragma once

#include "CoreMinimal.h"
#include "AIController.h"
#include "RoadPreferringController.generated.h"

class UNavigationQueryFilter;

UCLASS()
class ARoadPreferringController : public AAIController
{
	GENERATED_BODY()

public:
	bool TryMoveTo(const FVector& Destination);

protected:
	// A Navigation Query Filter class whose Areas list overrides the Mud area's travel cost (e.g. 5).
	// Only agents that pass this filter pay it; area classes themselves are UNavArea subclasses.
	UPROPERTY(EditDefaultsOnly, Category = "Navigation")
	TSubclassOf<UNavigationQueryFilter> PreferRoadsFilter;
};

// RoadPreferringController.cpp
#include "RoadPreferringController.h"
#include "NavigationPath.h"
#include "NavigationSystem.h"
#include "NavFilters/NavigationQueryFilter.h"

bool ARoadPreferringController::TryMoveTo(const FVector& Destination)
{
	UNavigationSystemV1* Nav = FNavigationSystem::GetCurrent<UNavigationSystemV1>(GetWorld());
	APawn* MyPawn = GetPawn();
	if (!Nav || !MyPawn) return false;

	// Snap the requested point onto the navmesh (clicks often land on walls or props).
	FNavLocation OnMesh;
	if (!Nav->ProjectPointToNavigation(Destination, OnMesh, FVector(200.f))) return false;

	// Check reachability first, so we can tell the player "can't get there".
	const UNavigationPath* Path = UNavigationSystemV1::FindPathToLocationSynchronously(
		this, MyPawn->GetActorLocation(), OnMesh.Location, MyPawn, PreferRoadsFilter);
	if (!Path || !Path->IsValid() || Path->IsPartial()) return false;

	MoveToLocation(OnMesh.Location, /*AcceptanceRadius=*/50.f, /*bStopOnOverlap=*/true,
		/*bUsePathfinding=*/true, /*bProjectDestinationToNavigation=*/false, /*bCanStrafe=*/false,
		PreferRoadsFilter);
	return true;
}
```

:::

### Planning only

Using the navmesh for path *planning* only, while your own controller does the moving (for root motion, or [Steering](./steering-behaviors)):

::: code-group

```csharp [Unity (C#)]
using UnityEngine;
using UnityEngine.AI;

public class SteeredNavigator : MonoBehaviour
{
    [SerializeField] NavMeshAgent agent;          // plans and avoids, but doesn't move the transform
    [SerializeField] SteeringAgent steering;      // from the Steering Behaviors page

    void Start()
    {
        agent.updatePosition = false;
        agent.updateRotation = false;
    }

    public void MoveTo(Vector3 target) => agent.SetDestination(target);

    void Update()
    {
        // Steer toward the agent's next corner; keep the agent's internal position in sync with ours.
        steering.Target = agent.hasPath ? agent.steeringTarget : (Vector3?)null;
        agent.nextPosition = transform.position;
    }
}
```

```gdscript [Godot (GDScript)]
# steered_navigator.gd: a child of the SteeringAgent (from the Steering Behaviors page).
# NavigationAgent3D never moves anything itself, so planning-only is its normal mode.
extends Node

@export var agent: NavigationAgent3D  # also a child of the steering agent, so it tracks its position
@export var steering: SteeringAgent


func move_to(point: Vector3) -> void:
	agent.target_position = point


func _physics_process(_delta: float) -> void:
	# Steer toward the next corner; get_next_path_position() also advances along the path.
	if agent.is_navigation_finished():
		steering.target = null
	else:
		steering.target = agent.get_next_path_position()
```

```cpp [Unreal (C++)]
// SteeredNavigatorComponent.h: plans with the navmesh, moves with USteeringComponent
// (from the Steering Behaviors page).
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "SteeredNavigatorComponent.generated.h"

class UNavigationPath;
class USteeringComponent;

UCLASS(ClassGroup = (AI), meta = (BlueprintSpawnableComponent))
class USteeredNavigatorComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	USteeredNavigatorComponent();
	void MoveTo(const FVector& Target);

protected:
	UPROPERTY(EditAnywhere, Category = "Navigation")
	float CornerRadius = 75.f;                  // how close counts as "reached this corner"

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

private:
	UPROPERTY()
	TObjectPtr<UNavigationPath> Path;

	UPROPERTY()
	TObjectPtr<USteeringComponent> Steering;

	int32 Corner = 0;
};

// SteeredNavigatorComponent.cpp
#include "SteeredNavigatorComponent.h"
#include "NavigationPath.h"
#include "NavigationSystem.h"
#include "SteeringComponent.h"

USteeredNavigatorComponent::USteeredNavigatorComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
}

void USteeredNavigatorComponent::BeginPlay()
{
	Super::BeginPlay();
	Steering = GetOwner()->FindComponentByClass<USteeringComponent>();
}

void USteeredNavigatorComponent::MoveTo(const FVector& Target)
{
	Path = UNavigationSystemV1::FindPathToLocationSynchronously(this, GetOwner()->GetActorLocation(), Target, GetOwner());
	Corner = 1;                                 // PathPoints[0] is the start
}

void USteeredNavigatorComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	if (!Steering) return;

	if (!Path || !Path->IsValid() || !Path->PathPoints.IsValidIndex(Corner))
	{
		Steering->Target.Reset();
		return;
	}

	// Steer toward the next corner, advancing when close (the last corner is left to Arrive).
	const FVector Location = GetOwner()->GetActorLocation();
	if (Corner < Path->PathPoints.Num() - 1 && FVector::Dist2D(Location, Path->PathPoints[Corner]) < CornerRadius)
		++Corner;
	Steering->Target = Path->PathPoints[Corner];
}
```

:::

A door that blocks paths while closed should cut the navmesh, so agents replan around it; a jump between ledges is an off-mesh link with its own area, which the agent's controller detects and animates as a jump.

**Engine notes**

- **Unity:** the components (`NavMeshSurface`, `NavMeshLink`, `NavMeshModifier`) come from the **AI Navigation** package (`com.unity.ai.navigation`). A closed door is a `NavMeshObstacle` with *Carve* enabled; a jump is a `NavMeshLink` with a custom area.
- **Godot:** `NavigationServer3D` queries return nothing on the very first physics frame, before the map has synced; wait one frame (`await get_tree().physics_frame`) before asking for paths at startup. Region costs are `enter_cost` and `travel_cost`; jumps are `NavigationLink3D` nodes. A door is simplest as its own small region whose `enabled` you toggle.
- **Unreal:** a door is a `UNavModifierComponent` (or a collision that affects navigation) switching between a normal area and `NavArea_Null`, which needs Dynamic or Dynamic Modifiers Only runtime generation. Jumps are **Nav Link Proxy** actors, whose smart links fire an event the controller can play a jump on. Detour crowd avoidance comes from `UCrowdFollowingComponent` (or `ADetourCrowdAIController`).

## When to use

- 3D (and many 2D) games with continuous, irregular walkable space: action, RPG, RTS, open world, shooters.
- Many agents needing fast pathfinding on large maps.

## When not to use

- Grid- or tile-based games. A* on the grid is simpler and matches the game rules.
- Flying or swimming agents in open 3D space. NavMeshes are surfaces; use steering or a 3D grid.
- Levels that change shape constantly. Frequent rebakes are expensive; use dynamic obstacles or local avoidance.

## Pitfalls

- **Destinations off the mesh.** `SetDestination` on a point inside a wall silently picks the nearest reachable point, or fails. Snap with `SamplePosition`, and check `path.status`.
- **Partial paths.** `PathPartial` means "got as close as possible". Treat it as unreachable when that matters (quest NPCs, escort missions), rather than walking to a wall.
- **Agent radius mismatch.** One bake for agents of every size makes large units get stuck in doorways. Bake per agent type.
- **Carving everything.** Carving obstacles rebuild parts of the mesh, which costs time. Use carving for objects that stop and stay (doors, parked vehicles), and local avoidance for moving ones.
- **Crowds.** NavMesh avoidance is local and simple. Hundreds of agents through one doorway jam. Stagger departures, use wider corridors, or use [Flow Fields](./flow-field) for big crowds.
- **Runtime bake hitches.** Baking a large level synchronously freezes the game. Bake behind loading screens, update asynchronously, or bake tiles around the player.

## Related

- [A* Pathfinding](./a-star) — the search that runs over the navmesh polygons.
- [Steering Behaviors](./steering-behaviors) — smooth following and local avoidance.
- [Flow Field](./flow-field) — better for many units heading to one goal.
- [Enemy AI](../recipes/enemy-ai) — navmesh corners as steering targets inside a full AI.
- [BSP Dungeon Generation](./bsp-dungeon) — generated levels that need a runtime bake.
