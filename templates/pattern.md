# Pattern Name

> One-sentence intent: what this pattern lets you do.

**Also known as:** Alias, Other Alias · **Category:** Category name

## Overview

Two to four sentences: what the pattern is, and what this page covers, so the reader knows what to expect.

## Problem

What goes wrong without this pattern? Describe a concrete game situation.

## Solution

The idea in a few sentences. Add a diagram or a short list of participants if it helps.

## Pseudocode

Optionally one short sentence on what the outline shows.

```text
// The core mechanism in about 10-30 lines, in no particular language:
// the data each participant holds, then the main operations.
Participant
    field         // what it holds and why

operation(argument):
    for each item in collection:
        result ← something(item)    // comment the reasoning, not the syntax
    return result
```

## Example

One line on what the example builds. If it has an engine-free core, split it into **Core** and **Engine wiring**; otherwise use a single tab group.

### Core

::: code-group

```csharp [Unity (C#)]
// The pattern itself, with no scene or engine types where possible. Must compile in Unity (C# 9).
```

```gdscript [Godot (GDScript)]
# The same logic in idiomatic GDScript (Godot 4).
```

```cpp [Unreal (C++)]
// The same logic in idiomatic Unreal C++ (Unreal Engine 5). Header and source in one block.
```

:::

### Engine wiring

::: code-group

```csharp [Unity (C#)]
// A small MonoBehaviour that connects the core to the scene.
```

```gdscript [Godot (GDScript)]
# A small node script that connects the core to the scene tree.
```

```cpp [Unreal (C++)]
// A small Actor or Component that connects the core to the world.
```

:::

**Engine notes**

- **Unity:** built-in features that already do this, version requirements, gotchas. Docs: [Official page](https://docs.unity3d.com/Manual/index.html).
- **Godot:** the same for Godot. Docs: [Official page](https://docs.godotengine.org/en/stable/).
- **Unreal:** the same for Unreal. Docs: [Official page](https://dev.epicgames.com/documentation/en-us/unreal-engine).

## When to use

- Situation where it pays off.
- Another situation.

## When not to use

- Situation where the pattern costs more than it saves, and the simpler code or [better-fitting pattern](./other-pattern) to use instead.

## Pitfalls

- Common way it goes wrong, and what to do instead.

## Related

- [Other Pattern](./other-pattern) — how it relates.
