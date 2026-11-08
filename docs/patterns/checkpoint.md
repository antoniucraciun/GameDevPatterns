# Checkpoint / Respawn

> Record restorable state at safe points and rebuild the world on death.

**Category:** Gameplay Systems

## Problem

When the player dies, the simplest response is reloading the scene. But that also resets the doors they opened, the keys they picked up and the enemies they killed in the previous room. Respawning at the level start feels punishing. Moving the player back to a saved position without resetting anything else causes new bugs: enemies stay alerted, the boss keeps half its health, a falling platform has already fallen and the gap can no longer be crossed. What should reset and what should persist is never decided explicitly.

## Solution

**Checkpoints** record a restorable state at safe moments, and **respawn** restores it.

1. **Checkpoint volumes** (usually [Trigger Volumes](./trigger-volume)) activate when the player reaches them. The latest, or the furthest, becomes the active checkpoint.
2. On activation, the checkpoint asks everything that participates to **capture** its state: a [Memento](./memento) per object.
3. On death: fade out, **restore** every participant to the checkpoint's snapshot, place the player at the checkpoint's spawn point, reset transient systems (camera, music, hit stop, input), and fade in.
4. **Decide explicitly what resets.** Each object chooses its policy:

| Policy | Examples |
| --- | --- |
| **Reset to the checkpoint snapshot** | Enemies, bosses, moving platforms, breakable floors, puzzle state |
| **Persist** (never rolled back) | Collected keys and upgrades, opened shortcuts, achievements |
| **Reset to the level's initial state** | One-off scripted events, if replaying them is desired |

Because both checkpoints and saves capture mementos, a checkpoint can also write a save, which makes it a save point.

## Pseudocode

```text
Restorable:                 // only objects that should roll back opt in
    capture()               // → memento: an enemy's position, health, alive
    restore(memento)

Checkpoint:
    order                   // progression along the level
    spawn_point
    when the player reaches it: CheckpointSystem.activate(this checkpoint)

CheckpointSystem:
    active ← none
    snapshot[restorable] ← memento
    respawning ← false

    activate(checkpoint):
        if active exists and checkpoint.order ≤ active.order: return   // never go backwards
        active ← checkpoint
        snapshot ← empty
        for each restorable r in the world:
            snapshot[r] ← r.capture()

    respawn():              // called when the player dies
        if respawning or no active: return
        respawning ← true
        fade to black
        for each (r, memento) in snapshot:
            if r still exists: r.restore(memento)   // disabled, not destroyed, enemies return
        move the player to active.spawn_point
        revive the player
        announce respawned  // camera, music, hit stop, input reset themselves
        wait 0.3 s; fade back in
        respawning ← false

// A collected key is not Restorable, so it stays collected after death.
```

## Example

### The checkpoint system

Reaching a checkpoint snapshots everything that opts in; respawning fades out, restores those snapshots, moves the player and fades back in. Health is from the [Health / Damageable](./health-component) page.

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public interface ICheckpointRestorable
{
    object Capture();                     // a memento of current state
    void Restore(object memento);         // back to that state
}

public class CheckpointSystem : MonoBehaviour
{
    public static CheckpointSystem Instance { get; private set; }

    [SerializeField] Transform player;
    [SerializeField] CanvasGroup fade;

    readonly Dictionary<ICheckpointRestorable, object> snapshot = new();
    Checkpoint active;
    bool respawning;

    public event Action Respawned;

    void Awake() => Instance = this;

    public void Activate(Checkpoint checkpoint)
    {
        if (active != null && checkpoint.Order <= active.Order) return;    // never go backwards
        active = checkpoint;

        snapshot.Clear();
        foreach (var r in FindRestorables()) snapshot[r] = r.Capture();
    }

    public async void Respawn()
    {
        if (respawning || active == null) return;
        respawning = true;
        try
        {
            await Fade(1f);

            foreach (var (restorable, memento) in snapshot)
                if (restorable is UnityEngine.Object o && o != null) restorable.Restore(memento);

            player.SetPositionAndRotation(active.SpawnPoint.position, active.SpawnPoint.rotation);
            Physics.SyncTransforms();                    // so triggers and physics see the teleport
            player.GetComponent<Health>().Revive();
            Respawned?.Invoke();                         // camera snap, music, input, UI reset

            await Awaitable.WaitForSecondsAsync(0.3f);
            await Fade(0f);
        }
        finally { respawning = false; }
    }

