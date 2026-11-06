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

## Example (Unity C#)

```csharp
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

One `Flock.Update` drives every boid, rather than one `Update` per boid, and all boids decide before any of them moves (a [Double Buffer](./double-buffer) in spirit). For thousands of boids, move the loop into a Burst-compiled job, or into [ECS](./entity-component-system).

## When to use

- Birds, fish, bats, insects, herds and crowds of simple creatures.
- Swarming enemies, drones and particle-like gameplay objects.
- Ambient life that should look organic at low authoring cost.

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
