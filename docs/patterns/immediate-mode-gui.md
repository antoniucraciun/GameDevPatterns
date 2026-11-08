# Immediate-Mode GUI

> Describe the UI from scratch every frame instead of retaining widget objects.

**Also known as:** IMGUI · **Category:** UI

## Problem

You need a quick debug panel: show the player's state, a few sliders for tuning, buttons to spawn enemies. With a retained-mode UI (uGUI or UI Toolkit, Godot's Control nodes, Unreal's UMG), that means creating a canvas, laying out widgets, wiring each button to a callback, and writing code to keep labels in sync with changing values. Twenty minutes for a panel that will change tomorrow. Editor tools have the same problem: every inspector and window needs widgets that mirror data.

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

Unity's **IMGUI** (`OnGUI`, `GUILayout`, `EditorGUILayout`) is immediate mode and still powers much of its editor. Godot and Unreal have no immediate-mode GUI for games built in. **Dear ImGui** is the most famous example outside engines, and community plugins bring it to all three.

## Example

A runtime debug panel. Unity's IMGUI (`OnGUI`) is a full immediate-mode GUI. Godot has no immediate-mode GUI for games: the closest built-in is immediate-mode *drawing* in `CanvasItem._draw()`, with input handled separately, or a community ImGui add-on. Unreal's closest built-ins are immediate drawing on the HUD canvas plus console commands for the controls, or one of the ImGui plugins.

::: code-group

```csharp [Unity (C#)]
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

```gdscript [Godot (GDScript)]
# debug_overlay.gd: a full-screen Control on a CanvasLayer. _draw() is immediate: it reads the
# current values every frame, with no widgets to keep in sync. There are no immediate-mode
# widgets, though, so the controls here are function keys. PlayerStats and EnemySpawner are
# your own classes.
extends Control

@export var player: PlayerStats
@export var spawner: EnemySpawner

var _font: Font


func _ready() -> void:
	_font = ThemeDB.fallback_font
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	process_mode = Node.PROCESS_MODE_ALWAYS
	visible = OS.is_debug_build()  # only in the editor and debug exports
	set_process_unhandled_key_input(OS.is_debug_build())


func _unhandled_key_input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if key == null or not key.pressed or key.echo:
		return
	match key.keycode:
		KEY_F1: visible = not visible
		KEY_F2: spawner.spawn(1)
		KEY_F3: spawner.spawn(10)
		KEY_F4: spawner.kill_all()
		KEY_F5: player.god_mode = not player.god_mode


func _process(_delta: float) -> void:
	if visible:
		queue_redraw()  # redraw every frame, like OnGUI


func _draw() -> void:
	var lines := PackedStringArray([
		"FPS: %d" % Engine.get_frames_per_second(),
		"HP: %d/%d" % [player.health, player.max_health],  # always current
		"[F2] Spawn 1  [F3] Spawn 10  [F4] Kill all",
		"[F5] God mode: %s" % ("on" if player.god_mode else "off"),
	])
	for enemy in spawner.alive:  # lists: just a loop
		lines.append("%s  %s  %d" % [enemy.name, enemy.state, enemy.health])

	draw_rect(Rect2(8, 8, 300, 12 + lines.size() * 18), Color(0, 0, 0, 0.6))
	var y := 26.0
	for line in lines:
		draw_string(_font, Vector2(16, y), line, HORIZONTAL_ALIGNMENT_LEFT, -1, 14)
		y += 18.0
```

```cpp [Unreal (C++)]
// DebugHUD.h: AHUD::DrawHUD runs every frame and draws immediately on the canvas.
// Set it as the HUD class in the game mode.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "DebugHUD.generated.h"

UCLASS()
class ADebugHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;
	void ToggleDebugPanel() { bShowPanel = !bShowPanel; }

private:
	bool bShowPanel = false;
};

// DebugHUD.cpp
#include "DebugHUD.h"
#include "EngineUtils.h"
#include "Misc/App.h"

void ADebugHUD::DrawHUD()
{
	Super::DrawHUD();
#if !UE_BUILD_SHIPPING
	if (!bShowPanel) return;

	TArray<FString> Lines;
	Lines.Add(FString::Printf(TEXT("FPS: %.0f"), 1.0 / FApp::GetDeltaTime()));
	if (const AGameCharacter* Player = Cast<AGameCharacter>(GetOwningPawn()))   // your pawn class
	{
		Lines.Add(FString::Printf(TEXT("HP: %.0f/%.0f"), Player->Health, Player->MaxHealth));   // always current
		Lines.Add(FString::Printf(TEXT("God mode: %s"), Player->bGodMode ? TEXT("on") : TEXT("off")));
	}
	for (TActorIterator<AEnemy> It(GetWorld()); It; ++It)                                       // lists: just a loop
	{
		Lines.Add(FString::Printf(TEXT("%s  %s  %.0f"), *It->GetName(), *It->GetStateName(), It->Health));
	}

	DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.6f), 10.f, 10.f, 320.f, 12.f + Lines.Num() * 16.f);
	float Y = 16.f;
	for (const FString& Line : Lines)
	{
		DrawText(Line, FLinearColor::White, 18.f, Y);
		Y += 16.f;
	}
#endif
}

// DebugCheatManager.h: the controls are console commands (open the console with ` and type
// "SpawnEnemies 10"). Set it as the Cheat Class on the player controller; cheats are stripped
// from shipping builds.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/CheatManager.h"
#include "DebugCheatManager.generated.h"

