# Noise-Based Generation

> Layer coherent noise (Perlin, Simplex) to generate terrain and variation.

**Category:** Data, Content & Procedural Generation

## Problem

Generating terrain with an independent random value per tile gives static: every tile unrelated to its neighbours, with no hills, valleys or coastlines. Hand-authoring a large world is not feasible. You need randomness that is **smooth** (neighbours are similar), **structured** (big shapes with small details on top), **controllable** (designers can tune "more mountains") and **reproducible** (the same seed gives the same world).

## Solution

Use **coherent noise**: a function `noise(x, y)` that returns similar values for nearby inputs and varies smoothly. Perlin and Simplex noise are the standard choices. Then build up structure:

1. **Frequency and amplitude.** Sampling at `x * frequency` controls feature size (low frequency gives continents, high frequency gives pebbles). Multiplying by an amplitude controls height.
2. **Octaves (fractal Brownian motion).** Sum several layers, each at double the frequency (**lacunarity** ≈ 2) and half the amplitude (**persistence** ≈ 0.5). Big shapes come from the first octaves, and detail from the later ones.
3. **Shaping.** Remap the result with curves: `pow` for flatter lowlands and sharper peaks, an island mask that falls off toward the edges, terraces, or ridged noise (`1 - |noise|`) for mountain ridges.
4. **Multiple maps.** Separate noise maps for height, temperature and moisture. Classify biomes by combining them (hot and dry is desert, cold and wet is taiga).
5. **Seeding.** Offset the sample coordinates by values derived from the world seed, so each seed gives a different, reproducible world.

## Pseudocode

```text
// One fractal noise map: several octaves of coherent noise, seeded by offsets.
NoiseMap:
    scale, octaves, persistence, lacunarity
    offsets[octaves]   // random per octave, from a generator seeded with seed

    sample(x, y):      // roughly 0..1
        value ← 0; amplitude ← 1; frequency ← 1; total ← 0
        for each octave i:
            p ← (x, y) / scale × frequency + offsets[i]   // never integer coordinates
            value ← value + noise(p) × amplitude          // noise remapped to 0..1
            total ← total + amplitude
            amplitude ← amplitude × persistence   // each layer quieter...
            frequency ← frequency × lacunarity    // ...and finer
        return value / total

WorldGenerator(seed, size):
    height      ← NoiseMap(scale 120, 6 octaves, seed)
    moisture    ← NoiseMap(scale 200, 3 octaves, seed + 1)
    temperature ← NoiseMap(scale 300, 2 octaves, seed + 2)

    height_at(x, y):
        h ← height.sample(x, y) ^ 1.6     // flatter lowlands, sharper peaks
        edge ← distance of (x, y) from the centre, 0 at centre, 1 at the border
        return h × (1 - smoothstep(0.6, 1, edge))   // island mask

    biome_at(x, y):
        h ← height_at(x, y)
        if h < 0.12: return Ocean
        if h < 0.15: return Beach
        if h > 0.6:  return Mountain
        t ← temperature.sample(x, y) - h × 0.3    // higher is colder
        m ← moisture.sample(x, y)
        if t < 0.3:  return Tundra
        if m < 0.35: return Desert if t > 0.55, else Grassland
        return Forest if m > 0.6, else Grassland
```

## Example

Fractal noise with seeded offsets, an island mask and biome classification. The **core** is engine-free apart from each engine's noise function, so the same seed always gives the same world. The **engine wiring** paints the biomes into a texture as a preview.

### Core

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public struct NoiseSettings
{
    public float Scale;          // world units per noise unit (bigger = larger features)
    public int Octaves;          // 4–6 is typical
    public float Persistence;    // amplitude multiplier per octave (~0.5)
    public float Lacunarity;     // frequency multiplier per octave (~2)
}

public class NoiseMap
{
    readonly NoiseSettings s;
    readonly Vector2[] octaveOffsets;

    public NoiseMap(NoiseSettings settings, int seed)
    {
        s = settings;
        var rng = new System.Random(seed);                 // see Seeded Randomness
        octaveOffsets = new Vector2[s.Octaves];
        for (int i = 0; i < s.Octaves; i++)
            octaveOffsets[i] = new Vector2(rng.Next(-100000, 100000), rng.Next(-100000, 100000));
    }

