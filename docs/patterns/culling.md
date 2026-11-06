# Culling

> Skip rendering or simulating objects that cannot be seen or do not matter.

**Category:** Performance & Memory

## Problem

An open level has 5,000 objects, and the camera sees perhaps 300 of them. Without culling, the engine still processes the rest: draw calls for objects behind the camera, animation for characters inside closed buildings, particle systems in rooms nobody is in, AI for enemies a kilometre away. The cheapest work is work that is never done.

## Solution

Find out early, and cheaply, what does **not** need processing, and skip it. Several kinds of culling exist, from the engine level to your own gameplay code:

| Kind | Skips | In Unity |
| --- | --- | --- |
| **Frustum culling** | Objects outside the camera's view volume | Automatic for renderers |
| **Occlusion culling** | Objects hidden behind other objects (walls, buildings) | Baked occlusion data (Window → Rendering → Occlusion Culling), or GPU occlusion in Unity 6 |
| **Distance culling** | Small objects beyond a distance (grass, debris, small props) | Per-layer cull distances (`Camera.layerCullDistances`), LOD Group "culled" level |
| **Animation culling** | Animating characters nobody can see | `Animator.cullingMode = CullUpdateTransforms` or `CullCompletely` |
| **Logic culling** | Gameplay scripts for off-screen or far objects (AI, particles, audio) | `CullingGroup` API, or your own checks |

Engine culling handles rendering automatically. **Logic culling** is up to you, and is often where the big wins are. Unity's **`CullingGroup`** API efficiently tells you, for thousands of bounding spheres, which are visible and which distance band each is in, and **notifies you when that changes**, so you do not have to poll.

## Example (Unity C#)

Logic culling for many ambient creatures with `CullingGroup`: animate and update only those that are visible, and switch them off completely when far away.

```csharp
using UnityEngine;

public class AmbientCreatureCulling : MonoBehaviour
{
    [SerializeField] Camera cam;
    [SerializeField] AmbientCreature[] creatures;       // e.g. 2,000 birds, fish, insects
    [SerializeField] float[] distanceBands = { 20f, 60f, 150f };   // band 0: <20 m, 1: <60, 2: <150, 3: beyond

    CullingGroup group;
    BoundingSphere[] spheres;

    void Start()
    {
        spheres = new BoundingSphere[creatures.Length];
        for (int i = 0; i < creatures.Length; i++)
            spheres[i] = new BoundingSphere(creatures[i].transform.position, creatures[i].Radius);

        group = new CullingGroup { targetCamera = cam };
        group.SetBoundingSpheres(spheres);
        group.SetBoundingSphereCount(creatures.Length);
        group.SetBoundingDistances(distanceBands);
        group.SetDistanceReferencePoint(cam.transform);
        group.onStateChanged = OnStateChanged;           // called only when visibility or band changes
    }

    void OnStateChanged(CullingGroupEvent e)
    {
        var c = creatures[e.index];
        bool visible = e.isVisible;
        int band = e.currentDistance;                     // index into the bands, or bands.Length = beyond

        c.SetActiveLogic(band < distanceBands.Length);    // beyond the last band: no logic at all
        c.SetAnimating(visible && band <= 1);             // animate only visible, fairly close creatures
        c.SetSoundEnabled(band == 0);                     // audible only up close
    }

    void Update()
    {
        // Moving objects must update their spheres (in place, no allocation).
        for (int i = 0; i < creatures.Length; i++)
            spheres[i].position = creatures[i].transform.position;
    }

    void OnDestroy()
    {
        group?.Dispose();
        group = null;
    }
}

// AmbientCreature: SetActiveLogic toggles its script's update, SetAnimating sets animator.enabled,
// SetSoundEnabled toggles its AudioSource. Radius is its bounding radius.
```

`CullingGroup` does the visibility tests in the engine's native code, in bulk, and reports only *changes*. For static objects, never update the spheres at all.

## When to use

- Levels with many objects, of which only a fraction is visible at once: open worlds, cities, forests, interiors with many rooms.
- Many gameplay objects that do expensive work only when the player can see or hear them: ambient life, particles, sound emitters, cosmetic physics.
- Mobile and VR, where every draw call and every millisecond counts.

## Pitfalls

- **Culling things that matter off-screen.** An enemy that stops moving when you turn around, or a timer that pauses when not visible, breaks gameplay. Cull *presentation* (animation, particles, audio) freely, and gameplay logic only when its effect is truly invisible, or replace it with a cheaper simulation (see [Level of Detail](./level-of-detail)).
- **Popping.** Objects that appear and disappear at a hard distance are noticeable. Use fade-out (LOD cross-fade) or cull only small objects at short distances.
- **Occlusion data out of date.** Baked occlusion assumes static geometry. Moving walls or procedurally built levels need runtime occlusion, or none.
- **Shadows from culled objects.** An object outside the view may still cast a shadow into it. Unity handles shadow casters separately, but custom culling of renderers can make shadows disappear.
- **Culling costs too.** Testing 10,000 objects every frame in C# can cost more than it saves. Use engine features (`CullingGroup`, layer cull distances) that test in native code and report changes.

## Related

- [Level of Detail](./level-of-detail) — instead of skipping, do something cheaper.
- [Spatial Partition](./spatial-partition) — finding what is near or visible without testing everything.
- [Interest Management](./interest-management) — the same idea applied to networking.
- [Batching](./batching) — large batches reduce draw calls, but weaken culling.
- [Time Slicing](./time-slicing) — update far objects less often instead of never.
