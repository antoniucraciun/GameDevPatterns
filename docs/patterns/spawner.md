# Spawner / Wave System

> Data-driven waves and spawn points that control what appears, where and when.

**Category:** Gameplay Systems

## Problem

The first version of a horde mode is a coroutine: spawn 5 zombies, wait 10 seconds, spawn 8 zombies. Then design wants wave 7 to mix runners and tanks, the boss wave to wait until the arena is clear, spawns to never appear in the player's view, and the whole thing to be tunable without recompiling. The coroutine turns into a wall of hard-coded numbers that only a programmer can change, and enemies keep popping in right in front of the player.

## Solution

Separate **what** spawns, **when**, and **where**:

- **What and when** are data. A `WaveDefinition` asset lists *spawn groups*: which enemy (or a weighted pool of enemies), how many, the interval between spawns, and a start delay. A wave ends when its groups are done and, optionally, the arena is cleared.
- **Where** is decided by **spawn points** in the level, plus a selection rule: not visible to the player, not too close, not too far, and not used in the last few seconds.
- A **wave runner** plays the waves in order. It counts living enemies by listening to their death events ([Observer](./observer)), and takes enemies from an [Object Pool](./object-pool) so waves do not cause allocation spikes.

## Example

### Data

A wave is a list of spawn groups; each group picks enemies from a weighted pool. `EnemyType` is the asset from [Type Object](./type-object).

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

[Serializable]
public class SpawnGroup
{
    public List<WeightedEnemy> pool = new();   // one is picked per spawn, by weight
    public int count = 5;
    public float startDelay = 0f;
    public float interval = 1f;
}

[Serializable]
public struct WeightedEnemy { public EnemyType type; public float weight; }

[CreateAssetMenu(menuName = "Waves/Wave")]
public class WaveDefinition : ScriptableObject
{
    public List<SpawnGroup> groups = new();
    public bool waitForClear = true;           // next wave only when every enemy is dead
    public float breakAfter = 5f;              // breather before the next wave
}
```

```gdscript [Godot (GDScript)]
# weighted_enemy.gd
class_name WeightedEnemy
extends Resource

@export var type: EnemyType
@export var weight := 1.0


# spawn_group.gd
class_name SpawnGroup
extends Resource

@export var pool: Array[WeightedEnemy] = []  # one is picked per spawn, by weight
@export var count := 5
@export var start_delay := 0.0
@export var interval := 1.0


# wave_definition.gd: one .tres per wave.
class_name WaveDefinition
extends Resource

@export var groups: Array[SpawnGroup] = []
@export var wait_for_clear := true  # next wave only when every enemy is dead
@export var break_after := 5.0  # breather before the next wave
```

```cpp [Unreal (C++)]
// WaveDefinition.h
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "EnemyType.h"
#include "WaveDefinition.generated.h"

USTRUCT(BlueprintType)
struct FWeightedEnemy
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Wave") TObjectPtr<UEnemyType> Type;
	UPROPERTY(EditAnywhere, Category = "Wave") float Weight = 1.f;
};

USTRUCT(BlueprintType)
struct FSpawnGroup
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Wave") TArray<FWeightedEnemy> Pool;    // one is picked per spawn, by weight
	UPROPERTY(EditAnywhere, Category = "Wave") int32 Count = 5;
	UPROPERTY(EditAnywhere, Category = "Wave") float StartDelay = 0.f;
	UPROPERTY(EditAnywhere, Category = "Wave") float Interval = 1.f;
};

