# Prompts for the remaining work

Paste one prompt into a new Claude Code chat opened in this repository. Run them **one at a time**: they share the compile-check folder (`tools/engine-examples/.check/`), so two at once in the same checkout would clash. Commit (or at least review) each batch before starting the next.

Status when these were written: 27 of 116 pattern pages converted (Game Loop & Timing, Architecture & Structure, and A*).

---

## Batch 3: Behavioral & Communication (15 pages)

```text
Convert the Example sections of 15 pattern pages to three-engine examples (Unity C#, Godot GDScript, Unreal C++). We're on the `development` branch.

First read tools/engine-examples/README.md (tools and "Conversion rules") and the "Engine examples" section of docs/contributing.md, and look at docs/patterns/a-star.md, docs/patterns/time-scale.md and docs/patterns/scriptable-object-architecture.md as reference examples of the finished format.

Pages (docs/patterns/<slug>.md): state, hierarchical-state-machine, pushdown-automaton, command, observer, event-queue, event-bus, strategy, template-method, mediator, chain-of-responsibility, visitor, bytecode, interpreter, memento.

Engine hints for this batch:
- Godot: signals are the built-in Observer; an autoload with signals is the usual Event Bus; Godot has a built-in UndoRedo class (relevant to Command and Memento); the Expression class is a built-in interpreter for simple formulas; node-based state machines (one child node per state) are idiomatic.
- Unreal: delegates (DECLARE_MULTICAST_DELEGATE / DYNAMIC) are the built-in Observer; StateTree is Unreal's built-in hierarchical state machine; the Gameplay Message Router (Lyra) is a common event bus; FScopedTransaction is editor undo (not gameplay undo); Blueprints and the Gameplay Ability System are relevant to Bytecode/Interpreter-style data-driven behaviour.
- Bytecode, Interpreter, Visitor, Memento and Strategy are mostly pure logic: write proper cores in each language.

Process: write each page's new Example section to a scratch file, splice it in with splice-example.mjs, add stubs/<slug>.cs for types defined elsewhere, run `node tools/engine-examples/unity-check.mjs <slugs>` until it reports no errors and no warnings, then `npm run docs:build` and confirm each page renders its code groups. Work in groups of 4-5 pages.

Don't commit. Finish with a summary table (page, tab groups, what Godot/Unreal use), the compile-check result, and a list of every Godot or Unreal API you were not fully sure about.
```

---

## Batch 4: AI & Decision Making (12 pages)

```text
Convert the Example sections of 12 pattern pages to three-engine examples (Unity C#, Godot GDScript, Unreal C++). We're on the `development` branch.

First read tools/engine-examples/README.md (tools and "Conversion rules") and the "Engine examples" section of docs/contributing.md, and look at docs/patterns/a-star.md, docs/patterns/time-scale.md and docs/patterns/scriptable-object-architecture.md as reference examples of the finished format.

Pages (docs/patterns/<slug>.md): behavior-tree, goap, utility-ai, htn-planning, blackboard, steering-behaviors, flocking, navigation-mesh, flow-field, influence-map, perception-system, director-ai.
Several of these pages embed an interactive visualizer (<SteeringViz />, <FlowFieldViz />) in the Solution section: leave those untouched.

Engine hints for this batch:
- Unreal has a lot built in: Behavior Trees + Blackboard (custom UBTTaskNode / UBTService / UBTDecorator in C++), StateTree, the AI Perception component (sight, hearing, damage senses), the Environment Query System (EQS) for utility-style scoring of positions, and the Navigation System (UNavigationSystemV1, AAIController::MoveToLocation, crowd avoidance). Show those where they fit instead of re-implementing them; GOAP and HTN have no official built-in, so write cores.
- Godot: no built-in behaviour tree (Beehave and LimboAI are popular add-ons; mention, but write a minimal tree in GDScript); NavigationAgent2D/3D and NavigationServer for navmeshes; Area3D plus raycasts (PhysicsRayQueryParameters3D) for perception.
- Steering, flocking, flow fields, influence maps, utility scoring, GOAP/HTN planners and the AI director are mostly engine-free logic: write proper cores in each language.

Process: write each page's new Example section to a scratch file, splice it in with splice-example.mjs, add stubs/<slug>.cs for types defined elsewhere, run `node tools/engine-examples/unity-check.mjs <slugs>` until it reports no errors and no warnings, then `npm run docs:build` and confirm each page renders its code groups. Work in groups of 4-5 pages.

Don't commit. Finish with a summary table (page, tab groups, what Godot/Unreal use), the compile-check result, and a list of every Godot or Unreal API you were not fully sure about.
```