    // Returns roughly 0..1.
    public float Sample(float x, float y)
    {
        float value = 0f, amplitude = 1f, frequency = 1f, max = 0f;
        for (int i = 0; i < s.Octaves; i++)
        {
            float nx = x / s.Scale * frequency + octaveOffsets[i].x;
            float ny = y / s.Scale * frequency + octaveOffsets[i].y;
            value += Mathf.PerlinNoise(nx, ny) * amplitude;
            max += amplitude;
            amplitude *= s.Persistence;
            frequency *= s.Lacunarity;
        }
        return value / max;                                // normalise to 0..1
    }
}

public enum Biome { Ocean, Beach, Desert, Grassland, Forest, Tundra, Mountain }

public class WorldGenerator
{
    readonly NoiseMap height, moisture, temperature;
    readonly int size;

    public WorldGenerator(int seed, int size)
    {
        this.size = size;
        height      = new NoiseMap(new NoiseSettings { Scale = 120f, Octaves = 6, Persistence = 0.5f, Lacunarity = 2f }, seed);
        moisture    = new NoiseMap(new NoiseSettings { Scale = 200f, Octaves = 3, Persistence = 0.5f, Lacunarity = 2f }, seed + 1);
        temperature = new NoiseMap(new NoiseSettings { Scale = 300f, Octaves = 2, Persistence = 0.5f, Lacunarity = 2f }, seed + 2);
    }

    public float Height(int x, int y)
    {
        float h = height.Sample(x, y);
        h = Mathf.Pow(h, 1.6f);                            // flatter lowlands, sharper peaks

        // Island mask: fade to ocean near the edges. Mathf.SmoothStep interpolates between its
        // first two arguments, so remap the edge distance to 0..1 first.
        float dx = x / (float)size * 2f - 1f, dy = y / (float)size * 2f - 1f;
        float edge = Mathf.InverseLerp(0.6f, 1f, Mathf.Max(Mathf.Abs(dx), Mathf.Abs(dy)));
        return h * (1f - Mathf.SmoothStep(0f, 1f, edge));
    }

    public Biome BiomeAt(int x, int y)
    {
        float h = Height(x, y);
        if (h < 0.12f) return Biome.Ocean;
        if (h < 0.15f) return Biome.Beach;
        if (h > 0.6f) return Biome.Mountain;

        float t = temperature.Sample(x, y) - h * 0.3f;     // higher is colder
        float m = moisture.Sample(x, y);
        if (t < 0.3f) return Biome.Tundra;
        if (m < 0.35f) return t > 0.55f ? Biome.Desert : Biome.Grassland;
        return m > 0.6f ? Biome.Forest : Biome.Grassland;
    }
}
```

```gdscript [Godot (GDScript)]
# world_generator.gd: FastNoiseLite is built in and does the octaves (fBm) and seeding itself,
# so there is no NoiseMap class to write.
class_name WorldGenerator
extends RefCounted

enum Biome { OCEAN, BEACH, DESERT, GRASSLAND, FOREST, TUNDRA, MOUNTAIN }

var _height: FastNoiseLite
var _moisture: FastNoiseLite
var _temperature: FastNoiseLite
var _size: int


func _init(world_seed: int, size: int) -> void:
	_size = size
	_height = _make_noise(world_seed, 120.0, 6)
	_moisture = _make_noise(world_seed + 1, 200.0, 3)
	_temperature = _make_noise(world_seed + 2, 300.0, 2)


static func _make_noise(noise_seed: int, scale: float, octaves: int) -> FastNoiseLite:
	var noise := FastNoiseLite.new()
	noise.noise_type = FastNoiseLite.TYPE_PERLIN
	noise.seed = noise_seed
	noise.frequency = 1.0 / scale  # bigger scale = larger features
	noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	noise.fractal_octaves = octaves
	noise.fractal_gain = 0.5  # persistence
	noise.fractal_lacunarity = 2.0
	return noise


# get_noise_2d returns roughly -1..1; remap to 0..1.
static func _sample(noise: FastNoiseLite, x: float, y: float) -> float:
	return noise.get_noise_2d(x, y) * 0.5 + 0.5


