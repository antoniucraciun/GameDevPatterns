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

## Example (Unity C#)

```csharp
using System;
using UnityEngine;
using UnityEngine.SceneManagement;

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

Concrete states:

```csharp
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

`LoadLevelState` requests the next state from inside its own `Enter`. The manager is still transitioning, so it stores the request as *pending* and runs it as soon as the current transition finishes. Only the latest pending request is kept.

This uses Unity 6's `Awaitable`, and awaiting `AsyncOperation` directly (2023.1+). On older versions, write the same states with coroutines.

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