---

## Batch 5: Performance & Memory (12 pages)

```text
Convert the Example sections of 12 pattern pages to three-engine examples (Unity C#, Godot GDScript, Unreal C++). We're on the `development` branch.

First read tools/engine-examples/README.md (tools and "Conversion rules") and the "Engine examples" section of docs/contributing.md, and look at docs/patterns/a-star.md, docs/patterns/time-scale.md and docs/patterns/scriptable-object-architecture.md as reference examples of the finished format.

Pages (docs/patterns/<slug>.md): object-pool, flyweight, dirty-flag, spatial-partition, data-locality, lazy-initialization, level-of-detail, culling, batching, job-system, memoization, arena-allocator.
spatial-partition embeds <SpatialPartitionViz /> in its Solution section: leave it untouched.

Engine hints for this batch:
- Godot: no built-in object pool (write one; hiding nodes and setting process_mode is cheaper than removing them from the tree); Resources as flyweights; Packed*Array for data locality; MultiMeshInstance for batching; visibility ranges and HLOD for LOD; VisibleOnScreenNotifier and occlusion culling; WorkerThreadPool and Thread for jobs; physics server queries (direct_space_state) for spatial queries. GDScript has no manual memory management: for the arena allocator, say so in the notes and show the closest idiom (reusing preallocated packed arrays).
- Unreal: Data Assets as flyweights; TArray structure-of-arrays for data locality; Instanced / Hierarchical Instanced Static Meshes for batching; LODs, HLOD and Nanite; cull distance volumes, precomputed visibility and the Significance Manager for culling; ParallelFor, UE::Tasks and the task graph for jobs; TOctree2 for spatial partitioning; FMemStack / FMemMark and TInlineAllocator for arenas. Unreal has no general actor pool built in; write one.
- Keep each example honest about measuring first (Unity Profiler, Godot profiler/monitors, Unreal Insights).

Process: write each page's new Example section to a scratch file, splice it in with splice-example.mjs, add stubs/<slug>.cs for types defined elsewhere, run `node tools/engine-examples/unity-check.mjs <slugs>` until it reports no errors and no warnings, then `npm run docs:build` and confirm each page renders its code groups. Work in groups of 4-5 pages. If a Unity tab needs a package the checker doesn't have (Jobs/Burst/Collections are available from the project in UNITY_PROJECT; check the README), add it to the SKIP list in unity-check.mjs with a comment rather than weakening the example.

Don't commit. Finish with a summary table (page, tab groups, what Godot/Unreal use), the compile-check result, and a list of every Godot or Unreal API you were not fully sure about.
```

---

## Batch 6: Gameplay Systems (14 pages)