UCLASS(BlueprintType)
class UWaveDefinition : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditDefaultsOnly, Category = "Wave") TArray<FSpawnGroup> Groups;
	UPROPERTY(EditDefaultsOnly, Category = "Wave") bool bWaitForClear = true;   // next wave only when every enemy is dead
	UPROPERTY(EditDefaultsOnly, Category = "Wave") float BreakAfter = 5.f;      // breather before the next wave
};
```

:::

### Spawn points with a selection rule

::: code-group

```csharp [Unity (C#)]
using System.Collections.Generic;
using UnityEngine;

public class SpawnPoint : MonoBehaviour
{
    public float LastUsed = float.NegativeInfinity;
}

public class SpawnPointSelector
{
    readonly List<SpawnPoint> points;
    readonly Transform player;
    readonly Camera camera;
    readonly List<SpawnPoint> candidates = new();

    public float MinDistance = 8f, MaxDistance = 30f, Cooldown = 2f;

    public SpawnPointSelector(List<SpawnPoint> points, Transform player, Camera camera)
    {
        this.points = points; this.player = player; this.camera = camera;
    }

    public SpawnPoint Pick(System.Random rng)
    {
        candidates.Clear();
        foreach (var p in points)
        {
            float d = Vector3.Distance(p.transform.position, player.position);
            if (d < MinDistance || d > MaxDistance) continue;
            if (Time.time - p.LastUsed < Cooldown) continue;
            if (IsVisible(p.transform.position)) continue;
            candidates.Add(p);
        }
        if (candidates.Count == 0) return null;          // no valid point right now: try again shortly

        var chosen = candidates[rng.Next(candidates.Count)];
        chosen.LastUsed = Time.time;
        return chosen;
    }

    bool IsVisible(Vector3 position)
    {
        Vector3 vp = camera.WorldToViewportPoint(position);
        bool inFrustum = vp.z > 0f && vp.x is > -0.1f and < 1.1f && vp.y is > -0.1f and < 1.1f;
        if (!inFrustum) return false;
        // In view, unless something blocks the line of sight.
        return !Physics.Linecast(camera.transform.position, position + Vector3.up);
    }
}
```

```gdscript [Godot (GDScript)]
# spawn_point.gd: a marker placed in the level.
class_name SpawnPoint
extends Marker3D

var last_used := -INF


# spawn_point_selector.gd
class_name SpawnPointSelector
extends RefCounted

var min_distance := 8.0
var max_distance := 30.0
var cooldown := 2.0

var _points: Array[SpawnPoint]
var _player: Node3D
var _camera: Camera3D


func _init(points: Array[SpawnPoint], player: Node3D, camera: Camera3D) -> void:
	_points = points
	_player = player
	_camera = camera


# now: the caller's game clock, so cooldowns pause with the game.
func pick(rng: RandomNumberGenerator, now: float) -> SpawnPoint:
	var candidates: Array[SpawnPoint] = []
	for p in _points:
		var d: float = p.global_position.distance_to(_player.global_position)
		if d < min_distance or d > max_distance:
			continue
		if now - p.last_used < cooldown:
			continue
		if _is_visible(p.global_position):
			continue
		candidates.append(p)
	if candidates.is_empty():
		return null  # no valid point right now: try again shortly

	var chosen := candidates[rng.randi_range(0, candidates.size() - 1)]
	chosen.last_used = now
	return chosen


func _is_visible(at: Vector3) -> bool:
	if not _camera.is_position_in_frustum(at):
		return false
	# In view, unless something blocks the line of sight.
	var query := PhysicsRayQueryParameters3D.create(_camera.global_position, at + Vector3.UP)
	return _camera.get_world_3d().direct_space_state.intersect_ray(query).is_empty()
```

```cpp [Unreal (C++)]
// SpawnPoint.h: a Target Point (an editor marker) that remembers when it was last used.
#pragma once

#include "CoreMinimal.h"
#include "Engine/TargetPoint.h"
#include "SpawnPoint.generated.h"

UCLASS()
class ASpawnPoint : public ATargetPoint
{
	GENERATED_BODY()

public:
	float LastUsed = -1.e9f;
};

// SpawnPointSelector.h: plain C++; the wave director owns it and keeps the points alive.
struct FSpawnPointSelector
{
	float MinDistance = 800.f, MaxDistance = 3000.f, Cooldown = 2.f;   // Unreal units are centimetres

	ASpawnPoint* Pick(const TArray<TObjectPtr<ASpawnPoint>>& Points, const AActor* Player, FRandomStream& Rng) const;

private:
	static bool IsVisible(const UWorld* World, const FVector& Position);
};

// SpawnPointSelector.cpp
#include "SpawnPointSelector.h"
#include "Kismet/GameplayStatics.h"
#include "Camera/PlayerCameraManager.h"

ASpawnPoint* FSpawnPointSelector::Pick(const TArray<TObjectPtr<ASpawnPoint>>& Points, const AActor* Player, FRandomStream& Rng) const
{
	const UWorld* World = Player->GetWorld();
	const float Now = World->GetTimeSeconds();
	TArray<ASpawnPoint*, TInlineAllocator<16>> Candidates;
	for (ASpawnPoint* P : Points)
	{
		const float D = FVector::Dist(P->GetActorLocation(), Player->GetActorLocation());
		if (D < MinDistance || D > MaxDistance) continue;
		if (Now - P->LastUsed < Cooldown) continue;
		if (IsVisible(World, P->GetActorLocation())) continue;
		Candidates.Add(P);
	}
	if (Candidates.IsEmpty()) return nullptr;                    // no valid point right now: try again shortly

	ASpawnPoint* Chosen = Candidates[Rng.RandRange(0, Candidates.Num() - 1)];
	Chosen->LastUsed = Now;
	return Chosen;
}

bool FSpawnPointSelector::IsVisible(const UWorld* World, const FVector& Position)
{
	const APlayerCameraManager* Camera = UGameplayStatics::GetPlayerCameraManager(World, 0);
	if (!Camera) return false;
	const FVector Eye = Camera->GetCameraLocation();

	// Approximate frustum: a cone with the camera's horizontal field of view.
	const float CosHalfFov = FMath::Cos(FMath::DegreesToRadians(Camera->GetFOVAngle() * 0.5f));
	if (FVector::DotProduct(Camera->GetCameraRotation().Vector(), (Position - Eye).GetSafeNormal()) < CosHalfFov) return false;

	// In view, unless something blocks the line of sight.
	FHitResult Hit;
	return !World->LineTraceSingleByChannel(Hit, Eye, Position + FVector(0, 0, 100), ECC_Visibility);
}
```

:::

### The wave runner

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

public class WaveRunner : MonoBehaviour
{
    [SerializeField] List<WaveDefinition> waves;
    [SerializeField] List<SpawnPoint> spawnPoints;
    [SerializeField] Transform player;

    public int CurrentWave { get; private set; }
    public int Alive { get; private set; }
    public event Action<int> WaveStarted, WaveCleared;

    SpawnPointSelector selector;
    readonly System.Random rng = new();      // seed it for reproducible runs (see Seeded Randomness)

    void Start()
    {
        selector = new SpawnPointSelector(spawnPoints, player, Camera.main);
        StartCoroutine(Run());
    }

    System.Collections.IEnumerator Run()
    {
        for (CurrentWave = 0; CurrentWave < waves.Count; CurrentWave++)
        {
            var wave = waves[CurrentWave];
            WaveStarted?.Invoke(CurrentWave);

            int groupsRunning = wave.groups.Count;
            foreach (var group in wave.groups)
                StartCoroutine(RunGroup(group, () => groupsRunning--));

            yield return new WaitUntil(() => groupsRunning == 0);
            if (wave.waitForClear) yield return new WaitUntil(() => Alive == 0);

            WaveCleared?.Invoke(CurrentWave);
            yield return new WaitForSeconds(wave.breakAfter);
        }
    }

    System.Collections.IEnumerator RunGroup(SpawnGroup group, Action done)
    {
        yield return new WaitForSeconds(group.startDelay);
        for (int i = 0; i < group.count; i++)
        {
            SpawnPoint point;
            while ((point = selector.Pick(rng)) == null)
                yield return new WaitForSeconds(0.25f);  // all points blocked or visible: wait

            Spawn(PickWeighted(group.pool), point.transform.position);
            yield return new WaitForSeconds(group.interval);
        }
        done();
    }

    void Spawn(EnemyType type, Vector3 position)
    {
        Enemy enemy = type.Spawn(position);          // or take it from an Object Pool per type
        Alive++;
        enemy.Died += OnEnemyDied;                   // Observer: count down when it dies
    }

    void OnEnemyDied(Enemy enemy)
    {
        enemy.Died -= OnEnemyDied;
        Alive--;
    }

    EnemyType PickWeighted(List<WeightedEnemy> pool)
    {
        float total = 0f;
        foreach (var e in pool) total += e.weight;
        double roll = rng.NextDouble() * total;
        foreach (var e in pool) { if (roll < e.weight) return e.type; roll -= e.weight; }
        return pool[^1].type;
    }
}

// This assumes Enemy exposes event Action<Enemy> Died, raised once when it dies or is despawned.
```

```gdscript [Godot (GDScript)]
# wave_runner.gd: coroutines with await instead of Unity's StartCoroutine.
extends Node3D

signal wave_started(index: int)
signal wave_cleared(index: int)

@export var waves: Array[WaveDefinition] = []
@export var spawn_points: Array[SpawnPoint] = []
@export var player: Node3D
@export var rng_seed := 0  # 0 = random; set it for reproducible runs (see Seeded Randomness)

var current_wave := 0
var alive := 0

var _selector: SpawnPointSelector
var _rng := RandomNumberGenerator.new()
var _clock := 0.0
var _groups_running := 0  # a member, not a local: lambdas capture locals by value


func _ready() -> void:
	if rng_seed != 0:
		_rng.seed = rng_seed
	_selector = SpawnPointSelector.new(spawn_points, player, get_viewport().get_camera_3d())
	_run()


func _process(delta: float) -> void:
	_clock += delta


func _run() -> void:
	for i in waves.size():
		current_wave = i
		var wave := waves[i]
		wave_started.emit(i)

		_groups_running = wave.groups.size()
		for group in wave.groups:
			_run_group(group)  # not awaited: the groups run side by side

		while _groups_running > 0 or (wave.wait_for_clear and alive > 0):
			await get_tree().process_frame

		wave_cleared.emit(i)
		# process_always = false: the timer stops while the game is paused.
		await get_tree().create_timer(wave.break_after, false).timeout


func _run_group(group: SpawnGroup) -> void:
	await get_tree().create_timer(group.start_delay, false).timeout
	for i in group.count:
		var point := _selector.pick(_rng, _clock)
		while point == null:
			await get_tree().create_timer(0.25, false).timeout  # all points blocked or visible: wait
			point = _selector.pick(_rng, _clock)
		_spawn(_pick_weighted(group.pool), point.global_position)
		await get_tree().create_timer(group.interval, false).timeout
	_groups_running -= 1


func _spawn(type: EnemyType, at: Vector3) -> void:
	var enemy := type.spawn(get_parent(), at)  # or take it from an Object Pool per type
	alive += 1
	enemy.tree_exiting.connect(func() -> void: alive -= 1)  # fires on death and on despawn


func _pick_weighted(pool: Array[WeightedEnemy]) -> EnemyType:
	var total := 0.0
	for e in pool:
		total += e.weight
	var roll := _rng.randf() * total
	for e in pool:
		if roll < e.weight:
			return e.type
		roll -= e.weight
	return pool[-1].type
```

```cpp [Unreal (C++)]
// WaveDirector.h: timers instead of coroutines.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WaveDefinition.h"
#include "SpawnPointSelector.h"
#include "WaveDirector.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnWaveEvent, int32, WaveIndex);

UCLASS()
class AWaveDirector : public AActor
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Waves") TArray<TObjectPtr<UWaveDefinition>> Waves;
	UPROPERTY(EditInstanceOnly, Category = "Waves") TArray<TObjectPtr<ASpawnPoint>> SpawnPoints;
	UPROPERTY(EditAnywhere, Category = "Waves") int32 Seed = 0;     // 0 = random; fixed = reproducible runs

	UPROPERTY(BlueprintAssignable) FOnWaveEvent OnWaveStarted;
	UPROPERTY(BlueprintAssignable) FOnWaveEvent OnWaveCleared;

protected:
	virtual void BeginPlay() override;

private:
	void StartWave(int32 Index);
	void SpawnFromGroup(int32 Group);
	void CheckWaveDone();
	UEnemyType* PickWeighted(const TArray<FWeightedEnemy>& Pool);
	UFUNCTION() void OnEnemyDestroyed(AActor* Enemy);

	FSpawnPointSelector Selector;
	FRandomStream Rng;
	TArray<FTimerHandle> GroupTimers;
	TArray<int32> Remaining;                         // spawns left per group
	FTimerHandle BreakTimer;
	int32 CurrentWave = -1;
	int32 Alive = 0;
	int32 GroupsRunning = 0;
	bool bWaveActive = false;
};

// WaveDirector.cpp
#include "WaveDirector.h"
#include "Kismet/GameplayStatics.h"

void AWaveDirector::BeginPlay()
{
	Super::BeginPlay();
	Rng.Initialize(Seed != 0 ? Seed : FMath::Rand());
	StartWave(0);
}

void AWaveDirector::StartWave(int32 Index)
{
	if (!Waves.IsValidIndex(Index)) return;                      // all waves done
	const UWaveDefinition* Wave = Waves[Index];
	CurrentWave = Index;
	bWaveActive = true;
	GroupsRunning = 0;
	Remaining.Init(0, Wave->Groups.Num());
	GroupTimers.SetNum(Wave->Groups.Num());
	OnWaveStarted.Broadcast(Index);

	for (int32 G = 0; G < Wave->Groups.Num(); ++G)
	{
		const FSpawnGroup& Group = Wave->Groups[G];
		if (Group.Count <= 0) continue;
		Remaining[G] = Group.Count;
		++GroupsRunning;
		// Repeats every Interval; the first spawn comes after StartDelay (a rate or delay of 0 would clear the timer).
		GetWorldTimerManager().SetTimer(GroupTimers[G], FTimerDelegate::CreateUObject(this, &AWaveDirector::SpawnFromGroup, G),
			FMath::Max(Group.Interval, 0.01f), true, FMath::Max(Group.StartDelay, 0.01f));
	}
	CheckWaveDone();                                             // a wave with no groups ends at once
}

void AWaveDirector::SpawnFromGroup(int32 G)
{
	const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	ASpawnPoint* Point = Player ? Selector.Pick(SpawnPoints, Player, Rng) : nullptr;
	if (!Point) return;                                          // all points blocked or visible: retry next interval

	// Deferred, so the enemy is initialised from its type before BeginPlay (Type Object page).
	UEnemyType* Type = PickWeighted(Waves[CurrentWave]->Groups[G].Pool);
	const FTransform Transform = Point->GetActorTransform();
	AEnemy* Enemy = GetWorld()->SpawnActorDeferred<AEnemy>(Type->GetEnemyClass(), Transform, nullptr, nullptr,
		ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn);
	Enemy->Init(Type);
	Enemy->FinishSpawning(Transform);
	++Alive;
	Enemy->OnDestroyed.AddDynamic(this, &AWaveDirector::OnEnemyDestroyed);   // counts deaths and despawns

	if (--Remaining[G] == 0)
	{
		GetWorldTimerManager().ClearTimer(GroupTimers[G]);
		--GroupsRunning;
		CheckWaveDone();
	}
}

void AWaveDirector::OnEnemyDestroyed(AActor*)
{
	--Alive;
	CheckWaveDone();
}

void AWaveDirector::CheckWaveDone()
{
	if (!bWaveActive || GroupsRunning > 0) return;
	const UWaveDefinition* Wave = Waves[CurrentWave];
	if (Wave->bWaitForClear && Alive > 0) return;

	bWaveActive = false;
	OnWaveCleared.Broadcast(CurrentWave);
	GetWorldTimerManager().SetTimer(BreakTimer, FTimerDelegate::CreateUObject(this, &AWaveDirector::StartWave, CurrentWave + 1),
		FMath::Max(Wave->BreakAfter, 0.01f), false);
}

UEnemyType* AWaveDirector::PickWeighted(const TArray<FWeightedEnemy>& Pool)
{
	float Total = 0.f;
	for (const FWeightedEnemy& E : Pool) Total += E.Weight;
	float Roll = Rng.FRand() * Total;
	for (const FWeightedEnemy& E : Pool)
	{
		if (Roll < E.Weight) return E.Type;
		Roll -= E.Weight;
	}
	return Pool.Last().Type;
}
```

:::

**Engine notes**

- **Unity:** coroutines with `WaitForSeconds` follow `Time.timeScale`, so waves pause with the game. `Camera.main` is cached by Unity 2020.2 and later, but still look it up once, as here.
- **Godot:** `Camera3D.is_position_in_frustum` does the view test, and `tree_exiting` is a free "died or despawned" signal for any node; it also fires when the level unloads, so disconnect or stop the runner first if that matters. Godot 4.3 added `RandomNumberGenerator.rand_weighted`, which can replace `_pick_weighted`.
- **Unreal:** `ATargetPoint` is the usual spawn marker, and the **Environment Query System** can do the point selection (distance and visibility tests, scoring) without code. `OnDestroyed` covers both death and despawn. Timers follow global time dilation and pausing.

## When to use

- Horde, survival, tower defence and arena modes, roguelike rooms, and ambient spawning in open worlds.
- Whenever designers need to tune pacing: counts, mixes, timing and breaks.

## When not to use

- Static levels where enemies are placed by hand. Put them in the scene.
- A single respawn point for the player. Use [Checkpoint / Respawn](./checkpoint).
- When enemy counts and timing never change. A wave system's tuning tools won't be used.

## Pitfalls

- **Enemies that leave without dying.** Enemies that fall out of the world, despawn or get pooled without raising `Died` leave `Alive` stuck above zero, and the wave never ends. Raise the event on *every* removal path, and add a debug view of alive counts.
- **Spawning in view.** Players notice enemies appearing out of nothing. Check the camera frustum *and* line of sight, and prefer points behind the player or behind cover.
- **No valid point.** In small arenas, every point can be visible or too close at once. Wait and retry, as here, or relax one rule at a time rather than spawning in view.
- **Fixed waves get stale.** Pure scripts are memorised quickly. Add weighted variety, or switch to a budget system: each wave has "threat points" that it spends on enemies with different costs.
- **Allocation spikes.** Instantiating 30 enemies on the first frame of a wave hitches. Pool enemies, and spread spawns over frames with intervals.

## Related

- [Type Object](./type-object) — enemy kinds referenced by waves.
- [Weighted Random & Loot Tables](./weighted-random) — weighted pools of enemy types.
- [Object Pool](./object-pool) — reuse enemies between waves.
- [Observer](./observer) — death events drive the alive count.
- [Seeded Randomness](./seeded-randomness) — reproducible wave mixes for daily challenges and replays.
- [AI Director](./director-ai) — a meta-system that adjusts spawning to the player's stress level.
