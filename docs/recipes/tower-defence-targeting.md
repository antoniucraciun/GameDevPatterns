# Tower Defence Targeting

> Towers with swappable targeting rules, cheap range queries and pooled projectiles that cope with targets dying mid-flight.

## Goal

The core of a tower-defence game:

- Each tower type has a range, fire rate, projectile and **targeting rule** (first, nearest, strongest, weakest, flying first), and players can **change the rule** on a placed tower.
- **50 towers and 400 enemies** with no frame drops: towers never scan every enemy.
- Thousands of projectiles per wave **without allocations**.
- When a target dies or leaves range, towers **retarget immediately**, and projectiles already flying toward it **do not break**.
- Designers add new tower types and targeting rules as assets.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Type Object](../patterns/type-object) | `TowerType` and `EnemyType` assets define the kinds: stats, prefabs and default targeting. |
| [Strategy](../patterns/strategy) | `TargetingStrategy` assets pick one target from the candidates in range. They can be swapped at runtime. |
| [Spatial Partition](../patterns/spatial-partition) | A grid of enemies, rebuilt every frame, answers "who is in range?" by checking a few cells. |
| [Object Pool](../patterns/object-pool) | Projectiles come from a pool and return on impact or expiry. |
| [Observer](../patterns/observer) | Enemies raise `Died` and `ReachedGoal`. Towers drop their target, and projectiles redirect or fizzle. |

## How they fit together

```
 Enemies ──register──► EnemyGrid (Spatial Partition, rebuilt each frame)
    │                        │  QueryRadius(tower.position, type.range)
    │                        ▼
    │               Tower ──candidates──► TargetingStrategy.Choose(...)   (Strategy asset: First / Nearest / …)
    │                 │  TowerType: range, rate, projectile           (Type Object)
    │                 └─ fire ──► ProjectilePool.Get() ──► Projectile (homing)
    │                                                         │
    └─ Died / ReachedGoal (Observer) ──► tower clears target   │
                                     └─► projectile: retarget nearby or fly on to the last known point
```

The joins:

- **Spatial Partition ↔ Strategy.** The grid makes candidate lists *small*: only enemies in nearby cells, filtered by exact distance. The strategy then picks from 5–10 candidates instead of 400, so even a costly rule ("highest health, prefer flying") stays cheap.
- **Type Object ↔ Strategy.** A tower type references its *default* strategy asset. A placed tower holds its *current* strategy, so the player can change it per tower without touching the type.
- **Observer ↔ Object Pool.** A projectile homing on an enemy that dies, or is pooled and reused elsewhere, would chase the wrong thing. Projectiles subscribe to their target's `Died` event for exactly one flight, and unsubscribe when they return to the pool.
- **Observer ↔ Tower.** Towers retarget when their target dies, without polling `target == null` every frame.

## Example (Unity C#)

This builds on the pattern pages: `TargetingStrategy` and `ITargetable` ([Strategy](../patterns/strategy)), and `UnityEngine.Pool.ObjectPool` ([Object Pool](../patterns/object-pool)).

### Enemies and the grid

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Pool;

public class Enemy : MonoBehaviour, ITargetable
{
    public static readonly List<Enemy> Active = new();

    [SerializeField] EnemyType type;                         // Type Object: a TD version with maxHealth, speed, flying
    public float Health { get; private set; }
    public float PathProgress { get; private set; }
    public bool IsFlying => type.flying;
    public Vector3 Position => transform.position;

    public event Action<Enemy> Died, ReachedGoal;            // Observer

    void OnEnable()  { Active.Add(this); Health = type.maxHealth; PathProgress = 0f; }
    void OnDisable() => Active.Remove(this);

    public void Damage(float amount)
    {
        if (Health <= 0f) return;
        if ((Health -= amount) <= 0f) { Died?.Invoke(this); gameObject.SetActive(false); }
    }

    // Path following updates PathProgress (0 at spawn, 1 at the goal) and raises ReachedGoal at the end.
}

public class EnemyGrid                                        // Spatial Partition
{
    readonly float cellSize;
    readonly Dictionary<Vector2Int, List<Enemy>> cells = new();

    public EnemyGrid(float cellSize) => this.cellSize = cellSize;

    Vector2Int Cell(Vector3 p) => new(Mathf.FloorToInt(p.x / cellSize), Mathf.FloorToInt(p.z / cellSize));

    public void Rebuild(List<Enemy> enemies)
    {
        foreach (var list in cells.Values) list.Clear();
        foreach (var e in enemies)
        {
            var c = Cell(e.Position);
            if (!cells.TryGetValue(c, out var list)) cells[c] = list = new List<Enemy>();
            list.Add(e);
        }
    }

    public void QueryRadius(Vector3 centre, float radius, List<ITargetable> results)
    {
        results.Clear();
        var min = Cell(centre - new Vector3(radius, 0f, radius));
        var max = Cell(centre + new Vector3(radius, 0f, radius));
        float r2 = radius * radius;
        for (int x = min.x; x <= max.x; x++)
        for (int y = min.y; y <= max.y; y++)
            if (cells.TryGetValue(new Vector2Int(x, y), out var list))
                foreach (var e in list)
                    if ((e.Position - centre).sqrMagnitude <= r2) results.Add(e);   // exact check
    }
}
```

### Tower types and towers

```csharp
[CreateAssetMenu(menuName = "TD/Tower Type")]
public class TowerType : ScriptableObject                     // Type Object
{
    public float range = 8f;
    public float shotsPerSecond = 1.5f;
    public float damage = 10f;
    public Projectile projectilePrefab;
    public TargetingStrategy defaultTargeting;                // Strategy asset
}

