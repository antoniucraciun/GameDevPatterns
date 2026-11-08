# AI Director

> A meta-AI that paces encounters by watching player stress and adjusting spawns.

**Category:** AI & Decision Making

## Problem

Encounters are scripted: the same 12 enemies spawn at the same doorway every time. Skilled players are bored, struggling players are overwhelmed, and on the second playthrough everyone knows what is coming. Pure random spawning is no better: sometimes three hordes in a row, sometimes nothing for five minutes. Neither responds to how the player is *actually doing* right now.

## Solution

Add an AI that controls **the game**, not a character. The director **observes** the player and **adjusts pacing**:

1. **Measure intensity.** Estimate how stressed the player is from signals: damage taken, health, nearby enemies, kills, ammo, recent deaths. Keep it as one number that rises quickly with danger and decays slowly when calm.
2. **Run a pacing cycle**, a small [state machine](./state):
   - **Build-up:** spawn pressure gradually rises.
   - **Peak:** when intensity crosses a threshold, hold the pressure briefly (the climax).
   - **Relax:** stop spawning, give breathing room, perhaps drop health or ammo. Return to build-up after a while.
3. **Act through existing systems.** The director never controls enemies directly. It changes the **spawn budget**, which spawn points are allowed (never in view), and item drops, using the [Spawner](./spawner) and loot tables.

The result is a rhythm: tension, release, tension. It adapts to skill, because skilled players spend less time at high intensity, so they get more frequent build-ups. Every session plays out differently.

## Pseudocode

```text
Director:
    intensity ← 0        // 0..1: rises fast with danger, decays slowly
    phase ← build-up     // build-up, peak or relax
    pressure ← 0         // 0..1: how hard to push right now
    budget ← 0           // threat points the spawner may spend

    // Stress events push intensity up quickly.
    on player damaged(amount):   intensity ← min(1, intensity + 2 × amount / max health)
    on enemy killed near player: intensity ← min(1, intensity + 0.03)

    every frame (dt):
        // Continuous signals hold intensity up; otherwise it decays.
        health_stress ← 1 − player health fraction
        crowd_stress  ← min(1, enemies within 15 m / 12)
        intensity ← max(intensity − decay × dt,
                        0.5 × health_stress + 0.4 × crowd_stress)

        if phase is build-up:
            pressure ← min(1, pressure + dt / 40)      // ramp up over about 40 s
            if intensity ≥ peak_threshold: enter(peak, 6 s)
        if phase is peak:
            pressure ← 1                               // hold the climax briefly
            if its time is up: enter(relax, 25 s)
        if phase is relax:
            pressure ← 0                               // breathing room
            if its time is up and intensity < 0.3: enter(build-up, 0 s)

        // The director decides how much; the spawner decides what and where.
        budget ← budget + pressure × max_budget_per_second × dt
        budget ← budget − spawner.spend(budget)        // off-screen spawns only

    enter(next, duration):
        phase ← next; the phase ends after duration
        if next is relax:    spawner.maybe drop supplies near the player
        if next is build-up: pressure ← 0.2
```

## Example

