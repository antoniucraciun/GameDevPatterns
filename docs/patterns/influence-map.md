# Influence Map

> A grid of values (threat, control, interest) that agents use to reason about space.

**Category:** AI & Decision Making

## Problem

A tactical AI must answer spatial questions: *Where is it safe to retreat? Which part of the map does the enemy control? Where should the flanking squad attack from? Where is the front line?* Answering them by looping over every unit for every candidate position is slow, and each agent asking separately repeats the work. Hard-coding "retreat to waypoint 7" breaks as soon as the battle moves.

## Solution

Keep **grids of numbers over the map**. Each unit **stamps** its influence onto the grid, strongest at its position and falling off with distance. Agents then **query** the grid instead of the units.

- **Layers** for different meanings: *enemy threat*, *ally strength*, *visibility*, *interest* (loot, objectives).
- **Combining** layers answers questions: `control = ally − threat` shows who owns each area, the cells where control is near zero form the front line, and `safety = −threat + 0.5 × cover` picks retreat spots.
- **Decay and propagation** give memory: old influence fades over time, so the map remembers where enemies *were* recently, not just where they are.
- Maps are **updated once** (every few frames), then shared by every agent.

## Example

The **core** is a grid of floats with two operations, decay and stamp. The **engine wiring** keeps a threat map and an ally map up to date a few times per second and answers tactical questions from them.

### Core

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class InfluenceMap
{
    public readonly int Width, Height;
    public readonly float CellSize;
    readonly Vector3 origin;
    readonly float[] values;

    public InfluenceMap(int width, int height, float cellSize, Vector3 origin)
    {
        Width = width; Height = height; CellSize = cellSize; this.origin = origin;
        values = new float[width * height];
    }

    public Vector2Int CellOf(Vector3 p) =>
        new(Mathf.FloorToInt((p.x - origin.x) / CellSize), Mathf.FloorToInt((p.z - origin.z) / CellSize));

    public Vector3 CenterOf(int x, int y) =>
        origin + new Vector3((x + 0.5f) * CellSize, 0f, (y + 0.5f) * CellSize);

    public float this[int x, int y] => values[y * Width + x];

    // Multiply everything toward zero: old information fades instead of vanishing.
    public void Decay(float factor)
    {
        for (int i = 0; i < values.Length; i++) values[i] *= factor;
    }

    // Add influence with linear falloff, strongest at the centre.
    public void Stamp(Vector3 position, float strength, float radius)
    {
        var c = CellOf(position);
        int r = Mathf.CeilToInt(radius / CellSize);
        for (int y = Mathf.Max(0, c.y - r); y <= Mathf.Min(Height - 1, c.y + r); y++)
        for (int x = Mathf.Max(0, c.x - r); x <= Mathf.Min(Width - 1, c.x + r); x++)
        {
            float d = Vector2.Distance(new Vector2(x, y), c) * CellSize;
            if (d > radius) continue;
            values[y * Width + x] += strength * (1f - d / radius);
        }
    }
}
```

```gdscript [Godot (GDScript)]
# influence_map.gd: cells lie on the XZ plane, starting at origin.
class_name InfluenceMap
extends RefCounted

var width: int
var height: int
var cell_size: float
var origin: Vector3
var _values := PackedFloat32Array()


func _init(p_width: int, p_height: int, p_cell_size: float, p_origin: Vector3) -> void:
	width = p_width
	height = p_height
	cell_size = p_cell_size
	origin = p_origin
	_values.resize(width * height)
	_values.fill(0.0)


func cell_of(p: Vector3) -> Vector2i:
	return Vector2i(floori((p.x - origin.x) / cell_size), floori((p.z - origin.z) / cell_size))


func center_of(x: int, y: int) -> Vector3:
	return origin + Vector3((x + 0.5) * cell_size, 0.0, (y + 0.5) * cell_size)


func value_at(x: int, y: int) -> float:
	return _values[y * width + x]


## Multiply everything toward zero: old information fades instead of vanishing.
func decay(factor: float) -> void:
	for i in _values.size():
		_values[i] *= factor


## Add influence with linear falloff, strongest at the centre.
func stamp(position: Vector3, strength: float, radius: float) -> void:
	var c := cell_of(position)
	var r := ceili(radius / cell_size)
	for y in range(maxi(0, c.y - r), mini(height - 1, c.y + r) + 1):
		for x in range(maxi(0, c.x - r), mini(width - 1, c.x + r) + 1):
			var d := Vector2(x, y).distance_to(Vector2(c)) * cell_size
			if d > radius:
				continue
			_values[y * width + x] += strength * (1.0 - d / radius)