```text
Convert the Example sections of 14 pattern pages to three-engine examples (Unity C#, Godot GDScript, Unreal C++). We're on the `development` branch.

First read tools/engine-examples/README.md (tools and "Conversion rules") and the "Engine examples" section of docs/contributing.md, and look at docs/patterns/a-star.md, docs/patterns/time-scale.md and docs/patterns/scriptable-object-architecture.md as reference examples of the finished format.

Pages (docs/patterns/<slug>.md): stat-modifier-system, ability-system, status-effects, damage-pipeline, health-component, inventory, save-system, quest-system, dialogue-system, spawner, interaction-system, tags, trigger-volume, checkpoint.

Engine hints for this batch:
- Unreal: the Gameplay Ability System covers abilities, attributes and modifiers (UAttributeSet, gameplay effects), status effects, the damage pipeline (execution calculations) and tags. Gameplay Tags (FGameplayTag, FGameplayTagContainer) are built into the engine even without GAS. Show GAS where it is the idiomatic answer, and mention when a lighter custom component is the better choice. Also: USaveGame + UGameplayStatics::SaveGameToSlot, ATriggerVolume / OnComponentBeginOverlap, UGameplayStatics::ApplyDamage and TakeDamage.
- Godot: Resources for item, ability and quest definitions; Area2D/Area3D body_entered for triggers; FileAccess, ConfigFile, JSON and ResourceSaver for saves (warn that loading untrusted Resources can run code, so prefer JSON or ConfigFile for save files); groups and metadata as simple tags; Dialogic and Dialogue Manager are common dialogue add-ons (mention, but write a small runner).
- Stat modifiers, inventory, quest logic and damage pipelines are mostly engine-free: write proper cores.

Process: write each page's new Example section to a scratch file, splice it in with splice-example.mjs, add stubs/<slug>.cs for types defined elsewhere, run `node tools/engine-examples/unity-check.mjs <slugs>` until it reports no errors and no warnings, then `npm run docs:build` and confirm each page renders its code groups. Work in groups of 4-5 pages.

Don't commit. Finish with a summary table (page, tab groups, what Godot/Unreal use), the compile-check result, and a list of every Godot or Unreal API you were not fully sure about.
```

---

## Batch 7: Game Feel & Input, and UI (12 pages)

```text
Convert the Example sections of 12 pattern pages to three-engine examples (Unity C#, Godot GDScript, Unreal C++). We're on the `development` branch.

First read tools/engine-examples/README.md (tools and "Conversion rules") and the "Engine examples" section of docs/contributing.md, and look at docs/patterns/a-star.md, docs/patterns/time-scale.md and docs/patterns/scriptable-object-architecture.md as reference examples of the finished format.

Pages (docs/patterns/<slug>.md):
- Game Feel & Input: input-buffer, coyote-time, input-abstraction, hit-stop, screen-shake, tweening, camera-smoothing, juice
- UI: mvp-mvvm, screen-stack, data-binding, immediate-mode-gui
input-buffer and coyote-time embed <JumpTimingViz /> in their Solution sections: leave those untouched.

Engine hints for this batch:
- Godot: InputMap actions and Input.is_action_just_pressed; Tween (create_tween) for tweening and juice; Camera2D position smoothing, limits and drag margins; Engine.time_scale or a short pause for hit stop; Control nodes and themes for UI; signals and setters for data binding. Godot has no immediate-mode GUI for games: say so, and show the closest options (CanvasItem._draw for debug overlays, or an ImGui add-on).
- Unreal: Enhanced Input (input actions, mapping contexts, triggers such as "pressed"/"hold"); camera shake classes (UCameraShakeBase, pattern-based shakes) and APlayerCameraManager; USpringArmComponent lag for camera smoothing; Timelines and FMath::Interp* for tweening; CustomTimeDilation / global time dilation for hit stop; UMG plus CommonUI (UCommonActivatableWidgetStack) for screen stacks; the UMG Viewmodel (MVVM) plugin for MVVM and data binding; Slate, the canvas debug HUD and ImGui plugins for immediate-mode UI.

Process: write each page's new Example section to a scratch file, splice it in with splice-example.mjs, add stubs/<slug>.cs for types defined elsewhere, run `node tools/engine-examples/unity-check.mjs <slugs>` until it reports no errors and no warnings, then `npm run docs:build` and confirm each page renders its code groups. Work in groups of 4-5 pages. If a Unity tab needs a package the checker doesn't have (for example the Input System or UI Toolkit runtime bindings), check whether UNITY_PROJECT provides it; if not, add the page to the SKIP list in unity-check.mjs with a comment rather than weakening the example.

Don't commit. Finish with a summary table (page, tab groups, what Godot/Unreal use), the compile-check result, and a list of every Godot or Unreal API you were not fully sure about.
```

