# Perception System

> Centralised sight, hearing and memory so agents react to stimuli consistently.

**Also known as:** Sensors, Stimuli · **Category:** AI & Decision Making

## Problem

Each enemy script decides for itself whether it can see the player: one uses a distance check, another a raycast, a third forgets the field of view. Gunshots alert enemies through the gun calling `FindObjectsOfType<Enemy>()`. Enemies react *instantly* to a pixel of the player at the edge of their vision, then forget them the moment they step behind a pillar. With 50 enemies raycasting every frame, the AI is both unfair and expensive.

## Solution

Give agents **senses** that turn the world into **stimuli**, and a **memory** that turns stimuli into **knowledge**:

- **Stimulus sources** register themselves (the player is *visible*; a gunshot is a *sound* at a position, with a loudness radius). Agents never search the scene.
- **Sight sensor**: range → field-of-view cone → line-of-sight raycast, cheapest test first. It runs a few times per second, not every frame, with agents staggered over time.
- **Hearing**: sounds are events with a position and radius. Each agent in range receives them, optionally reduced by walls.
- **Awareness**: seeing the target *raises* an awareness value over time, faster when close or in the centre of view. The agent reacts only when it crosses a threshold. This gives players the familiar "?" then "!" moment.
- **Memory**: the agent remembers the last known position and time after losing sight, and writes these facts into its [Blackboard](./blackboard) for decision-making to use.

## Example (Unity C#)

### Stimulus sources and sounds

```csharp
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

### An agent's senses, awareness and memory

```csharp
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

`Keys` are the typed keys from [Blackboard](./blackboard). Decision-making reads `LastKnownPosition` and its age to choose between chasing, searching and giving up, and never calls `Physics.Raycast` itself.

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
