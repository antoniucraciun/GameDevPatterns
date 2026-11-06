# Wave Spawning

> Designer-authored enemy waves with weighted variety and no spawn hitches.

## Goal

A horde or arena mode:

- Designers author waves as assets: how many enemies, which mix, how fast, and when the next wave starts.
- Each run feels a little different, with weighted enemy mixes, while the *difficulty* stays controlled.
- Wave 20 spawning 60 enemies causes **no frame hitches** and **no garbage collection spikes**.
- The game always knows how many enemies are alive, so "wave cleared" fires reliably, never too early and never stuck.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Spawner / Wave System](../patterns/spawner) | Wave assets, spawn groups, spawn-point selection, and the runner that plays waves in order. |
| [Weighted Random & Loot Tables](../patterns/weighted-random) | Picks each enemy from a weighted pool, with a seeded generator, so runs vary but can be reproduced. |
| [Object Pool](../patterns/object-pool) | One pool per enemy type. Spawning takes an enemy from the pool, and dying returns it, with no `Instantiate` or `Destroy` mid-wave. |
| [Observer](../patterns/observer) | Enemies raise `Died` and `Despawned`. The runner counts alive enemies and the pool reclaims them, and neither is called by the enemy directly. |

## How they fit together

```
 WaveDefinition ──► WaveRunner ──pick type──► WeightedPicker (seeded)
 (groups, mixes)        │
                        ├─ pick point ──► SpawnPointSelector (off-screen, cooldown)
                        │
                        └─ Get ──► EnemyPools[type] ──► Enemy.Activate(point) ── Alive++
                                        ▲                     │
                                        │      Died ──────────┤ (Observer, subscribed ONCE at creation)
                                        └──── Release ◄───────┴─ Alive--  ──► Alive == 0 → wave cleared
```

The joins:

- **Object Pool ↔ Observer.** Pooled enemies live for the whole session, so the runner subscribes to each enemy's events **once, when the pool creates it**, not on every spawn. Subscribing on spawn would add a handler every time the enemy is reused, and the alive count would drop by 2, 3, 4… per death.
- **Observer ↔ Spawner.** The alive count changes only in response to the enemy's own events, so "wave cleared" is exactly as reliable as those events. Every way an enemy can leave play (killed, fell out of the world, despawned at the end of a run) must raise one of them.
- **Weighted Random ↔ Spawner.** The wave asset decides *how many* and *how dangerous*. The weights decide *which*. Seeding the generator from the run seed makes a wave sequence reproducible for daily challenges and bug reports.
- **Object Pool ↔ Spawner.** Pools are **pre-warmed** before wave 1 from the wave data, so even the first appearance of a new enemy type causes no hitch.

## Example (Unity C#)

This builds on the code from the pattern pages: `WaveDefinition`, `SpawnGroup`, `WeightedEnemy`, `SpawnPointSelector` ([Spawner](../patterns/spawner)) and `EnemyType` ([Type Object](../patterns/type-object)).

### A poolable enemy with lifecycle events

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Pool;

public class Enemy : MonoBehaviour
{
    public EnemyType Type { get; private set; }
    public event Action<Enemy> Died;          // killed by the player
    public event Action<Enemy> Despawned;     // removed for any other reason (fell, wave reset)

    int health;
    bool active;

    public void Bind(EnemyType type) => Type = type;          // once, when the pool creates it

    public void Activate(Vector3 position)                    // every time it is taken from the pool
    {
        transform.position = position;
        health = Type.MaxHealth;                              // reset ALL per-life state
        active = true;
        gameObject.SetActive(true);
    }

    public void TakeDamage(int amount)
    {
        if (!active) return;
        if ((health -= amount) <= 0) End(Died);
    }

    public void Despawn() { if (active) End(Despawned); }

    void Update()
    {
        if (transform.position.y < -50f) Despawn();           // fell out of the world: still counted
    }

    void End(Action<Enemy> evt)
    {
        active = false;                                       // guarantees exactly one event per life
        evt?.Invoke(this);
    }
}
```

### Pools per enemy type, pre-warmed from wave data

```csharp
public class EnemyPools
{
    readonly Dictionary<EnemyType, ObjectPool<Enemy>> pools = new();
    readonly Transform parent;
    readonly Action<Enemy> onEnded;                           // the runner's handler

    public EnemyPools(Transform parent, Action<Enemy> onEnded)
    {
        this.parent = parent; this.onEnded = onEnded;
    }

    ObjectPool<Enemy> PoolFor(EnemyType type)
    {
        if (pools.TryGetValue(type, out var pool)) return pool;

        pool = new ObjectPool<Enemy>(
            createFunc: () =>
            {
                var enemy = UnityEngine.Object.Instantiate(type.Prefab, parent).GetComponent<Enemy>();
                enemy.Bind(type);
                enemy.Died += onEnded;                        // Observer: subscribe ONCE per object
                enemy.Despawned += onEnded;
                enemy.gameObject.SetActive(false);
                return enemy;
            },
            actionOnRelease: e => e.gameObject.SetActive(false),
            actionOnDestroy: e => UnityEngine.Object.Destroy(e.gameObject),
            collectionCheck: Application.isEditor,
            defaultCapacity: 16, maxSize: 256);

        pools[type] = pool;
        return pool;
    }