```

```cpp [Unreal (C++)]
// InfluenceMap.h: plain C++. Unreal is Z-up, so cells lie on the XY plane.
#pragma once

#include "CoreMinimal.h"

class FInfluenceMap
{
public:
	FInfluenceMap(int32 InWidth, int32 InHeight, float InCellSize, const FVector& InOrigin)
		: Width(InWidth), Height(InHeight), CellSize(InCellSize), Origin(InOrigin)
	{
		Values.SetNumZeroed(Width * Height);
	}

	int32 GetWidth() const { return Width; }
	int32 GetHeight() const { return Height; }
	float GetCellSize() const { return CellSize; }
	float Get(int32 X, int32 Y) const { return Values[Y * Width + X]; }

	FIntPoint CellOf(const FVector& P) const
	{
		return FIntPoint(FMath::FloorToInt((P.X - Origin.X) / CellSize), FMath::FloorToInt((P.Y - Origin.Y) / CellSize));
	}

	FVector CenterOf(int32 X, int32 Y) const
	{
		return Origin + FVector((X + 0.5f) * CellSize, (Y + 0.5f) * CellSize, 0.f);
	}

	// Multiply everything toward zero: old information fades instead of vanishing.
	void Decay(float Factor)
	{
		for (float& V : Values) V *= Factor;
	}

	// Add influence with linear falloff, strongest at the centre.
	void Stamp(const FVector& Position, float Strength, float Radius)
	{
		const FIntPoint C = CellOf(Position);
		const int32 R = FMath::CeilToInt(Radius / CellSize);
		for (int32 Y = FMath::Max(0, C.Y - R); Y <= FMath::Min(Height - 1, C.Y + R); ++Y)
		for (int32 X = FMath::Max(0, C.X - R); X <= FMath::Min(Width - 1, C.X + R); ++X)
		{
			const float D = FVector2f::Distance(FVector2f(X, Y), FVector2f(C.X, C.Y)) * CellSize;
			if (D > Radius) continue;
			Values[Y * Width + X] += Strength * (1.f - D / Radius);
		}
	}

private:
	int32 Width, Height;
	float CellSize;
	FVector Origin;
	TArray<float> Values;
};
```

:::

### Engine wiring

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class TacticalMaps : MonoBehaviour
{
    public InfluenceMap Threat { get; private set; }       // enemy danger
    public InfluenceMap Allies { get; private set; }       // friendly strength

    [SerializeField] float updateInterval = 0.25f;
    [SerializeField, Range(0f, 1f)] float decay = 0.8f;   // per update: 0.8 keeps a short memory
    float next;

    void Awake()
    {
        Threat = new InfluenceMap(100, 100, 2f, Vector3.zero);
        Allies = new InfluenceMap(100, 100, 2f, Vector3.zero);
    }

    void Update()
    {
        if (Time.time < next) return;
        next = Time.time + updateInterval;

        Threat.Decay(decay);
        Allies.Decay(decay);
        foreach (var u in Unit.All)                         // stamped once, read by every agent
        {
            var map = u.IsEnemyOfPlayerTeam ? Threat : Allies;
            map.Stamp(u.transform.position, u.CombatPower, u.ThreatRadius);
        }
    }

    // "Where should I retreat to?" The safest reachable cell near me, preferring friendly territory.
    public Vector3 BestRetreat(Vector3 from, float searchRadius)
    {
        var c = Threat.CellOf(from);
        int r = Mathf.CeilToInt(searchRadius / Threat.CellSize);
        float best = float.MinValue;
        Vector3 bestPos = from;

        for (int y = Mathf.Max(0, c.y - r); y <= Mathf.Min(Threat.Height - 1, c.y + r); y++)
        for (int x = Mathf.Max(0, c.x - r); x <= Mathf.Min(Threat.Width - 1, c.x + r); x++)
        {
            float score = Allies[x, y] * 0.5f - Threat[x, y];
            float travel = Vector2.Distance(new Vector2(x, y), c) * 0.05f;   // prefer closer options
            if (score - travel > best) { best = score - travel; bestPos = Threat.CenterOf(x, y); }
        }
        return bestPos;
    }

    // The front line: cells where the two sides are roughly balanced and both present.
    public bool IsFrontLine(int x, int y) =>
        Threat[x, y] > 0.5f && Allies[x, y] > 0.5f && Mathf.Abs(Allies[x, y] - Threat[x, y]) < 0.5f;
}

// Unit: a component with IsEnemyOfPlayerTeam, CombatPower and ThreatRadius, registered in Unit.All.
```

