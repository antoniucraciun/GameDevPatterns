# Game Dev Patterns

A catalog of programming patterns for game development, with Unity C# examples, published with GitHub Pages:

**https://antoniucraciun.github.io/GameDevPatterns/**

> [!NOTE]
> **AI-assisted and still being proofread.** This site was written with AI assistance and may contain mistakes. The Godot and Unreal code examples in particular have not been compiled yet. Found one? Please [open an issue](https://github.com/antoniucraciun/GameDevPatterns/issues).

> [!WARNING]
> **Keep it simple.** Patterns solve specific problems. Reaching for one where plain code would do (an event-channel architecture for one button, a behavior tree for a patrolling enemy) adds complexity without benefit. Start simple and add a pattern only when the problem is real. See [Keep It Simple](https://antoniucraciun.github.io/GameDevPatterns/keep-it-simple).

## Local development

Requires Node.js 18+.

```bash
npm install
npm run docs:dev      # live-reloading dev server
npm run docs:build    # production build to docs/.vitepress/dist
npm run docs:preview  # serve the production build
```

## Structure

```
docs/
  .vitepress/
    catalog.ts        # the master list of every pattern (source of truth)
    recipes.ts        # the master list of recipes (features built from several patterns)
    config.mts        # site config; the sidebar is generated from the two lists
    theme/            # theme extension + catalog, recipe and cross-link components
  patterns/
    index.md          # the filterable catalog page
    <slug>.md         # one page per written pattern
  recipes/
    index.md          # the recipes overview
    <slug>.md         # one page per written recipe
  index.md            # home page
templates/            # starting points for new pattern and recipe pages
```

See [docs/contributing.md](docs/contributing.md) for how to add a pattern or a recipe.
