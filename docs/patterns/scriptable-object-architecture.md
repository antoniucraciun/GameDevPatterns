# ScriptableObject Architecture

> Use engine data assets as shared variables, events and configuration between scenes.

**Category:** Architecture & Structure

## Problem

The health bar needs the player's health, the low-health vignette needs it too, and the music should change when it drops. The player lives in the gameplay scene, while the HUD is in a separate UI scene. Every option has a cost. A `Player.Instance` singleton couples all three to the player class. Passing references across scenes needs bootstrap code. Searching the scene for the player is slow and fragile. And designers cannot hook up a new reaction without a programmer.

## Solution

Use **data assets** as the shared meeting point: ScriptableObjects in Unity, `Resource`s in Godot, Data Assets in Unreal. An asset exists outside any scene, so any scene object can reference it from the editor. Three building blocks cover most uses:

| Building block | What it is | Replaces |
| --- | --- | --- |
| **Variable** | An asset holding one runtime value (`FloatVariable PlayerHealth`) | Singletons for shared state |
| **Event channel** | An asset that objects raise and listen to (`VoidEventChannel OnPlayerDied`) | Direct references for notifications |
| **Runtime set** | An asset holding the list of currently active objects of a kind (`EnemySet`) | Scene-wide searches, manager registries |

The player *writes* `PlayerHealth`, and the HUD *reads* it. Neither references the other, and the connection is made by dragging the same asset into both inspectors. Scenes can load and unload independently, and designers can wire new reactions themselves.

## Pseudocode

The mechanism underneath: an asset the engine loads once and hands to everything that references it.

```text
// A data asset lives outside every scene. All objects that reference
// it get the same loaded instance, so it works as a meeting point.
FloatVariable (shared asset):
    initial_value          // saved in the asset, edited by designers
    value                  // runtime only, never saved back into the asset
    listeners

    on load (or at game start):  value ← initial_value   // no run inherits the last one's
    set(v):
        if v = value: return
        value ← v
        for each listener: listener(value)

EventChannel (shared asset):
    listeners
    raise():  for each listener: listener()

RuntimeSet (shared asset):
    items                  // runtime only
    add(x):    if x is not in items: append x
    remove(x): remove x from items

// Wiring: both sides reference the same assets, never each other.
PlayerHealth (gameplay scene):    health asset, player-died channel
    take_damage(amount):
        health.set(max(0, health.value - amount))
        if health.value ≤ 0: player_died.raise()

HealthBar (UI scene):             the same health asset
    on enable:  add refresh to health.listeners; refresh(health.value)
    on disable: remove refresh from health.listeners
    refresh(v): fill ← v / max

Enemy:                            the active-enemies set
    on enable:  active_enemies.add(this)
    on disable: active_enemies.remove(this)
```

## Example

The idea is engine-wide: **shared data assets** that several objects reference, holding values, events and lists, so objects talk through the asset instead of referencing each other. Unity uses ScriptableObjects, Godot uses `Resource`s and Unreal uses Data Assets.

### A variable with a separate runtime value

::: code-group

```csharp [Unity (C#)]
using System;
using UnityEngine;

[CreateAssetMenu(menuName = "Variables/Float")]
public class FloatVariable : ScriptableObject
{
    [SerializeField] float initialValue;          // edited by designers, never changed at runtime
    [NonSerialized] float runtimeValue;           // NonSerialized: never written back into the asset

    public event Action<float> Changed;

    public float Value
    {
        get => runtimeValue;
        set
        {
            if (Mathf.Approximately(runtimeValue, value)) return;
            runtimeValue = value;
            Changed?.Invoke(runtimeValue);
        }
    }

    // Reset on load and on entering play mode, so values never leak between sessions.
    void OnEnable() => runtimeValue = initialValue;
}
```

```gdscript [Godot (GDScript)]
# float_variable.gd: create .tres files of this type in the FileSystem dock.
# Every node that exports the same .tres file gets the same instance.
class_name FloatVariable
extends Resource

signal value_changed(value: float)

# Edited by designers. The setter also resets the runtime value, which happens when the
# resource is loaded, so values never leak between runs.
@export var initial_value := 0.0:
	set(v):
		initial_value = v
		_value = v

var _value := 0.0  # not exported: never saved back into the .tres

var value: float:
	get:
		return _value
	set(v):
		if is_equal_approx(_value, v):
			return
		_value = v
		value_changed.emit(_value)
```

```cpp [Unreal (C++)]
// FloatVariable.h: a Data Asset holding a designer value and a separate runtime value.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "FloatVariable.generated.h"

DECLARE_MULTICAST_DELEGATE_OneParam(FOnFloatChanged, float);

UCLASS(BlueprintType)
class UFloatVariable : public UDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Variable") float InitialValue = 0.f;   // edited by designers

	FOnFloatChanged OnChanged;

	float Get() const { return RuntimeValue; }

	void Set(float NewValue)
	{
		if (FMath::IsNearlyEqual(RuntimeValue, NewValue)) return;
		RuntimeValue = NewValue;
		OnChanged.Broadcast(RuntimeValue);
	}

	// Assets stay loaded between Play-In-Editor sessions, so reset explicitly at game start
	// (for example from a game-instance subsystem's Initialize).
	void ResetToInitial() { RuntimeValue = InitialValue; }

private:
	UPROPERTY(Transient) float RuntimeValue = 0.f;   // Transient: never saved into the asset
};
```

