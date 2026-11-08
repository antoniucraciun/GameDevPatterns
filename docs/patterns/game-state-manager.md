# Game State Manager

> Model the top-level flow (boot, menu, playing, paused, game over) as explicit states.

**Category:** Architecture & Structure

## Problem

The flow of the whole game is scattered. The main menu's Play button loads the level scene. The player's death script shows a game-over panel and stops the music. The pause key handler sets `timeScale` and checks whether the game-over panel is open first. Loading screens are a mix of each. Questions like "can I pause during a loading screen?" or "what happens if the player dies while paused?" have no answer anywhere, so they turn into bugs.

## Solution

Apply the [State](./state) pattern to the **game itself**. One manager owns the current top-level state, and each state is an object with `Enter` and `Exit`:

| State | Enter | Exit |
| --- | --- | --- |
| **Boot** | Initialise services, load settings | – |
| **MainMenu** | Load menu scene, play menu music | Unload menu scene |
| **Loading** | Show loading screen, load level additively | Hide loading screen |
| **Playing** | Enable gameplay input, start level timer | Disable gameplay input |
| **Paused** | Push a time-scale request, open pause menu | Release request, close menu |
| **GameOver** | Show results, submit score | Unload level |

All flow goes through `manager.ChangeTo(...)`. Transitions are **asynchronous**, because scene loads take time, and **guarded**, so a second transition request during a load is queued rather than interleaved. Every other system **reacts** to state changes through an event instead of inspecting UI panels to work out what is going on.

## Pseudocode

```text
GameState:
    enter()      // may wait, e.g. for a scene load
    exit()       // may wait
    tick()

GameStateManager:
    current ← none
    is_transitioning ← false
    pending ← none                    // one queued request; the latest wins
    changed                           // event (from, to)

    change_to(next):
        if is_transitioning:
            pending ← next            // don't interleave: run it afterwards
            return
        is_transitioning ← true
        previous ← current
        if previous exists: wait for previous.exit()
        current ← next
        wait for next.enter()
        is_transitioning ← false      // even if enter or exit failed
        raise changed(previous, next)
        if pending exists:
            queued ← pending;  pending ← none
            change_to(queued)

    every frame:
        if not is_transitioning and current exists: current.tick()

LoadLevel(level) is a GameState:
    enter():
        show the loading screen;  load level additively and wait
        hide the loading screen
        manager.change_to(Playing(level))   // queued until this enter ends

Playing(level) is a GameState:
    tick(): if pause pressed: manager.change_to(Paused(resume_to = this))

Paused(resume_to) is a GameState:
    enter(): push a time-scale request of 0;  show the pause menu
    exit():  release that request;  hide the pause menu
    tick():  if pause pressed: manager.change_to(resume_to)
```

## Example

A manager that owns the top-level flow (menu, loading, playing, paused) with asynchronous enter and exit, and queues a change requested mid-transition.

::: code-group

```csharp [Unity (C#)]
using System;
using UnityEngine;

public abstract class GameState
{
    protected GameStateManager Manager { get; private set; }
    internal void Bind(GameStateManager manager) => Manager = manager;

    public virtual Awaitable Enter() => Done();
    public virtual Awaitable Exit() => Done();
    public virtual void Tick() { }

    // An already-completed Awaitable, for states with nothing to wait for.
    protected static Awaitable Done()
    {
        var source = new AwaitableCompletionSource();
        source.SetResult();
        return source.Awaitable;
    }
}

public class GameStateManager : MonoBehaviour
{
    public GameState Current { get; private set; }
    public bool IsTransitioning { get; private set; }

    public event Action<GameState, GameState> Changed;     // (from, to): music, analytics, input maps

    GameState pending;

    public async Awaitable ChangeTo(GameState next)
    {
        if (IsTransitioning)
        {
            pending = next;            // run once the current transition finishes; the latest request wins
            return;
        }

        IsTransitioning = true;
        try
        {
            var previous = Current;
            if (previous != null) await previous.Exit();
            next.Bind(this);
            Current = next;
            await next.Enter();
            Changed?.Invoke(previous, next);
        }
        finally { IsTransitioning = false; }

        if (pending != null)
        {
            var queued = pending;
            pending = null;
            await ChangeTo(queued);
        }
    }

    void Update()
    {
        if (!IsTransitioning) Current?.Tick();
    }
}
```

```gdscript [Godot (GDScript)]
# game_state.gd: base class for states. enter() and exit() may await.
class_name GameState
extends RefCounted

var manager  # the GameFlow autoload, set when the state is entered

func enter() -> void: pass
func exit() -> void: pass
func tick(_delta: float) -> void: pass


# game_flow.gd: autoload named GameFlow. Process Mode "Always", so it keeps ticking while paused.
extends Node

signal changed(from: GameState, to: GameState)  # music, analytics, input maps

var current: GameState
var is_transitioning := false
var _pending: GameState


func change_to(next: GameState) -> void:
	if is_transitioning:
		_pending = next  # run once the current transition finishes; the latest request wins
		return

	is_transitioning = true
	var previous := current
	if previous:
		await previous.exit()
	next.manager = self
	current = next
	await next.enter()
	is_transitioning = false
	changed.emit(previous, next)

	if _pending:
		var queued := _pending
		_pending = null
		change_to(queued)


func _process(delta: float) -> void:
	if not is_transitioning and current:
		current.tick(delta)
```

