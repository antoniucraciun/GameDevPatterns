# Interaction System

> A generic "interactable" contract with prompts, priority and range checks.

**Category:** Gameplay Systems

## Problem

The player can open doors, talk to NPCs, pick up items, pull levers and sit on benches. Each was added separately: the door has its own trigger and key check, the NPC its own, and the pickup uses a different button. When a lever stands next to an item, both respond to one press, or neither does. Prompts ("Press E to open") are inconsistent, gamepad players cannot tell what will be activated, and adding a new interactable means copying another one's code.

## Solution

Split the work between **the things you can interact with** and **the one thing that decides**:

- **`IInteractable`** is implemented by doors, NPCs, items and levers. It provides a prompt ("Open", "Talk"), whether interaction is currently possible (`CanInteract`, e.g. "locked: needs key"), the action itself, and optionally a hold duration and priority.
- **`Interactor`** on the player is the only component that reads the interact button. Every few frames it finds nearby interactables, filters them (range, line of sight, `CanInteract`), **scores** them (distance, how centred they are in the view, priority), and keeps **one focused target**.
- The **focused target** gets a highlight and a prompt in the UI. Pressing the button interacts with that target only.

New interactables need no changes to the player.

## Pseudocode

```text
Interactable:               // doors, NPCs, items, levers
    prompt                  // "Open", "Talk to Mira"
    priority, hold_seconds  // hold_seconds 0 = press
    blocked_reason(who)     // "Locked", "Inventory full", or none
    interact(who)
    set_focused(on)         // highlight

Interactor:                 // on the player; the only reader of the button
    focused, blocked_reason, hold_progress

    scan():                 // every 0.1 s
        best ← nothing
        for each interactable c within range of the eyes:
            if a wall is between the eyes and c: skip it
            facing ← how centred c is in view    // 1 = dead centre
            if facing < 0.3: skip it             // outside a ~70° cone
            score ← facing × 2 - distance / range + c.priority × 0.5
            if score beats best's: best ← c; blocked_reason ← c.blocked_reason(player)
        if best is not focused:
            unhighlight focused; focused ← best; highlight it
            hold_progress ← 0; announce focus changed   // UI shows the prompt

    every frame:
        if no focused, or blocked_reason: hold_progress ← 0; stop
        if focused.hold_seconds is 0:
            if interact was just pressed: focused.interact(player)
        else if interact is held:
            hold_progress += dt / focused.hold_seconds
            if hold_progress ≥ 1: hold_progress ← 0; focused.interact(player)
        else: hold_progress ← 0
```

## Example

### The interactor

The player's interactor scans nearby interactables a few times a second, picks the best one, and handles press and hold input. Interactables only answer a few questions and react.

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public interface IInteractable
{
    string Prompt { get; }                        // "Open", "Talk to Mira", "Pick up Iron Sword"
    int Priority { get; }                         // ties broken in favour of higher priority
    float HoldSeconds { get; }                    // 0 = press, > 0 = hold to interact
    Transform Anchor { get; }                     // where the prompt appears
    bool CanInteract(Interactor who, out string reason);   // reason: "Locked", "Inventory full"
    void Interact(Interactor who);
    void SetFocused(bool focused);                // highlight on/off
}

public class Interactor : MonoBehaviour
{
    [SerializeField] Transform eyes;
    [SerializeField] float range = 2.5f;
    [SerializeField] LayerMask interactableMask, occluders;
    [SerializeField] float scanInterval = 0.1f;

    public IInteractable Focused { get; private set; }
    public string BlockedReason { get; private set; }     // shown greyed out by the UI
    public float HoldProgress { get; private set; }        // 0..1 for a radial fill
    public event Action<IInteractable> FocusChanged;

    readonly Collider[] hits = new Collider[16];
    float nextScan;

    void Update()
    {
        if (Time.time >= nextScan) { nextScan = Time.time + scanInterval; Scan(); }
        HandleInput();
    }

