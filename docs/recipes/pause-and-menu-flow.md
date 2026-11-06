# Pause & Menu Flow

> Pausing, nested menus and returning to gameplay without systems fighting over input or time.

## Goal

Pausing that works the way players expect, every time:

- **Escape / Start** pauses. In the pause menu it goes **back one level** (Settings → Pause → resume), and never closes two things at once.
- While paused, gameplay, physics and gameplay audio stop, while **menus keep animating** and UI sounds still play.
- Pausing during slow motion, a cutscene or a loading screen does the right thing.
- The game **pauses itself** when the window loses focus or a controller disconnects.
- Systems such as music, input maps and analytics react to pausing **without being called** by the pause code.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Game State Manager](../patterns/game-state-manager) | *Playing* and *Paused* are explicit top-level states, and only some states may pause at all. |
| [Time Scale](../patterns/time-scale) | *Paused* holds a ×0 time request that combines correctly with slow motion, instead of overwriting `Time.timeScale`. |
| [Screen Stack](../patterns/screen-stack) | Menus inside the pause state: Pause → Settings → Confirm, with Back always closing the top one. |
| [Event Bus](../patterns/event-bus) | Publishes `GamePaused` and `GameResumed`, so other systems react without the pause code knowing them. |

## How they fit together

```
 Escape / Start ──► InputRouter ── screen stack not empty? ──► ScreenStack.Back()   (close top menu)
                         │                                       └─ stack became empty ──► resume
                         └── otherwise ──► GameStateManager: Playing ⇄ Paused
                                                           │
                                    Paused.Enter: GameTime.Push(0) · ScreenStack.Push(PauseMenu)
                                                  EventBus<GamePaused>.Publish
                                    Paused.Exit:  request.Dispose() · stack cleared
                                                  EventBus<GameResumed>.Publish
                                                           │
                         music ducks · gameplay input map off · analytics ◄┘
```

The joins:

- **One owner for Back.** The single most common pause bug is two listeners for Escape: gameplay opens Pause in the same frame that the menu closes itself. Here, one router asks the screen stack first, then the game state.
- **Game State ↔ Time Scale.** The *Paused* state owns its time request. Leaving the state, for any reason, releases it, so the game cannot stay frozen by accident, and slow motion running underneath resumes at its own speed.
- **Game State ↔ Screen Stack.** The pause *state* decides that the game is paused. The *stack* manages which menu is showing. When the stack empties, through Back on the root pause menu, the state changes back to *Playing*.
- **Game State ↔ Event Bus.** Music, input maps and analytics subscribe to events. Adding "dim the HUD when paused" is a new subscriber, not an edit to the pause code.

## Example (Unity C#)

This builds on the code from the four pattern pages: `GameState`, `GameStateManager`, `PlayingState` ([Game State Manager](../patterns/game-state-manager)), `GameTime` ([Time Scale](../patterns/time-scale)), `ScreenStack` and `UIScreen` ([Screen Stack](../patterns/screen-stack)), and `EventBus<T>` ([Event Bus](../patterns/event-bus)).

### Events and the paused state

```csharp
using UnityEngine;

public readonly struct GamePaused : IEvent { }
public readonly struct GameResumed : IEvent { }

public class PausedState : GameState
{
    readonly PlayingState resumeTo;
    readonly ScreenStack screens;
    readonly UIScreen pauseMenu;
    GameTime.Request freeze;

    public PausedState(PlayingState resumeTo, ScreenStack screens, UIScreen pauseMenu)
    {
        this.resumeTo = resumeTo; this.screens = screens; this.pauseMenu = pauseMenu;
    }

    public override Awaitable Enter()
    {
        freeze = GameTime.Push(0f, "Pause menu");          // combines with any slow motion
        screens.Push(pauseMenu);
        screens.Emptied += Resume;                         // Back on the root menu resumes
        EventBus<GamePaused>.Publish(default);
        return Done();
    }

    public override Awaitable Exit()
    {
        screens.Emptied -= Resume;
        screens.Clear();                                   // leaving by any route closes every menu
        freeze.Dispose();                                  // and always releases the time request
        EventBus<GameResumed>.Publish(default);
        return Done();
    }

    public void Resume() => _ = Manager.ChangeTo(resumeTo);
    public void QuitToMenu() => _ = Manager.ChangeTo(new MainMenuState());   // also runs Exit()
}
```

