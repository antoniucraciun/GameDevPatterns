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

## Example (Unity C#)

```csharp
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

    Vector3 AvoidObstacles()
    {
        if (Velocity.sqrMagnitude < 0.01f) return Vector3.zero;
        Vector3 dir = Velocity.normalized;
        float length = avoidDistance * Velocity.magnitude / maxSpeed;

        // Three feelers: straight ahead and angled to each side.
        foreach (float angle in new[] { 0f, -30f, 30f })
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

`Seek`, `Flee` and `Pursue` are included for completeness. Swap them into `Update` to build chasers, prey or interceptors. Allocating the feeler array each frame is fine for an example. Cache it in real code.

## When to use

- Movement that should look organic: animals, crowds, flocks, swarms, vehicles, flying enemies.
- The "last metre" of movement on top of pathfinding: follow path waypoints with *Arrive*, while *Separation* keeps agents from overlapping.
- Many simple agents where full pathfinding per agent is too expensive.

## Pitfalls

- **Weighted sums cancel out.** Separation pushing left and seek pulling right can sum to nearly zero, and the agent stalls or jitters. Use priorities (avoidance first), or limit how much force each behaviour may use.
- **Oscillation.** Agents that overshoot and correct back and forth need *Arrive* instead of *Seek* near targets, and a lower maximum force.
- **Not a pathfinder.** Steering is local: an agent will happily steer into a U-shaped dead end. Combine it with A* or a NavMesh for global routes.
- **O(n²) neighbours.** Checking every agent against every other is fine for 50 agents and too slow for 2,000. Use a [Spatial Partition](./spatial-partition) for neighbour queries.
- **Mixing with physics.** Setting `transform.position` on a Rigidbody fights the physics engine. Apply the force to the Rigidbody instead, or use kinematic movement consistently.
- **Frame-rate dependence.** Large forces with variable `deltaTime` behave differently at 30 and 144 FPS. Run steering in a [Fixed Timestep](./fixed-timestep) for consistency.

## Related

- Flocking — Separation + Alignment + Cohesion: steering applied to groups.
- A* Pathfinding, Navigation Mesh and Flow Field — global routes that steering follows locally.
- [Spatial Partition](./spatial-partition) — fast neighbour queries for separation.
- [Behavior Tree](./behavior-tree) — decides *which* steering behaviours are active and toward what.