An intensity meter fed by stress signals, a build-up / peak / relax cycle, and a spawn budget that follows the cycle. The director only decides *how much* pressure to apply; a spawner (left to the reader in each tab) decides what to spawn and where.

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class AIDirector : MonoBehaviour
{
    enum Phase { BuildUp, Peak, Relax }

    [Header("Intensity")]
    [SerializeField] float decayPerSecond = 0.05f;        // slow calm-down
    [SerializeField] float peakThreshold = 0.8f;

    [Header("Pacing (seconds)")]
    [SerializeField] float peakDuration = 6f;
    [SerializeField] float relaxDuration = 25f;

    [Header("Spawning")]
    [SerializeField] float maxSpawnBudgetPerSecond = 3f;   // threat points per second at full pressure

    [SerializeField] Health player;
    [SerializeField] DirectorSpawner spawner;              // spends budget on enemies, off-screen

    public float Intensity { get; private set; }           // 0..1
    Phase phase = Phase.BuildUp;
    float phaseUntil;
    float pressure;                                         // 0..1, rises during build-up
    float budget;

    void OnEnable()  => player.Damaged += OnPlayerDamaged;
    void OnDisable() => player.Damaged -= OnPlayerDamaged;

    // Stress signals push intensity up quickly.
    void OnPlayerDamaged(DamageInfo info) => Bump(info.Amount / player.Max * 2f);
    public void OnEnemyKilledNearPlayer() => Bump(0.03f);
    void Bump(float amount) => Intensity = Mathf.Clamp01(Intensity + amount);

    void Update()
    {
        float dt = Time.deltaTime;

        // Continuous signals: low health and many nearby enemies keep intensity up.
        float healthStress = 1f - player.Fraction;
        float crowdStress = Mathf.Clamp01(spawner.EnemiesNear(player.transform.position, 15f) / 12f);
        Intensity = Mathf.Clamp01(Mathf.Max(Intensity - decayPerSecond * dt, 0.5f * healthStress + 0.4f * crowdStress));

        switch (phase)
        {
            case Phase.BuildUp:
                pressure = Mathf.Min(1f, pressure + dt / 40f);            // ramp up over ~40 s
                if (Intensity >= peakThreshold) Enter(Phase.Peak, peakDuration);
                break;

            case Phase.Peak:
                pressure = 1f;                                            // hold the climax briefly
                if (Time.time >= phaseUntil) Enter(Phase.Relax, relaxDuration);
                break;

            case Phase.Relax:
                pressure = 0f;                                            // no new spawns: breathing room
                if (Time.time >= phaseUntil && Intensity < 0.3f) Enter(Phase.BuildUp, 0f);
                break;
        }

        // Spend a spawn budget proportional to pressure; the spawner decides what and where.
        budget += pressure * maxSpawnBudgetPerSecond * dt;
        budget -= spawner.SpendBudget(budget);
    }

    void Enter(Phase next, float duration)
    {
        phase = next;
        phaseUntil = Time.time + duration;
        if (next == Phase.Relax) spawner.MaybeDropSupplies(player.transform.position);   // reward surviving the peak
        if (next == Phase.BuildUp) pressure = 0.2f;
    }
}

// DirectorSpawner: EnemiesNear(...), SpendBudget(available) picks enemies whose cost fits
// (cheap fodder vs. expensive specials) at off-screen spawn points and returns what it spent,
// MaybeDropSupplies(...) places health or ammo near the player if they are low.
```

```gdscript [Godot (GDScript)]
# ai_director.gd
class_name AIDirector
extends Node

enum Phase { BUILD_UP, PEAK, RELAX }

@export_group("Intensity")
@export var decay_per_second := 0.05  # slow calm-down
@export var peak_threshold := 0.8

@export_group("Pacing (seconds)")
@export var peak_duration := 6.0
@export var relax_duration := 25.0

@export_group("Spawning")
@export var max_spawn_budget_per_second := 3.0  # threat points per second at full pressure

@export_group("")
@export var player: PlayerHealth       # your health node on the player: damaged(amount), max_health, fraction()
@export var spawner: DirectorSpawner   # your spawner: enemies_near(), spend_budget(), maybe_drop_supplies()

var intensity := 0.0  # 0..1
var _phase := Phase.BUILD_UP
var _phase_time_left := 0.0
var _pressure := 0.0  # 0..1, rises during build-up
var _budget := 0.0


func _ready() -> void:
	player.damaged.connect(_on_player_damaged)


# Stress signals push intensity up quickly.
func _on_player_damaged(amount: float) -> void:
	_bump(amount / player.max_health * 2.0)


func on_enemy_killed_near_player() -> void:
	_bump(0.03)


func _bump(amount: float) -> void:
	intensity = clampf(intensity + amount, 0.0, 1.0)


func _process(delta: float) -> void:
	# Continuous signals: low health and many nearby enemies keep intensity up.
	var health_stress := 1.0 - player.fraction()
	var crowd_stress := clampf(spawner.enemies_near(player.global_position, 15.0) / 12.0, 0.0, 1.0)
	intensity = clampf(maxf(intensity - decay_per_second * delta, 0.5 * health_stress + 0.4 * crowd_stress), 0.0, 1.0)

	_phase_time_left -= delta
	match _phase:
		Phase.BUILD_UP:
			_pressure = minf(1.0, _pressure + delta / 40.0)  # ramp up over ~40 s
			if intensity >= peak_threshold:
				_enter(Phase.PEAK, peak_duration)
		Phase.PEAK:
			_pressure = 1.0  # hold the climax briefly
			if _phase_time_left <= 0.0:
				_enter(Phase.RELAX, relax_duration)
		Phase.RELAX:
			_pressure = 0.0  # no new spawns: breathing room
			if _phase_time_left <= 0.0 and intensity < 0.3:
				_enter(Phase.BUILD_UP, 0.0)

	# Spend a spawn budget proportional to pressure; the spawner decides what and where.
	_budget += _pressure * max_spawn_budget_per_second * delta
	_budget -= spawner.spend_budget(_budget)


