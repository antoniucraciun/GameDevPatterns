# Spawner / Wave System

> Data-driven waves and spawn points that control what appears, where and when.

**Category:** Gameplay Systems

## Problem

The first version of a horde mode is a coroutine: spawn 5 zombies, wait 10 seconds, spawn 8 zombies. Then design wants wave 7 to mix runners and tanks, the boss wave to wait until the arena is clear, spawns to never appear in the player's view, and the whole thing to be tunable without recompiling. The coroutine turns into a wall of hard-coded numbers that only a programmer can change, and enemies keep popping in right in front of the player.

## Solution

Separate **what** spawns, **when**, and **where**:

- **What and when** are data. A `WaveDefinition` asset lists *spawn groups*: which enemy (or a weighted pool of enemies), how many, the interval between spawns, and a start delay. A wave ends when its groups are done and, optionally, the arena is cleared.
- **Where** is decided by **spawn points** in the level, plus a selection rule: not visible to the player, not too close, not too far, and not used in the last few seconds.
- A **wave runner** plays the waves in order. It counts living enemies by listening to their death events ([Observer](./observer)), and takes enemies from an [Object Pool](./object-pool) so waves do not cause allocation spikes.

## Example (Unity C#)

### Data

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

[Serializable]
public class SpawnGroup
{
    public List<WeightedEnemy> pool = new();   // one is picked per spawn, by weight
    public int count = 5;
    public float startDelay = 0f;
    public float interval = 1f;
}

[Serializable]
public struct WeightedEnemy { public EnemyType type; public float weight; }

[CreateAssetMenu(menuName = "Waves/Wave")]
public class WaveDefinition : ScriptableObject
{
    public List<SpawnGroup> groups = new();
    public bool waitForClear = true;           // next wave only when every enemy is dead
    public float breakAfter = 5f;              // breather before the next wave
}
```

`EnemyType` is the asset from [Type Object](./type-object).

### Spawn points with a selection rule

```csharp
public class SpawnPoint : MonoBehaviour
{
    public float LastUsed = float.NegativeInfinity;
}

public class SpawnPointSelector
{
    readonly List<SpawnPoint> points;
    readonly Transform player;
    readonly Camera camera;
    readonly List<SpawnPoint> candidates = new();

    public float MinDistance = 8f, MaxDistance = 30f, Cooldown = 2f;

    public SpawnPointSelector(List<SpawnPoint> points, Transform player, Camera camera)
    {
        this.points = points; this.player = player; this.camera = camera;
    }

    public SpawnPoint Pick(System.Random rng)
    {
        candidates.Clear();
        foreach (var p in points)
        {
            float d = Vector3.Distance(p.transform.position, player.position);
            if (d < MinDistance || d > MaxDistance) continue;
            if (Time.time - p.LastUsed < Cooldown) continue;
            if (IsVisible(p.transform.position)) continue;
            candidates.Add(p);
        }
        if (candidates.Count == 0) return null;          // no valid point right now: try again shortly

        var chosen = candidates[rng.Next(candidates.Count)];
        chosen.LastUsed = Time.time;
        return chosen;
    }

    bool IsVisible(Vector3 position)
    {
        Vector3 vp = camera.WorldToViewportPoint(position);
        bool inFrustum = vp.z > 0f && vp.x is > -0.1f and < 1.1f && vp.y is > -0.1f and < 1.1f;
        if (!inFrustum) return false;
        // In view, unless something blocks the line of sight.
        return !Physics.Linecast(camera.transform.position, position + Vector3.up);
    }
}
```

### The wave runner

```csharp
public class WaveRunner : MonoBehaviour
{
    [SerializeField] List<WaveDefinition> waves;
    [SerializeField] List<SpawnPoint> spawnPoints;
    [SerializeField] Transform player;

    public int CurrentWave { get; private set; }
    public int Alive { get; private set; }
    public event Action<int> WaveStarted, WaveCleared;

    SpawnPointSelector selector;
    readonly System.Random rng = new();      // seed it for reproducible runs (see Seeded Randomness)

    void Start()
    {
        selector = new SpawnPointSelector(spawnPoints, player, Camera.main);
        StartCoroutine(Run());
    }

    System.Collections.IEnumerator Run()
    {
        for (CurrentWave = 0; CurrentWave < waves.Count; CurrentWave++)
        {
            var wave = waves[CurrentWave];
            WaveStarted?.Invoke(CurrentWave);

            int groupsRunning = wave.groups.Count;
            foreach (var group in wave.groups)
                StartCoroutine(RunGroup(group, () => groupsRunning--));

            yield return new WaitUntil(() => groupsRunning == 0);
            if (wave.waitForClear) yield return new WaitUntil(() => Alive == 0);

            WaveCleared?.Invoke(CurrentWave);
            yield return new WaitForSeconds(wave.breakAfter);
        }
    }

    System.Collections.IEnumerator RunGroup(SpawnGroup group, Action done)
    {
        yield return new WaitForSeconds(group.startDelay);
        for (int i = 0; i < group.count; i++)
        {
            SpawnPoint point;
            while ((point = selector.Pick(rng)) == null)
                yield return new WaitForSeconds(0.25f);  // all points blocked or visible: wait

            Spawn(PickWeighted(group.pool), point.transform.position);
            yield return new WaitForSeconds(group.interval);
        }
        done();
    }

    void Spawn(EnemyType type, Vector3 position)
    {
        Enemy enemy = type.Spawn(position);          // or take it from an Object Pool per type
        Alive++;
        enemy.Died += OnEnemyDied;                   // Observer: count down when it dies
    }

    void OnEnemyDied(Enemy enemy)
    {
        enemy.Died -= OnEnemyDied;
        Alive--;
    }

    EnemyType PickWeighted(List<WeightedEnemy> pool)
    {
        float total = 0f;
        foreach (var e in pool) total += e.weight;
        double roll = rng.NextDouble() * total;
        foreach (var e in pool) { if (roll < e.weight) return e.type; roll -= e.weight; }
        return pool[^1].type;
    }
}
```

This assumes `Enemy` exposes `event Action<Enemy> Died`, raised once when it dies or is despawned.

## When to use

- Horde, survival, tower defence and arena modes, roguelike rooms, and ambient spawning in open worlds.
- Whenever designers need to tune pacing: counts, mixes, timing and breaks.

## Pitfalls

- **Enemies that leave without dying.** Enemies that fall out of the world, despawn or get pooled without raising `Died` leave `Alive` stuck above zero, and the wave never ends. Raise the event on *every* removal path, and add a debug view of alive counts.
- **Spawning in view.** Players notice enemies appearing out of nothing. Check the camera frustum *and* line of sight, and prefer points behind the player or behind cover.
- **No valid point.** In small arenas, every point can be visible or too close at once. Wait and retry, as here, or relax one rule at a time rather than spawning in view.
- **Fixed waves get stale.** Pure scripts are memorised quickly. Add weighted variety, or switch to a budget system: each wave has "threat points" that it spends on enemies with different costs.
- **Allocation spikes.** Instantiating 30 enemies on the first frame of a wave hitches. Pool enemies, and spread spawns over frames with intervals.

## Related

- [Type Object](./type-object) — enemy kinds referenced by waves.
- [Weighted Random & Loot Tables](./weighted-random) — weighted pools of enemy types.
- [Object Pool](./object-pool) — reuse enemies between waves.
- [Observer](./observer) — death events drive the alive count.
- [Seeded Randomness](./seeded-randomness) — reproducible wave mixes for daily challenges and replays.
- AI Director — a meta-system that adjusts spawning to the player's stress level.