---

## Batch 8: Networking & Multiplayer, and Tooling (14 pages)

```text
Convert the Example sections of 14 pattern pages to three-engine examples (Unity C#, Godot GDScript, Unreal C++). We're on the `development` branch.

First read tools/engine-examples/README.md (tools and "Conversion rules") and the "Engine examples" section of docs/contributing.md, and look at docs/patterns/a-star.md, docs/patterns/time-scale.md and docs/patterns/scriptable-object-architecture.md as reference examples of the finished format.

Pages (docs/patterns/<slug>.md):
- Networking: authoritative-server, client-side-prediction, server-reconciliation, entity-interpolation, lag-compensation, deterministic-lockstep, rollback-netcode, snapshot-delta-compression, interest-management
- Tooling: replay-system, debug-console, debug-draw, determinism, automated-playtesting
entity-interpolation, client-side-prediction and server-reconciliation embed <NetSyncViz /> in their Solution sections: leave those untouched.

Engine hints for this batch:
- Unreal: replication is built in (replicated UPROPERTYs with ReplicatedUsing, Server/Client/NetMulticast RPCs, NetCullDistanceSquared and the Replication Graph or Iris for interest management). UCharacterMovementComponent already does client prediction and server reconciliation for characters; the Network Prediction plugin generalises it. Replays are built in (the DemoNetDriver). Debug tools: console commands (FAutoConsoleCommand, Exec functions), DrawDebug* helpers and the Visual Logger; tests: the Automation framework, Functional Tests and Gauntlet. Lag compensation and rollback have no general built-in: write them, keep them small.
- Godot: the high-level multiplayer API (MultiplayerPeer / ENetMultiplayerPeer, @rpc annotations, MultiplayerSpawner, MultiplayerSynchronizer with visibility filters for interest management). The netfox add-on provides rollback and prediction (mention). Godot has no built-in 3D debug draw: show ImmediateMesh or a small helper. Tests: GUT or GdUnit4 add-ons.
- Determinism, lockstep, snapshot deltas and replay recording are mostly engine-free logic: write proper cores, and be explicit about floating-point and physics determinism limits in each engine.

Process: write each page's new Example section to a scratch file, splice it in with splice-example.mjs, add stubs/<slug>.cs for types defined elsewhere, run `node tools/engine-examples/unity-check.mjs <slugs>` until it reports no errors and no warnings, then `npm run docs:build` and confirm each page renders its code groups. Work in groups of 4-5 pages. If a Unity tab needs a package the checker doesn't have (Netcode for GameObjects, Unity Transport, Test Framework), check whether UNITY_PROJECT provides it; if not, add the page to the SKIP list in unity-check.mjs with a comment rather than weakening the example.

Don't commit. Finish with a summary table (page, tab groups, what Godot/Unreal use), the compile-check result, and a list of every Godot or Unreal API you were not fully sure about.
```

---

## Batch 9: Data, Content & Procedural Generation (9 pages)

