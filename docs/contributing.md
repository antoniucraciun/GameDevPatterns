# Contributing

The site is built with [VitePress](https://vitepress.dev) and deployed to GitHub Pages by a GitHub Actions workflow on every push to `main`.

## Found a mistake?

This site was written with AI assistance and is still being proofread, so expect some errors, especially in the Godot and Unreal examples, which have not been compiled yet. If you spot one, please [open an issue](https://github.com/antoniucraciun/GameDevPatterns/issues) describing it, or fix it directly in a pull request. Corrections to code examples are especially welcome when you have compiled or run them in the engine.

## Adding a pattern

1. **List it.** Add an entry to `docs/.vitepress/catalog.ts`:

   ```ts
   { slug: 'my-pattern', name: 'My Pattern', category: 'behavioral', summary: 'One-line intent.' },
   ```

   It now appears in the [catalog](/patterns/) as *planned*.

2. **Write it.** Copy `templates/pattern.md` to `docs/patterns/my-pattern.md` and fill it in. The file name must match the `slug`. Once the file exists, the pattern gets a sidebar entry and its catalog entry becomes a link.

3. **Preview it.**

   ```bash
   npm install
   npm run docs:dev
   ```

## Adding a recipe

A recipe is a feature built by combining several patterns, such as a platformer controller or an undo system.

1. **List it.** Add an entry to `docs/.vitepress/recipes.ts`, with its group and the slugs of the patterns it uses:

   ```ts
   { slug: 'my-recipe', name: 'My Recipe', group: 'systems', summary: 'One-line goal.', patterns: ['command', 'observer'] },
   ```

   `group` is one of the ids in `recipeGroups` at the top of the same file (`combat`, `ai`, `networking`, `performance`, `systems`, `content`). Add a new group there if none fits. The recipe now appears in its group on the [recipes page](/recipes/) as *planned*. The build fails if a pattern slug does not exist in `catalog.ts`, or if the group is unknown.

2. **Write it.** Copy `templates/recipe.md` to `docs/recipes/my-recipe.md` and fill it in. Link written patterns as `../patterns/<slug>`, and name planned ones in plain text.

3. **Link a sample (optional).** Runnable Unity samples live in a separate repo, [GameDevPatterns-Samples](https://github.com/antoniucraciun/GameDevPatterns-Samples), with one folder and scene per recipe. Add the recipe's folder, and a playable build if there is one, to its entry:

   ```ts
   { slug: 'my-recipe', /* … */ sample: 'Assets/Recipes/MyRecipe', demo: 'https://…/my-recipe/' },
   ```

   The recipe page and its card on the recipes page then show **See it in action** links. Folder links point at `samplesRepo.ref` in `recipes.ts`; set it to a release tag of the samples repo so links stay stable.

Every pattern a recipe uses automatically shows a **Used in recipes** link back to it at the bottom of its page.

## Page conventions

Every pattern page uses the same sections, in this order:

| Section | Purpose |
| --- | --- |
| Intent (quote under the title) | One sentence on what the pattern lets you do. |
| Problem | A concrete game situation that hurts without the pattern. |
| Solution | The idea, its participants, and how they interact. |
| Example | Short, compilable code in tabs for Unity, Godot and Unreal. See [Engine examples](#engine-examples). Pages not converted yet still have a single **Example (Unity C#)**. |
| When to use | Situations where it pays off. |
| When not to use | Situations where it costs more than it saves, each naming the simpler code or better-fitting pattern to use instead. See [Keep It Simple](./keep-it-simple). |
| Pitfalls | How it goes wrong when you do use it, and what to do instead. |
| Related | Links to neighbouring patterns, with one line on how they relate. |

## Engine examples

Each code example has three tabs, written as a VitePress code group. The tab names must be exactly these, because the site keeps every tab group on a page (and the reader's next pages) on the engine they last picked:

````md
::: code-group

```csharp [Unity (C#)]
```

```gdscript [Godot (GDScript)]
```

```cpp [Unreal (C++)]
```

:::
````

- **Core and Engine wiring.** When the pattern has logic that doesn't need the engine (a pathfinder, a stat calculator, a state machine), put it in a **Core** tab group with no scene types, and the code that connects it to the engine in an **Engine wiring** group. Readers can then lift the core into tests or another engine. If the pattern *is* the engine integration (camera smoothing, trigger volumes), use a single tab group.
- **Idiomatic per engine.** Write each tab the way that engine's developers would: `MonoBehaviour` and `[SerializeField]` in Unity, nodes, `@export` and signals in Godot 4, `UCLASS`/`UPROPERTY` actors and components in Unreal Engine 5. Don't transliterate C# into the other languages.
- **Engine-specific patterns.** When a pattern is built on one engine's feature (ScriptableObject Architecture, Coroutines, the Job System), show each engine's closest equivalent, such as Godot `Resource`s and Unreal Data Assets. If an engine has no real equivalent, say so in **Engine notes** instead of forcing code.
- **Engine notes.** End the example with a short list: built-in features that already solve it in each engine, minimum versions, and gotchas.
- **Versions.** Unity tabs must compile with C# 9 (Unity's language version). Godot tabs target Godot 4. Unreal tabs target Unreal Engine 5; note anything that needs a specific 5.x version.

## Interactive visualizers

Some patterns are about time or space, which text and code show poorly. Those pages can embed a small interactive canvas, such as `<AStarViz />` on the A* page. Visualizers live in `docs/.vitepress/theme/viz/`:

1. Create `MyPatternViz.vue` and wrap it in `VizFrame`. Pass a `draw(ctx, width, height, colors)` function, plus optional `update(dt)` (called while playing), `step` and `reset`. Put sliders and toggles in the default slot, live numbers in `#stats`, and a short explanation of what the reader is seeing in `#caption`.
2. Register it in `theme/index.ts` and place it in the page, usually at the end of **Solution**. The catalog then marks the pattern **Interactive** automatically: any tag ending in `Viz` counts.

`VizFrame` provides the canvas, Play / Step / Reset, light and dark colours, and pausing while off screen. It starts paused for readers who prefer reduced motion. Keep each visualizer focused on the one idea that is hard to see in a still diagram, and use `makeRandom` from `viz/types.ts` so every reader starts from the same state.

