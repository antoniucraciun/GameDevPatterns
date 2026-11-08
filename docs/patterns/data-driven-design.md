# Data-Driven Design

> Move tuning and content out of code into data designers can edit.

**Category:** Data, Content & Procedural Generation

## Problem

Jump height is a constant in `PlayerController.cs`. Enemy health lives in the enemy class. Level 3's spawn timings are hard-coded in a coroutine. Every balance tweak goes through a programmer, a recompile and an editor reload, so designers queue up requests and iteration slows to a crawl. Worse, values are scattered: nobody can answer "what are all the weapon damage numbers?" without reading code.

## Solution

Treat **behaviour** as code and **content and tuning** as data:

- **Code** defines *what can happen*: a weapon fires projectiles with some damage, rate and spread.
- **Data** defines *which instances exist and how they are tuned*: the shotgun deals 8 × 6 pellets at 1.2 shots per second.

Data lives where designers can edit it, with fast feedback:

| Format | Best for | Notes |
| --- | --- | --- |
| **Engine data assets** (Unity ScriptableObjects, Godot `Resource`s, Unreal Data Assets and Data Tables) | Most content: items, enemies, abilities, waves | Editing in the engine's editor, references to other assets |
| **Spreadsheets → import** (CSV/JSON) | Large tables: 300 items, level-up curves, localisation | Designers use familiar tools, and you get easy bulk edits and diffs |
| **JSON/YAML at runtime** | Modding, live-ops balance updates, server-driven config | Loaded without a new build. Needs validation and versioning. |
| **AnimationCurve / Gradient fields** | Shapes: difficulty over time, damage falloff, XP curves | Visual editing, sampled at runtime |

Validate data **at edit time** (`OnValidate`, import checks), so mistakes show up as errors in the editor rather than bugs in a build.

## Example

Weapons as data. A **definition asset** holds every number, curve and asset reference, with validation so designers see mistakes in the editor; the **behaviour** code reads it and contains no tuning values; an **importer** lets designers balance in a spreadsheet.

### The weapon definition

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

[CreateAssetMenu(menuName = "Weapons/Weapon")]
public class WeaponData : ScriptableObject
{
    [Header("Damage")]
    [Min(0)] public float damagePerPellet = 10f;
    [Min(1)] public int pellets = 1;
    [Tooltip("Damage multiplier by distance (x = metres, y = multiplier).")]
    public AnimationCurve falloff = AnimationCurve.Linear(0f, 1f, 30f, 0.3f);

    [Header("Handling")]
    [Min(0.01f)] public float shotsPerSecond = 2f;
    [Range(0f, 45f)] public float spreadDegrees = 2f;
    [Min(1)] public int magazineSize = 12;
    [Min(0f)] public float reloadSeconds = 1.5f;

    [Header("Presentation")]
    public GameObject projectilePrefab;
    public AudioClip fireSound;

    public float DamageAt(float distance) => damagePerPellet * falloff.Evaluate(distance);

    // Designers see problems immediately, in the inspector.
    void OnValidate()
    {
        if (projectilePrefab == null) Debug.LogWarning($"{name}: no projectile prefab assigned", this);
        if (pellets > 1 && spreadDegrees == 0f) Debug.LogWarning($"{name}: multiple pellets with no spread", this);
    }
}
```

```gdscript [Godot (GDScript)]
# weapon_data.gd: create .tres files of this type in the FileSystem dock (New Resource...).
class_name WeaponData
extends Resource

@export_group("Damage")
@export_range(0.0, 1000.0, 0.1, "or_greater") var damage_per_pellet := 10.0
@export_range(1, 32) var pellets := 1
## Damage multiplier over distance. The curve's x axis is 0..1, scaled to falloff_range metres.
@export var falloff: Curve
@export var falloff_range := 30.0

