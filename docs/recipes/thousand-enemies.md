# 1,000 Enemies at 60 FPS

> A horde of a thousand enemies simulated in parallel, culled, and drawn in a handful of draw calls with no garbage.

## Goal

A horde-survival game where the screen fills with enemies:

- **1,000+ enemies** chase the player, avoid stacking on top of each other, and die in large numbers.
- A **steady 60 FPS** on mid-range hardware, including on enemy-heavy frames.
- **No garbage collection spikes**: no allocations per frame during play.
- Several enemy kinds (fast runners, slow tanks), each with its own mesh, speed and health.

At this scale, one GameObject and one MonoBehaviour per enemy is the bottleneck: per-object `Update` calls, Transform updates, draw calls and allocations on spawn and death. This recipe treats enemies as **data**.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Flyweight](../patterns/flyweight) | Mesh, material, speed and health live once per `EnemyKind`. Each enemy stores only a kind index. |
| [Object Pool](../patterns/object-pool) | A fixed-capacity array of enemy slots. Spawning claims a slot, and death swaps the last enemy into it. |
| [Job System](../patterns/job-system) | Movement and separation for all enemies in a Burst-compiled parallel job. |
| [Culling](../patterns/culling) | Only enemies inside the camera frustum are drawn. Off-screen ones still move. |
| [Batching](../patterns/batching) | Visible enemies of each kind are drawn with GPU instancing, about 1,000 per draw call. |
| [Arena Allocator](../patterns/arena-allocator) | Per-frame scratch data (the separation grid, visible lists) uses temporary allocators reset every frame. |

## How they fit together

```
 EnemyKind assets (Flyweight): mesh, material, speed, health, radius
                │ kind index
 NativeArray<Enemy> enemies [capacity 4096], alive in [0, count)   (Object Pool: swap-remove)
   { position, velocity, health, kind }
                │
 Update:
   1. grid  = build spatial hash of positions        (TempJob memory: Arena)
   2. MoveJob (Burst, parallel): seek player + separate from grid neighbours   (Job System)
   3. complete in LateUpdate
   4. per kind: frustum test → matrices of visible enemies (Culling)
      → Graphics.RenderMeshInstanced in chunks          (Batching)
   5. dispose frame allocations                         (Arena)
```

The joins:

- **Flyweight ↔ Batching.** Because all enemies of a kind share one mesh and material, they can be instanced together. Per-enemy variation (tint, scale) goes into per-instance data, never into a copied material.
- **Object Pool ↔ Job System.** Enemies are packed into one `NativeArray` with no gaps, which is exactly what parallel jobs and Burst want: contiguous, blittable data.
- **Job System ↔ Arena Allocator.** The separation grid is rebuilt every frame. Allocating it from `Allocator.TempJob` and disposing it at the end of the frame costs nothing for the garbage collector.
- **Culling ↔ Batching.** Culling decides *which* enemies are drawn, and batching decides *how*. The matrix list is built only from visible enemies, so draw-call work scales with what the camera sees, not the horde size.

## Example (Unity C#)