public class TowerDefence : MonoBehaviour                     // one per level: owns the grid and pools
{
    public static TowerDefence Instance { get; private set; }
    public EnemyGrid Grid { get; } = new EnemyGrid(cellSize: 4f);
    readonly Dictionary<Projectile, ObjectPool<Projectile>> pools = new();

    void Awake() => Instance = this;
    void Update() => Grid.Rebuild(Enemy.Active);              // once per frame, before towers (Script Execution Order)

    public Projectile GetProjectile(Projectile prefab)
    {
        if (!pools.TryGetValue(prefab, out var pool))
        {
            ObjectPool<Projectile> created = null;
            created = new ObjectPool<Projectile>(
                () => { var p = Instantiate(prefab); p.Pool = created; return p; },
                p => p.gameObject.SetActive(true),
                p => p.gameObject.SetActive(false),
                p => Destroy(p.gameObject),
                collectionCheck: Application.isEditor, defaultCapacity: 32, maxSize: 1024);
            pools[prefab] = pool = created;
        }
        return pool.Get();
    }
}

public class Tower : MonoBehaviour
{
    [SerializeField] TowerType type;
    public TargetingStrategy Targeting { get; set; }          // the player can change this per tower

    readonly List<ITargetable> candidates = new();
    Enemy target;
    float nextShot, nextRetarget;

    void Start() => Targeting = type.defaultTargeting;

    void Update()
    {
        // Re-evaluate a few times per second, not every frame, and immediately when the target is lost.
        if (target == null || Time.time >= nextRetarget)
        {
            nextRetarget = Time.time + 0.2f;
            TowerDefence.Instance.Grid.QueryRadius(transform.position, type.range, candidates);
            SetTarget(Targeting.Choose(transform.position, candidates) as Enemy);
        }

        if (target != null && Time.time >= nextShot)
        {
            nextShot = Time.time + 1f / type.shotsPerSecond;
            var p = TowerDefence.Instance.GetProjectile(type.projectilePrefab);
            p.Launch(transform.position, target, type.damage);
        }
    }

    void SetTarget(Enemy next)
    {
        if (next == target) return;
        if (target != null) { target.Died -= OnTargetLost; target.ReachedGoal -= OnTargetLost; }
        target = next;
        if (target != null) { target.Died += OnTargetLost; target.ReachedGoal += OnTargetLost; }
    }

    void OnTargetLost(Enemy e) => SetTarget(null);            // Observer: retarget next frame

    void OnDestroy() => SetTarget(null);
}
```

### Pooled projectiles that survive their target dying

```csharp
public class Projectile : MonoBehaviour
{
    [SerializeField] float speed = 18f, hitRadius = 0.4f, maxLifetime = 4f;
    public IObjectPool<Projectile> Pool { get; set; }

    Enemy target;
    Vector3 lastKnownPosition;
    float damage, expiresAt;

    public void Launch(Vector3 from, Enemy target, float damage)
    {
        transform.position = from;
        this.damage = damage;
        expiresAt = Time.time + maxLifetime;
        Track(target);
    }

    void Track(Enemy next)
    {
        if (target != null) target.Died -= OnTargetDied;     // never keep a subscription across flights
        target = next;
        if (target != null) { target.Died += OnTargetDied; lastKnownPosition = target.Position; }
    }

    void OnTargetDied(Enemy e) => Track(null);               // fly on to where it was, then fizzle

    void Update()
    {
        if (target != null) lastKnownPosition = target.Position;
        transform.position = Vector3.MoveTowards(transform.position, lastKnownPosition, speed * Time.deltaTime);

        if ((transform.position - lastKnownPosition).sqrMagnitude <= hitRadius * hitRadius)
        {
            if (target != null) target.Damage(damage);       // not ?. — that skips Unity's destroyed-object check
            Release();
        }
        else if (Time.time >= expiresAt) Release();
    }

    void Release()
    {
        Track(null);                                         // unsubscribe before going back to the pool
        Pool.Release(this);
    }
}
```

## Where the patterns meet: pitfalls

- **Scanning every enemy per tower.** `foreach (var e in Enemy.Active)` per tower is 50 × 400 distance checks per frame, every frame. Rebuild one grid per frame and query it. Size cells close to the most common tower range.
- **Rebuilding the grid after towers query it.** If towers update before the grid rebuild, they see last frame's positions. Rebuild first, using Script Execution Order or a central update.
- **Stale subscriptions on pooled objects.** A projectile that does not unsubscribe from its old target receives that enemy's `Died` event on a *later* flight, and drops its new target. Unsubscribe on every target change and on release.
- **Homing on pooled enemies.** If enemies are pooled too, a reused enemy is the same object with a new life, and a projectile still tracking it would hit the new enemy. Clearing the target on `Died`, as above, prevents this.
- **Strategies with state.** A shared `TargetingStrategy` asset storing "the last target" mixes towers up. Keep strategies stateless, and keep per-tower state on the tower.
- **Retargeting every frame.** Re-choosing every frame makes towers flick between near-equal targets. Re-evaluate on a short interval and on target loss, or add a bonus for keeping the current target.

## Variations

- **Area towers:** use the same grid query with the splash radius at the impact point, and damage all results.
- **Prediction:** aim projectiles at `target.Position + velocity * timeToImpact` for slow projectiles and fast enemies.
- **Upgrades:** an upgraded tower swaps to an upgraded `TowerType` asset, keeping its current strategy.
- **Massive waves:** for thousands of enemies, move enemies and projectiles to arrays of structs or ECS, as in [Bullet-Hell Projectiles](./bullet-hell-projectiles).