@export_group("Handling")
@export_range(0.01, 30.0, 0.01) var shots_per_second := 2.0
@export_range(0.0, 45.0, 0.1) var spread_degrees := 2.0
@export_range(1, 200) var magazine_size := 12
@export_range(0.0, 10.0, 0.05) var reload_seconds := 1.5

@export_group("Presentation")
@export var projectile_scene: PackedScene
@export var fire_sound: AudioStream


func damage_at(distance: float) -> float:
	if falloff == null:
		return damage_per_pellet
	return damage_per_pellet * falloff.sample(clampf(distance / falloff_range, 0.0, 1.0))


# Resources can't show editor warnings themselves; the Weapon node below reports these.
func get_problems() -> PackedStringArray:
	var problems := PackedStringArray()
	if projectile_scene == null:
		problems.append("%s: no projectile scene assigned" % resource_path)
	if pellets > 1 and spread_degrees == 0.0:
		problems.append("%s: multiple pellets with no spread" % resource_path)
	return problems
```

```cpp [Unreal (C++)]
// WeaponData.h: a Data Asset. Create instances via Content Browser > Miscellaneous > Data Asset.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "Curves/CurveFloat.h"
#include "WeaponData.generated.h"

UCLASS(BlueprintType)
class UWeaponData : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditDefaultsOnly, Category = "Damage", meta = (ClampMin = "0"))
	float DamagePerPellet = 10.f;

	UPROPERTY(EditDefaultsOnly, Category = "Damage", meta = (ClampMin = "1"))
	int32 Pellets = 1;

	// Damage multiplier by distance (x = centimetres, y = multiplier). Edited inline, or points at a Curve asset.
	UPROPERTY(EditDefaultsOnly, Category = "Damage")
	FRuntimeFloatCurve Falloff;

	UPROPERTY(EditDefaultsOnly, Category = "Handling", meta = (ClampMin = "0.01"))
	float ShotsPerSecond = 2.f;

	UPROPERTY(EditDefaultsOnly, Category = "Handling", meta = (ClampMin = "0", ClampMax = "45"))
	float SpreadDegrees = 2.f;

	UPROPERTY(EditDefaultsOnly, Category = "Handling", meta = (ClampMin = "1"))
	int32 MagazineSize = 12;

	UPROPERTY(EditDefaultsOnly, Category = "Handling", meta = (ClampMin = "0"))
	float ReloadSeconds = 1.5f;

	UPROPERTY(EditDefaultsOnly, Category = "Presentation")
	TSubclassOf<AActor> ProjectileClass;

	UPROPERTY(EditDefaultsOnly, Category = "Presentation")
	TObjectPtr<USoundBase> FireSound;

	float DamageAt(float Distance) const
	{
		const FRichCurve* Curve = Falloff.GetRichCurveConst();
		return DamagePerPellet * (Curve && Curve->GetNumKeys() > 0 ? Curve->Eval(Distance) : 1.f);
	}

#if WITH_EDITOR
	// Runs on save and from Tools > Validate Data; problems show in the Message Log.
	virtual EDataValidationResult IsDataValid(FDataValidationContext& Context) const override;
#endif
};

// WeaponData.cpp
#include "WeaponData.h"
#include "Misc/DataValidation.h"

#if WITH_EDITOR
EDataValidationResult UWeaponData::IsDataValid(FDataValidationContext& Context) const
{
	EDataValidationResult Result = Super::IsDataValid(Context);
	if (!ProjectileClass)
	{
		Context.AddError(FText::FromString(GetName() + TEXT(": no projectile class assigned")));
		Result = EDataValidationResult::Invalid;
	}
	if (Pellets > 1 && SpreadDegrees == 0.f)
		Context.AddWarning(FText::FromString(GetName() + TEXT(": multiple pellets with no spread")));
	return Result;
}
#endif
```

:::

### Behaviour reads the data

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

// Code only implements behaviour; every number comes from data.
public class Weapon : MonoBehaviour
{
    [SerializeField] WeaponData data;
    float nextShot;
    int ammo;

    void Start() => ammo = data.magazineSize;

    public void TryFire(Vector3 direction)
    {
        if (Time.time < nextShot || ammo <= 0) return;
        nextShot = Time.time + 1f / data.shotsPerSecond;
        ammo--;

        for (int i = 0; i < data.pellets; i++)
        {
            Vector3 dir = Quaternion.Euler(Random.Range(-data.spreadDegrees, data.spreadDegrees),
                                           Random.Range(-data.spreadDegrees, data.spreadDegrees), 0f) * direction;
            Instantiate(data.projectilePrefab, transform.position, Quaternion.LookRotation(dir));
        }
    }
}
```

