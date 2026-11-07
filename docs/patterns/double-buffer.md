# Double Buffer

> Keep a current and a next state so readers never see a half-written update.

**Category:** Game Loop & Timing

## Problem

A cellular simulation (Game of Life, fire spreading, fluid on a grid) updates each cell from its neighbours. If you update the grid in place, cell 5 reads cell 4 *after* cell 4 has already changed this tick, but cell 3 reads cell 4 *before*. The result depends on iteration order, and patterns drift in one direction. The same bug appears whenever objects read each other's state during one update, such as boids reading neighbours' velocities or AI reading other agents' decisions. It also appears at a larger scale when a renderer reads a framebuffer that is still being drawn, which causes tearing.

## Solution

Keep **two buffers**:

- **Current** is read-only during the tick. Everyone reads from it.
- **Next** is write-only during the tick. Everyone writes to it.

At the end of the tick, **swap** them. Swapping exchanges two references, not the data, so it is O(1). Every update in a tick then sees the same consistent snapshot of the previous tick, and iteration order no longer matters.

<DoubleBufferViz />

## Example

A fire-spread grid, where order independence matters. This is pure logic with no engine types, so all three versions are drop-in cores:

::: code-group

```csharp [Unity (C#)]
using System;

public class FireGrid
{
    readonly int width, height;
    float[] current;    // heat this tick: read only
    float[] next;       // heat next tick: write only

    public FireGrid(int width, int height)
    {
        this.width = width; this.height = height;
        current = new float[width * height];
        next = new float[width * height];
    }

    public float this[int x, int y] => current[y * width + x];

    public void Ignite(int x, int y) => current[y * width + x] = 1f;

    public void Tick(float spread, float cooling)
    {
        for (int y = 0; y < height; y++)
            for (int x = 0; x < width; x++)
            {
                int i = y * width + x;
                float neighbours = Read(x - 1, y) + Read(x + 1, y) + Read(x, y - 1) + Read(x, y + 1);
                next[i] = Math.Clamp(current[i] + neighbours * spread - cooling, 0f, 1f);
            }

        (current, next) = (next, current);   // swap references: O(1), no copying
    }

    float Read(int x, int y) =>
        x < 0 || y < 0 || x >= width || y >= height ? 0f : current[y * width + x];
}
```

```gdscript [Godot (GDScript)]
# fire_grid.gd
class_name FireGrid
extends RefCounted

var _width: int
var _height: int
var _current: PackedFloat32Array  # heat this tick: read only
var _next: PackedFloat32Array     # heat next tick: write only


func _init(width: int, height: int) -> void:
	_width = width
	_height = height
	_current.resize(width * height)
	_next.resize(width * height)


func heat(x: int, y: int) -> float:
	return _current[y * _width + x]


func ignite(x: int, y: int) -> void:
	_current[y * _width + x] = 1.0


func tick(spread: float, cooling: float) -> void:
	for y in _height:
		for x in _width:
			var neighbours := _read(x - 1, y) + _read(x + 1, y) + _read(x, y - 1) + _read(x, y + 1)
			_next[y * _width + x] = clampf(_current[y * _width + x] + neighbours * spread - cooling, 0.0, 1.0)

	# Swap: packed arrays are copy-on-write, so this swaps references without copying.
	var tmp := _current
	_current = _next
	_next = tmp


func _read(x: int, y: int) -> float:
	if x < 0 or y < 0 or x >= _width or y >= _height:
		return 0.0
	return _current[y * _width + x]
```

```cpp [Unreal (C++)]
// FireGrid.h: plain C++
#pragma once

#include "CoreMinimal.h"

class FFireGrid
{
public:
	FFireGrid(int32 InWidth, int32 InHeight) : Width(InWidth), Height(InHeight)
	{
		Current.SetNumZeroed(Width * Height);
		Next.SetNumZeroed(Width * Height);
	}

	float Heat(int32 X, int32 Y) const { return Current[Y * Width + X]; }
	void Ignite(int32 X, int32 Y) { Current[Y * Width + X] = 1.f; }

	void Tick(float Spread, float Cooling)
	{
		for (int32 Y = 0; Y < Height; ++Y)
			for (int32 X = 0; X < Width; ++X)
			{
				const float Neighbours = Read(X - 1, Y) + Read(X + 1, Y) + Read(X, Y - 1) + Read(X, Y + 1);
				Next[Y * Width + X] = FMath::Clamp(Current[Y * Width + X] + Neighbours * Spread - Cooling, 0.f, 1.f);
			}

		Swap(Current, Next);   // moves the arrays' storage: O(1), no copying
	}

private:
	float Read(int32 X, int32 Y) const
	{
		return X < 0 || Y < 0 || X >= Width || Y >= Height ? 0.f : Current[Y * Width + X];
	}

	int32 Width, Height;
	TArray<float> Current;   // heat this tick: read only
	TArray<float> Next;      // heat next tick: write only
};
```

