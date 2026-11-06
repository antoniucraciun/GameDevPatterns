# Checkpoint / Respawn

> Record restorable state at safe points and rebuild the world on death.

**Category:** Gameplay Systems

## Problem

When the player dies, the simplest response is reloading the scene. But that also resets the doors they opened, the keys they picked up and the enemies they killed in the previous room. Respawning at the level start feels punishing. Moving the player back to a saved position without resetting anything else causes new bugs: enemies stay alerted, the boss keeps half its health, a falling platform has already fallen and the gap can no longer be crossed. What should reset and what should persist is never decided explicitly.

## Solution

**Checkpoints** record a restorable state at safe moments, and **respawn** restores it.

1. **Checkpoint volumes** (usually [Trigger Volumes](./trigger-volume)) activate when the player reaches them. The latest, or the furthest, becomes the active checkpoint.
2. On activation, the checkpoint asks everything that participates to **capture** its state: a [Memento](./memento) per object.
3. On death: fade out, **restore** every participant to the checkpoint's snapshot, place the player at the checkpoint's spawn point, reset transient systems (camera, music, hit stop, input), and fade in.
4. **Decide explicitly what resets.** Each object chooses its policy:

| Policy | Examples |
| --- | --- |
| **Reset to the checkpoint snapshot** | Enemies, bosses, moving platforms, breakable floors, puzzle state |
| **Persist** (never rolled back) | Collected keys and upgrades, opened shortcuts, achievements |
| **Reset to the level's initial state** | One-off scripted events, if replaying them is desired |

Because both checkpoints and saves capture mementos, a checkpoint can also write a save, which makes it a save point.

## Example (Unity C#)

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

public interface ICheckpointRestorable
{
    object Capture();                     // a memento of current state
    void Restore(object memento);         // back to that state
}

public class CheckpointSystem : MonoBehaviour
{
    public static CheckpointSystem Instance { get; private set; }

    [SerializeField] Transform player;
    [SerializeField] CanvasGroup fade;

    readonly Dictionary<ICheckpointRestorable, object> snapshot = new();
    Checkpoint active;
    bool respawning;

    public event Action Respawned;

    void Awake() => Instance = this;

    public void Activate(Checkpoint checkpoint)
    {
        if (active != null && checkpoint.Order <= active.Order) return;    // never go backwards
        active = checkpoint;

        snapshot.Clear();
        foreach (var r in FindRestorables()) snapshot[r] = r.Capture();
    }

    public async void Respawn()
    {
        if (respawning || active == null) return;
        respawning = true;
        try
        {
            await Fade(1f);

            foreach (var (restorable, memento) in snapshot)
                if (restorable is UnityEngine.Object o && o != null) restorable.Restore(memento);

            player.SetPositionAndRotation(active.SpawnPoint.position, active.SpawnPoint.rotation);
            Physics.SyncTransforms();                    // so triggers and physics see the teleport
            player.GetComponent<Health>().Revive();
            Respawned?.Invoke();                         // camera snap, music, input, UI reset

            await Awaitable.WaitForSecondsAsync(0.3f);
            await Fade(0f);
        }
        finally { respawning = false; }
    }

    static IEnumerable<ICheckpointRestorable> FindRestorables()
    {
        foreach (var mb in FindObjectsByType<MonoBehaviour>(FindObjectsInactive.Include, FindObjectsSortMode.None))
            if (mb is ICheckpointRestorable r) yield return r;
    }

    async Awaitable Fade(float target)
    {
        while (!Mathf.Approximately(fade.alpha, target))
        {
            fade.alpha = Mathf.MoveTowards(fade.alpha, target, Time.unscaledDeltaTime * 2.5f);
            await Awaitable.NextFrameAsync();
        }
    }
}

public class Checkpoint : MonoBehaviour
{
    public int Order;                                    // progression order along the level
    public Transform SpawnPoint;

    // Wired from a TriggerVolume's OnFirstEnter (player only).
    public void OnPlayerReached() => CheckpointSystem.Instance.Activate(this);
}
```

Objects choose what resets by implementing the interface, or by not implementing it:

```csharp
public class Enemy : MonoBehaviour, ICheckpointRestorable
{
    struct State { public Vector3 Position; public float Health; public bool Alive; }

    public object Capture() => new State
    {
        Position = transform.position, Health = GetComponent<Health>().Current, Alive = gameObject.activeSelf,
    };

    public void Restore(object m)
    {
        var s = (State)m;
        gameObject.SetActive(s.Alive);
        transform.position = s.Position;
        GetComponent<Health>().Revive(s.Health / GetComponent<Health>().Max);
        // also: reset AI to idle, clear blackboard knowledge of the player
    }
}

// A collected key does NOT implement ICheckpointRestorable: it stays collected after death.
```

Death triggers respawn: `health.Died += _ => CheckpointSystem.Instance.Respawn();`.

## When to use

- Platformers, action-adventures, shooters, any game where dying should cost some progress, but not all.
- Levels with puzzles, bosses or one-way state that must be consistent after a retry.

## Pitfalls

- **Undecided reset policy.** Bugs come from objects nobody thought about: a collapsed bridge that should have been restored, or a collected key that was wrongly removed. Make the policy part of every interactive object's design.
- **Destroyed objects.** An enemy destroyed after the checkpoint cannot be restored. Deactivate instead of destroying (or pool), or record enough to recreate it.
- **Transient systems.** Hit stop, slow motion, camera shake, AI alert levels, status effects and music intensity must all be reset on respawn, or the player respawns into a frozen, shaking, alarmed world. Raise `Respawned` and let those systems reset themselves.
- **Checkpoint order.** Walking back through an earlier checkpoint should not move the spawn backwards. Use an order value, as above, or the furthest checkpoint reached.
- **Dying during respawn.** Damage arriving during the fade, from a projectile still in flight, kills the player again. Make the player invulnerable during respawn, and clear projectiles.
- **Memory.** Capturing full state for every object at every checkpoint is fine for a level. For huge open worlds, capture only objects near the checkpoint, or only objects that have changed.

## Related

- [Memento](./memento) — what each object captures.
- [Trigger Volume](./trigger-volume) — how checkpoints are reached.
- [Save System](./save-system) — checkpoints that also save make save points.
- [Health / Damageable Interface](./health-component) — death triggers respawn, and `Revive` restores the player.
- [Scene / Level Management](./scene-management) — the heavy alternative: reload the level.