:::

### An event channel

::: code-group

```csharp [Unity (C#)]
using System;
using UnityEngine;

[CreateAssetMenu(menuName = "Events/Void Event Channel")]
public class VoidEventChannel : ScriptableObject
{
    event Action raised;

    public void Raise() => raised?.Invoke();
    public void Subscribe(Action handler) => raised += handler;
    public void Unsubscribe(Action handler) => raised -= handler;
}

// A designer-friendly listener: react to a channel with UnityEvents set up in the inspector.
public class VoidEventListener : MonoBehaviour
{
    [SerializeField] VoidEventChannel channel;
    [SerializeField] UnityEngine.Events.UnityEvent response;

    void OnEnable()  => channel.Subscribe(response.Invoke);
    void OnDisable() => channel.Unsubscribe(response.Invoke);
}
```

```gdscript [Godot (GDScript)]
# event_channel.gd: a shared .tres that carries a signal.
class_name EventChannel
extends Resource

signal raised


func raise() -> void:
	raised.emit()


# event_listener.gd: re-emits the channel as a node signal, which designers can connect
# in the Node dock without code.
class_name EventListener
extends Node

signal response

@export var channel: EventChannel


func _enter_tree() -> void:
	channel.raised.connect(response.emit)


func _exit_tree() -> void:
	channel.raised.disconnect(response.emit)
```

```cpp [Unreal (C++)]
// VoidEventChannel.h
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "VoidEventChannel.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnRaised);

UCLASS(BlueprintType)
class UVoidEventChannel : public UDataAsset
{
	GENERATED_BODY()

public:
	// BlueprintAssignable: designers bind to it in any Blueprint that references the asset.
	UPROPERTY(BlueprintAssignable, Category = "Event") FOnRaised OnRaised;

	UFUNCTION(BlueprintCallable, Category = "Event") void Raise() { OnRaised.Broadcast(); }
};
```

:::

### A runtime set

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public abstract class RuntimeSet<T> : ScriptableObject
{
    [NonSerialized] readonly List<T> items = new();
    public IReadOnlyList<T> Items => items;

    public void Add(T item) { if (!items.Contains(item)) items.Add(item); }
    public void Remove(T item) => items.Remove(item);

    void OnDisable() => items.Clear();
}

[CreateAssetMenu(menuName = "Sets/Enemy Set")]
public class EnemySet : RuntimeSet<Enemy> { }

public class Enemy : MonoBehaviour
{
    [SerializeField] EnemySet activeEnemies;
    void OnEnable()  => activeEnemies.Add(this);
    void OnDisable() => activeEnemies.Remove(this);
}
```

```gdscript [Godot (GDScript)]
# node_set.gd: a shared .tres listing live nodes.
class_name NodeSet
extends Resource

var items: Array[Node] = []  # not exported: runtime only


func add(node: Node) -> void:
	if node not in items:
		items.append(node)


func remove(node: Node) -> void:
	items.erase(node)


# enemy.gd
extends CharacterBody3D

@export var active_enemies: NodeSet


func _enter_tree() -> void:
	active_enemies.add(self)


func _exit_tree() -> void:
	active_enemies.remove(self)
```

```cpp [Unreal (C++)]
// ActorSet.h
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "ActorSet.generated.h"

UCLASS(BlueprintType)
class UActorSet : public UDataAsset
{
	GENERATED_BODY()

public:
	void Add(AActor* Actor) { Items.AddUnique(Actor); }
	void Remove(AActor* Actor) { Items.Remove(Actor); }
	const TArray<TWeakObjectPtr<AActor>>& GetItems() const { return Items; }

private:
	TArray<TWeakObjectPtr<AActor>> Items;   // weak: a destroyed actor never lingers as a dangling pointer
};

// Enemy.cpp
void AEnemy::BeginPlay() { Super::BeginPlay(); ActiveEnemies->Add(this); }
void AEnemy::EndPlay(const EEndPlayReason::Type Reason) { ActiveEnemies->Remove(this); Super::EndPlay(Reason); }
```

:::

### Wiring: no component references another

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class PlayerHealth : MonoBehaviour
{
    [SerializeField] FloatVariable health;          // same asset as the HUD's
    [SerializeField] VoidEventChannel onPlayerDied;

    public void TakeDamage(float amount)
    {
        health.Value = Mathf.Max(0f, health.Value - amount);
        if (health.Value <= 0f) onPlayerDied.Raise();
    }
}

public class HealthBar : MonoBehaviour              // lives in a different scene
{
    [SerializeField] FloatVariable health;
    [SerializeField] float max = 100f;
    [SerializeField] UnityEngine.UI.Image fill;

    void OnEnable()  { health.Changed += Refresh; Refresh(health.Value); }
    void OnDisable() => health.Changed -= Refresh;

    void Refresh(float value) => fill.fillAmount = value / max;
}
```

