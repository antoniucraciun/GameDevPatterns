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

Every engine has built-in debug drawing. Godot draws in 2D with `draw_line` and friends in `_draw()`, and its *Debug* menu shows collision shapes and navigation; 3D needs `ImmediateMesh` or an add-on. Unreal's `DrawDebugLine`, `DrawDebugSphere` and friends work in the editor and development builds, and the **Visual Logger** records them per actor. Unity has three built-in levels, and you often add a fourth:

| Tool | Where it shows | Use for |
| --- | --- | --- |
| `Debug.DrawLine` / `DrawRay` | Scene view, and the Game view with Gizmos enabled. Editor only. | Quick one-off rays from gameplay code |
| `OnDrawGizmos` / `OnDrawGizmosSelected` + `Gizmos.*` | Scene view. Editor only. | Persistent visualisation per component: ranges, cones, waypoints |
| `UnityEditor.Handles` | Scene view. Editor only. | Labels, arcs, discs, editable handles |
| **Your own runtime debug draw** | Game view, **in development builds on device** | Debugging on phones and consoles, or shown to QA |

## Example

Editor-time visualisation of a component's settings, drawn only when selected (or, in Godot, only in the editor) so the scene does not become noise:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

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

```gdscript [Godot (GDScript)]
# vision_cone.gd: draws its cone in the editor only. (For selection-only gizmos with handles,
# write an EditorNode3DGizmoPlugin in an editor plugin.)
@tool
extends Node3D

@export var vision_range := 15.0:
	set(value):
		vision_range = value
		_redraw()
@export_range(0, 180) var half_angle := 50.0:
	set(value):
		half_angle = value
		_redraw()

var _mesh := ImmediateMesh.new()
var _preview: MeshInstance3D


func _ready() -> void:
	if not Engine.is_editor_hint():
		return
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.albedo_color = Color(1.0, 0.9, 0.0, 0.15)
	_preview = MeshInstance3D.new()
	_preview.mesh = _mesh
	_preview.material_override = material
	add_child(_preview)  # no owner: never saved into the scene
	_redraw()


func _redraw() -> void:
	if _preview == null:
		return
	const SEGMENTS := 16
	_mesh.clear_surfaces()
	_mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in SEGMENTS:
		var a0 := deg_to_rad(lerpf(-half_angle, half_angle, float(i) / SEGMENTS))
		var a1 := deg_to_rad(lerpf(-half_angle, half_angle, float(i + 1) / SEGMENTS))
		_mesh.surface_add_vertex(Vector3.ZERO)
		_mesh.surface_add_vertex(Vector3(sin(a0), 0.0, -cos(a0)) * vision_range)  # forward is -Z
		_mesh.surface_add_vertex(Vector3(sin(a1), 0.0, -cos(a1)) * vision_range)
	_mesh.surface_end()
```

```cpp [Unreal (C++)]
// VisionConeVisualizer.h, in an editor module: a component visualizer draws when the component's
// actor is selected. Register it in the module's StartupModule():
//   GUnrealEd->RegisterComponentVisualizer(UVisionConeComponent::StaticClass()->GetFName(),
//                                          MakeShared<FVisionConeVisualizer>());
#pragma once

#include "ComponentVisualizer.h"
#include "VisionConeComponent.h"                          // UPROPERTYs Range (cm) and HalfAngle (degrees)

class FVisionConeVisualizer : public FComponentVisualizer
{
public:
	virtual void DrawVisualization(const UActorComponent* Component, const FSceneView* View, FPrimitiveDrawInterface* PDI) override
	{
		const UVisionConeComponent* Cone = Cast<UVisionConeComponent>(Component);
		if (!Cone) return;

		const FVector Origin = Cone->GetComponentLocation();
		const FVector Forward = Cone->GetForwardVector();
		const FLinearColor Color(1.f, 0.9f, 0.f);
		constexpr int32 Segments = 16;

		FVector Previous = Origin;
		for (int32 i = 0; i <= Segments; ++i)
		{
			const float Angle = FMath::Lerp(-Cone->HalfAngle, Cone->HalfAngle, float(i) / Segments);
			const FVector Edge = Origin + Forward.RotateAngleAxis(Angle, FVector::UpVector) * Cone->Range;
			PDI->DrawLine(Previous, Edge, Color, SDPG_World);
			Previous = Edge;
		}
		PDI->DrawLine(Previous, Origin, Color, SDPG_World);
	}
};
```

:::

A runtime debug draw that works in development builds. Unity and Godot need a small one; Unreal's is built in:

::: code-group

```csharp [Unity (C#)]
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

```gdscript [Godot (GDScript)]
# debug_draw.gd: autoload named DebugDraw. World-space lines on top of geometry, debug builds only.
#   DebugDraw.line(eye, hit_point, Color.RED, 1.0)
#   DebugDraw.sphere(last_known_position, 0.4, Color.YELLOW)
extends Node

var _lines := []  # {a, b, color, until}
var _mesh := ImmediateMesh.new()


func _ready() -> void:
	if not OS.is_debug_build():
		set_process(false)
		return
	process_mode = Node.PROCESS_MODE_ALWAYS  # keep drawing while paused
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.vertex_color_use_as_albedo = true
	material.no_depth_test = true  # draw on top of geometry
	var instance := MeshInstance3D.new()
	instance.mesh = _mesh
	instance.material_override = material
	instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(instance)


func line(a: Vector3, b: Vector3, color := Color.RED, duration := 0.0) -> void:
	if OS.is_debug_build():
		_lines.append({a = a, b = b, color = color, until = _now() + duration})


