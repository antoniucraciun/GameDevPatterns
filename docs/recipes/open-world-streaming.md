# Open-World Streaming

> A large world streamed around the player in cells, within a memory budget and without hitches.

## Goal

The streaming backbone of an open world:

- The world is split into **cells** (for example, 256 m squares), each its own scene and content.
- Cells **near the player** are fully loaded. Cells **further away** show only a cheap **proxy** (low-detail terrain and silhouettes), and everything beyond is unloaded.
- Loading **never hitches**: at most one heavy operation at a time, prioritised by what the player will see first.
- Memory stays **within a budget**, with nothing leaking as the player travels.
- Fast travel or a vehicle at full speed degrades gracefully, never into falling through unloaded ground.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Spatial Partition](../patterns/spatial-partition) | The world grid: which cell the player is in, and which cells are within each radius. |
| [Scene / Level Management](../patterns/scene-management) | Each cell is an additive scene, loaded and unloaded asynchronously. |
| [Asset References & Addressing](../patterns/asset-reference) | Cell scenes and proxies loaded by address, and released properly to free memory. |
| [Level of Detail](../patterns/level-of-detail) | Distance bands per cell: *Full* (gameplay), *Proxy* (visual only), *Unloaded*. |
| [Time Slicing](../patterns/time-slicing) | A prioritised load queue: one operation in flight, closest and most visible first. |
| [Culling](../patterns/culling) | Within loaded cells, distant logic and effects are switched off. |

## How they fit together

```
player position ──► grid cell (Spatial Partition)
                         │
     per cell: distance band with hysteresis (LOD)
       ≤ 1 cell  → Full   (gameplay scene + proxy hidden)
       ≤ 3 cells → Proxy  (low-detail scene only)
       else      → Unloaded
                         │ desired state differs from current?
                         ▼
     request queue, priority = distance − bonus for cells ahead of the player's movement
                         │  (Time Slicing: one operation in flight at a time)
                         ▼
     Addressables.LoadSceneAsync / UnloadSceneAsync (Asset References + Scene Management)
                         │
     inside Full cells: CullingGroups switch far NPCs, particles and audio off (Culling)
```

The joins:

- **Spatial Partition ↔ Level of Detail.** The grid turns a position into a cell, and cell distance picks a band. Bands use **hysteresis**: a cell enters *Full* at distance 1, but only leaves it beyond distance 2, so walking along a cell border does not reload anything.
- **LOD ↔ Time Slicing.** Bands produce *desired* states, and the queue decides *when* to act. Upgrading the cell the player is about to enter beats downgrading a cell behind them. Unloads can wait. Loads cannot.
- **Asset References ↔ Scene Management.** Each cell is an addressable scene with its own handle. Releasing the handle on unload is what actually frees its textures and meshes. Losing a handle means leaking a whole cell.
- **Culling ↔ Full cells.** A cell can be loaded and still mostly asleep. Loading decides what *exists*, and culling decides what *runs*.

## Example (Unity C#)

This uses **Addressables** scene loading. Each cell has two addressable scenes: `Cell_x_y` (full gameplay) and `Cell_x_y_Proxy` (visual only).