    static IEnumerable<ICheckpointRestorable> FindRestorables()
    {
        foreach (var mb in FindObjectsByType<MonoBehaviour>(FindObjectsInactive.Include))
            if (mb is ICheckpointRestorable r) yield return r;
    }

    async Awaitable Fade(float target)
    {
        while (!Mathf.Approximately(fade.alpha, target))
        {
            fade.alpha = Mathf.MoveTowards(fade.alpha, target, Time.unscaledDeltaTime * 2.5f);
            await Awaitable.NextFrameAsync();
        }
    }
}

public class Checkpoint : MonoBehaviour
{
    public int Order;                                    // progression order along the level
    public Transform SpawnPoint;

    // Wired from a TriggerVolume's OnFirstEnter (player only).
    public void OnPlayerReached() => CheckpointSystem.Instance.Activate(this);
}
```

```gdscript [Godot (GDScript)]
# checkpoint_system.gd: autoload named Checkpoints. Restorable nodes join the
# "checkpoint_restorable" group and provide capture() and restore(memento).
extends Node

signal respawned  # camera snap, music, input, UI reset

var player: Node3D  # set by the player in its _ready
var fade: ColorRect  # a full-screen black rect on a CanvasLayer, set by the HUD

var _snapshot := {}  # Node -> memento
var _active: Checkpoint
var _respawning := false


func activate(checkpoint: Checkpoint) -> void:
	if _active and checkpoint.order <= _active.order:
		return  # never go backwards
	_active = checkpoint
	_snapshot.clear()
	for node in get_tree().get_nodes_in_group(&"checkpoint_restorable"):
		_snapshot[node] = node.capture()


func respawn() -> void:
	if _respawning or _active == null:
		return
	_respawning = true
	await _fade_to(1.0)

	for node in _snapshot:
		if is_instance_valid(node):  # freed since the snapshot: see the notes
			node.restore(_snapshot[node])

	player.global_transform = _active.spawn_point.global_transform
	player.get_node("Health").revive()
	respawned.emit()

	await get_tree().create_timer(0.3).timeout
	await _fade_to(0.0)
	_respawning = false


func _fade_to(alpha: float) -> void:
	var tween := create_tween()
	tween.tween_property(fade, "modulate:a", alpha, 0.4)
	await tween.finished


# checkpoint.gd: an Area3D that detects the player's body.
class_name Checkpoint
extends Area3D

@export var order := 0  # progression order along the level
@export var spawn_point: Marker3D


func _ready() -> void:
	body_entered.connect(_on_body_entered)


func _on_body_entered(body: Node3D) -> void:
	if body.is_in_group(&"player"):
		Checkpoints.activate(self)
```

```cpp [Unreal (C++)]
// CheckpointRestorable.h: what an actor restores is every UPROPERTY marked SaveGame (the same flag
// the Save System page uses), plus its transform. The interface marks who takes part.
#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "CheckpointRestorable.generated.h"

UINTERFACE()
class UCheckpointRestorable : public UInterface { GENERATED_BODY() };

class ICheckpointRestorable
{
	GENERATED_BODY()

public:
	virtual void OnCheckpointRestored() {}          // apply the restored properties: visibility, AI reset...
};

// CheckpointSubsystem.h
struct FCheckpointMemento
{
	FTransform Transform;
	TArray<uint8> Data;                             // the actor's SaveGame properties
};

UCLASS()
class UCheckpointSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	void Activate(ACheckpoint* Checkpoint);
	void Respawn();
	FSimpleMulticastDelegate OnRespawned;           // camera snap, music, input, UI reset

private:
	void FinishRespawn();

	TWeakObjectPtr<ACheckpoint> Active;
	TMap<TWeakObjectPtr<AActor>, FCheckpointMemento> Snapshot;
	FTimerHandle FadeTimer;
	bool bRespawning = false;
};

// Checkpoint.h
UCLASS()
class ACheckpoint : public AActor
{
	GENERATED_BODY()

public:
	ACheckpoint();          // creates Trigger (a UBoxComponent, profile "Trigger") and SpawnPoint (a UArrowComponent)

