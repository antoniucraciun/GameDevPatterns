# Trigger Volume

> Regions in the level that fire events when entered, exited or occupied.

**Category:** Gameplay Systems

## Problem

The music should change when the player enters the cave. A trap should spring when anyone steps on the plate. A door should open while at least one player stands on the pressure pad, and close when the last one leaves. A cutscene should play the first time, and only the first time. Each of these is written as a one-off script with its own collider callbacks, its own tag checks and its own bugs. A character with several colliders triggers "enter" three times. Destroying an object inside the volume never triggers "exit", so the pad stays pressed forever.

## Solution

One reusable **trigger volume** component handles the mechanics, and designers wire up what happens:

- A trigger **collider** defines the region.
- A **filter** decides what counts: layers, tags, required components (`Player`, `IDamageable`), and optionally requirements such as a [Gameplay Tag](./tags).
- **Occupancy tracking** counts *objects*, not colliders. A character with three colliders counts once, and objects destroyed or disabled inside the volume are removed properly.
- **Events**: `OnFirstEnter` (empty → occupied), `OnLastExit` (occupied → empty), and per-object `OnEnter` / `OnExit`. Exposed as events designers can wire in the editor (`UnityEvent`s, Godot signals, Blueprint-assignable delegates) to connect doors, lights, music and cutscenes.
- **Modes**: fire once (cutscene), fire every time (music zone), or with a cooldown (trap).

## Pseudocode

```text
TriggerVolume:
    filter                  // layers, a required tag or group
    fire_once, cooldown
    occupants[object]       // colliders inside, per object
    fired ← false
    ready_at ← 0

    on collider entered(c):
        object ← the object c belongs to    // its rigidbody, actor or body
        if object fails the filter: return
        occupants[object] ← occupants[object] + 1
        if that count was already above 0: return   // a second collider of one object
        if fire_once and fired: return
        if now < ready_at: return                   // still cooling down
        announce entered(object)
        if object is the only occupant: announce first entered   // empty → occupied
        fired ← true
        ready_at ← now + cooldown

    on collider exited(c):
        object ← the object c belongs to
        if object is not an occupant: return
        occupants[object] ← occupants[object] - 1
        if it is still above 0: return      // other colliders still inside
        remove_occupant(object)

    regularly, if the engine sends no exit for removed objects:
        for each occupant destroyed or disabled inside: remove_occupant(it)

    remove_occupant(object):
        forget object
        announce exited(object)
        if there are no occupants left: announce last exited   // occupied → empty
```

## Example

One reusable volume with a filter, fire-once and cooldown options, and enter/exit plus occupied/empty events. Each occupant counts once, however many colliders it has.

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

[RequireComponent(typeof(Collider))]
public class TriggerVolume : MonoBehaviour
{
    [Header("Filter")]
    [SerializeField] LayerMask layers = ~0;
    [SerializeField] string requiredTag = "";                // e.g. "Player"; empty = any

    [Header("Behaviour")]
    [SerializeField] bool fireOnce;
    [SerializeField] float cooldown;

    [Header("Events")]
    public UnityEvent<GameObject> OnEnter, OnExit;
    public UnityEvent OnFirstEnter, OnLastExit;                // occupied / empty transitions

    // Count colliders per root object, so multi-collider characters count once.
    readonly Dictionary<GameObject, int> occupants = new();
    readonly List<GameObject> scratch = new();
    bool fired;
    float readyAt;

    public int Count => occupants.Count;
    public bool IsOccupied => occupants.Count > 0;

    void Reset() => GetComponent<Collider>().isTrigger = true;

    void OnTriggerEnter(Collider other)
    {
        var root = RootOf(other);
        if (!Accepts(root)) return;

        occupants.TryGetValue(root, out int colliders);
        occupants[root] = colliders + 1;
        if (colliders > 0) return;                          // another collider of an object already inside

        if (fireOnce && fired) return;
        if (Time.time < readyAt) return;

        bool wasEmpty = occupants.Count == 1;
        OnEnter.Invoke(root);
        if (wasEmpty) OnFirstEnter.Invoke();

        fired = true;
        readyAt = Time.time + cooldown;
    }

    void OnTriggerExit(Collider other)
    {
        var root = RootOf(other);
        if (!occupants.TryGetValue(root, out int colliders)) return;
        if (colliders > 1) { occupants[root] = colliders - 1; return; }
        RemoveOccupant(root);
    }

    // Objects destroyed or disabled inside the volume never send OnTriggerExit: clean up.
    void FixedUpdate()
    {
        if (occupants.Count == 0) return;
        scratch.Clear();
        foreach (var o in occupants.Keys)
            if (o == null || !o.activeInHierarchy) scratch.Add(o);
        foreach (var o in scratch) RemoveOccupant(o);
    }

    void RemoveOccupant(GameObject root)
    {
        occupants.Remove(root);
        if (root != null) OnExit.Invoke(root);
        if (occupants.Count == 0) OnLastExit.Invoke();
    }

