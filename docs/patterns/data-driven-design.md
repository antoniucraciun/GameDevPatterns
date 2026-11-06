# Data-Driven Design

> Move tuning and content out of code into data designers can edit.

**Category:** Data, Content & Procedural Generation

## Problem

Jump height is a constant in `PlayerController.cs`. Enemy health lives in the enemy class. Level 3's spawn timings are hard-coded in a coroutine. Every balance tweak goes through a programmer, a recompile and a domain reload, so designers queue up requests and iteration slows to a crawl. Worse, values are scattered: nobody can answer "what are all the weapon damage numbers?" without reading code.

## Solution

Treat **behaviour** as code and **content and tuning** as data:

- **Code** defines *what can happen*: a weapon fires projectiles with some damage, rate and spread.
- **Data** defines *which instances exist and how they are tuned*: the shotgun deals 8 × 6 pellets at 1.2 shots per second.

Data lives where designers can edit it, with fast feedback:

| Format | Best for | Notes |
| --- | --- | --- |
| **ScriptableObject assets** | Most Unity content: items, enemies, abilities, waves | Inspector editing, references to other assets, edits apply live in play mode |
| **Spreadsheets → import** (CSV/JSON) | Large tables: 300 items, level-up curves, localisation | Designers use familiar tools, and you get easy bulk edits and diffs |
| **JSON/YAML at runtime** | Modding, live-ops balance updates, server-driven config | Loaded without a new build. Needs validation and versioning. |
| **AnimationCurve / Gradient fields** | Shapes: difficulty over time, damage falloff, XP curves | Visual editing, sampled at runtime |

Validate data **at edit time** (`OnValidate`, import checks), so mistakes show up as errors in the editor rather than bugs in a build.

## Example (Unity C#)

Weapons as data, with validation and curves:

```csharp
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

Importing a spreadsheet into assets, so designers balance in a table and the game reads assets:

```csharp
#if UNITY_EDITOR
using UnityEditor;

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

The importer updates existing assets rather than recreating them, so references that only exist on the asset (prefabs, sounds) survive each import.

## When to use

- Anything designers tune: stats, timings, curves, costs, drop rates, spawn tables, dialogue.
- Content that grows in volume: hundreds of items, levels or abilities.
- Live games that adjust balance without a client update.

## Pitfalls

- **Logic hiding in data.** Flags like `isSpecialBossThatDoesTheThing` turn data into a bad programming language. When data needs real logic, add a code hook, such as a [Strategy](./strategy) reference or an effect list.
- **No validation.** A typo in a spreadsheet becomes a 10,000-damage pistol in production. Validate ranges and references on import and in `OnValidate`, and fail loudly.
- **Runtime edits persisting in the editor.** Changing a ScriptableObject field at runtime changes the asset. Treat data as read-only at runtime, and keep mutable state on instances.
- **Culture-dependent parsing.** `float.Parse("1.5")` fails on machines that use a decimal comma. Always parse with `CultureInfo.InvariantCulture`.
- **Two sources of truth.** If both the spreadsheet and the assets are edited, imports overwrite manual changes. Decide which is authoritative for which fields.

## Related

- [Type Object](./type-object) — data that defines new *kinds* of things.
- [Flyweight](./flyweight) — shared, read-only definitions.
- [ScriptableObject Architecture](./scriptable-object-architecture) — assets as the medium for data.
- [Weighted Random & Loot Tables](./weighted-random), [Spawner / Wave System](./spawner) and [Ability System](./ability-system) — data-driven systems built on this idea.
- [Localization Tables](./localization-tables) — the same approach applied to text.