func height(x: int, y: int) -> float:
	var h := pow(_sample(_height, x, y), 1.6)  # flatter lowlands, sharper peaks

	# Island mask: fade to ocean near the edges.
	var dx := x / float(_size) * 2.0 - 1.0
	var dy := y / float(_size) * 2.0 - 1.0
	var edge := maxf(absf(dx), absf(dy))
	return h * (1.0 - smoothstep(0.6, 1.0, edge))


func biome_at(x: int, y: int) -> Biome:
	var h := height(x, y)
	if h < 0.12:
		return Biome.OCEAN
	if h < 0.15:
		return Biome.BEACH
	if h > 0.6:
		return Biome.MOUNTAIN

	var t := _sample(_temperature, x, y) - h * 0.3  # higher is colder
	var m := _sample(_moisture, x, y)
	if t < 0.3:
		return Biome.TUNDRA
	if m < 0.35:
		return Biome.DESERT if t > 0.55 else Biome.GRASSLAND
	return Biome.FOREST if m > 0.6 else Biome.GRASSLAND
```

```cpp [Unreal (C++)]
// WorldGenerator.h: plain C++, no UObject, so it can be used from any thread or test.
#pragma once

#include "CoreMinimal.h"

struct FNoiseSettings
{
	float Scale = 100.f;       // world units per noise unit (bigger = larger features)
	int32 Octaves = 4;         // 4–6 is typical
	float Persistence = 0.5f;  // amplitude multiplier per octave
	float Lacunarity = 2.f;    // frequency multiplier per octave
};

class FNoiseMap
{
public:
	FNoiseMap(const FNoiseSettings& InSettings, int32 Seed) : S(InSettings)
	{
		FRandomStream Rng(Seed);                                 // see Seeded Randomness
		for (int32 I = 0; I < S.Octaves; ++I)
			OctaveOffsets.Add(FVector2D(Rng.RandRange(-10000, 10000), Rng.RandRange(-10000, 10000)));
	}

	// Returns roughly 0..1.
	float Sample(float X, float Y) const
	{
		float Value = 0.f, Amplitude = 1.f, Frequency = 1.f, Max = 0.f;
		for (int32 I = 0; I < S.Octaves; ++I)
		{
			const FVector2D P(X / S.Scale * Frequency + OctaveOffsets[I].X, Y / S.Scale * Frequency + OctaveOffsets[I].Y);
			Value += (FMath::PerlinNoise2D(P) * 0.5f + 0.5f) * Amplitude;   // PerlinNoise2D is -1..1
			Max += Amplitude;
			Amplitude *= S.Persistence;
			Frequency *= S.Lacunarity;
		}
		return Value / Max;
	}

private:
	FNoiseSettings S;
	TArray<FVector2D> OctaveOffsets;
};

enum class EBiome : uint8 { Ocean, Beach, Desert, Grassland, Forest, Tundra, Mountain };

class FWorldGenerator
{
public:
	FWorldGenerator(int32 Seed, int32 InSize)
		: Height({120.f, 6}, Seed), Moisture({200.f, 3}, Seed + 1), Temperature({300.f, 2}, Seed + 2), Size(InSize) {}

	float HeightAt(int32 X, int32 Y) const
	{
		const float H = FMath::Pow(Height.Sample(X, Y), 1.6f);  // flatter lowlands, sharper peaks

		// Island mask: fade to ocean near the edges.
		const float DX = X / float(Size) * 2.f - 1.f, DY = Y / float(Size) * 2.f - 1.f;
		const float Edge = FMath::Max(FMath::Abs(DX), FMath::Abs(DY));
		return H * (1.f - FMath::SmoothStep(0.6f, 1.f, Edge));
	}