```gdscript [Godot (GDScript)]
# weapon.gd: @tool only so the editor can show the data's problems as node warnings.
@tool
class_name Weapon
extends Node3D

@export var data: WeaponData:
	set(value):
		data = value
		update_configuration_warnings()

var _cooldown := 0.0
var _ammo := 0


func _ready() -> void:
	if data:
		_ammo = data.magazine_size


func _process(delta: float) -> void:
	_cooldown = maxf(_cooldown - delta, 0.0)


func _get_configuration_warnings() -> PackedStringArray:
	return data.get_problems() if data else PackedStringArray(["Assign a WeaponData resource."])


func try_fire(direction: Vector3) -> void:
	if _cooldown > 0.0 or _ammo <= 0:
		return
	_cooldown = 1.0 / data.shots_per_second
	_ammo -= 1

	var spread := deg_to_rad(data.spread_degrees)
	for i in data.pellets:
		var tilt := Basis.from_euler(Vector3(randf_range(-spread, spread), randf_range(-spread, spread), 0.0))
		var projectile := data.projectile_scene.instantiate() as Node3D
		get_tree().current_scene.add_child(projectile)
		projectile.global_position = global_position
		projectile.look_at(global_position + tilt * direction)
```

```cpp [Unreal (C++)]
// WeaponComponent.h: code only implements behaviour; every number comes from the Data Asset.
#pragma once

#include "CoreMinimal.h"
#include "Components/SceneComponent.h"
#include "WeaponComponent.generated.h"

class UWeaponData;

UCLASS(ClassGroup = (Combat), meta = (BlueprintSpawnableComponent))
class UWeaponComponent : public USceneComponent
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Weapon") TObjectPtr<UWeaponData> Data;

	UFUNCTION(BlueprintCallable, Category = "Weapon")
	void TryFire(FVector Direction);

protected:
	virtual void BeginPlay() override;

private:
	double NextShotTime = 0.0;
	int32 Ammo = 0;
};

// WeaponComponent.cpp
#include "WeaponComponent.h"
#include "WeaponData.h"

void UWeaponComponent::BeginPlay()
{
	Super::BeginPlay();
	if (Data) Ammo = Data->MagazineSize;
}

void UWeaponComponent::TryFire(FVector Direction)
{
	const double Now = GetWorld()->GetTimeSeconds();
	if (!Data || Now < NextShotTime || Ammo <= 0) return;
	NextShotTime = Now + 1.0 / Data->ShotsPerSecond;
	--Ammo;

	const float Spread = Data->SpreadDegrees;
	for (int32 I = 0; I < Data->Pellets; ++I)
	{
		const FRotator Tilt(FMath::FRandRange(-Spread, Spread), FMath::FRandRange(-Spread, Spread), 0.f);
		const FVector Dir = Tilt.RotateVector(Direction);
		GetWorld()->SpawnActor<AActor>(Data->ProjectileClass, GetComponentLocation(), Dir.Rotation());
	}
}
```

:::

### Balancing in a spreadsheet

Designers balance in a table and the game reads assets. Unity and Godot need a small importer that **updates existing assets** rather than recreating them, so references that only exist on the asset (prefabs, sounds) survive each import. Unreal imports spreadsheets natively as Data Tables and Curve Tables.

::: code-group

