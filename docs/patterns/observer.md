# Observer

> Let objects announce that something happened without knowing who is listening.

**Also known as:** Events, Signals · **Category:** Behavioral & Communication

## Problem

When the player dies, the HUD must update, a sound plays, the achievement system checks "die 100 times", analytics logs it and the music changes. If `Player.Die()` calls all of these directly, the player class depends on audio, UI, achievements and analytics. Adding one more reaction means editing the player again.

## Solution

The **subject** (the player) exposes an event. **Observers** subscribe to it. When something happens, the subject raises the event and every subscriber is notified. The subject knows nothing about who is listening. New reactions are added by subscribing, without touching the subject.

## Pseudocode

```text
// The event: a list of callbacks with one signature.
Event:
    listeners               // functions to call, in subscription order
    subscribe(f):   add f to listeners
    unsubscribe(f): remove f from listeners
    raise(args):
        for each f in a copy of listeners:   // a handler may unsubscribe
            f(args)

// The subject owns its events and never names a listener.
Player:
    health ← 100
    health_changed : Event(current, max)
    died           : Event(player)

    take_damage(amount):
        health ← max(0, health - amount)
        health_changed.raise(health, 100)
        if health = 0: died.raise(this player)

// An observer subscribes for exactly as long as it is alive.
HealthBar:
    on enable:  player.health_changed.subscribe(on_health_changed)
    on disable: player.health_changed.unsubscribe(on_health_changed)

    on_health_changed(current, max):
        fill ← current / max
```

## Example

Each engine has observers built in: C# events in Unity, signals in Godot, multicast delegates in Unreal. A health component announces changes; a health bar listens without the player knowing it exists.

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class Player : MonoBehaviour
{
    public event System.Action<Player> Died;
    public event System.Action<int, int> HealthChanged;  // (current, max)

    int health = 100;

    public void TakeDamage(int amount)
    {
        health = Mathf.Max(0, health - amount);
        HealthChanged?.Invoke(health, 100);
        if (health == 0) Died?.Invoke(this);
    }
}

public class HealthBar : MonoBehaviour
{
    [SerializeField] Player player;
    [SerializeField] UnityEngine.UI.Image fill;

    void OnEnable()  => player.HealthChanged += OnHealthChanged;
    void OnDisable() => player.HealthChanged -= OnHealthChanged;  // always unsubscribe

    void OnHealthChanged(int current, int max) => fill.fillAmount = (float)current / max;
}
```

```gdscript [Godot (GDScript)]
# player.gd
class_name Player
extends CharacterBody2D

signal died(player: Player)
signal health_changed(current: int, max_health: int)

@export var max_health := 100
@onready var _health := max_health  # @onready: read after the inspector value is applied


func take_damage(amount: int) -> void:
	_health = maxi(0, _health - amount)
	health_changed.emit(_health, max_health)
	if _health == 0:
		died.emit(self)


# health_bar.gd
extends ProgressBar

@export var player: Player


func _ready() -> void:
	# Freeing this node removes the connection, so there is no leak; disconnect by hand
	# only to stop listening while the bar stays alive.
	player.health_changed.connect(_on_health_changed)


func _on_health_changed(current: int, max_health: int) -> void:
	max_value = max_health
	value = current
```

```cpp [Unreal (C++)]
// HealthComponent.h
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "HealthComponent.generated.h"

// Dynamic delegates can be bound in Blueprints too.
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnHealthChanged, int32, Current, int32, Max);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnDied, AActor*, DeadActor);

UCLASS(ClassGroup = (Custom), meta = (BlueprintSpawnableComponent))
class UHealthComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UPROPERTY(BlueprintAssignable, Category = "Health") FOnHealthChanged OnHealthChanged;
	UPROPERTY(BlueprintAssignable, Category = "Health") FOnDied OnDied;

	UFUNCTION(BlueprintCallable, Category = "Health") void ApplyDamage(int32 Amount);

protected:
	virtual void BeginPlay() override { Super::BeginPlay(); Health = MaxHealth; }

private:
	UPROPERTY(EditAnywhere, Category = "Health") int32 MaxHealth = 100;
	int32 Health = 100;
};

// HealthComponent.cpp
#include "HealthComponent.h"

