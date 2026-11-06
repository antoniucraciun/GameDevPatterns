# Contributing

The site is built with [VitePress](https://vitepress.dev) and deployed to GitHub Pages by a GitHub Actions workflow on every push to `main`.

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
| Example (Unity C#) | Short, compilable code focused on the pattern. |
| When to use | Situations where it pays off. |
| Pitfalls | How it goes wrong, and what to do instead. |
| Related | Links to neighbouring patterns, with one line on how they relate. |

Keep examples small and engine-idiomatic. If a pattern is engine-agnostic, say so and keep the Unity-specific parts minimal.
