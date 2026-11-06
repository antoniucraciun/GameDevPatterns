# Moddable Spells

> Players and modders add spells as files: formulas, sandboxed scripts and icons, loaded and validated at runtime.

## Goal

Mod support for an ARPG's spell system:

- A mod is a **folder**: `spell.json` (name, cost, cooldown, damage formula), `script.txt` (what the spell does), and `icon.png`.
- Mod spells work **exactly like built-in spells**: the same cooldowns, mana, UI, AI usage and damage pipeline.
- Formulas reference **game stats** (`power * 1.5 + level * 2`) and are checked when the mod loads.
- Scripts are **sandboxed**: they can damage, heal, spawn effects and play sounds, but cannot read files, run forever or crash the game.
- Broken mods produce **clear error messages** and are skipped, never taking the game down.
- Works on **IL2CPP and consoles**, where loading compiled code is impossible.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Data-Driven Design](../patterns/data-driven-design) | Spells are JSON data, turned into the same `AbilityDefinition` objects as built-in spells. |
| [Interpreter](../patterns/interpreter) | Damage and cost formulas as text, parsed once and evaluated per cast against the caster's stats. |
| [Bytecode](../patterns/bytecode) | Spell behaviour as instructions for a small, sandboxed virtual machine, written in a simple assembly text. |
| [Ability System](../patterns/ability-system) | Validation, costs, cooldowns and execution, shared by built-in and modded spells. |
| [Asset References & Addressing](../patterns/asset-reference) | Built-in icons and effects by address. Mod icons loaded from disk, with a fallback to a built-in icon. |

## How they fit together

```
 Mods/FrostLance/
   spell.json ──JsonUtility──► SpellModData ──validate──► AbilityDefinition (runtime instance)
     "damage": "power * 1.5 + 10"  ──ExprParser──► Expr (Interpreter)       │
   script.txt ──Assembler──► byte[] (Bytecode) ──validate──┐                 │ effects = [ModScriptEffect]
   icon.png ──Texture2D.LoadImage──► Sprite (fallback: built-in icon via Addressables)
                                                          ▼                 ▼
 cast: AbilityRunner validates (mana, cooldown, tags) ──► ModScriptEffect.Apply(ctx)
          power = damageExpr.Eval(caster stats) ──► SpellVM.Run(code, api{ Power = power, caster, target })
                                                         └─ only: Damage, Heal, PlaySound, SpawnEffect, GetHealth
```

The joins:

- **Data-Driven Design ↔ Ability System.** A mod produces the same `AbilityDefinition` that designers create in the editor, just built at runtime. The hotbar, the AI and the cooldown UI need no mod-specific code.
- **Interpreter ↔ Bytecode.** Formulas are expressions, so they suit a tree interpreter (parsed once, readable, easy to validate). Behaviour is sequential, with conditions and side effects, so it suits a VM. The formula's result reaches the script as `power`, the one value the script reads from outside.
- **Bytecode ↔ sandbox.** The `ISpellApi` passed to the VM is the *entire* surface a mod can touch. Clamping happens there too: a mod cannot deal a million damage.
- **Asset References ↔ mods.** Built-in content loads by address. Mod content loads from disk. Both end up as the same `Sprite` and effect references, with built-in fallbacks when a mod's file is missing.

## Example (Unity C#)

This builds on `ExprParser` and `Expr` ([Interpreter](../patterns/interpreter)), `SpellVM`, `Op` and `ISpellApi` ([Bytecode](../patterns/bytecode)), and `AbilityDefinition` and `AbilityEffect` ([Ability System](../patterns/ability-system)). The VM gains one opcode, `GetPower`, which pushes `api.Power`.

### Mod data and loading

