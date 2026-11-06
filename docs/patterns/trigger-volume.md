# Trigger Volume

> Regions in the level that fire events when entered, exited or occupied.

**Category:** Gameplay Systems

## Problem

The music should change when the player enters the cave. A trap should spring when anyone steps on the plate. A door should open while at least one player stands on the pressure pad, and close when the last one leaves. A cutscene should play the first time, and only the first time. Each of these is written as a one-off script with its own collider callbacks, its own tag checks and its own bugs. A character with several colliders triggers "enter" three times. Destroying an object inside the volume never triggers "exit", so the pad stays pressed forever.

## Solution

One reusable **trigger volume** component handles the mechanics, and designers wire up what happens:

- A trigger **collider** defines the region.
- A **filter** decides what counts: layers, tags, required components (`Player`, `IDamageable`), and optionally requirements such as a [Gameplay Tag](./tags).
- **Occupancy tracking** counts *objects*, not colliders. A character with three colliders counts once, and objects destroyed or disabled inside the volume are removed properly.
- **Events**: `OnFirstEnter` (empty → occupied), `OnLastExit` (occupied → empty), and per-object `OnEnter` / `OnExit`. Exposed as `UnityEvent`s so designers connect doors, lights, music and cutscenes in the inspector.
- **Modes**: fire once (cutscene), fire every time (music zone), or with a cooldown (trap).

## Example (Unity C#)

```csharp
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

[RequireComponent(typeof(Collider))]
public class TriggerVolume : MonoBehaviour
{
    [Header("Filter")]
    [SerializeField] LayerMask layers = ~0;
    [SerializeField] string requiredTag = "";                // e.g. "Player"; empty = any

    [Header("Behaviour")]
    [SerializeField] bool fireOnce;
    [SerializeField] float cooldown;

    [Header("Events")]
    public UnityEvent<GameObject> OnEnter, OnExit;
    public UnityEvent OnFirstEnter, OnLastExit;                // occupied / empty transitions

    // Count colliders per root object, so multi-collider characters count once.
    readonly Dictionary<GameObject, int> occupants = new();
    readonly List<GameObject> scratch = new();
    bool fired;
    float readyAt;

    public int Count => occupants.Count;
    public bool IsOccupied => occupants.Count > 0;

    void Reset() => GetComponent<Collider>().isTrigger = true;

    void OnTriggerEnter(Collider other)
    {
        var root = RootOf(other);
        if (!Accepts(root)) return;

        occupants.TryGetValue(root, out int colliders);
        occupants[root] = colliders + 1;
        if (colliders > 0) return;                          // another collider of an object already inside

        if (fireOnce && fired) return;
        if (Time.time < readyAt) return;

        bool wasEmpty = occupants.Count == 1;
        OnEnter.Invoke(root);
        if (wasEmpty) OnFirstEnter.Invoke();

        fired = true;
        readyAt = Time.time + cooldown;
    }

    void OnTriggerExit(Collider other)
    {
        var root = RootOf(other);
        if (!occupants.TryGetValue(root, out int colliders)) return;
        if (colliders > 1) { occupants[root] = colliders - 1; return; }
        RemoveOccupant(root);
    }

    // Objects destroyed or disabled inside the volume never send OnTriggerExit: clean up.
    void FixedUpdate()
    {
        if (occupants.Count == 0) return;
        scratch.Clear();
        foreach (var o in occupants.Keys)
            if (o == null || !o.activeInHierarchy) scratch.Add(o);
        foreach (var o in scratch) RemoveOccupant(o);
    }

    void RemoveOccupant(GameObject root)
    {
        occupants.Remove(root);
        if (root != null) OnExit.Invoke(root);
        if (occupants.Count == 0) OnLastExit.Invoke();
    }

    bool Accepts(GameObject root) =>
        (layers.value & (1 << root.layer)) != 0 &&
        (string.IsNullOrEmpty(requiredTag) || root.CompareTag(requiredTag));

    // The object that "is" the occupant: the rigidbody's object, or the collider's own.
    static GameObject RootOf(Collider c) => c.attachedRigidbody ? c.attachedRigidbody.gameObject : c.gameObject;

#if UNITY_EDITOR
    void OnDrawGizmos()
    {
        Gizmos.color = IsOccupied ? new Color(0f, 1f, 0f, 0.25f) : new Color(1f, 0.6f, 0f, 0.15f);
        Gizmos.matrix = transform.localToWorldMatrix;
        if (TryGetComponent(out BoxCollider box)) Gizmos.DrawCube(box.center, box.size);
    }
#endif
}
```

Designer wiring, no code:

| Volume | Settings | Events |
| --- | --- | --- |
| **Cave music** | tag Player | OnFirstEnter → MusicPlayer.Play(cave) · OnLastExit → MusicPlayer.Play(forest) |
| **Pressure pad** | any rigidbody | OnFirstEnter → Door.Open · OnLastExit → Door.Close |
| **Intro cutscene** | tag Player, fire once | OnEnter → Cutscene.Play |
| **Spike trap** | layer Characters, cooldown 2 s | OnEnter → Trap.Fire |

## When to use

- Level scripting: music and ambience zones, cutscene triggers, checkpoints, traps, kill planes, tutorial hints, area-entered quest objectives.
- Pressure pads, doors and lifts that react to presence.

## When not to use

- Checks that need precise geometry or line of sight. Use raycasts or a [Perception System](./perception-system).
- Many moving objects all checking each other through triggers. A [Spatial Partition](./spatial-partition) query is cheaper.
- Logic that should run on a condition, not a location, such as "after the third key". Use events or a [Quest System](./quest-system).

## Pitfalls

- **No Rigidbody, no events.** Unity sends trigger messages only if at least one of the two objects has a Rigidbody (kinematic is fine). Static trigger + CharacterController works, static trigger + static collider does not.
- **Multiple colliders.** Counting colliders instead of objects makes a character "enter" several times. Count by owner, as above.
- **Destroyed or disabled occupants.** They never send `OnTriggerExit`. Clean up explicitly, or a pad stays pressed forever.
- **Fast objects tunnelling through.** A thin trigger can be skipped entirely by a fast object between physics steps. Make triggers thick, or use continuous collision detection on the fast object.
- **Teleporting in or out.** Moving a transform directly may not generate enter/exit until the next physics step, or at all. Call `Physics.SyncTransforms`, or handle teleports explicitly.
- **Logic in UnityEvents that should be code.** Long chains of inspector-wired events are hard to debug. Keep volumes for simple wiring, and move complex logic into scripts that the volume calls.

## Related

- [Observer](./observer) — enter and exit are events, and UnityEvents let designers subscribe.
- [Interaction System](./interaction-system) — the explicit, button-press counterpart.
- [Checkpoint / Respawn](./checkpoint) — checkpoints are usually trigger volumes.
- [Quest System](./quest-system) — "reach the location" objectives listen to area-entered events.
- [Data-Driven Design](./data-driven-design) — designers configure behaviour without code.
