# Level of Detail

> Use cheaper meshes, logic or update rates for things far from the player.

**Also known as:** LOD, Simulation LOD · **Category:** Performance & Memory

## Problem

A character model has 40,000 triangles, a full skeleton with facial bones, cloth simulation, an AI that replans every frame, and footstep sounds. Up close, all of that detail matters. At 100 metres the character covers twenty pixels, its face is invisible, nobody hears its footsteps, and its AI could think once a second without anyone noticing. Rendering and simulating every character at full detail, regardless of distance, wastes most of the frame budget.

## Solution

Prepare **several levels of detail** for an object, and choose one based on how much it matters to the player, usually measured by distance or screen size:

| Aspect | LOD 0 (near) | LOD 1 | LOD 2 (far) | Culled |
| --- | --- | --- | --- | --- |
| **Mesh** | Full detail | Half the triangles | Simple shape, or a billboard (impostor) | Not drawn |
| **Animation** | Every frame, full skeleton | Fewer bones, lower rate | Simple loop, or none | None |
| **AI / logic** | Every frame | Every 4th frame | Every 30th frame, simplified | Statistical: just advance along the route |
| **Physics** | Full ragdoll, cloth | Simple capsule | Kinematic | None |
| **Audio** | All sounds | Main sounds only | None | None |

Rendering LOD is built into Unity (**LOD Group**). **Simulation LOD**, applying the same idea to scripts, AI and animation, is up to you, and is often the bigger win in games with many agents.

Use **hysteresis** between levels, so objects near a boundary do not switch back and forth every frame.

## Example

