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

In Unity, the **AI Navigation** package provides `NavMeshSurface` (baking, including at runtime), `NavMeshAgent`, `NavMeshObstacle` (carving), `NavMeshLink` and area costs.

## Example (Unity C#)

Runtime baking for a procedurally generated level, and an agent that prefers roads:

```csharp
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

Using the navmesh for path *planning* only, while your own controller does the moving (for root motion, or [Steering](./steering-behaviors)):

```csharp
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

A door that blocks paths while closed carves the navmesh with a `NavMeshObstacle` (*Carve* enabled), so agents replan around it. A jump between ledges is a `NavMeshLink` with a custom area, which the agent's controller detects and animates as a jump.

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