```csharp
using Unity.Burst;
using Unity.Collections;
using Unity.Jobs;
using Unity.Mathematics;
using UnityEngine;

[CreateAssetMenu(menuName = "Horde/Enemy Kind")]
public class EnemyKind : ScriptableObject                 // Flyweight: shared by every enemy of this kind
{
    public Mesh mesh;
    public Material material;                              // GPU Instancing enabled
    public float speed = 3f, health = 10f, radius = 0.5f;
}

public struct Enemy                                        // per-enemy data: small and blittable
{
    public float3 Position, Velocity;
    public float Health;
    public int Kind;
}

public class Horde : MonoBehaviour
{
    [SerializeField] EnemyKind[] kinds;
    [SerializeField] Transform player;
    [SerializeField] int capacity = 4096;
    [SerializeField] float cellSize = 1.5f;

    NativeArray<Enemy> enemies;                            // Object Pool: fixed capacity, packed
    NativeArray<float> kindSpeed, kindRadius;              // flyweight data copied once for jobs
    int count;

    NativeParallelMultiHashMap<int, int> grid;             // per-frame scratch (Arena)
    JobHandle handle;
    readonly Matrix4x4[] batch = new Matrix4x4[1023];      // reused every frame: no allocation
    readonly Plane[] frustum = new Plane[6];
    RenderParams[] renderParams;

    void Awake()
    {
        enemies = new NativeArray<Enemy>(capacity, Allocator.Persistent);
        kindSpeed = new NativeArray<float>(kinds.Length, Allocator.Persistent);
        kindRadius = new NativeArray<float>(kinds.Length, Allocator.Persistent);
        renderParams = new RenderParams[kinds.Length];
        for (int k = 0; k < kinds.Length; k++)
        {
            kindSpeed[k] = kinds[k].speed;
            kindRadius[k] = kinds[k].radius;
            renderParams[k] = new RenderParams(kinds[k].material);
        }
    }

    public bool Spawn(int kind, Vector3 position)
    {
        if (count == capacity) return false;               // full: skip this spawn rather than allocate
        enemies[count++] = new Enemy { Position = position, Health = kinds[kind].health, Kind = kind };
        return true;
    }

    public void Kill(int index) => enemies[index] = enemies[--count];   // swap-remove keeps the array dense

    void Update()
    {
        // 1. Arena: a fresh grid for this frame only.
        grid = new NativeParallelMultiHashMap<int, int>(math.max(count, 1), Allocator.TempJob);
        var build = new BuildGridJob { Enemies = enemies, Grid = grid.AsParallelWriter(), CellSize = cellSize }
            .Schedule(count, 128);

        // 2. Parallel movement and separation, after the grid is built.
        handle = new MoveJob
        {
            Enemies = enemies, Grid = grid, Speed = kindSpeed, Radius = kindRadius,
            Target = player.position, Dt = Time.deltaTime, CellSize = cellSize,
        }.Schedule(count, 64, build);
    }

    void LateUpdate()
    {
        handle.Complete();
        grid.Dispose();                                     // Arena: reclaimed every frame

        // 3. Culling + batching: per kind, only visible enemies, up to 1023 per draw call.
        GeometryUtility.CalculateFrustumPlanes(Camera.main, frustum);
        for (int k = 0; k < kinds.Length; k++)
        {
            int n = 0;
            var bounds = kinds[k].mesh.bounds;
            for (int i = 0; i < count; i++)
            {
                var e = enemies[i];
                if (e.Kind != k) continue;
                bounds.center = e.Position;
                if (!GeometryUtility.TestPlanesAABB(frustum, bounds)) continue;    // off-screen: not drawn
                float3 dir = math.lengthsq(e.Velocity) > 0.01f ? math.normalize(e.Velocity) : new float3(0, 0, 1);
                batch[n++] = Matrix4x4.TRS(e.Position, Quaternion.LookRotation(dir), Vector3.one);
                if (n == batch.Length) { Graphics.RenderMeshInstanced(renderParams[k], kinds[k].mesh, 0, batch, n); n = 0; }
            }
            if (n > 0) Graphics.RenderMeshInstanced(renderParams[k], kinds[k].mesh, 0, batch, n);
        }
    }

    void OnDestroy()
    {
        handle.Complete();
        if (grid.IsCreated) grid.Dispose();
        enemies.Dispose(); kindSpeed.Dispose(); kindRadius.Dispose();
    }

    static int Hash(float3 p, float cell) => (int)math.hash(new int2((int)math.floor(p.x / cell), (int)math.floor(p.z / cell)));

    [BurstCompile]
    struct BuildGridJob : IJobParallelFor
    {
        [ReadOnly] public NativeArray<Enemy> Enemies;
        public NativeParallelMultiHashMap<int, int>.ParallelWriter Grid;
        public float CellSize;
        public void Execute(int i) => Grid.Add(Hash(Enemies[i].Position, CellSize), i);
    }

    [BurstCompile]
    struct MoveJob : IJobParallelFor
    {
        [NativeDisableParallelForRestriction] public NativeArray<Enemy> Enemies;   // each job writes only index i
        [ReadOnly] public NativeParallelMultiHashMap<int, int> Grid;
        [ReadOnly] public NativeArray<float> Speed, Radius;
        public float3 Target; public float Dt, CellSize;

        public void Execute(int i)
        {
            var e = Enemies[i];
            float3 seek = Target - e.Position; seek.y = 0;
            float3 desired = math.normalizesafe(seek) * Speed[e.Kind];

            // Separation from neighbours in this cell and the 8 around it.
            float3 push = float3.zero;
            int2 c = new((int)math.floor(e.Position.x / CellSize), (int)math.floor(e.Position.z / CellSize));
            for (int dx = -1; dx <= 1; dx++)
            for (int dz = -1; dz <= 1; dz++)
            {
                int key = (int)math.hash(c + new int2(dx, dz));
                if (!Grid.TryGetFirstValue(key, out int j, out var it)) continue;
                do
                {
                    if (j == i) continue;
                    float3 away = e.Position - Enemies[j].Position; away.y = 0;
                    float d = math.length(away), r = Radius[e.Kind] + Radius[Enemies[j].Kind];
                    if (d > 0.0001f && d < r) push += away / d * (r - d);
                } while (Grid.TryGetNextValue(out j, ref it));
            }

            e.Velocity = desired + push * 4f;
            e.Position += e.Velocity * Dt;
            Enemies[i] = e;
        }
    }
}
```