This `PausedState` replaces the simpler one on the Game State Manager page. Three other changes make the pieces fit:

- `ScreenStack` gets an `Emptied` event, raised when `Pop` removes the last screen, and a `Clear()` that pops everything *without* raising `Emptied`.
- `ScreenStack` no longer listens for Escape itself.
- `PlayingState.Tick` no longer listens for Escape either.

The router below is now the only place that handles Back.

### One router for Back / Pause

```csharp
public class InputRouter : MonoBehaviour
{
    [SerializeField] GameStateManager game;
    [SerializeField] ScreenStack screens;
    [SerializeField] UIScreen pauseMenu;

    void Update()
    {
        if (!Input.GetKeyDown(KeyCode.Escape) && !Input.GetKeyDown(KeyCode.JoystickButton7)) return;
        HandleBack();
    }

    void HandleBack()
    {
        if (game.IsTransitioning) return;                  // never pause halfway through a load

        if (screens.Top != null)                           // a menu is open: Back closes it
        {
            if (screens.Top.OnBack()) screens.Pop();
            return;
        }

        if (game.Current is PlayingState playing)          // nothing open: pause
            _ = game.ChangeTo(new PausedState(playing, screens, pauseMenu));
    }

    // Pause automatically when the player alt-tabs or the device suspends the app.
    void OnApplicationFocus(bool hasFocus)
    {
        if (!hasFocus && game.Current is PlayingState playing)
            _ = game.ChangeTo(new PausedState(playing, screens, pauseMenu));
    }
}
```

### Systems that react, without being called

```csharp
public class MusicDucker : MonoBehaviour
{
    [SerializeField] UnityEngine.Audio.AudioMixer mixer;

    void OnEnable()
    {
        EventBus<GamePaused>.Subscribe(OnPaused);
        EventBus<GameResumed>.Subscribe(OnResumed);
    }

    void OnDisable()
    {
        EventBus<GamePaused>.Unsubscribe(OnPaused);
        EventBus<GameResumed>.Unsubscribe(OnResumed);
    }

    void OnPaused(GamePaused _)   => mixer.SetFloat("MusicVolume", -12f);   // duck, don't stop
    void OnResumed(GameResumed _) => mixer.SetFloat("MusicVolume", 0f);
}
```

Menu animations use unscaled time (Animator update mode *Unscaled Time*, `Time.unscaledDeltaTime` in tweens), and UI audio sources set `ignoreListenerPause = true`, so the menu stays alive while the game is frozen.

## Where the patterns meet: pitfalls

- **Pausing from gameplay code.** A boss intro that sets `Time.timeScale = 0` directly bypasses both the state and the time-scale requests, and unpausing from the menu then "unfreezes" the cutscene. Everything that stops time goes through `GameTime`, and everything that pauses goes through the state manager.
- **Pause during transitions.** Pausing while a level loads leaves the game in *Paused* with no level. The router ignores input while `IsTransitioning`, and only *Playing* can pause.
- **Exit paths that skip cleanup.** "Quit to main menu" from the pause menu must still release the time request and close the menus, or the main menu starts frozen. Putting cleanup in `Exit` makes every route out of *Paused* safe.
- **Emptied versus cleared.** If `Clear()` raised `Emptied`, leaving *Paused* would request *Playing* again while already transitioning. Keep "the player backed out" separate from "the state is tearing down".
- **Focus loss on consoles and mobile.** Suspend and resume events differ per platform. Route them all to the same "pause if playing" call, and test resuming from suspend with a pause request still active.
- **Events published before listeners exist.** A system that subscribes after `GamePaused` was published misses it, and thinks the game is running. Systems that start mid-game should also query `game.Current` once on enable.

## Variations

- **Multiplayer "pause":** time cannot stop for everyone. The *Paused* state only opens menus and disables local input, with no time request.
- **Photo mode:** a state like *Paused* that freezes gameplay time but enables a free camera and its own input map.
- **Tutorial pop-ups:** push a time request and a screen without changing the game state, for brief interruptions that should not count as pausing for analytics.
