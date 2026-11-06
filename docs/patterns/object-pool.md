# Object Pool

> Reuse objects from a fixed pool instead of allocating and destroying them.

**Category:** Performance & Memory

## Problem

A bullet-hell game fires hundreds of projectiles per second. Each `Instantiate` allocates memory and runs initialisation, and each `Destroy` leaves garbage behind. The result is CPU spikes, garbage-collector pauses and memory fragmentation, all visible as hitches during the most intense moments of play.

## Solution

Create objects ahead of time, or on first demand, and keep inactive ones in a pool. **Get** takes an inactive object from the pool and activates it, creating a new one only if the pool is empty. **Release** deactivates the object and returns it to the pool instead of destroying it. Each object must fully reset its state when reused.

## Example (Unity C#)

Unity ships a generic pool in `UnityEngine.Pool`:

```csharp
using UnityEngine;
using UnityEngine.Pool;

public class Projectile : MonoBehaviour
{
    public IObjectPool<Projectile> Pool { get; set; }
    Vector3 velocity;
    float lifetime;

    public void Launch(Vector3 position, Vector3 velocity)
    {
        transform.position = position;
        this.velocity = velocity;
        lifetime = 3f;                       // reset ALL per-use state here
    }

    void Update()
    {
        transform.position += velocity * Time.deltaTime;
        if ((lifetime -= Time.deltaTime) <= 0f)
            Pool.Release(this);              // return instead of Destroy
    }
}

public class Gun : MonoBehaviour
{
    [SerializeField] Projectile prefab;
    IObjectPool<Projectile> pool;

    void Awake()
    {
        pool = new ObjectPool<Projectile>(
            createFunc:      () => { var p = Instantiate(prefab); p.Pool = pool; return p; },
            actionOnGet:     p => p.gameObject.SetActive(true),
            actionOnRelease: p => p.gameObject.SetActive(false),
            actionOnDestroy: p => Destroy(p.gameObject),
            collectionCheck: Application.isEditor,   // catches double-release while developing
            defaultCapacity: 64,
            maxSize:         512);
    }

    public void Fire(Vector3 dir) => pool.Get().Launch(transform.position, dir * 30f);
}
```

`UnityEngine.Pool` also provides `ListPool<T>`, `DictionaryPool<K,V>` and `GenericPool<T>`, which avoid allocating temporary collections every frame.

## When to use

- Objects created and destroyed frequently: projectiles, particles, hit effects, damage numbers, audio sources, enemies in waves.
- Platforms where GC spikes are noticeable, such as mobile, VR and consoles.

## Pitfalls

- **Stale state.** A reused enemy still has last life's status effects, or a trail renderer still shows its old path. Reset everything in `Get` or `Launch`, including `TrailRenderer.Clear()` and Rigidbody velocities.
- **Double release** puts the same object in the pool twice, so two systems end up controlling it. Keep `collectionCheck` on in development.
- **Holding references to released objects.** A homing missile still targeting an enemy that was released and respawned elsewhere. Use generation counters or clear references on release.
- **Oversized pools** waste memory. Profile and set `maxSize`.

## Related

- [Flyweight](./flyweight) — shares immutable data. A pool reuses mutable instances.
- [Arena Allocator](./arena-allocator) — the same idea applied to raw memory.