Reading neighbours' positions while other threads write their own entries is a deliberate, harmless race: separation tolerates slightly stale positions. For strict determinism, double-buffer the positions ([Double Buffer](../patterns/double-buffer)).

The culling loop runs on the main thread, for clarity. At larger counts, move it into a job that writes visible matrices into a `NativeList`, and render from that.

## Where the patterns meet: pitfalls

- **GameObjects for every enemy.** Even pooled, 1,000 GameObjects with Animators and colliders cost more than this entire system. Keep gameplay enemies as data, and use GameObjects only for special cases (bosses, elites).
- **Forgetting to complete jobs.** Reading `enemies` while a job writes it throws in the editor and corrupts data in builds. Complete before reading, and complete in `OnDestroy` before disposing.
- **Per-instance variation breaking batches.** Setting `renderer.material.color` for a hit flash creates a material per enemy. Pass per-instance data (a hit-flash value) through instanced properties instead.
- **Swap-remove and references.** Projectiles or UI holding an enemy *index* break when a kill swaps another enemy into that slot. Use generation-tagged IDs if anything outside the horde refers to individual enemies.
- **Collision with the player and bullets.** Physics colliders for every enemy defeat the purpose. Use the same spatial hash for hit tests against the player and projectiles ([Bullet-Hell Projectiles](./bullet-hell-projectiles)).
- **Animation.** Skinned meshes cannot be instanced this simply. Use vertex-animation textures (baked animations sampled in the shader) to animate thousands of instances.

## Variations

- **Entities (DOTS):** the same design expressed with [ECS](../patterns/entity-component-system): `EnemyKind` as shared components, jobs as systems, and Entities Graphics for rendering.
- **Level of detail:** far enemies update every other frame and use a simpler mesh, a natural fit for per-kind LOD meshes.
- **Hit flash and death effects:** a per-instance float property for flash, and pooled particle bursts on death, batched through an [Event Queue](../patterns/event-queue).
- **Flow-field chasing:** with walls, replace "seek the player" with a shared [Flow Field](../patterns/flow-field) toward the player.
