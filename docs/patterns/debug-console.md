# Debug Console & Cheats

> A runtime console to inspect state and trigger commands in builds.

**Category:** Tooling, Debugging & Testing

## Problem

A tester needs to check the final boss. Reaching it takes forty minutes of play. A bug only appears with 999 gold and the fire sword equipped. On a phone build, there is no editor to tweak a value or see what state the AI is in. Every team ends up adding a secret key combination here and a debug button there, scattered through the code and inconsistently stripped from release builds.

## Solution

Build one **console**: a text box that opens with a key (often the backtick), where typed commands run registered functions.

- **Registration by attribute.** Any static method tagged `[ConsoleCommand("give")]` becomes a command. Features add their own cheats next to the code they affect, without touching the console.
- **Argument parsing.** The console converts typed arguments (`give sword 3`) into the method's parameter types.
- **Discoverability.** A `help` command lists every command with its description. Autocomplete and history (arrow up) make it fast to use.
- **Output.** Commands return or log text, and the console also mirrors the engine's log so errors are visible on device.
- **Stripped from release.** The whole system compiles only in the editor and development builds.

## Pseudocode

```text
commands ← map from name to (function, help, argument types)

// Features register their own commands, next to the code they affect.
register(name, function, help, argument types):
    commands[lowercase name] ← (function, help, argument types)

when the toggle key (`) is pressed: show or hide the console
when Up is pressed while it is open: put the previous history line in the field
mirror the engine's log into the output, errors in red

execute(line):
    parts ← line split on spaces, empty parts dropped
    if parts is empty: return
    add line to history; print "> " + line

    name ← lowercase parts[0]
    if name is "help":
        for each command, sorted by name: print its name and help
        return
    if name is not in commands:
        print "Unknown command. Try 'help'."; return

    cmd ← commands[name]
    for each parameter i of cmd:
        args[i] ← parts[i + 1] converted to parameter i's type,
                  or parameter i's default value if it was not typed
    result ← call cmd.function(args)     // print an error instead of crashing
    if there is a result: print it