	EBiome BiomeAt(int32 X, int32 Y) const
	{
		const float H = HeightAt(X, Y);
		if (H < 0.12f) return EBiome::Ocean;
		if (H < 0.15f) return EBiome::Beach;
		if (H > 0.6f) return EBiome::Mountain;

		const float T = Temperature.Sample(X, Y) - H * 0.3f;   // higher is colder
		const float M = Moisture.Sample(X, Y);
		if (T < 0.3f) return EBiome::Tundra;
		if (M < 0.35f) return T > 0.55f ? EBiome::Desert : EBiome::Grassland;
		return M > 0.6f ? EBiome::Forest : EBiome::Grassland;
	}

private:
	FNoiseMap Height, Moisture, Temperature;
	int32 Size;
};
```

:::

### Engine wiring

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

// Paints the biome map onto a renderer (a Quad works). Feed Height() into
// TerrainData.SetHeights, a mesh or a Tilemap the same way.
public class WorldPreview : MonoBehaviour
{
    [SerializeField] int seed = 1234;
    [SerializeField] int size = 256;
    [SerializeField] Renderer target;

    static readonly Color32[] BiomeColors =              // indexed by Biome
    {
        new(30, 70, 160, 255),    // Ocean
        new(230, 215, 150, 255),  // Beach
        new(220, 190, 110, 255),  // Desert
        new(110, 170, 70, 255),   // Grassland
        new(40, 110, 50, 255),    // Forest
        new(220, 230, 235, 255),  // Tundra
        new(120, 110, 105, 255),  // Mountain
    };

    void Start()
    {
        var generator = new WorldGenerator(seed, size);
        var pixels = new Color32[size * size];
        for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
                pixels[y * size + x] = BiomeColors[(int)generator.BiomeAt(x, y)];

        var texture = new Texture2D(size, size) { filterMode = FilterMode.Point };
        texture.SetPixels32(pixels);
        texture.Apply();
        target.material.mainTexture = texture;
    }
}
```

```gdscript [Godot (GDScript)]
# world_preview.gd: paints the biome map into a texture. Write tiles into a TileMapLayer,
# or heights into an ArrayMesh, the same way.
extends Sprite2D

const BIOME_COLORS: Array[Color] = [  # indexed by WorldGenerator.Biome
	Color(0.12, 0.27, 0.63),  # ocean
	Color(0.90, 0.84, 0.59),  # beach
	Color(0.86, 0.75, 0.43),  # desert
	Color(0.43, 0.67, 0.27),  # grassland
	Color(0.16, 0.43, 0.20),  # forest
	Color(0.86, 0.90, 0.92),  # tundra
	Color(0.47, 0.43, 0.41),  # mountain
]

@export var world_seed := 1234
@export var size := 256


func _ready() -> void:
	var generator := WorldGenerator.new(world_seed, size)
	var image := Image.create_empty(size, size, false, Image.FORMAT_RGB8)
	for y in size:
		for x in size:
			image.set_pixel(x, y, BIOME_COLORS[generator.biome_at(x, y)])
	texture = ImageTexture.create_from_image(image)
	texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
```

```cpp [Unreal (C++)]
// WorldPreview.h: paints the biome map into a transient texture shown on a plane. Give the plane
// a material with a texture parameter named "Preview".
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WorldPreview.generated.h"

UCLASS()
class AWorldPreview : public AActor
{
	GENERATED_BODY()

public:
	AWorldPreview();

	UPROPERTY(VisibleAnywhere, Category = "Preview") TObjectPtr<UStaticMeshComponent> Plane;
	UPROPERTY(EditAnywhere, Category = "Preview") int32 Seed = 1234;
	UPROPERTY(EditAnywhere, Category = "Preview") int32 Size = 256;

protected:
	virtual void BeginPlay() override;

private:
	UPROPERTY(Transient) TObjectPtr<UTexture2D> Preview;   // UPROPERTY keeps it from being collected
};

// WorldPreview.cpp
#include "WorldPreview.h"
#include "WorldGenerator.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/Texture2D.h"
#include "Materials/MaterialInstanceDynamic.h"

static const FColor BiomeColors[] = {          // indexed by EBiome
	FColor(30, 70, 160), FColor(230, 215, 150), FColor(220, 190, 110), FColor(110, 170, 70),
	FColor(40, 110, 50), FColor(220, 230, 235), FColor(120, 110, 105),
};

AWorldPreview::AWorldPreview()
{
	Plane = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Plane"));
	RootComponent = Plane;
}

void AWorldPreview::BeginPlay()
{
	Super::BeginPlay();
	const FWorldGenerator Generator(Seed, Size);

	Preview = UTexture2D::CreateTransient(Size, Size, PF_B8G8R8A8);   // same byte order as FColor
	Preview->Filter = TF_Nearest;
	FTexture2DMipMap& Mip = Preview->GetPlatformData()->Mips[0];
	FColor* Pixels = static_cast<FColor*>(Mip.BulkData.Lock(LOCK_READ_WRITE));
	for (int32 Y = 0; Y < Size; ++Y)
		for (int32 X = 0; X < Size; ++X)
			Pixels[Y * Size + X] = BiomeColors[static_cast<int32>(Generator.BiomeAt(X, Y))];
	Mip.BulkData.Unlock();
	Preview->UpdateResource();

	UMaterialInstanceDynamic* Material = Plane->CreateDynamicMaterialInstance(0);
	Material->SetTextureParameterValue(TEXT("Preview"), Preview);
}
```

