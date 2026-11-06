# Noise-Based Generation

> Layer coherent noise (Perlin, Simplex) to generate terrain and variation.

**Category:** Data, Content & Procedural Generation

## Problem

Generating terrain with `Random.value` per tile gives static: every tile unrelated to its neighbours, with no hills, valleys or coastlines. Hand-authoring a large world is not feasible. You need randomness that is **smooth** (neighbours are similar), **structured** (big shapes with small details on top), **controllable** (designers can tune "more mountains") and **reproducible** (the same seed gives the same world).

## Solution

Use **coherent noise**: a function `noise(x, y)` that returns similar values for nearby inputs and varies smoothly. Perlin and Simplex noise are the standard choices. Then build up structure:

1. **Frequency and amplitude.** Sampling at `x * frequency` controls feature size (low frequency gives continents, high frequency gives pebbles). Multiplying by an amplitude controls height.
2. **Octaves (fractal Brownian motion).** Sum several layers, each at double the frequency (**lacunarity** ≈ 2) and half the amplitude (**persistence** ≈ 0.5). Big shapes come from the first octaves, and detail from the later ones.
3. **Shaping.** Remap the result with curves: `pow` for flatter lowlands and sharper peaks, an island mask that falls off toward the edges, terraces, or ridged noise (`1 - |noise|`) for mountain ridges.
4. **Multiple maps.** Separate noise maps for height, temperature and moisture. Classify biomes by combining them (hot and dry is desert, cold and wet is taiga).
5. **Seeding.** Offset the sample coordinates by values derived from the world seed, so each seed gives a different, reproducible world.

## Example (Unity C#)

Fractal noise with seeded offsets, an island mask and biome classification:

```csharp
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

        // Island mask: fade to ocean near the edges.
        float dx = x / (float)size * 2f - 1f, dy = y / (float)size * 2f - 1f;
        float edge = Mathf.Max(Mathf.Abs(dx), Mathf.Abs(dy));
        return h * (1f - Mathf.SmoothStep(0.6f, 1f, edge));
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

// Paint into a texture to preview, or feed Height() into TerrainData.SetHeights / a mesh / a Tilemap.
```

`Mathf.PerlinNoise` is 2D and returns values roughly in `[0, 1]`. For 3D noise (caves, volumetric clouds) or noise inside Burst jobs, use `Unity.Mathematics.noise.snoise` / `cnoise` from the Mathematics package.

## When to use

- Terrain height, biomes, resource distribution, cave density, cloud cover.
- Natural variation in placed content: tree density, grass colour, rock scale, enemy density.
- Organic animation: camera wobble, flickering lights, wind (see [Screen Shake](./screen-shake)).

## Pitfalls

- **Sampling at integer coordinates.** Perlin noise returns the same value at every integer lattice point, so `PerlinNoise(x, y)` on integer tile coordinates gives a perfectly flat map. Always divide by a scale.
- **Negative coordinates and huge offsets.** `Mathf.PerlinNoise` repeats over large ranges and loses precision with very large inputs. Keep offsets moderate (± 100,000), as above.
- **Everything looks the same.** Pure fBm terrain is recognisably generic. Shape it (curves, masks, ridges, terraces) and layer authored features on top: rivers, roads, landmarks.
- **Chunk seams.** Generating chunks independently with per-chunk offsets breaks continuity at the borders. Always sample in *world* coordinates.
- **Cross-platform determinism.** Floating-point noise can differ slightly between platforms. That is fine for visuals, but risky if gameplay (resource placement in multiplayer) must match exactly. See [Determinism](./determinism).

## Related

- [Seeded Randomness](./seeded-randomness) — reproducible offsets and per-feature seeds.
- Cellular Automata, Wave Function Collapse and BSP Dungeon Generation — other procedural techniques, often combined with noise.
- [Data-Driven Design](./data-driven-design) — expose noise settings and biome thresholds as tunable data.
- [Spatial Partition](./spatial-partition) — chunking and querying generated worlds.