// A cheat, in the player's own code, in development builds only:
register("gold", add amount (default 1000) to the wallet, "Add gold", [integer])
```

## Example

The console itself. Unity and Godot need one; Unreal has one built in, so its tab registers commands and variables with it:

::: code-group

```csharp [Unity (C#)]
#if UNITY_EDITOR || DEVELOPMENT_BUILD
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using UnityEngine;

[AttributeUsage(AttributeTargets.Method)]
public class ConsoleCommandAttribute : Attribute
{
    public readonly string Name, Help;
    public ConsoleCommandAttribute(string name, string help = "") { Name = name; Help = help; }
}

public class DevConsole : MonoBehaviour
{
    readonly Dictionary<string, (MethodInfo method, string help)> commands = new();
    readonly List<string> log = new();
    readonly List<string> history = new();
    string input = "";
    bool open;
    int historyIndex;
    Vector2 scroll;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void Create() => DontDestroyOnLoad(new GameObject("[DevConsole]").AddComponent<DevConsole>());

    void Awake()
    {
        // Find every static method marked [ConsoleCommand] in the game's assemblies.
        foreach (var type in AppDomain.CurrentDomain.GetAssemblies()
                     .Where(a => a.GetName().Name.StartsWith("Assembly-CSharp"))
                     .SelectMany(a => a.GetTypes()))
        foreach (var m in type.GetMethods(BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic))
        {
            var attr = m.GetCustomAttribute<ConsoleCommandAttribute>();
            if (attr != null) commands[attr.Name.ToLowerInvariant()] = (m, attr.Help);
        }

        Application.logMessageReceived += (msg, _, type) =>
            log.Add(type == LogType.Log ? msg : $"<color=#f66>{msg}</color>");
    }

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.BackQuote)) open = !open;
    }

    void OnGUI()
    {
        if (!open) return;
        GUILayout.BeginArea(new Rect(10, 10, Screen.width - 20, Screen.height * 0.4f), GUI.skin.box);
        scroll = GUILayout.BeginScrollView(scroll);
        foreach (var line in log.TakeLast(200)) GUILayout.Label(line);
        GUILayout.EndScrollView();

        var e = Event.current;
        if (e.type == EventType.KeyDown)
        {
            if (e.keyCode == KeyCode.Return) { Execute(input); input = ""; e.Use(); }
            else if (e.keyCode == KeyCode.UpArrow && history.Count > 0)
            {
                historyIndex = Mathf.Max(0, historyIndex - 1); input = history[historyIndex]; e.Use();
            }
        }

        GUI.SetNextControlName("ConsoleInput");
        input = GUILayout.TextField(input);
        GUI.FocusControl("ConsoleInput");
        GUILayout.EndArea();
    }

    void Execute(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        history.Add(line); historyIndex = history.Count;
        log.Add($"> {line}");

        var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        string name = parts[0].ToLowerInvariant();

        if (name == "help")
        {
            foreach (var (n, c) in commands.OrderBy(kv => kv.Key).Select(kv => (kv.Key, kv.Value)))
                log.Add($"{n} {string.Join(" ", c.method.GetParameters().Select(p => $"<{p.Name}>"))}  {c.help}");
            return;
        }

        if (!commands.TryGetValue(name, out var cmd)) { log.Add($"Unknown command '{name}'. Try 'help'."); return; }

        var ps = cmd.method.GetParameters();
        var args = new object[ps.Length];
        try
        {
            for (int i = 0; i < ps.Length; i++)
                args[i] = i + 1 < parts.Length
                    ? Convert.ChangeType(parts[i + 1], ps[i].ParameterType, System.Globalization.CultureInfo.InvariantCulture)
                    : ps[i].HasDefaultValue ? ps[i].DefaultValue
                    : throw new ArgumentException($"missing <{ps[i].Name}>");

            var result = cmd.method.Invoke(null, args);
            if (result != null) log.Add(result.ToString());
        }
        catch (Exception ex) { log.Add($"<color=#f66>{(ex.InnerException ?? ex).Message}</color>"); }
    }
}
#endif
```

```gdscript [Godot (GDScript)]
# dev_console.gd: autoload named DevConsole. ` toggles it; features register their own commands.
extends CanvasLayer

var _commands := {}  # name -> {callable, help, types}
var _history := PackedStringArray()
var _history_index := 0
var _panel := PanelContainer.new()
var _output := RichTextLabel.new()
var _field := LineEdit.new()


func _ready() -> void:
	if not OS.is_debug_build():
		queue_free()  # release exports: no console, no cheats
		return
	layer = 128
	process_mode = Node.PROCESS_MODE_ALWAYS  # usable while the game is paused
	_panel.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_panel.custom_minimum_size.y = 300
	_panel.hide()
	var box := VBoxContainer.new()
	_output.bbcode_enabled = true
	_output.scroll_following = true
	_output.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_field.text_submitted.connect(_on_submitted)
	box.add_child(_output)
	box.add_child(_field)
	_panel.add_child(box)
	add_child(_panel)
	register("help", _help, "List commands")


## types: one Variant.Type per argument (TYPE_INT, TYPE_FLOAT, TYPE_BOOL, TYPE_STRING).
## Missing trailing arguments fall back to the function's default values.
func register(command: String, callable: Callable, help := "", types: Array[int] = []) -> void:
	_commands[command.to_lower()] = {callable = callable, help = help, types = types}


func log_line(text: String) -> void:
	_output.append_text(text + "\n")


func _input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if key == null or not key.pressed or key.echo:
		return
	if key.keycode == KEY_QUOTELEFT:
		_panel.visible = not _panel.visible
		if _panel.visible:
			_field.grab_focus()
		get_viewport().set_input_as_handled()  # don't type ` into the field or pass it to the game
	elif _panel.visible and key.keycode == KEY_UP and not _history.is_empty():
		_history_index = maxi(0, _history_index - 1)
		_field.text = _history[_history_index]
		get_viewport().set_input_as_handled()


func _on_submitted(line: String) -> void:
	_field.clear()
	execute(line)