func sphere(centre: Vector3, radius: float, color := Color.RED, duration := 0.0) -> void:
	const SEGMENTS := 24
	for axis in 3:
		for i in SEGMENTS:
			var a0 := TAU * i / SEGMENTS
			var a1 := TAU * (i + 1) / SEGMENTS
			line(centre + _circle(axis, a0) * radius, centre + _circle(axis, a1) * radius, color, duration)


func _circle(axis: int, a: float) -> Vector3:
	match axis:
		0:
			return Vector3(cos(a), sin(a), 0.0)
		1:
			return Vector3(cos(a), 0.0, sin(a))
	return Vector3(0.0, cos(a), sin(a))


func _process(_delta: float) -> void:
	_mesh.clear_surfaces()
	if _lines.is_empty():
		return  # surface_end() with no vertices is an error
	_mesh.surface_begin(Mesh.PRIMITIVE_LINES)
	for l: Dictionary in _lines:
		_mesh.surface_set_color(l.color)
		_mesh.surface_add_vertex(l.a)
		_mesh.surface_add_vertex(l.b)
	_mesh.surface_end()
	var now := _now()
	_lines = _lines.filter(func(l: Dictionary) -> bool: return l.until >= now)  # one-frame lines go after one draw


func _now() -> float:
	return Time.get_ticks_msec() / 1000.0  # real time: unaffected by time scale and pause
```

```cpp [Unreal (C++)]
// Built in: DrawDebugHelpers.h. The calls compile to nothing in Shipping builds (ENABLE_DRAW_DEBUG is 0).
// Guard.cpp (AGuard is an ACharacter with an FVector LastKnownPosition member)
#include "Guard.h"
#include "DrawDebugHelpers.h"
#include "VisualLogger/VisualLogger.h"

void AGuard::LookForPlayer(const FVector& Target)
{
	const FVector Eye = GetPawnViewLocation();
	FHitResult Hit;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(GuardSight), false, this);
	if (GetWorld()->LineTraceSingleByChannel(Hit, Eye, Target, ECC_Visibility, Params))
		DrawDebugLine(GetWorld(), Eye, Hit.ImpactPoint, FColor::Red, false, 1.f);   // stays for 1 s
	DrawDebugSphere(GetWorld(), LastKnownPosition, 40.f, 12, FColor::Yellow);       // one frame

	// Visual Logger: the same shapes, recorded per actor on a timeline you can scrub after the fact.
	UE_VLOG_SEGMENT(this, LogTemp, Log, Eye, Target, FColor::Red, TEXT("sight ray"));
	UE_VLOG_LOCATION(this, LogTemp, Log, LastKnownPosition, 40.f, FColor::Yellow, TEXT("last known"));
}
```

:::

**Engine notes**

- **Unity:** Gizmos and `Handles` are editor-only. `Debug.DrawLine` / `Debug.DrawRay` draw in the Scene view (and the Game view with Gizmos on) but never in builds, which is why the runtime version above exists. With several cameras, one-frame lines are drawn by the first camera and then removed. Expire lines once per frame (for example from a `LateUpdate` hook) if every camera must show them.
- **Godot:** There is no built-in 3D debug draw API for scripts; `ImmediateMesh` as above is the usual approach, and add-ons such as *Debug Draw 3D* offer a fuller one. In 2D, any `CanvasItem` can draw with `draw_line` / `draw_circle` in `_draw()` (call `queue_redraw()` each frame). The *Debug* menu's *Visible Collision Shapes* and *Visible Navigation* cover physics and navigation.
- **Unreal:** `DrawDebugLine`, `DrawDebugSphere`, `DrawDebugBox`, `DrawDebugString` and friends work in the editor and development builds, from game code or Blueprints. The **Visual Logger** records shapes and log lines per actor so you can inspect a bug after it happened, and the **Gameplay Debugger** (the apostrophe key) shows AI and perception state in game. Component visualizers live in an editor module that depends on `UnrealEd`.

## When to use

- Any spatial logic: AI perception, pathfinding, steering, spawn selection, physics queries, aiming, camera rigs.
- QA builds on device, together with a [Debug Console](./debug-console) to toggle categories.

## When not to use

- Logic that isn't spatial. Use logs or a stats overlay.
- Leaving draws on in production. Strip them out or put them behind a flag; they cost time and confuse players.

## Pitfalls

- **Debug code in release builds.** String formatting and draw calls cost time even when nothing is shown. `[Conditional]` removes the calls and their arguments entirely. `#if` around implementations alone does not.
- **Noise.** Every system drawing everything makes the view unreadable. Draw only for selected objects, or put categories behind toggles ("ai", "nav", "physics").
- **Wrong lifetime.** Lines drawn from fixed-step code (Unity's `FixedUpdate`, Godot's `_physics_process`) with zero duration flicker, because they appear on some rendered frames and not others. Use a duration of about one physics step for fixed-step code.
- **Depth.** Lines hidden inside geometry are useless. Draw on top (`ZTest Always`), or use two passes with dimmed occluded lines.
- **Allocation.** Debug draws in hot loops can allocate (closures, strings). Keep them out of shipping code paths with `[Conditional]`.

## Related

- [Debug Console & Cheats](./debug-console) — toggles for debug views.
- [Perception System](./perception-system), [Steering Behaviors](./steering-behaviors) and [A* Pathfinding](./a-star) — typical things to visualise.
- [Spatial Partition](./spatial-partition) — drawing the grid makes cell-size problems obvious.
- [Immediate-Mode GUI](./immediate-mode-gui) — the same immediate-mode idea applied to UI.