    bool Accepts(GameObject root) =>
        (layers.value & (1 << root.layer)) != 0 &&
        (string.IsNullOrEmpty(requiredTag) || root.CompareTag(requiredTag));

    // The object that "is" the occupant: the rigidbody's object, or the collider's own.
    static GameObject RootOf(Collider c) => c.attachedRigidbody ? c.attachedRigidbody.gameObject : c.gameObject;

#if UNITY_EDITOR
    void OnDrawGizmos()
    {
        Gizmos.color = IsOccupied ? new Color(0f, 1f, 0f, 0.25f) : new Color(1f, 0.6f, 0f, 0.15f);
        Gizmos.matrix = transform.localToWorldMatrix;
        if (TryGetComponent(out BoxCollider box)) Gizmos.DrawCube(box.center, box.size);
    }
#endif
}
```

```gdscript [Godot (GDScript)]
# trigger_volume.gd: an Area3D with a CollisionShape3D child. Its Collision Mask is the
# layer filter. body_entered fires once per body, not per shape, so occupants need no counting.
class_name TriggerVolume
extends Area3D

signal entered(body: Node3D)
signal exited(body: Node3D)
signal first_entered  # empty → occupied
signal last_exited  # occupied → empty

@export var required_group: StringName = &""  # e.g. &"player"; empty = any
@export var fire_once := false
@export var cooldown := 0.0

var _occupants: Array[Node3D] = []
var _fired := false
var _ready_at := 0.0
var _clock := 0.0  # game time: stops while paused


func _ready() -> void:
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)


func _physics_process(delta: float) -> void:
	_clock += delta


func is_occupied() -> bool:
	return not _occupants.is_empty()


func _on_body_entered(body: Node3D) -> void:
	if required_group != &"" and not body.is_in_group(required_group):
		return
	_occupants.append(body)

	if fire_once and _fired:
		return
	if _clock < _ready_at:
		return

	entered.emit(body)
	if _occupants.size() == 1:
		first_entered.emit()
	_fired = true
	_ready_at = _clock + cooldown


# Also sent when a body inside is freed or leaves the tree, so no clean-up pass is needed.
func _on_body_exited(body: Node3D) -> void:
	if not _occupants.has(body):
		return
	_occupants.erase(body)
	exited.emit(body)
	if _occupants.is_empty():
		last_exited.emit()
```

```cpp [Unreal (C++)]
// TriggerZone.h: Unreal ships ATriggerBox / ATriggerSphere / ATriggerVolume for level-blueprint
// scripting; this actor adds filtering, per-actor counting, fire-once and cooldown.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Components/BoxComponent.h"
#include "TriggerZone.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnTriggerActor, AActor*, Actor);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnTriggerState);

UCLASS()
class ATriggerZone : public AActor
{
	GENERATED_BODY()

public:
	ATriggerZone();

	UPROPERTY(EditAnywhere, Category = "Filter") FName RequiredTag;              // actor tag, e.g. Player; None = any
	UPROPERTY(EditAnywhere, Category = "Behaviour") bool bFireOnce = false;
	UPROPERTY(EditAnywhere, Category = "Behaviour") float Cooldown = 0.f;

	UPROPERTY(BlueprintAssignable) FOnTriggerActor OnEnter;
	UPROPERTY(BlueprintAssignable) FOnTriggerActor OnExit;
	UPROPERTY(BlueprintAssignable) FOnTriggerState OnFirstEnter;                 // occupied / empty transitions
	UPROPERTY(BlueprintAssignable) FOnTriggerState OnLastExit;

	UFUNCTION(BlueprintPure, Category = "Trigger") bool IsOccupied() const { return Occupants.Num() > 0; }

protected:
	virtual void BeginPlay() override;

private:
	UFUNCTION() void HandleBeginOverlap(UPrimitiveComponent* Overlapped, AActor* Other, UPrimitiveComponent* OtherComp,
		int32 BodyIndex, bool bFromSweep, const FHitResult& Sweep);
	UFUNCTION() void HandleEndOverlap(UPrimitiveComponent* Overlapped, AActor* Other, UPrimitiveComponent* OtherComp, int32 BodyIndex);

	UPROPERTY(VisibleAnywhere, Category = "Trigger") TObjectPtr<UBoxComponent> Box;
	TMap<TWeakObjectPtr<AActor>, int32> Occupants;  // overlapping components per actor
	bool bFired = false;
	float ReadyAt = 0.f;
};

// TriggerZone.cpp
#include "TriggerZone.h"

ATriggerZone::ATriggerZone()
{
	Box = CreateDefaultSubobject<UBoxComponent>(TEXT("Box"));
	Box->SetCollisionProfileName(TEXT("Trigger"));   // overlap only; edit its responses to filter by channel
	Box->ShapeColor = FColor::Orange;                // how the volume is drawn in the editor
	RootComponent = Box;
}