func execute(line: String) -> void:
	var parts := line.strip_edges().split(" ", false)
	if parts.is_empty():
		return
	_history.append(line)
	_history_index = _history.size()
	log_line("> " + line)

	var cmd: Dictionary = _commands.get(parts[0].to_lower(), {})
	if cmd.is_empty() or not cmd.callable.is_valid():  # invalid: its object was freed
		log_line("[color=#f66]Unknown command '%s'. Try 'help'.[/color]" % parts[0])
		return
	var args := []
	for i in mini(parts.size() - 1, cmd.types.size()):
		args.append(_convert(parts[i + 1], cmd.types[i]))
	var result: Variant = cmd.callable.callv(args)
	if result != null:
		log_line(str(result))


func _convert(text: String, type: int) -> Variant:
	match type:
		TYPE_INT:
			return text.to_int()
		TYPE_FLOAT:
			return text.to_float()
		TYPE_BOOL:
			return text in ["1", "true", "on"]
	return text


func _help() -> void:
	var names := _commands.keys()
	names.sort()
	for n: String in names:
		log_line("%s  %s" % [n, _commands[n].help])
```

```cpp [Unreal (C++)]
// DevCommands.cpp: the console (the ~ key), its history and autocomplete are built in and compiled
// out of Shipping builds. Commands and variables register themselves at startup.
#include "CoreMinimal.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/GameplayStatics.h"

#if !UE_BUILD_SHIPPING

// A console variable: "game.ShowAIDebug 1". Read it with CVarShowAIDebug.GetValueOnGameThread().
static TAutoConsoleVariable<bool> CVarShowAIDebug(
	TEXT("game.ShowAIDebug"), false, TEXT("Draw AI perception and paths"), ECVF_Cheat);

// A command with the world and the typed-in arguments: "game.Teleport 100 200 50".
static FAutoConsoleCommandWithWorldAndArgs GTeleportCommand(
	TEXT("game.Teleport"),
	TEXT("Teleport the local player to X Y Z"),
	FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
	{
		if (Args.Num() < 3)
		{
			UE_LOG(LogTemp, Warning, TEXT("usage: game.Teleport X Y Z"));
			return;
		}
		if (APawn* Pawn = UGameplayStatics::GetPlayerPawn(World, 0))
			Pawn->SetActorLocation(FVector(FCString::Atof(*Args[0]), FCString::Atof(*Args[1]), FCString::Atof(*Args[2])));
	}),
	ECVF_Cheat);

#endif
```

:::

Commands live next to the features they control:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public static class PlayerCheats
{
#if UNITY_EDITOR || DEVELOPMENT_BUILD
    [ConsoleCommand("god", "Toggle invulnerability")]
    static string God() => $"God mode: {(Player.Instance.Invulnerable = !Player.Instance.Invulnerable)}";

    [ConsoleCommand("gold", "Add gold")]
    static void Gold(int amount = 1000) => Player.Instance.Wallet.Add(amount);

    [ConsoleCommand("tp", "Teleport to x y z")]
    static void Teleport(float x, float y, float z) => Player.Instance.transform.position = new Vector3(x, y, z);

    [ConsoleCommand("timescale", "Set time scale")]
    static void TimeScale(float scale) => Time.timeScale = scale;   // or push a GameTime request
#endif
}
```

```gdscript [Godot (GDScript)]
# player.gd
extends CharacterBody3D

var invulnerable := false
@onready var wallet: Wallet = $Wallet


func _ready() -> void:
	if OS.is_debug_build():
		DevConsole.register("god", _cmd_god, "Toggle invulnerability")
		DevConsole.register("gold", _cmd_gold, "Add gold", [TYPE_INT])
		DevConsole.register("tp", _cmd_teleport, "Teleport to x y z", [TYPE_FLOAT, TYPE_FLOAT, TYPE_FLOAT])
		DevConsole.register("timescale", _cmd_time_scale, "Set time scale", [TYPE_FLOAT])


func _cmd_god() -> String:
	invulnerable = not invulnerable
	return "God mode: %s" % invulnerable


func _cmd_gold(amount := 1000) -> void:
	wallet.add(amount)


func _cmd_teleport(x: float, y: float, z: float) -> void:
	global_position = Vector3(x, y, z)


func _cmd_time_scale(scale: float) -> void:
	Engine.time_scale = scale  # or push a GameTime request
```

