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

## Example

Logic culling for many ambient creatures: animate and update only those that are visible, and switch them off completely when far away. Rendering is already culled by every engine; what this adds is culling the *work* attached to invisible objects. Confirm that work shows up in the profiler (Unity Profiler, Godot's profiler, Unreal Insights) before building it.

::: code-group

```csharp [Unity (C#)]
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

```gdscript [Godot (GDScript)]
# ambient_creature.gd: each creature has a VisibleOnScreenNotifier3D child sized to its bounds,
# which reports when it enters or leaves the camera view.
class_name AmbientCreature
extends Node3D

@onready var _notifier: VisibleOnScreenNotifier3D = $VisibleOnScreenNotifier3D
@onready var _anim: AnimationPlayer = $AnimationPlayer
@onready var _sound: AudioStreamPlayer3D = $Sound

var _band := 0  # set by the manager below


func _ready() -> void:
	_notifier.screen_entered.connect(_refresh)
	_notifier.screen_exited.connect(_refresh)
	_refresh()


func set_band(band: int) -> void:
	if band != _band:
		_band = band
		_refresh()


func _refresh() -> void:
	var on_screen := _notifier.is_on_screen()  # not "visible": that is a Node3D property
	set_physics_process(_band < 3)  # beyond the last band: no logic at all
	_anim.process_mode = PROCESS_MODE_INHERIT if on_screen and _band <= 1 else PROCESS_MODE_DISABLED
	_sound.stream_paused = _band != 0  # audible only up close


# creature_culling.gd: distance bands for every child creature, checked a few times per second.
extends Node3D

@export var bands := PackedFloat32Array([20.0, 60.0, 150.0])  # band 0: <20 m, 1: <60, 2: <150, 3: beyond
@export var check_interval := 0.25

var _until_check := 0.0


func _process(delta: float) -> void:
	_until_check -= delta
	if _until_check > 0.0:
		return
	_until_check = check_interval

	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	for child in get_children():
		var creature := child as AmbientCreature
		var d := cam.global_position.distance_to(creature.global_position)
		creature.set_band(bands.bsearch(d, false))  # index of the first band beyond d
```

```cpp [Unreal (C++)]
// The Significance Manager (enable the SignificanceManager plugin and add the module dependency)
// scores registered objects against the viewpoints you give it, and calls back when a score changes.

// AmbientCreature.cpp: Mesh is a USkeletalMeshComponent, Sound a UAudioComponent.
#include "AmbientCreature.h"
#include "SignificanceManager.h"
#include "Components/AudioComponent.h"
#include "Components/SkeletalMeshComponent.h"

AAmbientCreature::AAmbientCreature()
{
	// ...create Mesh and Sound...
	// "Animate only visible creatures" is built in: skip the pose when the mesh isn't rendered.
	Mesh->VisibilityBasedAnimTickOption = EVisibilityBasedAnimTickOption::OnlyTickPoseWhenRendered;
}

void AAmbientCreature::BeginPlay()
{
	Super::BeginPlay();
	USignificanceManager* Significance = FSignificanceManagerModule::Get(GetWorld());
	if (!Significance) return;

	Significance->RegisterObject(this, TEXT("AmbientCreature"),
		[](USignificanceManager::FManagedObjectInfo* Info, const FTransform& Viewpoint)
		{
			const AActor* Self = CastChecked<AActor>(Info->GetObject());
			const float D = FVector::Dist(Self->GetActorLocation(), Viewpoint.GetLocation());
			const int32 Band = D < 2000.f ? 0 : D < 6000.f ? 1 : D < 15000.f ? 2 : 3;
			return float(3 - Band);                         // higher means more significant
		},
		USignificanceManager::EPostSignificanceType::Sequential,
		[](USignificanceManager::FManagedObjectInfo* Info, float OldSignificance, float Significance, bool bFinal)
		{
			if (Significance != OldSignificance)
				CastChecked<AAmbientCreature>(Info->GetObject())->ApplyBand(3 - int32(Significance));
		});
}

void AAmbientCreature::EndPlay(const EEndPlayReason::Type Reason)
{
	if (USignificanceManager* Significance = FSignificanceManagerModule::Get(GetWorld()))
		Significance->UnregisterObject(this);
	Super::EndPlay(Reason);
}

void AAmbientCreature::ApplyBand(int32 Band)
{
	SetActorTickEnabled(Band < 3);                          // beyond the last band: no logic at all
	Mesh->SetComponentTickEnabled(Band <= 1);               // animate only fairly close creatures
	Sound->SetPaused(Band != 0);                            // audible only up close
}

// The game drives the update once per frame, e.g. from the player controller's Tick:
//   if (USignificanceManager* S = FSignificanceManagerModule::Get(GetWorld()))
//   {
//       const TArray<FTransform> Viewpoints = { FTransform(PlayerCameraManager->GetCameraRotation(),
//                                                          PlayerCameraManager->GetCameraLocation()) };
//       S->Update(Viewpoints);
//   }
```

:::

**Engine notes**

- **Unity:** `CullingGroup` does the visibility tests in the engine's native code, in bulk, and reports only *changes*. For static objects, never update the spheres at all. Occlusion culling for rendering is baked in the **Occlusion Culling** window; per-layer cull distances are set with `Camera.layerCullDistances`.
- **Godot:** `VisibleOnScreenEnabler3D` is a ready-made variant that disables a target node's processing while it's off screen. Rendering occlusion culling needs **Use Occlusion Culling** in the project settings plus baked `OccluderInstance3D` nodes; distance culling is the `visibility_range_end` of each `GeometryInstance3D`.
- **Unreal:** the Significance Manager is a plugin and does not update itself: the game calls `Update` with the viewpoints. For rendering, **Cull Distance Volumes** (and each primitive's `LDMaxDrawDistance`) remove small objects at a distance, and **precomputed visibility** bakes occlusion for static scenes; dynamic occlusion culling is on by default. `AActor::WasRecentlyRendered()` tells logic whether an actor was drawn in the last frames.

## When to use

- Levels with many objects, of which only a fraction is visible at once: open worlds, cities, forests, interiors with many rooms.
- Many gameplay objects that do expensive work only when the player can see or hear them: ambient life, particles, sound emitters, cosmetic physics.
- Mobile and VR, where every draw call and every millisecond counts.

## When not to use

- When Unity's built-in frustum and occlusion culling already covers it. Don't reimplement camera culling for renderers.
- Objects whose state must keep updating while unseen, such as networked or simulation-critical objects. Simplify them with [Level of Detail](./level-of-detail) instead of disabling them.
- Small levels where most things are always visible. Culling checks then cost more than they save.

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