void ATriggerZone::BeginPlay()
{
	Super::BeginPlay();
	Box->OnComponentBeginOverlap.AddDynamic(this, &ATriggerZone::HandleBeginOverlap);
	Box->OnComponentEndOverlap.AddDynamic(this, &ATriggerZone::HandleEndOverlap);
}

void ATriggerZone::HandleBeginOverlap(UPrimitiveComponent*, AActor* Other, UPrimitiveComponent*, int32, bool, const FHitResult&)
{
	if (!Other || (!RequiredTag.IsNone() && !Other->ActorHasTag(RequiredTag))) return;
	int32& Components = Occupants.FindOrAdd(Other);
	if (Components++ > 0) return;                   // another component of an actor already inside

	const float Now = GetWorld()->GetTimeSeconds();
	if ((bFireOnce && bFired) || Now < ReadyAt) return;

	OnEnter.Broadcast(Other);
	if (Occupants.Num() == 1) OnFirstEnter.Broadcast();
	bFired = true;
	ReadyAt = Now + Cooldown;
}

// Also called when an overlapping actor is destroyed, so no clean-up pass is needed.
void ATriggerZone::HandleEndOverlap(UPrimitiveComponent*, AActor* Other, UPrimitiveComponent*, int32)
{
	int32* Components = Occupants.Find(Other);
	if (!Components || --*Components > 0) return;
	Occupants.Remove(Other);
	OnExit.Broadcast(Other);
	if (Occupants.Num() == 0) OnLastExit.Broadcast();
}
```

:::

Designer wiring, no code (UnityEvents in the inspector, signals in Godot's Node dock, event bindings in a Blueprint or the Level Blueprint):

| Volume | Settings | Events |
| --- | --- | --- |
| **Cave music** | tag Player | OnFirstEnter → MusicPlayer.Play(cave) · OnLastExit → MusicPlayer.Play(forest) |
| **Pressure pad** | any rigidbody | OnFirstEnter → Door.Open · OnLastExit → Door.Close |
| **Intro cutscene** | tag Player, fire once | OnEnter → Cutscene.Play |
| **Spike trap** | layer Characters, cooldown 2 s | OnEnter → Trap.Fire |

**Engine notes**

- **Unity:** a trigger needs a Rigidbody on at least one of the two objects, and objects destroyed or disabled inside never send `OnTriggerExit`, which is what the `FixedUpdate` clean-up handles.
- **Godot:** `Area3D` (`Area2D` in 2D) is the trigger volume: `body_entered` / `body_exited` for physics bodies and `area_entered` / `area_exited` for other areas. Turn **Monitorable** off on volumes nothing needs to detect. Group membership is the usual "tag" filter.
- **Unreal:** the built-in trigger actors fire `OnActorBeginOverlap` / `OnActorEndOverlap`, which a Level Blueprint can bind directly. Both components need **Generate Overlap Events** enabled, and overlap events fire per component, hence the counting.

## When to use

- Level scripting: music and ambience zones, cutscene triggers, checkpoints, traps, kill planes, tutorial hints, area-entered quest objectives.
- Pressure pads, doors and lifts that react to presence.

## When not to use

- Checks that need precise geometry or line of sight. Use raycasts or a [Perception System](./perception-system).
- Many moving objects all checking each other through triggers. A [Spatial Partition](./spatial-partition) query is cheaper.
- Logic that should run on a condition, not a location, such as "after the third key". Use events or a [Quest System](./quest-system).

## Pitfalls

- **Missing overlap requirements.** Unity sends trigger messages only if at least one of the two objects has a Rigidbody (kinematic is fine): static trigger + CharacterController works, static trigger + static collider does not. Unreal needs **Generate Overlap Events** on both components. In Godot, the `Area3D` must be monitoring and its collision mask must include the other object's layer.
- **Multiple colliders.** Counting colliders instead of objects makes a character "enter" several times. Count by owner, as above.
- **Destroyed or disabled occupants.** They may never send an exit event (Unity never sends `OnTriggerExit` for them). Clean up explicitly, or a pad stays pressed forever.
- **Fast objects tunnelling through.** A thin trigger can be skipped entirely by a fast object between physics steps. Make triggers thick, or use continuous collision detection on the fast object.
- **Teleporting in or out.** Moving an object directly may not generate enter/exit until the next physics step, or at all. Handle teleports explicitly (in Unity, `Physics.SyncTransforms` helps).
- **Logic in editor-wired events that should be code.** Long chains of editor-wired events are hard to debug. Keep volumes for simple wiring, and move complex logic into scripts that the volume calls.

## Related

- [Observer](./observer) — enter and exit are events, and editor-wired events (UnityEvents, signals, Blueprint events) let designers subscribe.
- [Interaction System](./interaction-system) — the explicit, button-press counterpart.
- [Checkpoint / Respawn](./checkpoint) — checkpoints are usually trigger volumes.
- [Quest System](./quest-system) — "reach the location" objectives listen to area-entered events.
- [Data-Driven Design](./data-driven-design) — designers configure behaviour without code.