```csharp [Unity (C#)]
#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

public static class WeaponImporter
{
    // CSV columns: id,damage,pellets,rate,spread,magazine,reload
    [MenuItem("Tools/Import Weapons CSV")]
    static void Import()
    {
        string path = EditorUtility.OpenFilePanel("Weapons CSV", "", "csv");
        if (string.IsNullOrEmpty(path)) return;

        var lines = System.IO.File.ReadAllLines(path);
        for (int i = 1; i < lines.Length; i++)                      // skip the header row
        {
            var c = lines[i].Split(',');
            string assetPath = $"Assets/Data/Weapons/{c[0]}.asset";
            var w = AssetDatabase.LoadAssetAtPath<WeaponData>(assetPath);
            if (w == null) { w = ScriptableObject.CreateInstance<WeaponData>(); AssetDatabase.CreateAsset(w, assetPath); }

            var inv = System.Globalization.CultureInfo.InvariantCulture;
            w.damagePerPellet = float.Parse(c[1], inv);
            w.pellets         = int.Parse(c[2], inv);
            w.shotsPerSecond  = float.Parse(c[3], inv);
            w.spreadDegrees   = float.Parse(c[4], inv);
            w.magazineSize    = int.Parse(c[5], inv);
            w.reloadSeconds   = float.Parse(c[6], inv);
            EditorUtility.SetDirty(w);                              // keeps prefab and sound references
        }
        AssetDatabase.SaveAssets();
    }
}
#endif
```

```gdscript [Godot (GDScript)]
# import_weapons.gd: open in the Script editor and run with File > Run (Ctrl+Shift+X).
# Godot imports .csv files as translations by default: select weapons.csv and set its
# import mode to "Keep File" in the Import dock so it stays a plain file.
@tool
extends EditorScript

const SOURCE := "res://data/weapons.csv"  # columns: id,damage,pellets,rate,spread,magazine,reload
const TARGET_DIR := "res://data/weapons/"


func _run() -> void:
	var file := FileAccess.open(SOURCE, FileAccess.READ)
	if file == null:
		push_error("Can't open %s: %s" % [SOURCE, error_string(FileAccess.get_open_error())])
		return
	file.get_csv_line()  # skip the header row
	while not file.eof_reached():
		var c := file.get_csv_line()
		if c.size() < 7:
			continue  # blank trailing line
		var path := TARGET_DIR + c[0] + ".tres"
		# Load the existing resource so fields the sheet doesn't cover (scenes, sounds) survive.
		var w: WeaponData = load(path) if ResourceLoader.exists(path) else WeaponData.new()
		w.damage_per_pellet = c[1].to_float()  # to_float/to_int ignore the OS locale
		w.pellets = c[2].to_int()
		w.shots_per_second = c[3].to_float()
		w.spread_degrees = c[4].to_float()
		w.magazine_size = c[5].to_int()
		w.reload_seconds = c[6].to_float()
		ResourceSaver.save(w, path)
	print("Imported weapons from ", SOURCE)
```

```cpp [Unreal (C++)]
// WeaponStatsRow.h: the row type of a Data Table. Import weapons.csv (or .json) by dragging it
// into the Content Browser and picking this struct; the first column is the row name.
// Reimporting updates the table in place, so everything referencing it keeps working.
// CSV header: Name,DamagePerPellet,Pellets,ShotsPerSecond,SpreadDegrees,MagazineSize,ReloadSeconds
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataTable.h"
#include "Engine/CurveTable.h"
#include "WeaponStatsRow.generated.h"

USTRUCT(BlueprintType)
struct FWeaponStatsRow : public FTableRowBase
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly) float DamagePerPellet = 10.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 Pellets = 1;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) float ShotsPerSecond = 2.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) float SpreadDegrees = 2.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 MagazineSize = 12;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) float ReloadSeconds = 1.5f;
};

// Falloff curves live in a Curve Table, also imported from CSV: one row per weapon,
// columns are distances, cells are multipliers (Name,0,1500,3000 / Shotgun,1,0.6,0.3).
USTRUCT(BlueprintType)
struct FWeaponTuning
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, meta = (RowType = "/Script/MyGame.WeaponStatsRow"))
	FDataTableRowHandle Stats;            // pick table + row in the editor

	UPROPERTY(EditAnywhere)
	FCurveTableRowHandle Falloff;

	const FWeaponStatsRow* GetStats() const { return Stats.GetRow<FWeaponStatsRow>(TEXT("Weapon stats")); }

	float FalloffAt(float Distance) const
	{
		const FRealCurve* Curve = Falloff.GetCurve(TEXT("Weapon falloff"));
		return Curve ? Curve->Eval(Distance) : 1.f;
	}
};
```

