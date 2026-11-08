---
layout: home

hero:
  name: Game Dev Patterns
  text: A catalog of programming patterns for games
  tagline: Game loops, architecture, AI, performance, netcode, game feel and more. Each pattern has a problem statement, a solution and code examples for Unity (C#), Godot (GDScript) and Unreal (C++).
  actions:
    - theme: brand
      text: 'Start here: Keep it simple'
      link: /keep-it-simple
    - theme: alt
      text: Explore Catalog
      link: /patterns/
    - theme: alt
      text: See Recipes
      link: /recipes/

features:
  - title: Game Loop & Timing
    details: Fixed timesteps, update methods, double buffering and time slicing.
    link: /patterns/#loop
  - title: Architecture
    details: Components, ECS, service locators, dependency injection and ScriptableObject architecture.
    link: /patterns/#architecture
  - title: Behavior & AI
    details: State machines, commands, observers, behavior trees, GOAP and utility AI.
    link: /patterns/#ai
  - title: Performance
    details: Object pools, flyweights, dirty flags, spatial partitions and data locality.
    link: /patterns/#performance
  - title: Gameplay & Feel
    details: Stats and modifiers, abilities, input buffers, coyote time, hit stop and screen shake.
    link: /patterns/#gameplay
  - title: Networking
    details: Client-side prediction, reconciliation, interpolation, lockstep and rollback.
    link: /patterns/#networking
---

::: warning Keep it simple
Patterns solve specific problems. Using one where plain code would do adds complexity without benefit. Start simple and add a pattern only when the problem is real. [Read the guidance →](./keep-it-simple)
:::

::: info AI-assisted and still being proofread
This site was written with AI assistance and is still being proofread, so it may contain mistakes. The Godot and Unreal code examples in particular have not been compiled yet. Found a mistake? Please [open an issue](https://github.com/antoniucraciun/GameDevPatterns/issues), or see [Contributing](./contributing#found-a-mistake) to fix it yourself.
:::