void UHealthComponent::ApplyDamage(int32 Amount)
{
	Health = FMath::Max(0, Health - Amount);
	OnHealthChanged.Broadcast(Health, MaxHealth);
	if (Health == 0) OnDied.Broadcast(GetOwner());
}

// HealthBarWidget.h
#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "HealthBarWidget.generated.h"

class UHealthComponent;
class UProgressBar;

UCLASS()
class UHealthBarWidget : public UUserWidget
{
	GENERATED_BODY()

public:
	void Bind(UHealthComponent* InHealth);

protected:
	virtual void NativeDestruct() override;

	UPROPERTY(meta = (BindWidget)) TObjectPtr<UProgressBar> Fill;   // a ProgressBar named "Fill" in the widget

private:
	UFUNCTION() void HandleHealthChanged(int32 Current, int32 Max);   // dynamic bindings need UFUNCTION

	TWeakObjectPtr<UHealthComponent> Health;
};

// HealthBarWidget.cpp
#include "HealthBarWidget.h"
#include "HealthComponent.h"
#include "Components/ProgressBar.h"

void UHealthBarWidget::Bind(UHealthComponent* InHealth)
{
	Health = InHealth;
	InHealth->OnHealthChanged.AddDynamic(this, &UHealthBarWidget::HandleHealthChanged);
}

void UHealthBarWidget::NativeDestruct()
{
	if (UHealthComponent* H = Health.Get())
		H->OnHealthChanged.RemoveDynamic(this, &UHealthBarWidget::HandleHealthChanged);   // always unsubscribe
	Super::NativeDestruct();
}

void UHealthBarWidget::HandleHealthChanged(int32 Current, int32 Max)
{
	Fill->SetPercent(static_cast<float>(Current) / Max);
}
```

:::

**Engine notes**

- **Unity:** Use `UnityEvent` when designers need to wire up responses in the Inspector, and plain C# events when the wiring lives in code. C# events are faster and cannot be broken by renaming a method.
- **Godot:** Signals are the observer pattern; they can also be connected in the editor's **Node** dock. Connections to a freed object are removed automatically. Pass `CONNECT_ONE_SHOT` to `connect` for a listener that should fire once, or `CONNECT_DEFERRED` to run it at idle time instead of mid-emit.
- **Unreal:** Use `DECLARE_MULTICAST_DELEGATE_*` (native, faster, C++ only, bound with `AddUObject` or `AddLambda`, removed with the returned `FDelegateHandle`) when Blueprints don't need it, and the `DYNAMIC` variants with `UPROPERTY(BlueprintAssignable)` when they do. Bindings to a `UObject` (`AddUObject`, `AddDynamic`, `AddWeakLambda`) are skipped once it is destroyed; plain `AddLambda` bindings are not, so always remove those.

## When to use

- One thing happens and several unrelated systems care: UI, audio, achievements, analytics.
- Lower-level systems that need to inform higher-level ones without depending on them.
- Replacing per-frame polling of state that rarely changes.

## When not to use

- One sender and one receiver that already know each other. A direct method call is clearer and easier to debug.
- Events that fire many times per frame from many objects. The overhead and call order add up; process them in bulk or use an [Event Queue](./event-queue).
- When the order of reactions matters. Observers run in subscription order, which is hard to control; call the systems explicitly.

## Pitfalls

- **Forgetting to unsubscribe.** The subject keeps the observer alive (a memory leak), or calls into a destroyed object and throws. Pair subscribing and unsubscribing in matching lifecycle callbacks (`OnEnable`/`OnDisable`, `_enter_tree`/`_exit_tree`, `BeginPlay`/`EndPlay`). Godot disconnects signals automatically when either object is freed, but not plain callable lists of your own.
- **Hard-to-follow control flow.** "Who reacts to this?" requires a search. Keep event names explicit and the number of hops low.
- **Re-entrancy.** An observer that triggers the same event, or unsubscribes during notification, can cause surprises. Keep handlers small.
- **Order of observers is not guaranteed.** Do not rely on it.
- **Synchronous by default.** A slow handler stalls the caller. Use an [Event Queue](./event-queue) for deferred delivery.

## Related

- [Event Bus](./event-bus) — decouples through a central channel, when listeners have no reference to the subject.
- [Event Queue](./event-queue) — decouples in time: events are processed later.
- [Command](./command) — the counterpart: a request to do something, rather than a notice that something was done.
- [Component](./component) — components often talk to each other through events.