```gdscript [Godot (GDScript)]
# tactical_maps.gd: an autoload ("TacticalMaps"), so every agent reads the same maps.
extends Node

@export var update_interval := 0.25
@export_range(0.0, 1.0) var decay := 0.8  # per update: 0.8 keeps a short memory

var threat := InfluenceMap.new(100, 100, 2.0, Vector3.ZERO)  # enemy danger
var allies := InfluenceMap.new(100, 100, 2.0, Vector3.ZERO)  # friendly strength
var _time_to_update := 0.0


func _process(delta: float) -> void:
	_time_to_update -= delta
	if _time_to_update > 0.0:
		return
	_time_to_update = update_interval

	threat.decay(decay)
	allies.decay(decay)
	# Combatant: your unit script (class_name Combatant) with is_enemy, combat_power and
	# threat_radius, which adds itself to the "units" group.
	for u: Combatant in get_tree().get_nodes_in_group(&"units"):  # stamped once, read by every agent
		var map := threat if u.is_enemy else allies
		map.stamp(u.global_position, u.combat_power, u.threat_radius)


## "Where should I retreat to?" The safest cell near me, preferring friendly territory.
func best_retreat(from: Vector3, search_radius: float) -> Vector3:
	var c := threat.cell_of(from)
	var r := ceili(search_radius / threat.cell_size)
	var best := -INF
	var best_pos := from
	for y in range(maxi(0, c.y - r), mini(threat.height - 1, c.y + r) + 1):
		for x in range(maxi(0, c.x - r), mini(threat.width - 1, c.x + r) + 1):
			var score := allies.value_at(x, y) * 0.5 - threat.value_at(x, y)
			var travel := Vector2(x, y).distance_to(Vector2(c)) * 0.05  # prefer closer options
			if score - travel > best:
				best = score - travel
				best_pos = threat.center_of(x, y)
	return best_pos


## The front line: cells where the two sides are roughly balanced and both present.
func is_front_line(x: int, y: int) -> bool:
	var t := threat.value_at(x, y)
	var a := allies.value_at(x, y)
	return t > 0.5 and a > 0.5 and absf(a - t) < 0.5
```

```cpp [Unreal (C++)]
// TacticalMapsSubsystem.h: one per world, so every agent reads the same maps.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "InfluenceMap.h"
#include "TacticalMapsSubsystem.generated.h"

class UCombatantComponent;   // your unit component: bIsEnemy, CombatPower, ThreatRadius; registers itself

UCLASS()
class UTacticalMapsSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	void Register(UCombatantComponent* Unit) { Units.AddUnique(Unit); }
	void Unregister(UCombatantComponent* Unit) { Units.Remove(Unit); }

	const FInfluenceMap& GetThreat() const { return Threat; }   // enemy danger
	const FInfluenceMap& GetAllies() const { return Allies; }   // friendly strength

	FVector BestRetreat(const FVector& From, float SearchRadius) const;
	bool IsFrontLine(int32 X, int32 Y) const;

protected:
	virtual void OnWorldBeginPlay(UWorld& InWorld) override;

private:
	void UpdateMaps();

	FInfluenceMap Threat{100, 100, 200.f, FVector::ZeroVector};
	FInfluenceMap Allies{100, 100, 200.f, FVector::ZeroVector};
	float UpdateInterval = 0.25f;
	float DecayFactor = 0.8f;                   // per update: 0.8 keeps a short memory
	FTimerHandle UpdateTimer;

	UPROPERTY()
	TArray<TObjectPtr<UCombatantComponent>> Units;
};

// TacticalMapsSubsystem.cpp
#include "TacticalMapsSubsystem.h"
#include "CombatantComponent.h"
#include "TimerManager.h"

void UTacticalMapsSubsystem::OnWorldBeginPlay(UWorld& InWorld)
{
	Super::OnWorldBeginPlay(InWorld);
	InWorld.GetTimerManager().SetTimer(UpdateTimer, this, &UTacticalMapsSubsystem::UpdateMaps, UpdateInterval, true);
}

void UTacticalMapsSubsystem::UpdateMaps()
{
	Threat.Decay(DecayFactor);
	Allies.Decay(DecayFactor);
	for (const UCombatantComponent* U : Units)  // stamped once, read by every agent
	{
		FInfluenceMap& Map = U->bIsEnemy ? Threat : Allies;
		Map.Stamp(U->GetOwner()->GetActorLocation(), U->CombatPower, U->ThreatRadius);
	}
}

// "Where should I retreat to?" The safest cell near me, preferring friendly territory.
FVector UTacticalMapsSubsystem::BestRetreat(const FVector& From, float SearchRadius) const
{
	const FIntPoint C = Threat.CellOf(From);
	const int32 R = FMath::CeilToInt(SearchRadius / Threat.GetCellSize());
	float Best = TNumericLimits<float>::Lowest();
	FVector BestPos = From;
	for (int32 Y = FMath::Max(0, C.Y - R); Y <= FMath::Min(Threat.GetHeight() - 1, C.Y + R); ++Y)
	for (int32 X = FMath::Max(0, C.X - R); X <= FMath::Min(Threat.GetWidth() - 1, C.X + R); ++X)
	{
		const float Score = Allies.Get(X, Y) * 0.5f - Threat.Get(X, Y);
		const float Travel = FVector2f::Distance(FVector2f(X, Y), FVector2f(C.X, C.Y)) * 0.05f;   // prefer closer
		if (Score - Travel > Best) { Best = Score - Travel; BestPos = Threat.CenterOf(X, Y); }
	}
	return BestPos;
}

// The front line: cells where the two sides are roughly balanced and both present.
bool UTacticalMapsSubsystem::IsFrontLine(int32 X, int32 Y) const
{
	const float T = Threat.Get(X, Y), A = Allies.Get(X, Y);
	return T > 0.5f && A > 0.5f && FMath::Abs(A - T) < 0.5f;
}
```

