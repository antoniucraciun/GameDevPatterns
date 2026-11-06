# Immediate-Mode GUI

> Describe the UI from scratch every frame instead of retaining widget objects.

**Also known as:** IMGUI · **Category:** UI

## Problem

You need a quick debug panel: show the player's state, a few sliders for tuning, buttons to spawn enemies. With a retained-mode UI (uGUI, UI Toolkit), that means creating a canvas, laying out widgets, wiring each button to a callback, and writing code to keep labels in sync with changing values. Twenty minutes for a panel that will change tomorrow. Editor tools have the same problem: every inspector and window needs widgets that mirror data.

## Solution

In **immediate mode**, there are no persistent widget objects. Every frame, code *describes* the UI by calling functions in order, and each call both **draws** the control and **returns its interaction**:

```
if (Button("Spawn enemy")) Spawn();        // drawn this frame; true on the frame it is clicked
speed = Slider("Speed", speed, 0, 20);     // draws the slider, returns the (possibly new) value
Label($"HP: {player.Health}");              // always shows the current value: nothing to sync
```

- **No synchronisation.** The UI is a function of the current state, so it can never be stale.
- **No wiring.** Control flow *is* the event handling.
- **Conditional UI is just `if`.** Show a section only when something is selected, list items with a `foreach`.
- The cost: the UI is rebuilt every frame (cheap for tools, not ideal for complex game UI), and layout and styling are basic.

Unity's **IMGUI** (`OnGUI`, `GUILayout`, `EditorGUILayout`) is immediate mode and still powers much of the editor. **Dear ImGui** is the most famous example outside Unity, and community Unity bindings exist for it.

## Example (Unity C#)

A runtime debug panel, written in a few minutes:

```csharp
using UnityEngine;

public class DebugPanel : MonoBehaviour
{
#if UNITY_EDITOR || DEVELOPMENT_BUILD
    [SerializeField] PlayerStats player;
    [SerializeField] EnemySpawner spawner;

    bool visible;
    bool showAdvanced;
    Vector2 scroll;

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.F1)) visible = !visible;
    }

    void OnGUI()
    {
        if (!visible) return;

        GUILayout.BeginArea(new Rect(10, 10, 280, Screen.height - 20), GUI.skin.box);
        GUILayout.Label($"FPS: {1f / Time.smoothDeltaTime:0}");
        GUILayout.Label($"HP: {player.Health:0}/{player.MaxHealth:0}");     // always current

        player.MoveSpeed = LabeledSlider("Move speed", player.MoveSpeed, 0f, 20f);
        player.JumpHeight = LabeledSlider("Jump height", player.JumpHeight, 0f, 10f);

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("Spawn 1")) spawner.Spawn(1);
        if (GUILayout.Button("Spawn 10")) spawner.Spawn(10);
        if (GUILayout.Button("Kill all")) spawner.KillAll();
        GUILayout.EndHorizontal();

        player.GodMode = GUILayout.Toggle(player.GodMode, "God mode");

        showAdvanced = GUILayout.Toggle(showAdvanced, "Advanced");
        if (showAdvanced)                                                    // conditional UI: just an if
        {
            scroll = GUILayout.BeginScrollView(scroll, GUILayout.Height(200));
            foreach (var enemy in spawner.Alive)                             // lists: just a loop
                GUILayout.Label($"{enemy.name}  {enemy.State}  {enemy.Health:0}");
            GUILayout.EndScrollView();
        }

        GUILayout.EndArea();
    }

    static float LabeledSlider(string label, float value, float min, float max)
    {
        GUILayout.Label($"{label}: {value:0.0}");
        return GUILayout.HorizontalSlider(value, min, max);
    }
#endif
}
```

The same approach in the editor, a custom tool window:

```csharp
#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

public class LevelStatsWindow : EditorWindow
{
    [MenuItem("Tools/Level Stats")]
    static void Open() => GetWindow<LevelStatsWindow>("Level Stats");

    void OnGUI()
    {
        var enemies = FindObjectsByType<Enemy>(FindObjectsSortMode.None);
        EditorGUILayout.LabelField("Enemies", enemies.Length.ToString());

        if (GUILayout.Button("Select all enemies"))
            Selection.objects = System.Array.ConvertAll(enemies, e => (Object)e.gameObject);
    }

    void OnInspectorUpdate() => Repaint();       // refresh a few times per second
}
#endif
```

## When to use

- Debug overlays, cheat panels and tuning sliders.
- Editor tools: custom windows, inspectors, scene-view overlays.
- Prototypes, where speed of iteration beats polish.

For **player-facing UI**, use a retained system (UI Toolkit or uGUI). It supports styling, animation, accessibility, localisation and efficient rendering, which IMGUI does poorly.

## Pitfalls

- **Performance.** `OnGUI` can run several times per frame (once per event) and allocates. Keep IMGUI out of shipping builds, as above with `#if`, and out of performance captures.
- **Event phases.** `OnGUI` runs for layout and repaint events separately. Changing what controls exist between those passes, for example by adding a button when it is clicked, causes "GUI Error: Getting control 1's position in a group with only 1 controls". Change state, then show new controls next frame.
- **Input conflicts.** Clicking an IMGUI button also reaches gameplay input. Check `GUIUtility.hotControl`, or disable gameplay input while the panel is open.
- **Styling.** Making IMGUI look good is laborious. Accept its default look for tools.
- **Scaling.** IMGUI ignores DPI by default. Scale with `GUI.matrix` on high-resolution screens and phones.

## Related

- [Debug Console & Cheats](./debug-console) and [Debug Draw](./debug-draw) — other runtime debugging tools. The console example uses IMGUI.
- [MVC / MVP / MVVM](./mvp-mvvm) and [Data Binding](./data-binding) — retained-mode alternatives for real game UI.
- [Data-Driven Design](./data-driven-design) — custom inspectors make data easier to edit.