    void Scan()
    {
        IInteractable best = null;
        float bestScore = float.MinValue;
        string bestReason = null;

        int n = Physics.OverlapSphereNonAlloc(eyes.position, range, hits, interactableMask);
        for (int i = 0; i < n; i++)
        {
            var candidate = hits[i].GetComponentInParent<IInteractable>();
            if (candidate == null) continue;

            Vector3 to = candidate.Anchor.position - eyes.position;
            if (Physics.Raycast(eyes.position, to.normalized, to.magnitude, occluders)) continue;   // behind a wall

            // Prefer what the player is looking at, then what is close, then higher priority.
            float facing = Vector3.Dot(eyes.forward, to.normalized);          // 1 = dead centre
            if (facing < 0.3f) continue;                                       // outside a ~70° cone
            float score = facing * 2f - to.magnitude / range + candidate.Priority * 0.5f;

            if (score > bestScore)
            {
                bestScore = score;
                best = candidate;
                candidate.CanInteract(this, out bestReason);
            }
        }

        if (best != Focused)
        {
            Focused?.SetFocused(false);
            Focused = best;
            Focused?.SetFocused(true);
            HoldProgress = 0f;
            FocusChanged?.Invoke(Focused);                                     // UI updates the prompt
        }
        BlockedReason = bestReason;
    }

    void HandleInput()
    {
        if (Focused == null || BlockedReason != null) { HoldProgress = 0f; return; }

        if (Focused.HoldSeconds <= 0f)
        {
            if (Input.GetButtonDown("Interact")) Focused.Interact(this);
            return;
        }

        if (Input.GetButton("Interact"))
        {
            HoldProgress += Time.deltaTime / Focused.HoldSeconds;
            if (HoldProgress >= 1f) { HoldProgress = 0f; Focused.Interact(this); }
        }
        else HoldProgress = 0f;
    }
}
```

```gdscript [Godot (GDScript)]
# interactable.gd: the base class. An Area3D on the interactable layer, placed where the prompt appears.
class_name Interactable
extends Area3D

@export var prompt := "Interact"  # "Open", "Talk to Mira", "Pick up Iron Sword"
@export var priority := 0  # ties broken in favour of higher priority
@export var hold_seconds := 0.0  # 0 = press, > 0 = hold to interact


# GDScript has no out parameters: return the reason, "" = allowed ("Locked", "Inventory full").
func get_blocked_reason(_who: Interactor) -> String:
	return ""


func interact(_who: Interactor) -> void:
	pass


func set_focused(_focused: bool) -> void:  # highlight on/off
	pass


# interactor.gd: an Area3D on the player (a sphere of the interaction range) whose
# collision mask is the interactable layer. The input action "interact" is set in the Input Map.
class_name Interactor
extends Area3D

signal focus_changed(focused: Interactable)  # UI updates the prompt

@export var eyes: Node3D  # usually the camera
@export var reach := 2.5  # the sphere's radius, used for scoring
@export_flags_3d_physics var occluders := 1  # walls only, not the interactables' own bodies
@export var scan_interval := 0.1

var focused: Interactable
var blocked_reason := ""  # shown greyed out by the UI
var hold_progress := 0.0  # 0..1 for a radial fill

var _scan_left := 0.0


func _process(delta: float) -> void:
	_scan_left -= delta
	if _scan_left <= 0.0:
		_scan_left = scan_interval
		_scan()
	_handle_input(delta)


func _scan() -> void:
	var best: Interactable = null
	var best_score := -INF
	var best_reason := ""
	var from := eyes.global_position
	var forward := -eyes.global_transform.basis.z
	var space := get_world_3d().direct_space_state

	for area in get_overlapping_areas():
		var candidate := area as Interactable
		if candidate == null:
			continue
		var to := candidate.global_position - from
		var query := PhysicsRayQueryParameters3D.create(from, candidate.global_position, occluders)
		if not space.intersect_ray(query).is_empty():
			continue  # behind a wall

		# Prefer what the player is looking at, then what is close, then higher priority.
		var facing := forward.dot(to.normalized())  # 1 = dead centre
		if facing < 0.3:
			continue  # outside a ~70° cone
		var score := facing * 2.0 - to.length() / reach + candidate.priority * 0.5
		if score > best_score:
			best_score = score
			best = candidate
			best_reason = candidate.get_blocked_reason(self)

	if best != focused:
		if focused:
			focused.set_focused(false)
		focused = best
		if focused:
			focused.set_focused(true)
		hold_progress = 0.0
		focus_changed.emit(focused)
	blocked_reason = best_reason


