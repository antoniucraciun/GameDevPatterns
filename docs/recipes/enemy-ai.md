# Enemy AI

> Enemies that notice the player, remember what they saw, and move believably.

## Goal

Guards for a stealth or action game:

- They **patrol** until something catches their attention.
- They **notice gradually**. A glimpse at the edge of vision makes them suspicious, and a clear view alerts them.
- They **chase** while they can see you, **search** where they last saw you, investigate **noises**, and eventually **give up**.
- A guard who spots you **tells its squad**.
- They move with weight and curves, and do not pile into one blob.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Perception System](../patterns/perception-system) | Sight cone, line of sight, hearing and gradual awareness. Turns the world into facts. |
| [Blackboard](../patterns/blackboard) | Holds those facts (target, last known position, noise location) with timestamps, per guard and per squad. |
| [Behavior Tree](../patterns/behavior-tree) | Decides what to do from the facts, by priority: attack, chase, search, investigate, patrol. |
| [Steering Behaviors](../patterns/steering-behaviors) | Turns "go there" into smooth, separated movement. |

## How they fit together

```
 world ──► Perception ──writes──► Blackboard ◄──reads── Behavior Tree ──sets──► SteeringAgent.Target
          (sight, sound,          (Target, LastKnown,   (Selector by priority)  (Arrive + Separation
           awareness)              Noise, timestamps)                             + Avoidance)
                │                        │ parent
                └─ on alert ──copy──► Squad Blackboard ──► other guards' trees
```

Each layer only knows about its neighbours:

- **Perception ↔ Blackboard.** Perception is the *only* writer of what the guard knows about the player. The tree never raycasts and never reads the player's real position, so the guard cannot be omniscient by accident.
- **Blackboard ↔ Behavior Tree.** Timestamps turn one fact into several behaviours. `LastKnownPosition` younger than 1 s means *chase*, younger than 10 s means *search*, older means *give up and patrol*. No extra state is needed.
- **Behavior Tree ↔ Steering.** Tree actions only set a destination. Steering decides how the body gets there, and separation keeps a squad from overlapping, without the tree knowing other guards exist.
- **Blackboard ↔ Blackboard.** A squad blackboard as parent makes sharing free. Guards read through their own board to the squad's.

## Example (Unity C#)

Building on the code from the four pattern pages: `Node`, `Selector`, `Sequence`, `Condition`, `ActionNode`, `Status` ([Behavior Tree](../patterns/behavior-tree)), `Blackboard`, `Keys`, `HasRecent` ([Blackboard](../patterns/blackboard)), `Perception` ([Perception System](../patterns/perception-system)) and `SteeringAgent` ([Steering Behaviors](../patterns/steering-behaviors)).