```csharp
using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

[Serializable]
public class SpellModData
{
    public string id, name;
    public int manaCost = 10;
    public float cooldown = 2f, range = 12f;
    public string damage = "power";            // formula, see Interpreter
    public string icon = "icon.png";
}

public static class ModLoader
{
    public static List<AbilityDefinition> LoadAll(string modsFolder, Sprite fallbackIcon, List<string> errors)
    {
        var result = new List<AbilityDefinition>();
        foreach (var dir in Directory.GetDirectories(modsFolder))
        {
            try { result.Add(LoadOne(dir, fallbackIcon)); }
            catch (Exception e) { errors.Add($"{Path.GetFileName(dir)}: {e.Message}"); }   // skip, don't crash
        }
        return result;
    }

    static AbilityDefinition LoadOne(string dir, Sprite fallbackIcon)
    {
        var data = JsonUtility.FromJson<SpellModData>(File.ReadAllText(Path.Combine(dir, "spell.json")));
        if (string.IsNullOrWhiteSpace(data.id)) throw new FormatException("spell.json needs an \"id\"");

        // Interpreter: parse the formula now, so syntax errors surface at load time.
        Expr damage = ExprParser.Parse(data.damage);
        ValidateVariables(data.damage, allowed: new[] { "power", "level", "intellect" });

        // Bytecode: assemble and validate the script.
        byte[] code = SpellAssemblerText.Assemble(File.ReadAllText(Path.Combine(dir, "script.txt")));

        var def = ScriptableObject.CreateInstance<AbilityDefinition>();   // same type as built-in spells
        def.name = data.id;
        def.displayName = data.name;
        def.manaCost = Mathf.Clamp(data.manaCost, 0, 500);
        def.cooldown = Mathf.Clamp(data.cooldown, 0.2f, 120f);           // mods can't bypass balance limits
        def.range = Mathf.Clamp(data.range, 0f, 40f);
        def.icon = LoadIcon(Path.Combine(dir, data.icon)) ?? fallbackIcon;
        def.effects.Add(new ModScriptEffect { Damage = damage, Code = code });
        return def;
    }

    static Sprite LoadIcon(string path)
    {
        if (!File.Exists(path)) return null;
        var tex = new Texture2D(2, 2);
        if (!tex.LoadImage(File.ReadAllBytes(path)) || tex.width > 512 || tex.height > 512) return null;
        return Sprite.Create(tex, new Rect(0, 0, tex.width, tex.height), new Vector2(0.5f, 0.5f));
    }

    static void ValidateVariables(string formula, string[] allowed)
    {
        foreach (System.Text.RegularExpressions.Match m in System.Text.RegularExpressions.Regex.Matches(formula, "[A-Za-z_][A-Za-z0-9_]*"))
            if (Array.IndexOf(allowed, m.Value) < 0) throw new FormatException($"Unknown variable '{m.Value}' in formula");
    }
}
```

### Scripts as assembly text, turned into bytecode

```csharp
// script.txt for "Frost Lance":
//   push 1          ; target
//   getpower
//   damage          ; Damage(target, power)
//   push 0          ; caster
//   gethealth
//   push 30
//   less            ; caster health < 30 ?
//   jz end
//   push 0
//   getpower
//   push 0.25
//   mul
//   heal            ; heal caster for a quarter of the damage when low
//   end:

public static class SpellAssemblerText
{
    public static byte[] Assemble(string text)
    {
        var code = new List<byte>();
        var labels = new Dictionary<string, int>();
        var fixups = new List<(int at, string label, int line)>();
        var lines = text.Split('\n');

        for (int n = 0; n < lines.Length; n++)
        {
            var line = lines[n].Split(';')[0].Trim().ToLowerInvariant();
            if (line.Length == 0) continue;
            if (line.EndsWith(":")) { labels[line.TrimEnd(':')] = code.Count; continue; }

            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            switch (parts[0])
            {
                case "push":
                    code.Add((byte)Op.Push);
                    code.AddRange(BitConverter.GetBytes(float.Parse(parts[1], System.Globalization.CultureInfo.InvariantCulture)));
                    break;
                case "jz": case "jmp":
                    code.Add((byte)(parts[0] == "jz" ? Op.JumpIfZero : Op.Jump));
                    fixups.Add((code.Count, parts[1], n + 1));
                    code.Add(0); code.Add(0);
                    break;
                default:
                    if (!Enum.TryParse(parts[0], ignoreCase: true, out Op op) || op is Op.Push or Op.Jump or Op.JumpIfZero)
                        throw new FormatException($"script.txt line {n + 1}: unknown instruction '{parts[0]}'");
                    code.Add((byte)op);
                    break;
            }
        }

        foreach (var (at, label, line) in fixups)
        {
            if (!labels.TryGetValue(label, out int target)) throw new FormatException($"script.txt line {line}: unknown label '{label}'");
            var b = BitConverter.GetBytes((ushort)target);
            code[at] = b[0]; code[at + 1] = b[1];
        }
        code.Add((byte)Op.End);
        return code.ToArray();
    }
}
```