func _handle_input(delta: float) -> void:
	if focused == null or blocked_reason != "":
		hold_progress = 0.0
		return
	if focused.hold_seconds <= 0.0:
		if Input.is_action_just_pressed("interact"):
			focused.interact(self)
		return
	if Input.is_action_pressed("interact"):
		hold_progress += delta / focused.hold_seconds
		if hold_progress >= 1.0:
			hold_progress = 0.0
			focused.interact(self)
	else:
		hold_progress = 0.0
```

```cpp [Unreal (C++)]
// Interactable.h: a Blueprint-implementable interface, so designers can make any actor interactable.
// Callers use the generated IInteractable::Execute_* functions.
#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "Interactable.generated.h"

UINTERFACE(BlueprintType)
class UInteractable : public UInterface { GENERATED_BODY() };

class IInteractable
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction") FText GetPrompt() const;
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction") int32 GetPriority() const;
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction") float GetHoldSeconds() const;   // 0 = press
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction") bool CanInteract(AActor* Who, FText& OutReason) const;
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction") void Interact(AActor* Who);
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction") void SetFocused(bool bFocused);
};

// InteractorComponent.h
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnFocusChanged, AActor*, NewFocus);

UCLASS(ClassGroup = (Gameplay), meta = (BlueprintSpawnableComponent))
class UInteractorComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UInteractorComponent() { PrimaryComponentTick.bCanEverTick = true; }

	UPROPERTY(EditAnywhere, Category = "Interaction") float Range = 250.f;
	UPROPERTY(EditAnywhere, Category = "Interaction") TEnumAsByte<ECollisionChannel> InteractableChannel = ECC_GameTraceChannel1;
	UPROPERTY(EditAnywhere, Category = "Interaction") float ScanInterval = 0.1f;

	UPROPERTY(BlueprintReadOnly, Category = "Interaction") TObjectPtr<AActor> Focused;
	UPROPERTY(BlueprintReadOnly, Category = "Interaction") FText BlockedReason;        // shown greyed out by the UI
	UPROPERTY(BlueprintReadOnly, Category = "Interaction") float HoldProgress = 0.f;   // 0..1 for a radial fill
	UPROPERTY(BlueprintAssignable) FOnFocusChanged OnFocusChanged;                     // UI updates the prompt

	// Bound to the Interact input action's Started and Completed events (Enhanced Input).
	UFUNCTION(BlueprintCallable, Category = "Interaction") void PressInteract();
	UFUNCTION(BlueprintCallable, Category = "Interaction") void ReleaseInteract() { bHeld = false; HoldProgress = 0.f; }

	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

protected:
	virtual void BeginPlay() override;

private:
	void Scan();

	FTimerHandle ScanTimer;
	bool bBlocked = false;
	bool bHeld = false;
};

// InteractorComponent.cpp
#include "InteractorComponent.h"
#include "Engine/OverlapResult.h"

void UInteractorComponent::BeginPlay()
{
	Super::BeginPlay();
	GetWorld()->GetTimerManager().SetTimer(ScanTimer, this, &UInteractorComponent::Scan, ScanInterval, true);
}