:::

The same pattern for objects that read each other's state. Agents read the *published* state of their neighbours, and publish their own new state only after everyone has updated:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public struct AgentState { public Vector2 Position, Velocity; }

public class Agent
{
    public AgentState Current;   // what others see this tick
    public AgentState Next;      // what this agent computes

    public void Swap() => Current = Next;
}

// Update phase: everyone reads Current, writes Next.
//   foreach (var a in agents) a.Next = ComputeSteering(a, neighbours);   // reads n.Current only
// Publish phase:
//   foreach (var a in agents) a.Swap();
```

```gdscript [Godot (GDScript)]
# agent.gd
class_name Agent
extends RefCounted

# What others see this tick, and what this agent computes for the next one.
var current_position: Vector2
var current_velocity: Vector2
var next_position: Vector2
var next_velocity: Vector2


func publish() -> void:
	current_position = next_position
	current_velocity = next_velocity

# Update phase: everyone reads current_*, writes next_*.
#   for a in agents: a.compute_steering(neighbours)  # reads n.current_* only
# Publish phase:
#   for a in agents: a.publish()
```

```cpp [Unreal (C++)]
// Agent.h: plain C++
#pragma once

#include "CoreMinimal.h"

struct FAgentState
{
	FVector2D Position = FVector2D::ZeroVector;
	FVector2D Velocity = FVector2D::ZeroVector;
};

struct FAgent
{
	FAgentState Current;   // what others see this tick
	FAgentState Next;      // what this agent computes

	void Publish() { Current = Next; }
};

// Update phase: everyone reads Current, writes Next.
//   for (FAgent& A : Agents) A.Next = ComputeSteering(A, Neighbours);   // reads N.Current only
// Publish phase:
//   for (FAgent& A : Agents) A.Publish();
```

:::

**Engine notes**

- **All engines:** the GPU does this at the largest scale. The front buffer is displayed while the back buffer is drawn, and they are swapped at vsync.
- **Unity:** on the GPU side, the same idea appears as ping-pong `RenderTexture`s or double-buffered `ComputeBuffer`s for simulations in compute shaders.
- **Godot:** for big grids, keep the data in `Packed*Array`s as above: they are contiguous and cheap to swap. Grids drawn as textures can ping-pong two `ImageTexture`s or viewports.
- **Unreal:** Niagara simulation stages and Render Graph textures double-buffer GPU simulations for you.

## When to use

- State updated incrementally while other code reads it during the same step: cellular automata, grid simulations, physics-like interactions between many objects.
- Producer/consumer handoff between threads, such as a simulation thread writing state that the render thread reads.
- Interpolated rendering: keeping the previous and current simulation state, as in [Fixed Timestep](./fixed-timestep).

## When not to use

- State that is only written by one system before anyone reads it. Ordering the updates is enough; the second buffer just doubles the memory.
- Small, rarely-changing state shared between threads. A lock or an immutable snapshot is simpler.
- Updates where each cell or object depends only on itself. There is nothing to read stale, so there is nothing to protect.

## Pitfalls

- **Writing to `current` during the tick** silently brings the bug back. Make the read and write paths obvious, or enforce them with read-only views.
- **Forgetting cells that do not change.** Every cell of `next` must be written each tick, or it keeps the value from two ticks ago. Copy unchanged values explicitly.
- **Double the memory.** Large grids or per-object state cost twice as much. For sparse updates, a list of pending changes applied at the end of the tick can be cheaper.
- **One tick of latency.** Effects become visible to others one tick later. Usually invisible, but it matters for tightly coupled systems such as chains of triggers.

## Related

- [Game Loop](./game-loop) and [Update Method](./update-method) — double buffering removes update-order dependencies between objects.
- [Fixed Timestep](./fixed-timestep) — keeps previous and current states for interpolation.
- [Determinism](./determinism) — order-independent updates are much easier to make deterministic.
- [Cellular Automata](./cellular-automata) — the classic use case.
