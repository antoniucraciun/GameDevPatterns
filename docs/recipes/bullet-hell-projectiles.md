# Bullet-Hell Projectiles

> Thousands of bullets on screen at a steady frame rate, with no allocations and cheap hit tests.

## Goal

A danmaku-style shooter where bosses fill the screen with patterns:

- **5,000+ live bullets** without frame drops, including on mid-range hardware.
- **No allocations** while firing, so there are no garbage-collector hitches in the middle of a pattern.
- Bullets hit any of dozens of targets **without checking every bullet against every target**.
- Designers add new bullet kinds as assets.

A GameObject per bullet does not reach this scale. Instantiating, updating and rendering each one separately costs too much, even with pooling. This recipe keeps bullets as **plain data** managed by one system.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Object Pool](../patterns/object-pool) | One preallocated array of bullet slots, never resized. Spawning claims a slot and despawning frees it, with no allocation. |
| [Flyweight](../patterns/flyweight) | Mesh, material, radius, damage and lifetime live once per `BulletType` asset. Each bullet stores only a type index. |
| [Data Locality](../patterns/data-locality) | Live bullets are packed contiguously in an array of small structs, so the update loop streams through memory without cache misses. |
| [Spatial Partition](../patterns/spatial-partition) | A uniform grid of targets, rebuilt each frame, means each bullet tests only the targets in nearby cells. |

## How they fit together

```
BulletType assets (Flyweight)          BulletSystem
 ├─ mesh, material                     ┌──────────────────────────────────────────────┐
 ├─ radius, damage                     │ Bullet[] bullets   (fixed capacity = Pool)   │
 └─ lifetime                           │ [0 .. count) alive, packed (Data Locality)   │
          ▲                            │  pos | vel | age | type ──► types[type]      │
          └──── type index ────────────│                                              │
                                       │ Update:  move ─► expire (swap-remove)        │
 targets ──► TargetGrid (Spatial       │          ─► grid.Query(cell) ─► hit?         │
             Partition, rebuilt/frame) │ Render:  per type, RenderMeshInstanced       │
                                       └──────────────────────────────────────────────┘
```

- **Pool ↔ Data Locality.** The pool *is* the dense array. Despawning swaps the last live bullet into the freed slot (swap-remove), so live bullets always occupy `[0, count)` with no gaps to skip.
- **Flyweight ↔ Data Locality.** Moving shared data into `BulletType` keeps each `Bullet` struct at 24 bytes, so more bullets fit per cache line. Grouping by type also enables one instanced draw call per type.
- **Spatial Partition ↔ Data Locality.** The target grid is built as flat arrays (counting sort into cells), not as lists per cell, so building it every frame costs nothing in allocations.

## Example (Unity C#)