void UInteractorComponent::Scan()
{
	FVector Eye;
	FRotator View;
	GetOwner()->GetActorEyesViewPoint(Eye, View);

	TArray<FOverlapResult> Overlaps;
	GetWorld()->OverlapMultiByChannel(Overlaps, Eye, FQuat::Identity, InteractableChannel, FCollisionShape::MakeSphere(Range));

	AActor* Best = nullptr;
	float BestScore = -BIG_NUMBER;
	FText BestReason;
	bool bBestBlocked = false;
	for (const FOverlapResult& Overlap : Overlaps)
	{
		AActor* Candidate = Overlap.GetActor();
		if (!Candidate || !Candidate->Implements<UInteractable>()) continue;

		const FVector To = Candidate->GetActorLocation() - Eye;
		FCollisionQueryParams Params(SCENE_QUERY_STAT(InteractOcclusion), false, GetOwner());
		Params.AddIgnoredActor(Candidate);
		if (GetWorld()->LineTraceTestByChannel(Eye, Candidate->GetActorLocation(), ECC_Visibility, Params)) continue;   // behind a wall

		// Prefer what the player is looking at, then what is close, then higher priority.
		const float Facing = FVector::DotProduct(View.Vector(), To.GetSafeNormal());   // 1 = dead centre
		if (Facing < 0.3f) continue;                                                   // outside a ~70° cone
		const float Score = Facing * 2.f - To.Size() / Range + IInteractable::Execute_GetPriority(Candidate) * 0.5f;
		if (Score > BestScore)
		{
			BestScore = Score;
			Best = Candidate;
			BestReason = FText::GetEmpty();
			bBestBlocked = !IInteractable::Execute_CanInteract(Candidate, GetOwner(), BestReason);
		}
	}

	if (Best != Focused)
	{
		if (Focused) IInteractable::Execute_SetFocused(Focused, false);
		Focused = Best;
		if (Focused) IInteractable::Execute_SetFocused(Focused, true);
		HoldProgress = 0.f;
		OnFocusChanged.Broadcast(Focused);
	}
	BlockedReason = BestReason;
	bBlocked = bBestBlocked;
}

void UInteractorComponent::PressInteract()
{
	if (!Focused || bBlocked) return;
	if (IInteractable::Execute_GetHoldSeconds(Focused) <= 0.f) IInteractable::Execute_Interact(Focused, GetOwner());
	else bHeld = true;
}

void UInteractorComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	if (!bHeld || !Focused || bBlocked) { HoldProgress = 0.f; return; }

	HoldProgress += DeltaTime / IInteractable::Execute_GetHoldSeconds(Focused);
	if (HoldProgress >= 1.f)
	{
		HoldProgress = 0.f;
		bHeld = false;
		IInteractable::Execute_Interact(Focused, GetOwner());
	}
}
```

:::

### An interactable door

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class Door : MonoBehaviour, IInteractable
{
    [SerializeField] ItemDefinition key;                // null = unlocked; PlayerInventory is from the Inventory page
    [SerializeField] Renderer outline;
    bool open;

    public string Prompt => open ? "Close" : "Open";
    public int Priority => 0;
    public float HoldSeconds => 0f;
    public Transform Anchor => transform;

    public bool CanInteract(Interactor who, out string reason)
    {
        reason = null;
        if (key == null || open) return true;
        if (who.TryGetComponent(out PlayerInventory inventory) && inventory.Bag.CountOf(key) > 0) return true;
        reason = "Locked";
        return false;
    }

    public void Interact(Interactor who) { open = !open; /* animate, play sound */ }
    public void SetFocused(bool focused) => outline.enabled = focused;
}
```

```gdscript [Godot (GDScript)]
# door_interactable.gd: an Interactable child of the door; it drives its parent.
# PlayerInventory is the Inventory node from the Inventory page.
extends Interactable

@export var key: ItemDefinition  # null = unlocked
@export var outline: Node3D  # an outline mesh, shown while focused

var _open := false


func _ready() -> void:
	prompt = "Open"


func get_blocked_reason(who: Interactor) -> String:
	if key == null or _open:
		return ""
	var inventory := who.get_parent().get_node_or_null("Inventory") as PlayerInventory
	if inventory and inventory.bag.count_of(key) > 0:
		return ""
	return "Locked"


func interact(_who: Interactor) -> void:
	_open = not _open
	prompt = "Close" if _open else "Open"
	# animate the parent door, play a sound


func set_focused(focused: bool) -> void:
	outline.visible = focused
```