```cpp [Unreal (C++)]
// GameFlowSubsystem.h: Unreal's GameMode runs the rules of a match; this subsystem runs the flow
// around it (menu → loading → playing → paused) and survives map changes. Enter and Exit take a
// completion callback because C++ has no awaits.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Tickable.h"
#include "GameFlowSubsystem.generated.h"

class UGameFlowSubsystem;

class FGameFlowState
{
public:
	virtual ~FGameFlowState() = default;
	virtual void Enter(UGameFlowSubsystem& Flow, TFunction<void()> Done) { Done(); }
	virtual void Exit(UGameFlowSubsystem& Flow, TFunction<void()> Done) { Done(); }
	virtual void Tick(UGameFlowSubsystem& Flow, float DeltaTime) {}
};

UCLASS()
class UGameFlowSubsystem : public UGameInstanceSubsystem, public FTickableGameObject
{
	GENERATED_BODY()

public:
	DECLARE_MULTICAST_DELEGATE_TwoParams(FOnChanged, FGameFlowState* /*From*/, FGameFlowState* /*To*/);
	FOnChanged OnChanged;                                  // music, analytics, input mappings

	void ChangeTo(TSharedRef<FGameFlowState> Next)
	{
		if (bTransitioning)
		{
			Pending = Next;                                // the latest request wins
			return;
		}
		bTransitioning = true;
		TSharedPtr<FGameFlowState> Previous = Current;
		auto EnterNext = [this, Previous, Next]
		{
			Current = Next;
			Next->Enter(*this, [this, Previous, Next]
			{
				bTransitioning = false;
				OnChanged.Broadcast(Previous.Get(), &Next.Get());
				if (TSharedPtr<FGameFlowState> Queued = MoveTemp(Pending)) ChangeTo(Queued.ToSharedRef());
			});
		};
		if (Previous) Previous->Exit(*this, EnterNext);
		else EnterNext();
	}

	// FTickableGameObject
	virtual void Tick(float DeltaTime) override { if (!bTransitioning && Current) Current->Tick(*this, DeltaTime); }
	virtual bool IsTickableWhenPaused() const override { return true; }   // the paused state must still tick
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UGameFlowSubsystem, STATGROUP_Tickables); }

private:
	TSharedPtr<FGameFlowState> Current, Pending;
	bool bTransitioning = false;
};
```

:::

Concrete states:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;
using UnityEngine.SceneManagement;

public class MainMenuState : GameState
{
    public override async Awaitable Enter() => await SceneManager.LoadSceneAsync("MainMenu", LoadSceneMode.Additive);
    public override async Awaitable Exit()  => await SceneManager.UnloadSceneAsync("MainMenu");
}

public class LoadLevelState : GameState
{
    readonly string level;
    public LoadLevelState(string level) => this.level = level;

    public override async Awaitable Enter()
    {
        LoadingScreen.Show();
        await SceneManager.LoadSceneAsync(level, LoadSceneMode.Additive);
        SceneManager.SetActiveScene(SceneManager.GetSceneByName(level));
        LoadingScreen.Hide();
        _ = Manager.ChangeTo(new PlayingState(level));     // queued: runs after this transition completes
    }
}

public class PlayingState : GameState
{
    public readonly string Level;
    public PlayingState(string level) => Level = level;

    public override void Tick()
    {
        if (Input.GetKeyDown(KeyCode.Escape)) _ = Manager.ChangeTo(new PausedState(this));
    }
}

public class PausedState : GameState
{
    readonly PlayingState resumeTo;
    GameTime.Request pause;                                // see the Time Scale pattern

    public PausedState(PlayingState resumeTo) => this.resumeTo = resumeTo;

    public override Awaitable Enter() { pause = GameTime.Push(0f, "Paused"); PauseMenu.Show(); return Done(); }
    public override Awaitable Exit()  { pause.Dispose(); PauseMenu.Hide(); return Done(); }

    public override void Tick()
    {
        if (Input.GetKeyDown(KeyCode.Escape)) _ = Manager.ChangeTo(resumeTo);   // back to the same level
    }
}
```

```gdscript [Godot (GDScript)]
# load_level_state.gd
class_name LoadLevelState
extends GameState

var _path: String

func _init(path: String) -> void:
	_path = path

func enter() -> void:
	await SceneLoader.load_level(_path, manager.get_tree().current_scene.get_node("Level"))
	manager.change_to(PlayingState.new(_path))  # queued: runs after this transition completes


# playing_state.gd
class_name PlayingState
extends GameState

var level: String

func _init(path: String) -> void:
	level = path

func tick(_delta: float) -> void:
	if Input.is_action_just_pressed("pause"):
		manager.change_to(PausedState.new(self))