```csharp
using UnityEngine;
using UnityEngine.AI;

[RequireComponent(typeof(Perception), typeof(SteeringAgent))]
public class Guard : MonoBehaviour
{
    [SerializeField] Transform[] patrolPoints;
    [SerializeField] float attackRange = 2f;
    [SerializeField] SquadBlackboard squad;              // optional: shared with other guards

    Perception perception;
    SteeringAgent steering;
    Blackboard bb;
    Node root;

    void Awake()
    {
        perception = GetComponent<Perception>();
        steering = GetComponent<SteeringAgent>();
        bb = perception.Blackboard;
        if (squad) bb.SetParent(squad.Board);            // read-through to squad knowledge

        perception.Alerted += () =>                      // share sightings with the squad
        {
            if (squad && bb.TryGet(Keys.LastKnownPosition, out var p))
                squad.Board.Set(Keys.LastKnownPosition, p);
        };

        root = new Selector(
            // 1. Attack: target fresh and in range.
            new Sequence(new HasRecent<Vector3>(bb, Keys.LastKnownPosition, 0.5f),
                         new Condition(TargetInRange),
                         new ActionNode(Attack)),
            // 2. Chase: seen within the last second.
            new Sequence(new HasRecent<Vector3>(bb, Keys.LastKnownPosition, 1f),
                         new ActionNode(() => MoveTo(Keys.LastKnownPosition, running: true))),
            // 3. Search: go where it was last seen, for up to 10 seconds.
            new Sequence(new HasRecent<Vector3>(bb, Keys.LastKnownPosition, 10f),
                         new ActionNode(() => MoveTo(Keys.LastKnownPosition, running: false))),
            // 4. Investigate a recent noise.
            new Sequence(new HasRecent<Vector3>(bb, Keys.NoiseLocation, 8f),
                         new ActionNode(() => MoveTo(Keys.NoiseLocation, running: false))),
            // 5. Otherwise patrol.
            new ActionNode(Patrol));
    }

    void Update() => root.Tick();       // reactive: higher priorities interrupt lower ones every frame

    // ── Actions: decide WHERE; steering decides HOW ──

    Status MoveTo(BlackboardKey<Vector3> key, bool running)
    {
        if (!bb.TryGet(key, out var destination)) return Status.Failure;
        steering.MaxSpeedScale = running ? 1f : 0.5f;
        steering.Target = NextCorner(destination);
        return Vector3.Distance(transform.position, destination) < 1f ? Status.Success : Status.Running;
    }

    Status Patrol()
    {
        int index = bb.Get(Keys.PatrolIndex);
        Vector3 point = patrolPoints[index].position;
        steering.MaxSpeedScale = 0.4f;
        steering.Target = NextCorner(point);
        if (Vector3.Distance(transform.position, point) < 1f)
            bb.Set(Keys.PatrolIndex, (index + 1) % patrolPoints.Length);
        return Status.Running;
    }

    Status Attack()
    {
        steering.Target = null;                          // stand and swing
        /* trigger attack animation, apply damage on the animation event */
        return Status.Success;
    }

    bool TargetInRange() =>
        bb.TryGet(Keys.LastKnownPosition, out var p) && Vector3.Distance(transform.position, p) <= attackRange;

    // Steering is local; the NavMesh supplies the global route. Steer toward the next path corner.
    readonly NavMeshPath path = new();
    Vector3 NextCorner(Vector3 destination)
    {
        if (NavMesh.CalculatePath(transform.position, destination, NavMesh.AllAreas, path) && path.corners.Length > 1)
            return path.corners[1];
        return destination;
    }
}

[CreateAssetMenu(menuName = "AI/Squad Blackboard")]
public class SquadBlackboard : ScriptableObject
{
    [System.NonSerialized] Blackboard board;
    public Blackboard Board => board ??= new Blackboard();
    void OnDisable() => board = null;                     // fresh knowledge each play session
}
```

Two small additions to the pattern code make the layers fit. `Blackboard` gets `SetParent(Blackboard parent)` (the constructor parameter turned into a setter), and `SteeringAgent` gets a `MaxSpeedScale` multiplier on `maxSpeed`, so the tree can choose between walking and running without knowing steering internals.

## Where the patterns meet: pitfalls

- **Tree ticks faster than perception.** Perception updates sight every 0.2 s while the tree ticks every frame. That is fine, because the tree reads timestamped facts. But a condition like "can see player *now*" would flicker between checks, so phrase conditions as "seen within the last N seconds".
- **Path recalculated every frame.** `NavMesh.CalculatePath` per guard per frame is expensive. Cache the path, and recalculate only when the destination moves more than a metre, or a few times per second.
- **Interrupted actions leave state behind.** When *Chase* interrupts *Patrol*, the patrol's walking speed stays set until something overwrites it. Every action here sets everything it depends on (speed, target), which is the simplest defence. Larger trees need explicit abort hooks.
- **Squad knowledge echoing.** If every guard copies squad facts back to the squad board, timestamps keep refreshing and the squad never gives up. Only write first-hand observations to the squad board, as `Alerted` does here.
- **Separation versus doorways.** Separation pushes squads apart, and a group trying to chase through a narrow door can jam. Reduce the separation weight while chasing, or let agents queue.
- **Unfair detection.** Awareness tuning matters more than any tree logic. Telegraph it with "?" and "!" icons or voice lines, so players understand why they were spotted.

## Variations

- **[Utility AI](../patterns/utility-ai) instead of fixed priorities:** score chase, search and flee with response curves (health, distance, ammo), reading the same blackboard.
- **Cover:** an action that queries nearby cover points, scores them against the last known position, and writes `ChosenCover` to the blackboard.
- **Director-controlled aggression:** an AI Director limits how many guards may attack at once, by handing out attack tokens through the squad blackboard.
- **[Flocking](../patterns/flocking) enemies:** for swarms, replace path corners with alignment and cohesion, plus a shared flow field toward the player.