	UPROPERTY(EditAnywhere, Category = "Checkpoint") int32 Order = 0;      // progression order along the level
	UPROPERTY(VisibleAnywhere, Category = "Checkpoint") TObjectPtr<UArrowComponent> SpawnPoint;
	UPROPERTY(VisibleAnywhere, Category = "Checkpoint") TObjectPtr<UBoxComponent> Trigger;

protected:
	virtual void NotifyActorBeginOverlap(AActor* Other) override
	{
		Super::NotifyActorBeginOverlap(Other);
		const APawn* Pawn = Cast<APawn>(Other);
		if (Pawn && Pawn->IsPlayerControlled()) GetWorld()->GetSubsystem<UCheckpointSubsystem>()->Activate(this);
	}
};

// CheckpointSubsystem.cpp
#include "CheckpointSubsystem.h"
#include "Kismet/GameplayStatics.h"
#include "Serialization/MemoryReader.h"
#include "Serialization/MemoryWriter.h"
#include "Serialization/ObjectAndNameAsStringProxyArchive.h"

void UCheckpointSubsystem::Activate(ACheckpoint* Checkpoint)
{
	if (Active.IsValid() && Checkpoint->Order <= Active->Order) return;   // never go backwards
	Active = Checkpoint;

	Snapshot.Reset();
	TArray<AActor*> Restorables;
	UGameplayStatics::GetAllActorsWithInterface(GetWorld(), UCheckpointRestorable::StaticClass(), Restorables);
	for (AActor* Actor : Restorables)
	{
		FCheckpointMemento& Memento = Snapshot.Add(Actor);
		Memento.Transform = Actor->GetActorTransform();
		FMemoryWriter Writer(Memento.Data, true);
		FObjectAndNameAsStringProxyArchive Ar(Writer, false);
		Ar.ArIsSaveGame = true;
		Actor->Serialize(Ar);
	}
}

void UCheckpointSubsystem::Respawn()
{
	if (bRespawning || !Active.IsValid()) return;
	bRespawning = true;
	// Fade to black and hold it; the camera manager draws the fade.
	UGameplayStatics::GetPlayerCameraManager(this, 0)->StartCameraFade(0.f, 1.f, 0.4f, FLinearColor::Black, true, true);
	GetWorld()->GetTimerManager().SetTimer(FadeTimer, FTimerDelegate::CreateUObject(this, &UCheckpointSubsystem::FinishRespawn), 0.4f, false);
}

void UCheckpointSubsystem::FinishRespawn()
{
	for (const TPair<TWeakObjectPtr<AActor>, FCheckpointMemento>& Pair : Snapshot)
	{
		AActor* Actor = Pair.Key.Get();
		if (!Actor) continue;                       // destroyed since the snapshot: see the notes
		Actor->SetActorTransform(Pair.Value.Transform, false, nullptr, ETeleportType::TeleportPhysics);
		FMemoryReader Reader(Pair.Value.Data, true);
		FObjectAndNameAsStringProxyArchive Ar(Reader, true);
		Ar.ArIsSaveGame = true;
		Actor->Serialize(Ar);
		Cast<ICheckpointRestorable>(Actor)->OnCheckpointRestored();
	}

	APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	Player->TeleportTo(Active->SpawnPoint->GetComponentLocation(), Active->SpawnPoint->GetComponentRotation());
	if (UHealthComponent* Health = Player->FindComponentByClass<UHealthComponent>()) Health->Revive();
	OnRespawned.Broadcast();

	UGameplayStatics::GetPlayerCameraManager(this, 0)->StartCameraFade(1.f, 0.f, 0.4f, FLinearColor::Black, true, false);
	bRespawning = false;
}
```

:::

### Choosing what resets

Objects choose what resets by opting in, or by not opting in:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class Enemy : MonoBehaviour, ICheckpointRestorable
{
    struct State { public Vector3 Position; public float Health; public bool Alive; }

    public object Capture() => new State
    {
        Position = transform.position, Health = GetComponent<Health>().Current, Alive = gameObject.activeSelf,
    };

    public void Restore(object m)
    {
        var s = (State)m;
        gameObject.SetActive(s.Alive);
        transform.position = s.Position;
        GetComponent<Health>().Revive(s.Health / GetComponent<Health>().Max);
        // also: reset AI to idle, clear blackboard knowledge of the player
    }
}

// A collected key does NOT implement ICheckpointRestorable: it stays collected after death.
```