:::

**Engine notes**

- **Unity:** ScriptableObjects are the standard container, with `[Min]`, `[Range]`, `[Header]` and `OnValidate` for editor feedback. Spreadsheet importers are always custom (or a tool such as a Google Sheets plugin); `ScriptedImporter` can turn a `.csv` into assets automatically on every change instead of a menu item.
- **Godot:** custom `Resource`s saved as `.tres` are the equivalent, with `@export_range` and `@export_group` for the inspector. `Curve` samples over x = 0..1 on most 4.x versions (4.4 added a configurable domain), hence `falloff_range`. `FileAccess.get_csv_line()` and `JSON.parse_string()` read external data; remember that `.csv` files default to the translation importer.
- **Unreal:** Data Assets (`UPrimaryDataAsset`) hold per-item definitions, and **Data Tables** and **Curve Tables** import CSV/JSON natively, can be reimported, and are read with `FindRow` or row handles. `IsDataValid(FDataValidationContext&)` is the Unreal 5.3+ signature (older versions take `TArray<FText>&`). Replace `MyGame` in `RowType` with your module name.

## When to use

## When to use

- Anything designers tune: stats, timings, curves, costs, drop rates, spawn tables, dialogue.
- Content that grows in volume: hundreds of items, levels or abilities.
- Live games that adjust balance without a client update.

## When not to use

- Values only a programmer will ever change. A constant in code is easier to find and refactor.
- Logic that doesn't fit in data. Forcing it into data creates a weak programming language; use code or a proper [Interpreter](./interpreter).
- Prototypes, where requirements are still moving. Pull values out into data once the design settles.

## Pitfalls

- **Logic hiding in data.** Flags like `isSpecialBossThatDoesTheThing` turn data into a bad programming language. When data needs real logic, add a code hook, such as a [Strategy](./strategy) reference or an effect list.
- **No validation.** A typo in a spreadsheet becomes a 10,000-damage pistol in production. Validate ranges and references on import and in `OnValidate`, and fail loudly.
- **Runtime edits persisting in the editor.** In Unity and in Unreal's Play In Editor, the game uses the editor's own asset objects, so changing a data asset at runtime changes it in the editor too (Unity saves the change to disk). In Godot, a loaded `Resource` is shared, so a runtime change affects everything using it. Treat data as read-only at runtime, and keep mutable state on instances.
- **Culture-dependent parsing.** `float.Parse("1.5")` fails on machines that use a decimal comma. Always parse with `CultureInfo.InvariantCulture`.
- **Two sources of truth.** If both the spreadsheet and the assets are edited, imports overwrite manual changes. Decide which is authoritative for which fields.

## Related

- [Type Object](./type-object) — data that defines new *kinds* of things.
- [Flyweight](./flyweight) — shared, read-only definitions.
- [ScriptableObject Architecture](./scriptable-object-architecture) — assets as the medium for data.
- [Weighted Random & Loot Tables](./weighted-random), [Spawner / Wave System](./spawner) and [Ability System](./ability-system) — data-driven systems built on this idea.
- [Localization Tables](./localization-tables) — the same approach applied to text.