func _enter(next: Phase, duration: float) -> void:
	_phase = next
	_phase_time_left = duration
	if next == Phase.RELAX:
		spawner.maybe_drop_supplies(player.global_position)  # reward surviving the peak
	if next == Phase.BUILD_UP:
		_pressure = 0.2
```

```cpp [Unreal (C++)]
// AIDirector.h: placed once in the level. In multiplayer, run it on the server only (or own it
// from the GameMode, which only exists there).
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "AIDirector.generated.h"

class ADirectorSpawner;   // yours: EnemiesNear(), SpendBudget(), MaybeDropSupplies()
class UHealthComponent;   // yours: GetFraction(), GetMax()

UCLASS()
class AAIDirector : public AActor
{
	GENERATED_BODY()

public:
	AAIDirector() { PrimaryActorTick.bCanEverTick = true; }

	float GetIntensity() const { return Intensity; }   // 0..1
	void OnEnemyKilledNearPlayer() { Bump(0.03f); }

protected:
	UPROPERTY(EditAnywhere, Category = "Intensity") float DecayPerSecond = 0.05f;   // slow calm-down
	UPROPERTY(EditAnywhere, Category = "Intensity") float PeakThreshold = 0.8f;
	UPROPERTY(EditAnywhere, Category = "Pacing") float PeakDuration = 6.f;
	UPROPERTY(EditAnywhere, Category = "Pacing") float RelaxDuration = 25.f;
	UPROPERTY(EditAnywhere, Category = "Spawning") float MaxSpawnBudgetPerSecond = 3.f;
	UPROPERTY(EditAnywhere, Category = "Spawning") TObjectPtr<ADirectorSpawner> Spawner;

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

private:
	enum class EPhase : uint8 { BuildUp, Peak, Relax };   // internal only, so no UENUM

	// Bound to the player's built-in OnTakeAnyDamage delegate.
	UFUNCTION()
	void OnPlayerDamaged(AActor* DamagedActor, float Damage, const UDamageType* DamageType,
		AController* InstigatedBy, AActor* DamageCauser);

	void Bump(float Amount) { Intensity = FMath::Clamp(Intensity + Amount, 0.f, 1.f); }
	void Enter(EPhase Next, float Duration);

	UPROPERTY() TObjectPtr<APawn> Player;
	UPROPERTY() TObjectPtr<UHealthComponent> PlayerHealth;

	float Intensity = 0.f;
	EPhase Phase = EPhase::BuildUp;
	float PhaseUntil = 0.f;
	float Pressure = 0.f;                       // 0..1, rises during build-up
	float Budget = 0.f;
};

// AIDirector.cpp
#include "AIDirector.h"
#include "DirectorSpawner.h"
#include "HealthComponent.h"
#include "Kismet/GameplayStatics.h"

void AAIDirector::BeginPlay()
{
	Super::BeginPlay();
	// Single-player sketch: rebind here too if the player pawn respawns.
	Player = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!Player) return;
	PlayerHealth = Player->FindComponentByClass<UHealthComponent>();
	Player->OnTakeAnyDamage.AddDynamic(this, &AAIDirector::OnPlayerDamaged);
}

// Stress signals push intensity up quickly.
void AAIDirector::OnPlayerDamaged(AActor* DamagedActor, float Damage, const UDamageType* DamageType,
	AController* InstigatedBy, AActor* DamageCauser)
{
	if (PlayerHealth) Bump(Damage / PlayerHealth->GetMax() * 2.f);
}