```cpp [Unreal (C++)]
// MyCheatManager.h: every UFUNCTION(Exec) on the cheat manager is a console command, with its
// arguments parsed from the typed text. UCheatManager already has God, Fly, Ghost, Slomo and more.
// Set CheatClass = UMyCheatManager::StaticClass() in your player controller's constructor.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/CheatManager.h"
#include "MyCheatManager.generated.h"

UCLASS()
class UMyCheatManager : public UCheatManager
{
	GENERATED_BODY()

public:
	UFUNCTION(Exec)
	void Gold(int32 Amount = 1000);

	UFUNCTION(Exec)
	void TeleportTo(float X, float Y, float Z);
};

// MyCheatManager.cpp
#include "MyCheatManager.h"
#include "MyPlayerState.h"

void UMyCheatManager::Gold(int32 Amount)
{
	// Runs on the client that typed it: in multiplayer, forward to a Server RPC that checks permissions.
	if (AMyPlayerState* PlayerState = GetOuterAPlayerController()->GetPlayerState<AMyPlayerState>())
		PlayerState->AddGold(Amount);
}

void UMyCheatManager::TeleportTo(float X, float Y, float Z)
{
	if (APawn* Pawn = GetOuterAPlayerController()->GetPawn()) Pawn->SetActorLocation(FVector(X, Y, Z));
}
```

:::

**Engine notes**

- **Unity:** Scanning assemblies with reflection is slow-ish (tens of milliseconds) and happens once at startup, in development builds only. With IL2CPP and managed code stripping, add a `link.xml` entry or `[Preserve]` attributes so unreferenced command methods are not removed. Unity has no runtime console of its own; `Debug.Log` output goes to the player log file.
- **Godot:** There is no in-game console built in. `OS.is_debug_build()` is true in the editor and in exports with *Export With Debug* on, so release exports remove the console. Godot 4.5 adds `OS.add_logger()` for capturing engine errors and `print()` output in the console; earlier versions can't capture them from script. Several console add-ons exist in the Asset Library.
- **Unreal:** The console (`~`), `TAutoConsoleVariable`, `FAutoConsoleCommand*` and `UFUNCTION(Exec)` are all built in. `Exec` functions only work on certain classes (the player controller, its cheat manager, the HUD, the game mode, the pawn and the game instance), and the cheat manager exists only when cheats are allowed: always in development builds, and through `EnableCheats` or `AGameModeBase::AllowCheats` otherwise. Flag cheat variables `ECVF_Cheat` so they're unavailable in Shipping.

## When to use

- Every project past the prototype stage: QA, designers and programmers all need shortcuts.
- Mobile and console builds, where editor tools are unavailable.
- Reproducing bugs: jump to a level, spawn an enemy, set a stat, toggle debug views.

## When not to use

- Shipping to players without stripping or locking it. Cheats left in can break competitive or economy games.
- Game jams and very small projects. Editor-only buttons and keyboard shortcuts are faster to add.

## Pitfalls

- **Cheats shipping to players.** Wrap commands and the console in `#if UNITY_EDITOR || DEVELOPMENT_BUILD`, and verify a release build actually excludes them.
- **Multiplayer.** A client-side cheat command that changes gold is a cheat for real. Route commands through the server, and require developer permissions there.
- **Commands that break invariants.** `tp` into a wall, or `gold -999999`, creates states the game never expects. That is useful for testing, but keep commands going through normal APIs (`Wallet.Add`) rather than poking fields.
- **Input leaking to the game.** Typing "w" in the console moves the player. Disable gameplay input (switch action maps) while the console is open.
- **Reflection stripping.** IL2CPP builds can strip command methods that nothing references. Preserve them explicitly.

## Related

- [Debug Draw](./debug-draw) — visualise what commands change.
- [Command](./command) — console commands can create gameplay commands, so they replay and network like normal actions.
- [Input Abstraction](./input-abstraction) — switch to a console action map while typing.
- [Replay System](./replay-system) — commands executed during a session can be part of a bug report.