:::

Draw the maps as a coloured overlay with [Debug Draw](./debug-draw) while tuning. Influence maps are much easier to reason about when you can see them.

**Engine notes**

- **Unity:** for large maps, store the values in a `NativeArray<float>` and run `Decay` and the stamps in Burst jobs. A `Texture2D` written from the array makes a cheap debug overlay.
- **Godot:** an autoload is the natural home for maps every agent shares. For a debug overlay, write the values into an `Image` and show it as an `ImageTexture` on a plane or in a `TextureRect`.
- **Unreal:** no built-in influence map. For *one-off* position scoring, the **Environment Query System** fits better (score candidate points by distance, visibility and custom tests); influence maps win when many agents ask about the same space every second. `OnWorldBeginPlay` is the subsystem's hook once actors have begun play.

## When to use

- Strategy and tactics games: territory control, front lines, flanking, choosing where to build or attack.
- Squad AI: retreat points, cover selection, avoiding kill zones, finding where the player was recently seen.
- Ambient or crowd behaviour: NPCs avoiding dangerous districts, animals avoiding hunters.

## When not to use

- AI with simple tactical needs, such as "move toward the player". Distance checks or raycasts are enough.
- Fast, fine-grained queries. The grid resolution limits accuracy; use [Spatial Partition](./spatial-partition) queries instead.
- Small arenas with few units. The map adds update cost and tuning work without much information.

## Pitfalls

- **Ignoring walls.** Linear falloff spreads threat through walls, so "safe" spots may be right behind a wall from an enemy who has to walk around. Propagate influence with a flood fill that respects obstacles, or factor in line of sight.
- **Resolution.** Fine grids cost memory and stamping time. Coarse grids blur tactical detail. Use a cell size matched to the decisions being made (squad positions, not individual footsteps).
- **Update cost.** Stamping hundreds of units with large radii every frame adds up. Update every few frames, stamp only changed units, or run stamping in a [Job](./job-system).
- **Unnormalised layers.** Adding layers with very different scales makes one dominate. Normalise, or weight layers deliberately, and document the weights.
- **Agents all choosing the same cell.** Ten agents querying "best retreat" pick the same spot. Stamp *reservations* into an interest layer, or add each agent's own position into the scoring.

## Related

- [Utility AI](./utility-ai) — influence values make excellent inputs for utility considerations.
- [Flow Field](./flow-field) — another shared grid that agents read.
- [Spatial Partition](./spatial-partition) — a grid organising objects. An influence map is a grid of values.
- [Blackboard](./blackboard) — agents store chosen positions there.
- [AI Director](./director-ai) — reads aggregate threat to judge how intense the game is.