    public Enemy Spawn(EnemyType type, Vector3 position)
    {
        var enemy = PoolFor(type).Get();
        enemy.Activate(position);
        return enemy;
    }

    public void Release(Enemy enemy) => PoolFor(enemy.Type).Release(enemy);

    // Create enough instances up front that no wave needs to Instantiate.
    public void Prewarm(IEnumerable<WaveDefinition> waves)
    {
        var peak = new Dictionary<EnemyType, int>();
        foreach (var wave in waves)
        foreach (var group in wave.groups)
        foreach (var option in group.pool)
            peak[option.type] = Math.Max(peak.GetValueOrDefault(option.type), group.count);

        foreach (var (type, count) in peak)
        {
            var pool = PoolFor(type);
            var temp = new List<Enemy>(count);
            for (int i = 0; i < count; i++) temp.Add(pool.Get());
            foreach (var e in temp) pool.Release(e);
        }
    }
}
```

### The runner: seeded mixes, pooled spawns, reliable counting

```csharp
public class WaveSpawning : MonoBehaviour
{
    [SerializeField] List<WaveDefinition> waves;
    [SerializeField] List<SpawnPoint> spawnPoints;
    [SerializeField] Transform player;
    [SerializeField] int runSeed = 12345;                     // from the run / daily challenge

    public int Alive { get; private set; }
    public event Action<int> WaveCleared;

    EnemyPools pools;
    SpawnPointSelector selector;
    System.Random rng;

    void Start()
    {
        rng = new System.Random(runSeed);
        selector = new SpawnPointSelector(spawnPoints, player, Camera.main);
        pools = new EnemyPools(transform, OnEnemyEnded);
        pools.Prewarm(waves);                                 // pay the Instantiate cost during loading
        StartCoroutine(Run());
    }

    void OnEnemyEnded(Enemy enemy)                            // one handler for Died and Despawned
    {
        Alive--;
        pools.Release(enemy);
    }

    System.Collections.IEnumerator Run()
    {
        for (int w = 0; w < waves.Count; w++)
        {
            var wave = waves[w];
            int groupsRunning = wave.groups.Count;
            foreach (var group in wave.groups)
                StartCoroutine(RunGroup(group, () => groupsRunning--));

            yield return new WaitUntil(() => groupsRunning == 0 && (!wave.waitForClear || Alive == 0));
            WaveCleared?.Invoke(w);
            yield return new WaitForSeconds(wave.breakAfter);
        }
    }

    System.Collections.IEnumerator RunGroup(SpawnGroup group, Action done)
    {
        yield return new WaitForSeconds(group.startDelay);
        for (int i = 0; i < group.count; i++)
        {
            SpawnPoint point;
            while ((point = selector.Pick(rng)) == null) yield return new WaitForSeconds(0.25f);

            pools.Spawn(PickWeighted(group.pool), point.transform.position);
            Alive++;
            yield return new WaitForSeconds(group.interval);
        }
        done();
    }

    EnemyType PickWeighted(List<WeightedEnemy> options)       // Weighted Random, seeded
    {
        float total = 0f;
        foreach (var o in options) total += o.weight;
        double roll = rng.NextDouble() * total;
        foreach (var o in options) { if (roll < o.weight) return o.type; roll -= o.weight; }
        return options[^1].type;
    }
}
```

## Where the patterns meet: pitfalls

- **Subscribing on every spawn.** With pooling, `enemy.Died += handler` in the spawn method stacks a new handler each time the enemy is reused. Subscribe once at creation, as `EnemyPools` does, or unsubscribe in the handler.
- **Two events for one death.** An enemy that dies *and* then falls out of the world raises both events, so the count drops twice and the wave "clears" early. The `active` flag guarantees exactly one ending per life.
- **Stale state on reuse.** A reused enemy keeps its old health, status effects, AI state and velocity unless `Activate` resets them. Every per-life field must be reset there.
- **Pool too small.** If a wave peaks above the pre-warmed count, the pool instantiates mid-wave. That is correct, but it hitches. Pre-warm from the actual wave data, as above, and log when a pool grows during play.
- **Seed consumed by other systems.** If spawn-point choice and enemy choice share one generator, adding a spawn point changes which enemies appear. Use separate streams per purpose (see [Seeded Randomness](../patterns/seeded-randomness)).
- **Releasing while still referenced.** A homing missile still targeting an enemy that was released and reused elsewhere will chase the wrong enemy. Clear targets on `Died`/`Despawned`, or compare a per-life generation counter.

## Variations

- **Threat budgets:** instead of fixed counts, each wave has a budget that it spends on enemies with different costs, which gives more variety at the same difficulty.
- **Adaptive pacing:** an [AI Director](../patterns/director-ai) scales the next wave's budget, or the break time, using the player's health and recent performance.
- **Endless mode:** generate wave definitions at runtime from a difficulty curve rather than authoring them.
- **Elites:** a small weighted chance to apply a status effect such as "Elite" (+50% health, a glowing outline) on spawn, using [Status Effects](../patterns/status-effects).