```csharp
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;
using UnityEngine.ResourceManagement.ResourceProviders;
using UnityEngine.SceneManagement;

public enum CellLevel { Unloaded, Proxy, Full }

public class WorldStreamer : MonoBehaviour
{
    [SerializeField] Transform player;
    [SerializeField] Rigidbody playerBody;                // for movement direction
    [SerializeField] float cellSize = 256f;
    [SerializeField] int gridSize = 32;                   // 32 × 32 cells
    [SerializeField] int fullRadius = 1, proxyRadius = 3; // in cells (Chebyshev distance)

    class Cell
    {
        public Vector2Int Coord;
        public CellLevel Current, Desired;
        public AsyncOperationHandle<SceneInstance>? Full, Proxy;
    }

    readonly Dictionary<Vector2Int, Cell> cells = new();
    readonly List<Cell> queue = new();
    bool busy;                                             // Time Slicing: one operation at a time

    Vector2Int CellOf(Vector3 p) => new(Mathf.FloorToInt(p.x / cellSize), Mathf.FloorToInt(p.z / cellSize));

    void Update()
    {
        var center = CellOf(player.position);
        UpdateDesiredLevels(center);
        if (!busy) StartNext(center);
    }

    // ── LOD bands with hysteresis ──
    void UpdateDesiredLevels(Vector2Int center)
    {
        int reach = proxyRadius + 1;
        for (int x = center.x - reach; x <= center.x + reach; x++)
        for (int y = center.y - reach; y <= center.y + reach; y++)
        {
            var c = new Vector2Int(x, y);
            if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) continue;
            if (!cells.TryGetValue(c, out var cell)) cells[c] = cell = new Cell { Coord = c };
        }

        foreach (var cell in cells.Values)
        {
            int d = Mathf.Max(Mathf.Abs(cell.Coord.x - center.x), Mathf.Abs(cell.Coord.y - center.y));
            // Enter a band at its radius; leave it only one cell further out.
            int fullLimit = cell.Current == CellLevel.Full ? fullRadius + 1 : fullRadius;
            int proxyLimit = cell.Current >= CellLevel.Proxy ? proxyRadius + 1 : proxyRadius;
            cell.Desired = d <= fullLimit ? CellLevel.Full : d <= proxyLimit ? CellLevel.Proxy : CellLevel.Unloaded;
        }
    }

    // ── Time-sliced, prioritised work ──
    void StartNext(Vector2Int center)
    {
        queue.Clear();
        foreach (var c in cells.Values) if (c.Current != c.Desired) queue.Add(c);
        if (queue.Count == 0) return;

        Vector3 heading = playerBody ? playerBody.linearVelocity : Vector3.zero;
        queue.Sort((a, b) => Priority(a, center, heading).CompareTo(Priority(b, center, heading)));
        _ = Apply(queue[0]);
    }

    // Lower = sooner. Upgrades before downgrades; near before far; ahead of the player before behind.
    float Priority(Cell c, Vector2Int center, Vector3 heading)
    {
        bool upgrade = c.Desired > c.Current;
        Vector2 toCell = c.Coord - center;
        float ahead = heading.sqrMagnitude > 1f ? Vector2.Dot(toCell.normalized, new Vector2(heading.x, heading.z).normalized) : 0f;
        return (upgrade ? 0f : 1000f) + toCell.magnitude - ahead * 0.75f;
    }

    async Awaitable Apply(Cell c)
    {
        busy = true;
        try
        {
            if (c.Desired >= CellLevel.Proxy && c.Proxy == null)
                c.Proxy = await LoadScene($"Cell_{c.Coord.x}_{c.Coord.y}_Proxy");

            if (c.Desired == CellLevel.Full && c.Full == null)
                c.Full = await LoadScene($"Cell_{c.Coord.x}_{c.Coord.y}");
            else if (c.Desired < CellLevel.Full && c.Full != null)
            {
                await Addressables.UnloadSceneAsync(c.Full.Value).Task;      // releases its assets too
                c.Full = null;
            }

            if (c.Desired == CellLevel.Unloaded && c.Proxy != null)
            {
                await Addressables.UnloadSceneAsync(c.Proxy.Value).Task;
                c.Proxy = null;
            }

            SetProxyVisible(c, c.Desired == CellLevel.Proxy);                 // full detail hides its proxy
            c.Current = c.Desired;
        }
        finally { busy = false; }
    }

    static async Awaitable<AsyncOperationHandle<SceneInstance>> LoadScene(string address)
    {
        var handle = Addressables.LoadSceneAsync(address, LoadSceneMode.Additive);
        await handle.Task;
        return handle;
    }

    void SetProxyVisible(Cell c, bool visible)
    {
        if (c.Proxy is { } h && h.Status == AsyncOperationStatus.Succeeded)
            foreach (var root in h.Result.Scene.GetRootGameObjects()) root.SetActive(visible);
    }
}
```

`c.Desired` can change while an operation is in flight. That is fine: the cell is simply picked again on the next free frame, with its new target.

A safety net for fast movement: if the player's cell is not yet *Full*, keep the player's physics frozen (or slow the vehicle) until it is. Never let them fall through ground that does not exist yet.

## Where the patterns meet: pitfalls

- **Hitches from scene activation.** Async loading spreads the *loading* over frames, but activating a scene runs every `Awake` and `Start` at once. Keep cell content light at startup, use streaming-friendly components, and profile activation frames.
- **Thrashing at borders.** Without hysteresis, a player walking along a cell edge triggers repeated load/unload. Use different enter and leave distances, as above.
- **Leaked handles.** A cell that loads, gets unloaded "manually" with `SceneManager.UnloadSceneAsync`, and loses its Addressables handle keeps its assets in memory. Always unload through the same API and handle that loaded it.
- **Cross-cell references.** A quest NPC in cell A that references a door in cell B breaks when B is unloaded. Reference things across cells by ID, and resolve them through a registry when both are loaded.
- **State of unloaded cells.** Chests opened in a cell must stay open when it reloads. Capture cell state before unloading, and restore it after loading (see the world-state cache in [Save & Load](./save-and-load)).
- **Floating-point precision.** Far from the origin (beyond about 5–10 km), float positions jitter. Shift the world origin around the player periodically (floating origin) in very large worlds.

## Variations

- **Vertical streaming:** dungeons and building interiors as separate cells, loaded when the player approaches an entrance.
- **Predictive loading:** use the navigation path or vehicle velocity to request cells several seconds ahead.
- **Server-side streaming:** in multiplayer, combine with [Interest Management](../patterns/interest-management), since the server decides which entities each client needs.
- **Imposters for very far distances:** a single low-poly mesh of the whole world as the last "LOD", always loaded.