```cpp [Unreal (C++)]
// Door.h: UInventoryComponent and UItemDefinition are from the Inventory page.
UCLASS()
class ADoor : public AActor, public IInteractable
{
	GENERATED_BODY()

public:
	virtual FText GetPrompt_Implementation() const override
	{
		return bOpen ? NSLOCTEXT("Door", "Close", "Close") : NSLOCTEXT("Door", "Open", "Open");
	}
	virtual int32 GetPriority_Implementation() const override { return 0; }
	virtual float GetHoldSeconds_Implementation() const override { return 0.f; }
	virtual bool CanInteract_Implementation(AActor* Who, FText& OutReason) const override;
	virtual void Interact_Implementation(AActor* Who) override { bOpen = !bOpen; /* animate, play sound */ }
	// Custom depth drives an outline post-process material.
	virtual void SetFocused_Implementation(bool bFocused) override { Mesh->SetRenderCustomDepth(bFocused); }

private:
	UPROPERTY(EditAnywhere, Category = "Door") TObjectPtr<UItemDefinition> Key;     // null = unlocked
	UPROPERTY(VisibleAnywhere, Category = "Door") TObjectPtr<UStaticMeshComponent> Mesh;
	bool bOpen = false;
};

// Door.cpp
bool ADoor::CanInteract_Implementation(AActor* Who, FText& OutReason) const
{
	if (!Key || bOpen) return true;
	const UInventoryComponent* Inventory = Who->FindComponentByClass<UInventoryComponent>();
	if (Inventory && Inventory->CountOf(Key) > 0) return true;
	OutReason = NSLOCTEXT("Door", "Locked", "Locked");
	return false;
}
```

:::

The blocked reason is evaluated when the focus is chosen and shown in the prompt ("Locked"), rather than letting the press fail silently. The input calls stand in for an action from [Input Abstraction](./input-abstraction).

**Engine notes**

- **Unity:** `Input.GetButton` is the legacy Input Manager; with the Input System package, read an `InputAction` instead. `GetComponentInParent<IInteractable>()` works with interfaces, so the collider can sit on a child.
- **Godot:** an `Area3D` on the player with `get_overlapping_areas()` replaces the overlap query, and `Camera3D`'s basis gives the look direction (`-basis.z` is forward). Interactables are found by class (`as Interactable`), since GDScript has no interfaces.
- **Unreal:** `BlueprintNativeEvent` interface functions let designers implement interactables in Blueprint; always call them through `IInteractable::Execute_*`, which works for both C++ and Blueprint implementations. Add an **Interactable** trace channel in Project Settings → Collision (`ECC_GameTraceChannel1` here). Lyra's interaction system follows the same idea using Gameplay Abilities.

## When to use

- First- and third-person games, adventure games, RPGs, immersive sims: anything with "press to use".
- Whenever several kinds of objects respond to the same button.

## When not to use

- One or two interactable kinds. Direct trigger checks are clearer.
- Games with no "use" input, such as shooters where you only touch pickups. Collisions are enough.

## Pitfalls

- **Several objects activating at once.** Interacting in each interactable's own trigger means overlapping triggers all fire. Only the interactor reads input, and only the focused target acts.
- **Focus flicker.** Two objects with similar scores swap focus every scan. Add a small bonus for the current focus (hysteresis).
- **Prompts that lie.** A prompt saying "Open" on a locked door that then does nothing feels broken. Show the blocked reason in the prompt.
- **Interacting through walls.** Range checks alone let players loot through thin walls. Add a line-of-sight check.
- **Holding through a focus change.** If the player turns away mid-hold, progress must reset, or the hold completes on a different object.
- **Interaction during other actions.** Opening a door mid-attack or mid-dialogue causes odd states. Gate the interactor with the player's state or tags (for example, not while in a cutscene).

## Related

- [Input Abstraction](./input-abstraction) — the interact action, rebindable per device.
- [Observer](./observer) — `FocusChanged` drives the prompt UI.
- [Gameplay Tags](./tags) — gate interaction on character state.
- [Inventory](./inventory) — keys and pickups.
- [Dialogue System](./dialogue-system) — what talking to an NPC starts.
- [Trigger Volume](./trigger-volume) — automatic interactions without a button press.