Opcode names in the text map directly onto the `Op` enum (`damage`, `heal`, `gethealth`, `less`, `getpower`…), so the language grows automatically as you add opcodes.

### The bridge: an ability effect that runs the script

```csharp
public class ModScriptEffect : AbilityEffect
{
    public Expr Damage;
    public byte[] Code;

    public override void Apply(in AbilityContext ctx)
    {
        var stats = new StatContext(new Dictionary<string, float>
        {
            ["power"] = ctx.Caster.SpellPower, ["level"] = ctx.Caster.Level, ["intellect"] = ctx.Caster.Intellect,
        });
        var api = new SandboxedSpellApi(ctx.Caster, ctx.Target, power: Damage.Eval(stats));
        try { SpellVM.Run(Code, api); }
        catch (InvalidOperationException e) { Debug.LogWarning($"Mod spell failed: {e.Message}"); }   // sandbox limits
    }
}

// ctx.Caster.SpellPower / Level / Intellect read the caster's stats (see Stat & Modifier System).
// SandboxedSpellApi : ISpellApi — maps who=0/1 to caster/target, clamps amounts (e.g. ≤ 5 × power),
// routes damage through the target's IDamageable (so armour, shields and the Damage Pipeline apply),
// and plays only whitelisted sounds and effects by id.
```

## Where the patterns meet: pitfalls

- **Trusting mod numbers.** A mod with `"cooldown": 0` or a script that heals for a million breaks the game, or multiplayer fairness. Clamp at load, clamp in the API, and disable mods in competitive modes.
- **Errors at cast time.** If formulas or scripts are only checked when cast, a broken mod fails mid-fight. Parse, assemble and validate everything at load, and report errors in a mod menu.
- **Bypassing shared systems.** If mod damage calls `Health` directly, armour, shields and on-hit effects are skipped. Route the API through the same [Damage Pipeline](../patterns/damage-pipeline) as built-in spells.
- **Unbounded resources.** Huge textures, thousands of spells or infinite loops. Limit icon size, mod count and VM instruction count (the VM already caps instructions).
- **Versioning.** A game update that renames an opcode or variable breaks every mod. Keep a `formatVersion` in `spell.json`, keep old opcodes working, and show a clear message for unsupported versions.
- **Security.** The sandbox is your API surface. Never add opcodes for file, network or reflection access, and never load mod DLLs on platforms where you cannot sandbox them.

## Variations

- **A friendlier language:** compile a small high-level syntax (`if caster.health < 30 { heal caster power * 0.25 }`) to the same bytecode, for modders who do not want assembly.
- **Visual spell editor:** an in-game node editor that emits the same JSON and bytecode, for players rather than modders.
- **Workshop integration:** mod folders downloaded from Steam Workshop or mod.io, loaded with the same `ModLoader`.
- **Built-in spells as mods:** ship your own spells in the same format, to make sure the modding path is fully tested.