:::

**Engine notes**

- **Unity:** `Mathf.PerlinNoise` is 2D and returns values roughly in `[0, 1]` (it isn't seedable, hence the offsets). For 3D noise (caves, volumetric clouds) or noise inside Burst jobs, use `Unity.Mathematics.noise.snoise` / `cnoise` from the Mathematics package. Note that `Mathf.SmoothStep(a, b, t)` interpolates *between* `a` and `b`; it is not shader-style `smoothstep`.
- **Godot:** `FastNoiseLite` (Godot 4.0+) covers Perlin, Simplex, cellular and value noise, fBm/ridged fractals and domain warp, with a `seed` property; `NoiseTexture2D` shows a noise resource directly in the editor, which is handy for tuning. `Image.create_empty` is Godot 4.3+; older versions use `Image.create`. Its output distribution differs from Unity's, so retune the biome thresholds.
- **Unreal:** `FMath::PerlinNoise1D/2D/3D` return `[-1, 1]` and aren't seedable, so offsets come from an `FRandomStream`. Landscapes are usually generated offline or with **PCG** (the Procedural Content Generation framework, 5.2+), whose graphs include noise nodes.

## When to use

- Terrain height, biomes, resource distribution, cave density, cloud cover.
- Natural variation in placed content: tree density, grass colour, rock scale, enemy density.
- Organic animation: camera wobble, flickering lights, wind (see [Screen Shake](./screen-shake)).

## When not to use

- Content that must be designed exactly, such as story levels. Noise gives organic randomness, not structure.
- Layouts with clear rooms or connections. Use [BSP](./bsp-dungeon), [Wave Function Collapse](./wave-function-collapse) or hand-made pieces.
- Gameplay-critical randomness, such as loot. Use [Weighted Random](./weighted-random) with tuned odds.

## Pitfalls

- **Sampling at integer coordinates.** Perlin noise returns the same value at every integer lattice point, so `PerlinNoise(x, y)` on integer tile coordinates gives a perfectly flat map. Always divide by a scale.
- **Negative coordinates and huge offsets.** Float-based noise loses precision with very large inputs, and some implementations (such as Unity's `Mathf.PerlinNoise`) repeat over large ranges. Keep offsets moderate (± 100,000), as above.
- **Everything looks the same.** Pure fBm terrain is recognisably generic. Shape it (curves, masks, ridges, terraces) and layer authored features on top: rivers, roads, landmarks.
- **Chunk seams.** Generating chunks independently with per-chunk offsets breaks continuity at the borders. Always sample in *world* coordinates.
- **Cross-platform determinism.** Floating-point noise can differ slightly between platforms. That is fine for visuals, but risky if gameplay (resource placement in multiplayer) must match exactly. See [Determinism](./determinism).

## Related

- [Seeded Randomness](./seeded-randomness) — reproducible offsets and per-feature seeds.
- [Cellular Automata](./cellular-automata), [Wave Function Collapse](./wave-function-collapse) and [BSP Dungeon Generation](./bsp-dungeon) — other procedural techniques, often combined with noise.
- [Data-Driven Design](./data-driven-design) — expose noise settings and biome thresholds as tunable data.
- [Spatial Partition](./spatial-partition) — chunking and querying generated worlds.
