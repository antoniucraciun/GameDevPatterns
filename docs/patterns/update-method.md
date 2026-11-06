# Update Method

> Let every object simulate one frame of its own behaviour when asked.

**Category:** Game Loop & Timing

## Problem

A world holds dozens of independent things: a patrolling guard, a spinning pickup, a door that slowly closes. Hard-coding all of their behaviour into one giant loop body does not scale, and adding a new kind of object would mean editing that loop.

## Solution

Give every active object an `Update(dt)` method that advances it by one frame. The game keeps a collection of active objects and calls `Update` on each of them once per frame. Each object keeps whatever state it needs between calls, such as the patrol waypoint index or how far the door has closed.

## Example (Unity C#)

`MonoBehaviour.Update` *is* this pattern. Unity keeps the list and calls it for you:

```csharp
public class Patrol : MonoBehaviour
{
    [SerializeField] Transform[] waypoints;
    [SerializeField] float speed = 3f;
    int index;

    void Update()
    {
        Vector3 target = waypoints[index].position;
        transform.position = Vector3.MoveTowards(transform.position, target, speed * Time.deltaTime);
        if (transform.position == target)
            index = (index + 1) % waypoints.Length;
    }
}
```

With thousands of objects, the per-call overhead of the engine-to-script boundary adds up. A common optimisation is a single manager that holds a plain list and calls a method on each object:

```csharp
public interface ITickable { void Tick(float dt); }

public class TickManager : MonoBehaviour
{
    static readonly List<ITickable> tickables = new();
    public static void Register(ITickable t) => tickables.Add(t);
    public static void Unregister(ITickable t) => tickables.Remove(t);

    void Update()
    {
        float dt = Time.deltaTime;
        // Iterate backwards so objects can unregister themselves during Tick.
        for (int i = tickables.Count - 1; i >= 0; i--)
            tickables[i].Tick(dt);
    }
}
```

## When to use

- Many independent objects that each need a little work every frame.
- Behaviour that is easy to express as "advance by one step".

## When not to use

- Objects that sit idle most of the time: doors, pickups, spawners waiting for a trigger. React to events with [Observer](./observer) or schedule work with a [Timer](./timer-scheduler) instead of checking every frame.
- Thousands of identical objects. One manager looping over a plain array is faster than thousands of `Update` calls; see [Data Locality](./data-locality).
- Work that only needs to happen every few frames or seconds. Use [Time Slicing](./time-slicing) or a timer.

## Pitfalls

- **Update order is undefined between objects.** If A reads B's position, A may see this frame's value or last frame's. Use `LateUpdate`, explicit system ordering or a [Double Buffer](./double-buffer).
- **Modifying the collection while iterating it**, for example spawning or destroying objects during `Update`. Defer the changes, or iterate a copy or backwards.
- **Empty `Update` methods still cost a call.** Disable components that have nothing to do, or switch to events.
- **Polling things that rarely change.** Prefer [Observer](./observer) when something only matters at the moment it changes.

## Related

- [Game Loop](./game-loop) — what calls the update methods.
- [Component](./component) — update methods usually live on components.
- [Time Slicing](./time-slicing) — when each update is too expensive to run every frame.