# paused_state.gd
class_name PausedState
extends GameState

var _resume_to: PlayingState
var _pause: GameTime.Request  # see the Time Scale pattern

func _init(resume_to: PlayingState) -> void:
	_resume_to = resume_to

func enter() -> void:
	_pause = GameTime.push(0.0, "Paused")
	PauseMenu.show()

func exit() -> void:
	GameTime.release(_pause)
	PauseMenu.hide()

func tick(_delta: float) -> void:
	if Input.is_action_just_pressed("pause"):
		manager.change_to(_resume_to)  # back to the same level
```

```cpp [Unreal (C++)]
// GameFlowStates.h
class FLoadLevelState : public FGameFlowState
{
public:
	explicit FLoadLevelState(FName InLevel) : Level(InLevel) {}

	virtual void Enter(UGameFlowSubsystem& Flow, TFunction<void()> Done) override
	{
		ULevelLoaderSubsystem* Loader = Flow.GetGameInstance()->GetSubsystem<ULevelLoaderSubsystem>();
		Loader->OnLevelLoaded.AddLambda([&Flow, Level = Level, Done](FName Loaded)
		{
			Done();
			Flow.ChangeTo(MakeShared<FPlayingState>(Level));   // runs once this transition has finished
		});
		Loader->LoadLevel(Level);
	}

private:
	FName Level;
};

class FPausedState : public FGameFlowState
{
public:
	explicit FPausedState(TSharedRef<FGameFlowState> InResumeTo) : ResumeTo(InResumeTo) {}

	virtual void Enter(UGameFlowSubsystem& Flow, TFunction<void()> Done) override
	{
		UWorld* World = Flow.GetGameInstance()->GetWorld();
		Pause = World->GetSubsystem<UGameTimeSubsystem>()->Push(0.f, TEXT("Paused"));   // see Time Scale
		/* show the pause menu widget */
		Done();
	}

	virtual void Exit(UGameFlowSubsystem& Flow, TFunction<void()> Done) override
	{
		Pause.Reset();
		/* hide the pause menu widget */
		Done();
	}

private:
	TSharedRef<FGameFlowState> ResumeTo;
	TSharedPtr<FTimeRequest> Pause;
};

// The pause input action calls: Flow->ChangeTo(MakeShared<FPausedState>(PlayingState));
```

:::

States request the next state from inside their own enter. The manager is still transitioning, so it stores the request as *pending* and runs it as soon as the current transition finishes. Only the latest pending request is kept.

**Engine notes**

- **Unity:** this uses Unity 6's `Awaitable`, and awaiting `AsyncOperation` directly (2023.1+). On older versions, write the same states with coroutines.
- **Godot:** `PauseMenu` here is an autoload `CanvasLayer`; give it and `GameFlow` Process Mode "Always" so they work while the tree is paused.
- **Unreal:** `GameMode` and `GameState` (the class) handle match rules and replicated match state; this flow sits above them and lives in the game instance. The lambda registered on `OnLevelLoaded` should be removed once it has fired in real code.

## When to use

- Every game beyond a prototype. The top-level flow always exists, and the only question is whether it is explicit.
- Games with loading screens, multiple modes (campaign, arena, editor) or online sessions with lobby and match states.

## When not to use

- Game jams and prototypes with one scene and no menus. A `bool isGameOver` is enough.
- Character or enemy behaviour. Use [State](./state) on the object; the game state manager is for top-level flow only.
- When the flow is a simple stack of screens. A [Screen Stack](./screen-stack) may be all you need.

## Pitfalls

- **Pausing with a whole state.** Replacing *Playing* with *Paused* runs *Playing*'s `Exit`, which may unload the level. Either keep exits light (disable input, nothing destructive), as here, or use a stack ([Pushdown Automaton](./pushdown-automaton)) so *Paused* sits on top of *Playing* without exiting it.
- **Interleaved transitions.** Without a guard, two quick clicks start two loads, and the game ends up with two levels or none. The pending slot prevents interleaving, but a double click still queues the same transition twice, so also disable buttons while `IsTransitioning`.
- **Logic leaking back out.** Once the manager exists, every "show game over panel" must go through it. A second path to game over brings the scattered flow back.
- **States that know about everything.** States should orchestrate (load scene, enable input, raise event), not implement gameplay. Let other systems react to `Changed`.
- **Exceptions mid-transition.** A failed scene load must not leave `IsTransitioning` stuck. Use `try/finally`, and send the player to a safe state (main menu) on failure.

## Related

- [State](./state) — the underlying pattern.
- [Time Scale](./time-scale) — *Paused* pushes a time-scale request instead of setting the global value.
- [Screen Stack](./screen-stack) — handles menus *inside* states, such as settings within pause.
- [Event Bus](./event-bus) and [Observer](./observer) — how other systems react to state changes.
- [Pushdown Automaton](./pushdown-automaton) — lets *Paused* sit on top of *Playing* without exiting it.
- [Scene / Level Management](./scene-management) and [Bootstrapper](./bootstrapper) — closely related structure.
