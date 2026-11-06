# Level of Detail

> Use cheaper meshes, logic or update rates for things far from the player.

**Also known as:** LOD, Simulation LOD · **Category:** Performance & Memory

## Problem

A character model has 40,000 triangles, a full skeleton with facial bones, cloth simulation, an AI that replans every frame, and footstep sounds. Up close, all of that detail matters. At 100 metres the character covers twenty pixels, its face is invisible, nobody hears its footsteps, and its AI could think once a second without anyone noticing. Rendering and simulating every character at full detail, regardless of distance, wastes most of the frame budget.

## Solution

Prepare **several levels of detail** for an object, and choose one based on how much it matters to the player, usually measured by distance or screen size:

| Aspect | LOD 0 (near) | LOD 1 | LOD 2 (far) | Culled |
| --- | --- | --- | --- | --- |
| **Mesh** | Full detail | Half the triangles | Simple shape, or a billboard (impostor) | Not drawn |
| **Animation** | Every frame, full skeleton | Fewer bones, lower rate | Simple loop, or none | None |
| **AI / logic** | Every frame | Every 4th frame | Every 30th frame, simplified | Statistical: just advance along the route |
| **Physics** | Full ragdoll, cloth | Simple capsule | Kinematic | None |
| **Audio** | All sounds | Main sounds only | None | None |

Rendering LOD is built into Unity (**LOD Group**). **Simulation LOD**, applying the same idea to scripts, AI and animation, is up to you, and is often the bigger win in games with many agents.

Use **hysteresis** between levels, so objects near a boundary do not switch back and forth every frame.

## Example (Unity C#)

Simulation LOD: one component chooses a level from the distance to the camera, and the systems on the object adapt.

```csharp
using System;
using UnityEngine;

public enum DetailLevel { High, Medium, Low, Dormant }

public class SimulationLod : MonoBehaviour
{
    // Distances at which detail drops; a level is left 10% further out than it is entered (hysteresis).
    [SerializeField] float mediumAt = 25f, lowAt = 60f, dormantAt = 150f;
    [SerializeField] float hysteresis = 1.1f;
    [SerializeField] float checkInterval = 0.5f;

    public DetailLevel Level { get; private set; } = DetailLevel.High;
    public event Action<DetailLevel> Changed;

    static Transform viewer;
    float nextCheck;

    void Start()
    {
        viewer ??= Camera.main.transform;
        nextCheck = Time.time + UnityEngine.Random.value * checkInterval;   // stagger checks
    }

    void Update()
    {
        if (Time.time < nextCheck) return;
        nextCheck = Time.time + checkInterval;

        float d = Vector3.Distance(transform.position, viewer.position);
        var next = LevelFor(d);
        if (next != Level) { Level = next; Changed?.Invoke(next); }
    }

    DetailLevel LevelFor(float d)
    {
        // Moving to a lower detail level needs the full distance; coming back needs to be 10% closer.
        float Threshold(float t, DetailLevel boundary) => Level >= boundary ? t / hysteresis : t;

        if (d >= Threshold(dormantAt, DetailLevel.Dormant)) return DetailLevel.Dormant;
        if (d >= Threshold(lowAt, DetailLevel.Low)) return DetailLevel.Low;
        if (d >= Threshold(mediumAt, DetailLevel.Medium)) return DetailLevel.Medium;
        return DetailLevel.High;
    }
}

// Systems react to the level instead of each measuring distance themselves.
[RequireComponent(typeof(SimulationLod))]
public class NpcLodController : MonoBehaviour
{
    [SerializeField] Animator animator;
    [SerializeField] AudioSource footsteps;
    [SerializeField] NpcBrain brain;                       // the AI, with a configurable think interval

    void Awake()
    {
        var lod = GetComponent<SimulationLod>();
        lod.Changed += Apply;
        Apply(lod.Level);
    }

    void Apply(DetailLevel level)
    {
        animator.enabled = level <= DetailLevel.Low;
        animator.cullingMode = level == DetailLevel.High
            ? AnimatorCullingMode.AlwaysAnimate : AnimatorCullingMode.CullUpdateTransforms;
        footsteps.enabled = level == DetailLevel.High;

        brain.ThinkInterval = level switch
        {
            DetailLevel.High => 0f,                       // every frame
            DetailLevel.Medium => 0.1f,
            DetailLevel.Low => 0.5f,
            _ => 2f,                                      // dormant: barely thinks, just follows its schedule
        };
    }
}
```

For mesh LODs, add a **LOD Group** to the prefab and assign meshes per level. Enable **cross-fade** to hide the switch. Unity 6 also offers automatic mesh LOD generation for imported models.

## When to use

- Many characters or objects at varied distances: open worlds, crowds, strategy games, racing games with many cars.
- When the profiler shows rendering, animation or AI cost growing with object count, while most objects are far away.

## Pitfalls

- **Visible popping.** A sudden switch between meshes or behaviours is noticeable. Use cross-fade for meshes, choose transition distances where the change is too small to see, and use hysteresis.
- **Gameplay depending on detail.** If a low-LOD NPC skips the logic that triggers a quest event, the game behaves differently depending on where the player stands. Keep gameplay-relevant state updates at every level, and only reduce *how often* and *how precisely*.
- **Big `dt` at low update rates.** A brain that thinks every 2 seconds must handle 2 seconds of change at once: timers, positions, needs. Pass the real elapsed time (see [Time Slicing](./time-slicing)).
- **Distance from the wrong point.** In split-screen, or with a detached camera (photo mode), "distance to the camera" may be wrong. Use the minimum distance to all relevant viewers.
- **Authoring cost.** Hand-made LOD meshes take artist time. Use automatic generation where quality allows, and prioritise the models that appear most often.

## Related

- [Culling](./culling) — the final level: do nothing at all.
- [Time Slicing](./time-slicing) — the mechanism behind reduced update rates.
- [Flyweight](./flyweight) and [Batching](./batching) — the far, simple levels are ideal for instancing.
- [Interest Management](./interest-management) — the same idea for network updates: far entities update less often.
- [Utility AI](./utility-ai) and [Behavior Tree](./behavior-tree) — AI that can think at different rates.