UCLASS()
class UDebugCheatManager : public UCheatManager
{
	GENERATED_BODY()

public:
	UFUNCTION(Exec) void DebugPanel();
	UFUNCTION(Exec) void SpawnEnemies(int32 Count);
	UFUNCTION(Exec) void KillAllEnemies();
	UFUNCTION(Exec) void SetMoveSpeed(float Speed);
};

// DebugCheatManager.cpp (excerpt)
void UDebugCheatManager::DebugPanel()
{
	if (ADebugHUD* HUD = GetPlayerController()->GetHUD<ADebugHUD>()) HUD->ToggleDebugPanel();
}
```

:::

The same approach in the editor, a custom tool window. Godot and Unreal build editor tools from retained widgets (Control nodes, Slate), but both can poll the level in the same "rebuild what you show from the current state" style:

::: code-group

```csharp [Unity (C#)]
#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

public class LevelStatsWindow : EditorWindow
{
    [MenuItem("Tools/Level Stats")]
    static void Open() => GetWindow<LevelStatsWindow>("Level Stats");

    void OnGUI()
    {
        var enemies = FindObjectsByType<Enemy>();
        EditorGUILayout.LabelField("Enemies", enemies.Length.ToString());

        if (GUILayout.Button("Select all enemies"))
            Selection.objects = System.Array.ConvertAll(enemies, e => (Object)e.gameObject);
    }

    void OnInspectorUpdate() => Repaint();       // refresh a few times per second
}
#endif
```

```gdscript [Godot (GDScript)]
# addons/level_stats/level_stats.gd: an editor plugin (enable it in Project Settings > Plugins).
# Enemies are nodes in the "enemies" group.
@tool
extends EditorPlugin

var _dock: VBoxContainer
var _count_label: Label


func _enter_tree() -> void:
	_dock = VBoxContainer.new()
	_dock.name = "Level Stats"
	_count_label = Label.new()
	var select_button := Button.new()
	select_button.text = "Select all enemies"
	select_button.pressed.connect(_select_enemies)
	_dock.add_child(_count_label)
	_dock.add_child(select_button)
	add_control_to_dock(DOCK_SLOT_RIGHT_UL, _dock)


func _exit_tree() -> void:
	remove_control_from_docks(_dock)
	_dock.queue_free()


func _process(_delta: float) -> void:  # polled like OnInspectorUpdate
	_count_label.text = "Enemies: %d" % _enemies().size()


func _enemies() -> Array[Node]:
	return get_tree().get_nodes_in_group("enemies")


func _select_enemies() -> void:
	var selection := EditorInterface.get_selection()
	selection.clear()
	for enemy in _enemies():
		selection.add_node(enemy)
```

```cpp [Unreal (C++)]
// In an editor module's StartupModule(). Slate is declarative and retained, but attribute
// lambdas such as Text_Lambda are re-evaluated every frame, which gives the same always-current
// display. CountEnemies and SelectAllEnemies are your own helpers over the editor world.
FGlobalTabmanager::Get()->RegisterNomadTabSpawner("LevelStats", FOnSpawnTab::CreateLambda([](const FSpawnTabArgs&)
{
	return SNew(SDockTab)
		.TabRole(ETabRole::NomadTab)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().Padding(4.f)
			[
				SNew(STextBlock)
				.Text_Lambda([] { return FText::Format(INVTEXT("Enemies: {0}"), CountEnemies()); })
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(4.f)
			[
				SNew(SButton)
				.Text(INVTEXT("Select all enemies"))
				.OnClicked_Lambda([] { SelectAllEnemies(); return FReply::Handled(); })
			]
		];
}))
.SetDisplayName(INVTEXT("Level Stats"));

// Open it from a menu entry or the console: FGlobalTabmanager::Get()->TryInvokeTab(FTabId("LevelStats"));
```

:::

**Engine notes**

- **Unity:** IMGUI is still the API for custom inspectors and editor windows that don't use UI Toolkit, and for quick runtime debug panels. For shipped game UI, use uGUI or UI Toolkit. Community packages such as **Dear ImGui** bindings exist for runtime use.
- **Godot:** no immediate-mode GUI for games. `_draw()` gives immediate drawing (text, rects, lines) and the debugger's **Monitors** tab and `Performance.add_custom_monitor` cover many stats without any UI. For real immediate-mode widgets, use a Dear ImGui add-on such as **imgui-godot**. `EditorInterface` as a singleton is Godot 4.2+; earlier versions use `get_editor_interface()`.
- **Unreal:** the canvas HUD and `UCheatManager` exec functions are the built-in quick-debug path, and `stat` and `showdebug` console commands cover common stats. **Dear ImGui** plugins (several community ones exist) give true immediate-mode widgets in game and editor. **Editor Utility Widgets** are the Blueprint-friendly way to build editor tools.

## When to use

- Debug overlays, cheat panels and tuning sliders.
- Editor tools: custom windows, inspectors, scene-view overlays.
- Prototypes, where speed of iteration beats polish.

For **player-facing UI**, use a retained system (UI Toolkit or uGUI in Unity, Control nodes in Godot, UMG in Unreal). It supports styling, animation, accessibility, localisation and efficient rendering, which IMGUI does poorly.

## When not to use

- Player-facing UI. Use the engine's retained UI (UI Toolkit or uGUI, Control nodes, UMG), which handles styling, animation, accessibility, localisation and efficient rendering.
- Complex editor tools with lots of state. A retained system is better suited to large editor interfaces (UI Toolkit in Unity, Control-based editor plugins in Godot, Slate or Editor Utility Widgets in Unreal).

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