```text
Convert the Example sections of 9 pattern pages to three-engine examples (Unity C#, Godot GDScript, Unreal C++). We're on the `development` branch.

First read tools/engine-examples/README.md (tools and "Conversion rules") and the "Engine examples" section of docs/contributing.md, and look at docs/patterns/a-star.md, docs/patterns/time-scale.md and docs/patterns/scriptable-object-architecture.md as reference examples of the finished format.

Pages (docs/patterns/<slug>.md): data-driven-design, asset-reference, localization-tables, noise-generation, wave-function-collapse, cellular-automata, bsp-dungeon, seeded-randomness, weighted-random.
cellular-automata and bsp-dungeon embed visualizers (<CellularAutomataViz />, <BspDungeonViz />) in their Solution sections: leave them untouched.

Engine hints for this batch:
- Godot: Resources and CSV/JSON import for data-driven design; ResourceLoader.load_threaded_request and UIDs for asset references; TranslationServer with CSV or PO files and tr() for localization; FastNoiseLite is built in; RandomNumberGenerator with an explicit seed; TileMapLayer for writing generated maps.
- Unreal: Data Tables and Curve Tables (FTableRowBase) for data-driven design; TSoftObjectPtr / TSoftClassPtr with FStreamableManager and the Asset Manager for asset references; String Tables, FText and the Localization Dashboard; FMath::PerlinNoise2D/3D; FRandomStream for seeded randomness.
- WFC, cellular automata, BSP, weighted random and seeded randomness are mostly engine-free: write proper cores, and keep generated output deterministic for a given seed in every language.

Process: write each page's new Example section to a scratch file, splice it in with splice-example.mjs, add stubs/<slug>.cs for types defined elsewhere, run `node tools/engine-examples/unity-check.mjs <slugs>` until it reports no errors and no warnings, then `npm run docs:build` and confirm each page renders its code groups. Work in groups of 4-5 pages. If a Unity tab needs a package the checker doesn't have (Addressables, Localization), check whether UNITY_PROJECT provides it; if not, add the page to the SKIP list in unity-check.mjs with a comment rather than weakening the example.

Don't commit. Finish with a summary table (page, tab groups, what Godot/Unreal use), the compile-check result, and a list of every Godot or Unreal API you were not fully sure about.
```

---

## After the batches: wording pass and enforcement

```text
All 116 pattern pages in docs/patterns now have three-engine Example sections (Unity C#, Godot GDScript, Unreal C++); see tools/engine-examples/README.md and the "Engine examples" section of docs/contributing.md. We're on the `development` branch. Finish the migration:

1. Find prose outside the Example sections that still assumes Unity (MonoBehaviour, Time.deltaTime, Update, prefabs, ScriptableObjects, the Inspector...) in Problem, Solution, When to use, When not to use, Pitfalls and Related, across all pattern pages and recipes. Make it engine-neutral, or name all three engines where the point is engine-specific. Show me a list of the proposed changes grouped by page before editing.
2. Update docs/contributing.md and templates/pattern.md so they no longer mention unconverted "Example (Unity C#)" pages.
3. Add a build check in docs/patterns/catalog.data.ts (next to the existing "When not to use" check) that fails if a pattern page has no "## Example" heading or if any ::: code-group lacks the three engine tabs in order.
4. Run node tools/engine-examples/unity-check.mjs and npm run docs:build, and spot-check a few pages in the browser.

Don't commit. Summarise what changed.
```

---

## AI-generated content disclaimer

```text
This documentation site (VitePress, in docs/) was written with AI assistance and I'm still proofreading it, so it may contain mistakes, especially in the Godot and Unreal code examples, which haven't been compiled. Add a clear, honest disclaimer saying so. We're on the `development` branch.

- Show it on every page: a slim, unobtrusive banner at the top of the content area (use a theme layout slot in docs/.vitepress/theme/index.ts, consistent with the existing custom components). It must not be dismissible, must not cover content, and must work at phone width and in light and dark mode.
- Also add it to the home page (docs/index.md) and the top of README.md.
- Suggested wording, adjust if needed: "This site is AI-assisted and still being proofread. Code examples, especially Godot and Unreal, may contain mistakes. Found one? Please open an issue." Link "open an issue" to https://github.com/antoniucraciun/GameDevPatterns/issues.
- Add a short note to docs/contributing.md asking contributors to report or fix mistakes they find.

Build with npm run docs:build, check it in the browser preview (desktop and mobile, light and dark), and show me a screenshot. Don't commit.
```