```csharp
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(menuName = "Bullets/Bullet Type")]
public class BulletType : ScriptableObject        // Flyweight: shared, read-only at runtime
{
    public Mesh mesh;
    public Material material;                     // enable GPU Instancing on the material
    public float radius = 0.1f;
    public int damage = 1;
    public float lifetime = 6f;
}

public interface IBulletTarget
{
    Vector2 Position { get; }
    float Radius { get; }
    void Hit(int damage);
}

public struct Bullet                              // Data Locality: small, contiguous
{
    public Vector2 Position;
    public Vector2 Velocity;
    public float Age;
    public int Type;                              // index into BulletSystem.types
}

public class BulletSystem : MonoBehaviour
{
    [SerializeField] BulletType[] types;
    [SerializeField] int capacity = 8192;
    [SerializeField] Rect arena = new Rect(-12, -8, 24, 16);
    [SerializeField] float cellSize = 1f;

    // ── Object Pool: fixed array, alive bullets packed in [0, count) ──
    Bullet[] bullets;
    int count;

    public readonly List<IBulletTarget> Targets = new();
    TargetGrid grid;

    readonly Matrix4x4[] batch = new Matrix4x4[1023];
    RenderParams[] renderParams;

    void Awake()
    {
        bullets = new Bullet[capacity];
        grid = new TargetGrid(arena, cellSize, maxTargets: 256);
        renderParams = new RenderParams[types.Length];
        for (int t = 0; t < types.Length; t++) renderParams[t] = new RenderParams(types[t].material);
    }

    public bool Spawn(int type, Vector2 position, Vector2 velocity)
    {
        if (count == capacity) return false;      // pool exhausted: drop the bullet, never allocate
        bullets[count++] = new Bullet { Position = position, Velocity = velocity, Type = type };
        return true;
    }

    void Update()
    {
        float dt = Time.deltaTime;
        grid.Rebuild(Targets);

        for (int i = 0; i < count; i++)
        {
            ref Bullet b = ref bullets[i];
            BulletType type = types[b.Type];

            b.Position += b.Velocity * dt;
            b.Age += dt;

            bool dead = b.Age >= type.lifetime || !arena.Contains(b.Position);
            if (!dead && grid.TryHit(b.Position, type.radius, out IBulletTarget target))
            {
                target.Hit(type.damage);
                dead = true;
            }

            if (dead)
            {
                bullets[i] = bullets[--count];    // swap-remove keeps the array dense
                i--;                              // re-process the bullet moved into slot i
            }
        }

        Render();
    }

    void Render()
    {
        for (int t = 0; t < types.Length; t++)
        {
            int n = 0;
            for (int i = 0; i < count; i++)
            {
                if (bullets[i].Type != t) continue;
                batch[n++] = Matrix4x4.Translate(bullets[i].Position);
                if (n == batch.Length) { Graphics.RenderMeshInstanced(renderParams[t], types[t].mesh, 0, batch, n); n = 0; }
            }
            if (n > 0) Graphics.RenderMeshInstanced(renderParams[t], types[t].mesh, 0, batch, n);
        }
    }
}

// ── Spatial Partition: uniform grid in flat arrays, rebuilt every frame ──
public class TargetGrid
{
    readonly Rect area;
    readonly float cellSize;
    readonly int columns, rows;
    readonly int[] cellStart, cellCount;           // per cell: range into `sorted`
    readonly int[] targetCell;
    readonly IBulletTarget[] sorted, scratch;
    int targetCount;

    public TargetGrid(Rect area, float cellSize, int maxTargets)
    {
        this.area = area; this.cellSize = cellSize;
        columns = Mathf.CeilToInt(area.width / cellSize);
        rows = Mathf.CeilToInt(area.height / cellSize);
        cellStart = new int[columns * rows];
        cellCount = new int[columns * rows];
        targetCell = new int[maxTargets];
        sorted = new IBulletTarget[maxTargets];
        scratch = new IBulletTarget[maxTargets];
    }

    int CellIndex(Vector2 p)
    {
        int x = Mathf.Clamp((int)((p.x - area.xMin) / cellSize), 0, columns - 1);
        int y = Mathf.Clamp((int)((p.y - area.yMin) / cellSize), 0, rows - 1);
        return y * columns + x;
    }

    // Counting sort: targets end up grouped by cell in one flat array, with zero allocations.
    public void Rebuild(List<IBulletTarget> targets)
    {
        targetCount = Mathf.Min(targets.Count, sorted.Length);
        System.Array.Clear(cellCount, 0, cellCount.Length);
        for (int i = 0; i < targetCount; i++)
        {
            scratch[i] = targets[i];
            targetCell[i] = CellIndex(targets[i].Position);
            cellCount[targetCell[i]]++;
        }
        for (int c = 0, start = 0; c < cellCount.Length; c++) { cellStart[c] = start; start += cellCount[c]; }
        System.Array.Clear(cellCount, 0, cellCount.Length);
        for (int i = 0; i < targetCount; i++)
        {
            int c = targetCell[i];
            sorted[cellStart[c] + cellCount[c]++] = scratch[i];
        }
    }

    // Checks the bullet's cell and its 8 neighbours. Assumes target radius + bullet radius <= cellSize.
    public bool TryHit(Vector2 p, float radius, out IBulletTarget hit)
    {
        int cx = Mathf.Clamp((int)((p.x - area.xMin) / cellSize), 0, columns - 1);
        int cy = Mathf.Clamp((int)((p.y - area.yMin) / cellSize), 0, rows - 1);

        for (int y = Mathf.Max(cy - 1, 0); y <= Mathf.Min(cy + 1, rows - 1); y++)
        for (int x = Mathf.Max(cx - 1, 0); x <= Mathf.Min(cx + 1, columns - 1); x++)
        {
            int c = y * columns + x;
            for (int i = cellStart[c], end = i + cellCount[c]; i < end; i++)
            {
                var t = sorted[i];
                float r = radius + t.Radius;
                if ((t.Position - p).sqrMagnitude <= r * r) { hit = t; return true; }
            }
        }
        hit = null;
        return false;
    }
}
```

A boss fires a ring pattern with a few `Spawn` calls, and nothing is allocated:

```csharp
for (int i = 0; i < 36; i++)
{
    float angle = i * 10f * Mathf.Deg2Rad + Time.time;
    bullets.Spawn(type: 0, transform.position, new Vector2(Mathf.Cos(angle), Mathf.Sin(angle)) * 4f);
}
```

## Where the patterns meet: pitfalls

- **Swap-remove changes bullet order.** Code that holds a bullet *index* across frames, such as a homing missile's target, breaks when the array is compacted. Give bullets a stable ID if anything needs to refer to them later.
- **Mutating the flyweight.** Changing `type.damage` for one "powered-up" bullet changes it for all of them, and permanently changes the asset in the editor. Per-bullet variation belongs in the `Bullet` struct.
- **The grid's assumptions.** Checking only neighbouring cells is correct only if `bullet radius + target radius <= cellSize`. Large bosses need to be inserted into every cell they overlap, or checked separately.
- **Fast bullets tunnel.** If a bullet moves further than a target's diameter in one frame, it can skip over the target. Use a swept test (segment against circle) for fast types.
- **Pool exhaustion is a design decision.** When `Spawn` returns false, decide whether to drop the new bullet (as here) or recycle the oldest one, and log it in development builds.
- **Rendering by type scans the array once per type.** With many types, sort bullets by type occasionally, or keep one array per type.

## Variations

- **Jobs and Burst:** `Bullet` is already a blittable struct. Move the arrays to `NativeArray<Bullet>` and run the movement loop in an `IJobParallelFor` compiled with Burst, often an order of magnitude faster.
- **Patterns as data:** describe emitters (count, spread, rotation speed, bullet type) as assets as well, so designers create boss patterns without code.
- **Grazing:** reuse the grid query with a larger radius to reward near misses.
