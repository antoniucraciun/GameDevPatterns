# Debug Draw

> Immediate-mode lines, shapes and labels to visualise invisible state.

**Also known as:** Gizmos · **Category:** Tooling, Debugging & Testing

## Problem

The AI "can't see" the player, but why? Is the vision cone pointing the wrong way, is the raycast hitting a fence, or is the range too short? The spawn system picks odd positions, and the steering forces fight each other. All of this is *invisible state*: vectors, ranges, paths, decisions. Logging numbers to the console is slow to read and loses the spatial relationships that matter.

## Solution

Provide a **one-line API to draw shapes into the world** from anywhere in gameplay code, for one frame or for a duration:

```
DebugDraw.Line(eye, hit.point, Color.red, 2f);
DebugDraw.Sphere(target, 0.5f, Color.yellow);
DebugDraw.Text(transform.position + Vector3.up * 2, state.Name);
```

It is **immediate mode**: the call queues a shape, the shape renders, and it expires after its duration. There is no object to create, manage or destroy.

Unity has three built-in levels, and you often add a fourth:

| Tool | Where it shows | Use for |
| --- | --- | --- |
| `Debug.DrawLine` / `DrawRay` | Scene view, and the Game view with Gizmos enabled. Editor only. | Quick one-off rays from gameplay code |
| `OnDrawGizmos` / `OnDrawGizmosSelected` + `Gizmos.*` | Scene view. Editor only. | Persistent visualisation per component: ranges, cones, waypoints |
| `UnityEditor.Handles` | Scene view. Editor only. | Labels, arcs, discs, editable handles |
| **Your own runtime debug draw** | Game view, **in development builds on device** | Debugging on phones and consoles, or shown to QA |

## Example (Unity C#)

Component visualisation with gizmos, drawn only when selected so the scene does not become noise:

```csharp
public class VisionCone : MonoBehaviour
{
    public float range = 15f;
    [Range(0, 180)] public float halfAngle = 50f;

#if UNITY_EDITOR
    void OnDrawGizmosSelected()
    {
        UnityEditor.Handles.color = new Color(1f, 0.9f, 0f, 0.15f);
        Vector3 from = Quaternion.Euler(0f, -halfAngle, 0f) * transform.forward;
        UnityEditor.Handles.DrawSolidArc(transform.position, Vector3.up, from, halfAngle * 2f, range);
        UnityEditor.Handles.Label(transform.position + Vector3.up * 2f, $"range {range}  fov {halfAngle * 2f}°");
    }
#endif
}
```

A runtime debug draw that works in development builds, rendered with `GL` after each camera:

```csharp
using System.Collections.Generic;
using System.Diagnostics;
using UnityEngine;
using UnityEngine.Rendering;

public static class DebugDraw
{
    struct Segment { public Vector3 A, B; public Color Color; public float Until; }

    static readonly List<Segment> lines = new();
    static Material material;

    // [Conditional] removes every call site from release builds: no cost, no strings, no allocations.
    [Conditional("UNITY_EDITOR"), Conditional("DEVELOPMENT_BUILD")]
    public static void Line(Vector3 a, Vector3 b, Color color, float duration = 0f) =>
        lines.Add(new Segment { A = a, B = b, Color = color, Until = Time.unscaledTime + duration });

    [Conditional("UNITY_EDITOR"), Conditional("DEVELOPMENT_BUILD")]
    public static void Sphere(Vector3 c, float r, Color color, float duration = 0f)
    {
        const int segments = 24;
        for (int axis = 0; axis < 3; axis++)
            for (int i = 0; i < segments; i++)
            {
                float a0 = i * Mathf.PI * 2f / segments, a1 = (i + 1) * Mathf.PI * 2f / segments;
                Line(c + Circle(axis, a0) * r, c + Circle(axis, a1) * r, color, duration);
            }
    }

    static Vector3 Circle(int axis, float a) => axis switch
    {
        0 => new Vector3(Mathf.Cos(a), Mathf.Sin(a), 0f),
        1 => new Vector3(Mathf.Cos(a), 0f, Mathf.Sin(a)),
        _ => new Vector3(0f, Mathf.Cos(a), Mathf.Sin(a)),
    };

#if UNITY_EDITOR || DEVELOPMENT_BUILD
    [RuntimeInitializeOnLoadMethod]
    static void Init()
    {
        material = new Material(Shader.Find("Hidden/Internal-Colored")) { hideFlags = HideFlags.HideAndDontSave };
        material.SetInt("_ZTest", (int)CompareFunction.Always);     // draw on top of geometry
        RenderPipelineManager.endCameraRendering += (_, cam) => Render(cam);   // URP / HDRP
        Camera.onPostRender += Render;                                        // Built-in pipeline
    }

    static void Render(Camera cam)
    {
        if (lines.Count == 0 || cam.cameraType == CameraType.Preview) return;
        material.SetPass(0);
        GL.PushMatrix();
        GL.MultMatrix(Matrix4x4.identity);
        GL.Begin(GL.LINES);
        foreach (var l in lines) { GL.Color(l.Color); GL.Vertex(l.A); GL.Vertex(l.B); }
        GL.End();
        GL.PopMatrix();

        float now = Time.unscaledTime;
        lines.RemoveAll(l => l.Until < now);   // one-frame lines (duration 0) expire after drawing once
    }
#endif
}

// Anywhere:
// if (Physics.Raycast(eye, dir, out var hit, range)) DebugDraw.Line(eye, hit.point, Color.red, 1f);
// DebugDraw.Sphere(lastKnownPosition, 0.4f, Color.yellow);
```

With several cameras, one-frame lines are drawn by the first camera and then removed. Expire lines once per frame (for example from a `LateUpdate` hook) if every camera must show them.

## When to use

- Any spatial logic: AI perception, pathfinding, steering, spawn selection, physics queries, aiming, camera rigs.
- QA builds on device, together with a [Debug Console](./debug-console) to toggle categories.

## When not to use

- Logic that isn't spatial. Use logs or a stats overlay.
- Leaving draws on in production. Strip them out or put them behind a flag; they cost time and confuse players.

## Pitfalls

- **Debug code in release builds.** String formatting and draw calls cost time even when nothing is shown. `[Conditional]` removes the calls and their arguments entirely. `#if` around implementations alone does not.
- **Noise.** Every system drawing everything makes the view unreadable. Draw only for selected objects, or put categories behind toggles ("ai", "nav", "physics").
- **Wrong lifetime.** Lines drawn from `FixedUpdate` with zero duration flicker, because they appear on some rendered frames and not others. Use a duration of about one physics step for fixed-step code.
- **Depth.** Lines hidden inside geometry are useless. Draw on top (`ZTest Always`), or use two passes with dimmed occluded lines.
- **Allocation.** Debug draws in hot loops can allocate (closures, strings). Keep them out of shipping code paths with `[Conditional]`.

## Related

- [Debug Console & Cheats](./debug-console) — toggles for debug views.
- [Perception System](./perception-system), [Steering Behaviors](./steering-behaviors) and [A* Pathfinding](./a-star) — typical things to visualise.
- [Spatial Partition](./spatial-partition) — drawing the grid makes cell-size problems obvious.
- [Immediate-Mode GUI](./immediate-mode-gui) — the same immediate-mode idea applied to UI.