```gdscript [Godot (GDScript)]
# enemy.gd (excerpt). Dying hides and disables the enemy instead of freeing it, so a respawn
# can bring it back: PROCESS_MODE_DISABLED also removes a physics body from the simulation.
extends CharacterBody3D

@onready var health: Health = $Health


func _ready() -> void:
	add_to_group(&"checkpoint_restorable")


func capture() -> Dictionary:
	return {"position": global_position, "health": health.current, "alive": visible}


func restore(m: Dictionary) -> void:
	_set_alive(m["alive"])
	global_position = m["position"]
	health.revive(m["health"] / health.max_health)
	# also: reset AI to idle, clear blackboard knowledge of the player


func _set_alive(alive: bool) -> void:
	visible = alive
	process_mode = Node.PROCESS_MODE_INHERIT if alive else Node.PROCESS_MODE_DISABLED

# A collected key is not in the group: it stays collected after death.
```

```cpp [Unreal (C++)]
// Enemy.h (excerpt). Dying hides and disables the enemy instead of destroying it,
// so a respawn can bring it back.
UCLASS()
class AEnemy : public ACharacter, public ICheckpointRestorable
{
	GENERATED_BODY()

public:
	UPROPERTY(SaveGame) float Health = 100.f;
	UPROPERTY(SaveGame) bool bAlive = true;

	virtual void OnCheckpointRestored() override
	{
		SetActorHiddenInGame(!bAlive);
		SetActorEnableCollision(bAlive);
		// also: reset AI to idle, clear blackboard knowledge of the player
	}
};

// A collected key does not implement ICheckpointRestorable: it stays collected after death.
```

:::

Death triggers respawn: subscribe the respawn call to the player's died event (`health.Died += _ => CheckpointSystem.Instance.Respawn();` in Unity).

**Engine notes**

- **Unity:** `Awaitable` needs Unity 6 (2023.1+); use a coroutine on older versions. `Physics.SyncTransforms` matters when *Auto Sync Transforms* is off (the default). Restorables that were destroyed since the snapshot are skipped, so "dead" enemies should be disabled, not destroyed.
- **Godot:** `create_tween()` on the autoload keeps the fade independent of the level. The same rule applies: freed nodes are skipped, so disable rather than free anything that must come back.
- **Unreal:** `StartCameraFade` on the player camera manager is the built-in screen fade, and `UPROPERTY(SaveGame)` with `ArIsSaveGame` reuses the Save System's serialisation for mementos. Only the actor's own properties are serialised, not its components'; give components their own `Serialize` call if their state must reset. Destroyed actors drop out of the weak-pointer map, so hide and disable instead of destroying.

## When to use

- Platformers, action-adventures, shooters, any game where dying should cost some progress, but not all.
- Levels with puzzles, bosses or one-way state that must be consistent after a retry.

## When not to use

- Short levels or arcade games where restarting the level is fast and fair.
- Games with free saving. The [Save System](./save-system) covers it.
- Roguelikes, where permanent death is the design.

## Pitfalls

- **Undecided reset policy.** Bugs come from objects nobody thought about: a collapsed bridge that should have been restored, or a collected key that was wrongly removed. Make the policy part of every interactive object's design.
- **Destroyed objects.** An enemy destroyed after the checkpoint cannot be restored. Deactivate instead of destroying (or pool), or record enough to recreate it.
- **Transient systems.** Hit stop, slow motion, camera shake, AI alert levels, status effects and music intensity must all be reset on respawn, or the player respawns into a frozen, shaking, alarmed world. Raise `Respawned` and let those systems reset themselves.
- **Checkpoint order.** Walking back through an earlier checkpoint should not move the spawn backwards. Use an order value, as above, or the furthest checkpoint reached.
- **Dying during respawn.** Damage arriving during the fade, from a projectile still in flight, kills the player again. Make the player invulnerable during respawn, and clear projectiles.
- **Memory.** Capturing full state for every object at every checkpoint is fine for a level. For huge open worlds, capture only objects near the checkpoint, or only objects that have changed.

## Related

- [Memento](./memento) — what each object captures.
- [Trigger Volume](./trigger-volume) — how checkpoints are reached.
- [Save System](./save-system) — checkpoints that also save make save points.
- [Health / Damageable Interface](./health-component) — death triggers respawn, and `Revive` restores the player.
- [Scene / Level Management](./scene-management) — the heavy alternative: reload the level.