void AAIDirector::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!Player || !PlayerHealth || !Spawner) return;
	const float Now = GetWorld()->GetTimeSeconds();

	// Continuous signals: low health and many nearby enemies keep intensity up.
	const float HealthStress = 1.f - PlayerHealth->GetFraction();
	const float CrowdStress = FMath::Clamp(Spawner->EnemiesNear(Player->GetActorLocation(), 1500.f) / 12.f, 0.f, 1.f);
	Intensity = FMath::Clamp(FMath::Max(Intensity - DecayPerSecond * DeltaSeconds, 0.5f * HealthStress + 0.4f * CrowdStress), 0.f, 1.f);

	switch (Phase)
	{
	case EPhase::BuildUp:
		Pressure = FMath::Min(1.f, Pressure + DeltaSeconds / 40.f);      // ramp up over ~40 s
		if (Intensity >= PeakThreshold) Enter(EPhase::Peak, PeakDuration);
		break;
	case EPhase::Peak:
		Pressure = 1.f;                                                   // hold the climax briefly
		if (Now >= PhaseUntil) Enter(EPhase::Relax, RelaxDuration);
		break;
	case EPhase::Relax:
		Pressure = 0.f;                                                   // no new spawns: breathing room
		if (Now >= PhaseUntil && Intensity < 0.3f) Enter(EPhase::BuildUp, 0.f);
		break;
	}

	// Spend a spawn budget proportional to pressure; the spawner decides what and where.
	Budget += Pressure * MaxSpawnBudgetPerSecond * DeltaSeconds;
	Budget -= Spawner->SpendBudget(Budget);
}

void AAIDirector::Enter(EPhase Next, float Duration)
{
	Phase = Next;
	PhaseUntil = GetWorld()->GetTimeSeconds() + Duration;
	if (Next == EPhase::Relax) Spawner->MaybeDropSupplies(Player->GetActorLocation());   // reward surviving the peak
	if (Next == EPhase::BuildUp) Pressure = 0.2f;
}
```

:::

**Engine notes**

- **Unity:** a single director per scene suits a `MonoBehaviour`; expose `Intensity` to a debug graph (or the Profiler's custom counters) while tuning, because pacing problems are invisible in a single frame.
- **Godot:** making the director an autoload lets any enemy call `on_enemy_killed_near_player()` without a reference being wired up. `PlayerHealth` and `DirectorSpawner` stand for your own scripts.
- **Unreal:** `OnTakeAnyDamage` is every actor's built-in damage delegate, fed by `UGameplayStatics::ApplyDamage`; with the Gameplay Ability System, listen to the health attribute's change delegate instead. The spawner can ask the **Environment Query System** for off-screen spawn points (score candidates by distance to the player and by not being visible to them).

## When to use

- Co-op shooters, horde modes, survival and horror games, roguelikes: anywhere replayability and pacing matter more than authored set pieces.
- Open worlds that need ambient encounters at a sensible rate.
- Difficulty that should adapt without an explicit difficulty setting.

## When not to use

- Hand-crafted levels where designers want every encounter placed exactly. A director fights authored pacing.
- Competitive multiplayer. Adaptive difficulty feels unfair when players compete.
- Short or linear games without enough repeat play for adaptation to be noticed.

## Pitfalls

- **Rubber-banding players notice.** If the game always gets easier when you are losing and harder when you are winning, skilled play feels pointless. Keep the adjustments subtle, mostly in timing rather than in enemy strength.
- **Unfair spawns.** "Pressure" spawning enemies right next to or in view of the player feels cheap. Spawn only out of sight and at sensible distances (see [Spawner](./spawner)).
- **Badly chosen signals.** Intensity built only from damage ignores a player surrounded by enemies but dodging well. Combine several signals, and test with very different play styles.
- **Opaque behaviour.** Designers cannot tune what they cannot see. Graph intensity, phase and budget over time in a debug overlay.
- **Scripted beats get lost.** Story moments and boss fights still need authoring. Let scripted events pause or override the director.

## Related

- [Spawner / Wave System](./spawner) — what the director drives.
- [State](./state) — the build-up / peak / relax cycle.
- [Influence Map](./influence-map) — spatial threat as an input.
- [Utility AI](./utility-ai) — directors often score possible actions (spawn, drop, wait) the same way.
- [Weighted Random & Loot Tables](./weighted-random) — supply drops and enemy mixes.