```gdscript [Godot (GDScript)]
# player_health.gd
extends Node

@export var health: FloatVariable      # same .tres as the HUD's
@export var on_player_died: EventChannel


func take_damage(amount: float) -> void:
	health.value = maxf(0.0, health.value - amount)
	if health.value <= 0.0:
		on_player_died.raise()


# health_bar.gd: lives in a different scene
extends ProgressBar

@export var health: FloatVariable


func _enter_tree() -> void:
	health.value_changed.connect(_refresh)
	_refresh(health.value)


func _exit_tree() -> void:
	health.value_changed.disconnect(_refresh)


func _refresh(v: float) -> void:
	value = v  # ProgressBar.value
```

```cpp [Unreal (C++)]
// PlayerHealthComponent.cpp
void UPlayerHealthComponent::ApplyDamage(float Amount)
{
	Health->Set(FMath::Max(0.f, Health->Get() - Amount));   // same asset as the HUD's
	if (Health->Get() <= 0.f) OnPlayerDied->Raise();
}

// HealthBarWidget.cpp: a UMG widget in the HUD
void UHealthBarWidget::NativeConstruct()
{
	Super::NativeConstruct();
	Health->OnChanged.AddUObject(this, &UHealthBarWidget::Refresh);
	Refresh(Health->Get());
}

void UHealthBarWidget::NativeDestruct()
{
	Health->OnChanged.RemoveAll(this);
	Super::NativeDestruct();
}

void UHealthBarWidget::Refresh(float Value) { Bar->SetPercent(Value / Max); }
```

:::

**Engine notes**

- **Unity:** `response.Invoke` creates a new delegate each time, but delegates compare by target and method, so `Unsubscribe` still removes the right one. ScriptableObject runtime values persist between Play sessions in the editor unless reset, as `OnEnable` does above.
- **Godot:** resources loaded from the same path are shared by default. That is what makes this work, and also why "Local to Scene" exists for resources that must be unique per instance.
- **Unreal:** Data Assets are best for configuration; for runtime event channels, Epic's **Gameplay Message Router** (from Lyra) and **subsystems** are the more common choice, because they reset with the game instance automatically.

## When to use

- Sharing state and events across scenes and prefabs without singletons.
- Teams where designers wire behaviour in the editor.
- Configuration data: game settings, difficulty curves, item and enemy definitions. This is the [Flyweight](./flyweight) use of data assets, and the least controversial one.

## When not to use

- One-off links between two objects in the same scene or prefab. A direct editor-assigned reference is easier to follow and debug than an event channel asset.
- Small teams of programmers. The editor wiring mainly helps designers, and it hides the flow of control from the code.
- Runtime state that must be saved, reset or networked. Asset state can outlive a play session (Unity keeps it between Play sessions in the editor, and Unreal between Play In Editor sessions; Godot runs the game in a separate process, so it resets), and it isn't part of your save data unless you add it.

## Pitfalls

- **Runtime changes persisting in the editor.** In Unity and in Unreal's Play In Editor, the game uses the editor's own asset objects. Changing a *serialised* field of a ScriptableObject in Unity's play mode changes the asset, and it stays changed after you stop; keep runtime values `[NonSerialized]` and reset them in `OnEnable`, as above. In Unreal, keep runtime values out of `UPROPERTY` fields that are saved with the asset, or reset them when play starts. Godot runs the game in a separate process, so the asset on disk is safe, but a loaded `Resource` is shared by everything that loaded it.
- **Assets unloaded mid-game.** If nothing references the asset for a while, such as during a scene transition, the engine may unload it, and its runtime value resets on reload: Unity unloads unreferenced ScriptableObjects, Godot frees a `Resource` when its last reference goes, and Unreal garbage-collects unreferenced assets. Keep a reference alive from a persistent object, or do not use variables for state that must survive scene loads.
- **Invisible wiring.** Connections live in editor fields across many scenes and prefabs, and "who changes PlayerHealth?" has no code search answer. Name assets clearly and organise them in folders. The engine's reference search helps: *Find References in Scene* in Unity, *View Owners* in Godot's FileSystem dock, the *Reference Viewer* in Unreal.
- **Asset sprawl.** Hundreds of tiny variable and event assets become hard to navigate. Use them for genuinely shared things, not for every value.
- **One shared instance.** An asset is global. Two players in co-op cannot share `PlayerHealth`. Per-instance state belongs on the instance.

## Related

- [Singleton](./singleton) — the problem this pattern most often replaces.
- [Event Bus](./event-bus) — the same decoupling, keyed by type in code rather than by asset in the editor.
- [Observer](./observer) — variables and channels are observable subjects.
- [Flyweight](./flyweight) — data assets as shared, read-only definitions.
