# Engine example tools

Helpers for converting pattern pages to three-engine examples (Unity C#, Godot GDScript, Unreal C++). The format is described in [docs/contributing.md](../../docs/contributing.md#engine-examples).

| Script | What it does |
| --- | --- |
| `splice-example.mjs` | Replaces a page's whole `## Example…` section (up to `## When to use`) with new Markdown, and fails unless every `::: code-group` has exactly the tabs `Unity (C#)`, `Godot (GDScript)`, `Unreal (C++)` in that order. |
| `unity-check.mjs` | Compiles every `Unity (C#)` tab against a real Unity install with C# 9. Types defined on other pages are declared in `stubs/<slug>.cs`. |
| `extract-unity.mjs` | The extraction step on its own, writing one `.cs` per snippet. |

## Converting a page

1. Write the new section to a scratch file, starting with `## Example`.
2. Splice it in:

   ```bash
   node tools/engine-examples/splice-example.mjs docs/patterns state /path/to/state-example.md
   ```

   Several `slug file` pairs can follow in one call.
3. Compile-check the Unity tabs:

   ```bash
   node tools/engine-examples/unity-check.mjs state command observer
   ```

   With no arguments it checks every converted page. If a snippet uses a type defined on another page or left to the reader, add a minimal declaration to `stubs/<slug>.cs`, inside the namespace `Page_<slug>` (dashes become underscores); copy the header of an existing stub file. Declare only the members the snippet calls.
4. `npm run docs:build` and check that the page renders.

## Conversion rules

Reference pages already converted: [a-star.md](../../docs/patterns/a-star.md) (Core + Engine wiring split), [time-scale.md](../../docs/patterns/time-scale.md) (several tab groups with prose between), [scriptable-object-architecture.md](../../docs/patterns/scriptable-object-architecture.md) (engine-specific pattern shown through each engine's equivalent).

- **Only the Example section changes.** Replace `## Example (Unity C#)` and everything up to `## When to use` with a new `## Example` section. Leave Problem, Solution (including any `<…Viz />` visualizer), When to use, When not to use, Pitfalls and Related as they are.
- **Every code block is a three-tab code group**, tabs named exactly `Unity (C#)`, `Godot (GDScript)`, `Unreal (C++)`, in that order. Language-neutral pseudocode can stay a plain block.
- **Keep the existing Unity code** unless it doesn't compile or is wrong; turn stray top-level statements ("Anywhere: …") into comments so every tab compiles.
- **Idiomatic per engine**, never transliterated: Godot 4 (typed GDScript, nodes, `@export`, signals, `await`, autoloads, Resources); Unreal Engine 5 (`UCLASS`/`UPROPERTY`, actors, components, subsystems, delegates, `TArray`/`TMap`, header and source in one block separated by a `// File.cpp` comment).
- **Use what the engine already has.** If an engine has a built-in feature for the pattern (Godot's `UndoRedo`, Unreal's Behavior Trees, GAS, Enhanced Input…), show it or point to it instead of rewriting it. If an engine has no real equivalent, say so in the notes rather than forcing code.
- **Split Core / Engine wiring** (as in A*) when the pattern has engine-free logic; otherwise one or more tab groups with short prose between them.
- **End with `**Engine notes**`**, one bullet per engine: built-ins that solve it, minimum versions, gotchas. Move Unity-only remarks that sat under the old example into the Unity bullet.
- **Accuracy over completeness.** Unity tabs must pass `unity-check.mjs`. Godot and Unreal tabs can't be compiled here, so use only APIs you are confident exist in Godot 4.x / UE 5.x, name the minimum version when it matters, and list anything uncertain in your final summary. Drop a claim rather than guess.
- **Watch for:** UHT rules (no `USTRUCT` nested in a `UCLASS`; every `UCLASS` needs `GENERATED_BODY()`; `UObject*` members that must survive GC need `UPROPERTY()`), GDScript names that shadow built-ins (`range`, `name` on nodes), objects passed by reference in GDScript where C# and C++ copy structs, and integer division warnings in GDScript.

## Requirements

- Node.js and the .NET SDK.
- A Unity editor install (`UNITY_EDITOR`, default `C:/Program Files/Unity/Hub/Editor/6000.6.0f1`).
- Optional: a Unity project (`UNITY_PROJECT`, default `G:/GameDev/UnityProjects/SurvivalGame`) whose `Library/ScriptAssemblies` provides package assemblies that the editor install doesn't: `UnityEngine.UI` (uGUI), `Unity.TextMeshPro`, `Unity.InputSystem`, `Unity.Mathematics`, `Unity.Collections`, `Unity.Burst` and `Unity.AI.Navigation` (NavMeshSurface). To check snippets that need another package, add its assembly name to the list in `unity-check.mjs`, or add the page to `SKIP` with a comment.
- Pages in `SKIP` (currently `entity-component-system`, which needs Entities plus matching source generators) must be checked inside a real Unity project instead.

Godot and Unreal tabs are not compiled by these tools.
