---
title: Keep It Simple
---

# Keep It Simple

> Read this before you add a pattern. Patterns are tools for specific problems. They are not a checklist and not a sign of quality.

This site describes more than a hundred patterns in detail. That makes it easy to fall into a common trap: using a pattern because you know it, not because the game needs it. A full ScriptableObject event-channel architecture for one button, or a behavior tree for an enemy that walks left and right, makes simple code harder to read, slower to change and harder to debug. On a small team, or when you are still finding the fun, that cost hurts most.

Every pattern adds indirection: more types, more files, and more places to look when something breaks. That only pays off when the problem it solves is real **and in front of you now**.

## Start with the simplest thing that works

| Instead of starting with… | Start with… | Move up when… |
| --- | --- | --- |
| [Behavior Tree](./patterns/behavior-tree), [GOAP](./patterns/goap) or [Utility AI](./patterns/utility-ai) | A `switch` on an enum in `Update` | The enemy has more than a handful of states, or designers need to author behaviour. |
| [ScriptableObject Architecture](./patterns/scriptable-object-architecture) or [Event Bus](./patterns/event-bus) | A direct reference set in the Inspector, or a C# `event` | Many unrelated systems react to the same thing, or scene objects can't reference each other. |
| [Entity Component System](./patterns/entity-component-system) or the [Job System](./patterns/job-system) | Plain `MonoBehaviour`s | The Profiler shows a real CPU bottleneck with thousands of entities. |
| [Object Pool](./patterns/object-pool) | `Instantiate` and `Destroy` | The Profiler shows GC spikes or instantiation hitches. |
| [Dependency Injection](./patterns/dependency-injection) or a [Service Locator](./patterns/service-locator) | Serialized fields and `GetComponent` | Wiring by hand is causing real bugs, or you need to swap implementations for tests. |
| [Command](./patterns/command) with undo/redo | Calling the method directly | You actually need undo, replays, queuing or networking. |
| [Data-Driven Design](./patterns/data-driven-design) for everything | Constants in code | Someone other than a programmer needs to tune the values. |

## Signs you are over-engineering

- You are adding a layer for a requirement that **might** come later ("in case we add multiplayer").
- A change to one feature means touching five files that exist only to pass the call along.
- You can't say, in one sentence, which problem the pattern solves **in this project**.
- An interface has exactly one implementation, and no test or tool needs a second one.
- New teammates need a tour of the architecture before they can fix a simple bug.

## Rules of thumb

- **Wait for the problem.** Add a pattern when the pain is real: the third copy of the same code, a profiler spike, a bug the structure keeps causing. Not before.
- **Prototype in plain code.** Prototypes get thrown away. Structure is for the code that survives.
- **Refactoring later is cheap.** Moving from a `switch` to a state machine when you need one is an afternoon. Living with an unneeded framework costs you on every change for the whole project.
- **Measure before you optimise.** Every performance pattern here assumes the Profiler has pointed at the problem.
- **Patterns can be partial.** You can use the core idea of a pattern (a small enum state machine, a list you reuse) without the full machinery shown on its page.

## Reading the recipes

The [recipes](./recipes/) show several patterns working together, because that is what complex features at scale need. They show where a design **can** end up, not where you should start. Build the plain version first and use a recipe as a map for when it starts to strain.