Simulation LOD: one component chooses a level from the distance to the camera, and the systems on the object adapt. Profile first (Unity Profiler, Godot's profiler, Unreal Insights) to find which systems on distant objects actually cost time; those are the ones worth degrading.

::: code-group

```csharp [Unity (C#)]
using System;
using UnityEngine;

public enum DetailLevel { High, Medium, Low, Dormant }

public class SimulationLod : MonoBehaviour
{
    // Distances at which detail drops; a level is left 10% further out than it is entered (hysteresis).
    [SerializeField] float mediumAt = 25f, lowAt = 60f, dormantAt = 150f;
    [SerializeField] float hysteresis = 1.1f;
    [SerializeField] float checkInterval = 0.5f;

    public DetailLevel Level { get; private set; } = DetailLevel.High;
    public event Action<DetailLevel> Changed;

    static Transform viewer;
    float nextCheck;

    void Start()
    {
        viewer ??= Camera.main.transform;
        nextCheck = Time.time + UnityEngine.Random.value * checkInterval;   // stagger checks
    }

    void Update()
    {
        if (Time.time < nextCheck) return;
        nextCheck = Time.time + checkInterval;

        float d = Vector3.Distance(transform.position, viewer.position);
        var next = LevelFor(d);
        if (next != Level) { Level = next; Changed?.Invoke(next); }
    }

    DetailLevel LevelFor(float d)
    {
        // Moving to a lower detail level needs the full distance; coming back needs to be 10% closer.
        float Threshold(float t, DetailLevel boundary) => Level >= boundary ? t / hysteresis : t;

        if (d >= Threshold(dormantAt, DetailLevel.Dormant)) return DetailLevel.Dormant;
        if (d >= Threshold(lowAt, DetailLevel.Low)) return DetailLevel.Low;
        if (d >= Threshold(mediumAt, DetailLevel.Medium)) return DetailLevel.Medium;
        return DetailLevel.High;
    }
}

// Systems react to the level instead of each measuring distance themselves.
[RequireComponent(typeof(SimulationLod))]
public class NpcLodController : MonoBehaviour
{
    [SerializeField] Animator animator;
    [SerializeField] AudioSource footsteps;
    [SerializeField] NpcBrain brain;                       // the AI, with a configurable think interval

    void Awake()
    {
        var lod = GetComponent<SimulationLod>();
        lod.Changed += Apply;
        Apply(lod.Level);
    }

    void Apply(DetailLevel level)
    {
        animator.enabled = level <= DetailLevel.Low;
        animator.cullingMode = level == DetailLevel.High
            ? AnimatorCullingMode.AlwaysAnimate : AnimatorCullingMode.CullUpdateTransforms;
        footsteps.enabled = level == DetailLevel.High;

        brain.ThinkInterval = level switch
        {
            DetailLevel.High => 0f,                       // every frame
            DetailLevel.Medium => 0.1f,
            DetailLevel.Low => 0.5f,
            _ => 2f,                                      // dormant: barely thinks, just follows its schedule
        };
    }
}
```

```gdscript [Godot (GDScript)]
# simulation_lod.gd: a child node of the NPC.
class_name SimulationLod
extends Node3D

signal changed(level: Level)

enum Level { HIGH, MEDIUM, LOW, DORMANT }

# Distances at which detail drops; a level is left 10% further out than it is entered (hysteresis).
@export var medium_at := 25.0
@export var low_at := 60.0
@export var dormant_at := 150.0
@export var hysteresis := 1.1
@export var check_interval := 0.5

var level := Level.HIGH
var _until_check := 0.0


func _ready() -> void:
	_until_check = randf() * check_interval  # stagger checks


func _process(delta: float) -> void:
	_until_check -= delta
	if _until_check > 0.0:
		return
	_until_check = check_interval

	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	var next := _level_for(global_position.distance_to(cam.global_position))
	if next != level:
		level = next
		changed.emit(next)


func _level_for(d: float) -> Level:
	if d >= _threshold(dormant_at, Level.DORMANT):
		return Level.DORMANT
	if d >= _threshold(low_at, Level.LOW):
		return Level.LOW
	if d >= _threshold(medium_at, Level.MEDIUM):
		return Level.MEDIUM
	return Level.HIGH


# Moving to a lower detail level needs the full distance; coming back needs to be 10% closer.
func _threshold(t: float, boundary: Level) -> float:
	return t / hysteresis if level >= boundary else t


# npc_lod_controller.gd: systems react to the level instead of each measuring distance themselves.
extends Node

@export var lod: SimulationLod
@export var anim: AnimationPlayer
@export var footsteps: AudioStreamPlayer3D
@export var brain: NpcBrain  # the AI, with a configurable think interval


func _ready() -> void:
	lod.changed.connect(_apply)
	_apply(lod.level)


func _apply(level: SimulationLod.Level) -> void:
	anim.process_mode = PROCESS_MODE_INHERIT if level <= SimulationLod.Level.LOW else PROCESS_MODE_DISABLED
	footsteps.stream_paused = level != SimulationLod.Level.HIGH

	match level:
		SimulationLod.Level.HIGH:
			brain.think_interval = 0.0  # every frame
		SimulationLod.Level.MEDIUM:
			brain.think_interval = 0.1
		SimulationLod.Level.LOW:
			brain.think_interval = 0.5
		_:
			brain.think_interval = 2.0  # dormant: barely thinks, just follows its schedule
```

```cpp [Unreal (C++)]
// SimulationLodComponent.h
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "SimulationLodComponent.generated.h"

UENUM(BlueprintType)
enum class EDetailLevel : uint8 { High, Medium, Low, Dormant };

DECLARE_MULTICAST_DELEGATE_OneParam(FOnDetailLevelChanged, EDetailLevel);

UCLASS(ClassGroup = (Custom), meta = (BlueprintSpawnableComponent))
class USimulationLodComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	EDetailLevel GetLevel() const { return Level; }
	FOnDetailLevelChanged OnChanged;

protected:
	virtual void BeginPlay() override;

private:
	void Check();
	float Threshold(float Distance, EDetailLevel Boundary) const;

	// Distances in cm at which detail drops; a level is left 10% further out than it is entered.
	UPROPERTY(EditAnywhere) float MediumAt = 2500.f;
	UPROPERTY(EditAnywhere) float LowAt = 6000.f;
	UPROPERTY(EditAnywhere) float DormantAt = 15000.f;
	UPROPERTY(EditAnywhere) float Hysteresis = 1.1f;
	UPROPERTY(EditAnywhere) float CheckInterval = 0.5f;

	EDetailLevel Level = EDetailLevel::High;
	FTimerHandle CheckTimer;
};

// SimulationLodComponent.cpp
#include "SimulationLodComponent.h"
#include "Kismet/GameplayStatics.h"
#include "Camera/PlayerCameraManager.h"

void USimulationLodComponent::BeginPlay()
{
	Super::BeginPlay();
	// A timer instead of Tick; the random first delay staggers the checks.
	GetWorld()->GetTimerManager().SetTimer(CheckTimer, this, &USimulationLodComponent::Check,
		CheckInterval, /*bLoop*/ true, /*FirstDelay*/ FMath::FRand() * CheckInterval);
}

float USimulationLodComponent::Threshold(float Distance, EDetailLevel Boundary) const
{
	return Level >= Boundary ? Distance / Hysteresis : Distance;
}

void USimulationLodComponent::Check()
{
	const APlayerCameraManager* Camera = UGameplayStatics::GetPlayerCameraManager(this, 0);
	if (!Camera) return;
	const float D = FVector::Dist(GetOwner()->GetActorLocation(), Camera->GetCameraLocation());

	EDetailLevel Next = EDetailLevel::High;
	if (D >= Threshold(DormantAt, EDetailLevel::Dormant))     Next = EDetailLevel::Dormant;
	else if (D >= Threshold(LowAt, EDetailLevel::Low))        Next = EDetailLevel::Low;
	else if (D >= Threshold(MediumAt, EDetailLevel::Medium))  Next = EDetailLevel::Medium;

	if (Next != Level) { Level = Next; OnChanged.Broadcast(Next); }
}

// Npc.cpp: ANpc is an ACharacter with UPROPERTY members Lod (USimulationLodComponent) and
// Footsteps (UAudioComponent). Systems react to the level instead of each measuring distance.
#include "AIController.h"
#include "BrainComponent.h"
#include "Components/AudioComponent.h"

void ANpc::BeginPlay()
{
	Super::BeginPlay();
	Lod->OnChanged.AddUObject(this, &ANpc::ApplyDetail);
	ApplyDetail(Lod->GetLevel());
}

void ANpc::ApplyDetail(EDetailLevel Level)
{
	USkeletalMeshComponent* SkelMesh = GetMesh();
	SkelMesh->SetComponentTickEnabled(Level <= EDetailLevel::Low);
	SkelMesh->VisibilityBasedAnimTickOption = Level == EDetailLevel::High
		? EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones
		: EVisibilityBasedAnimTickOption::OnlyTickPoseWhenRendered;
	Footsteps->SetPaused(Level != EDetailLevel::High);   // UAudioComponent

	const float ThinkInterval =
		Level == EDetailLevel::High   ? 0.f :              // every frame
		Level == EDetailLevel::Medium ? 0.1f :
		Level == EDetailLevel::Low    ? 0.5f : 2.f;        // dormant: barely thinks
	if (AAIController* AI = Cast<AAIController>(GetController()))
		if (UBrainComponent* Brain = AI->GetBrainComponent())
			Brain->SetComponentTickInterval(ThinkInterval);
}
```

:::

Mesh LOD is an editor feature in all three engines rather than code. In Unity, add a **LOD Group** to the prefab and assign meshes per level, with **cross-fade** to hide the switch; Unity 6 can also generate mesh LODs for imported models. In Godot, imported meshes get LODs generated automatically, and **visibility ranges** on each `GeometryInstance3D` swap between hand-made levels. In Unreal, LODs are set per Static Mesh asset (with automatic reduction), **Nanite** removes the need for them on supported meshes, and **HLOD** merges whole groups of distant actors.

**Engine notes**

- **Unity:** `AnimatorCullingMode.CullUpdateTransforms` skips retargeting, IK and writing transforms while the renderers are off screen, but the state machine keeps advancing, so it is a cheap middle level before disabling the `Animator` entirely.
- **Godot:** visibility ranges (`visibility_range_begin`/`_end`, with a margin and a fade mode) are Godot 4.0+; setting `visibility_parent` builds an HLOD-style hierarchy, where children are hidden while the parent's range shows it. `GeometryInstance3D.lod_bias` tunes the automatic mesh LOD.
- **Unreal:** for many animated characters, the **Animation Budget Allocator** plugin and **Update Rate Optimizations** (`bEnableUpdateRateOptimizations` on skeletal meshes) throttle animation by significance. With World Partition, HLODs are generated from the editor's **Build** menu.

## When to use

- Many characters or objects at varied distances: open worlds, crowds, strategy games, racing games with many cars.
- When the profiler shows rendering, animation or AI cost growing with object count, while most objects are far away.

## When not to use

- Small scenes where everything is close to the camera.
- Before profiling. LOD meshes and simplified AI cost authoring time; add them where the Profiler shows a problem.
- Objects whose silhouettes matter at all distances, such as key landmarks. Visible popping can be worse than the cost.

## Pitfalls

- **Visible popping.** A sudden switch between meshes or behaviours is noticeable. Use cross-fade for meshes, choose transition distances where the change is too small to see, and use hysteresis.
- **Gameplay depending on detail.** If a low-LOD NPC skips the logic that triggers a quest event, the game behaves differently depending on where the player stands. Keep gameplay-relevant state updates at every level, and only reduce *how often* and *how precisely*.
- **Big `dt` at low update rates.** A brain that thinks every 2 seconds must handle 2 seconds of change at once: timers, positions, needs. Pass the real elapsed time (see [Time Slicing](./time-slicing)).
- **Distance from the wrong point.** In split-screen, or with a detached camera (photo mode), "distance to the camera" may be wrong. Use the minimum distance to all relevant viewers.
- **Authoring cost.** Hand-made LOD meshes take artist time. Use automatic generation where quality allows, and prioritise the models that appear most often.

## Related

- [Culling](./culling) — the final level: do nothing at all.
- [Time Slicing](./time-slicing) — the mechanism behind reduced update rates.
- [Flyweight](./flyweight) and [Batching](./batching) — the far, simple levels are ideal for instancing.
- [Interest Management](./interest-management) — the same idea for network updates: far entities update less often.
- [Utility AI](./utility-ai) and [Behavior Tree](./behavior-tree) — AI that can think at different rates.
