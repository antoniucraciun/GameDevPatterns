# Debug Console & Cheats

> A runtime console to inspect state and trigger commands in builds.

**Category:** Tooling, Debugging & Testing

## Problem

A tester needs to check the final boss. Reaching it takes forty minutes of play. A bug only appears with 999 gold and the fire sword equipped. On a phone build, there is no inspector to tweak a value or see what state the AI is in. Every team ends up adding a secret key combination here and a debug button there, scattered through the code and inconsistently stripped from release builds.

## Solution

Build one **console**: a text box that opens with a key (often the backtick), where typed commands run registered functions.

- **Registration by attribute.** Any static method tagged `[ConsoleCommand("give")]` becomes a command. Features add their own cheats next to the code they affect, without touching the console.
- **Argument parsing.** The console converts typed arguments (`give sword 3`) into the method's parameter types.
- **Discoverability.** A `help` command lists every command with its description. Autocomplete and history (arrow up) make it fast to use.
- **Output.** Commands return or log text, and the console also mirrors `Debug.Log` so errors are visible on device.
- **Stripped from release.** The whole system compiles only in the editor and development builds.

## Example (Unity C#)

```csharp
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

Commands live next to the features they control:

```csharp
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

Scanning assemblies with reflection is slow-ish (tens of milliseconds) and happens once at startup, in development builds only. With IL2CPP and managed code stripping, add a `link.xml` entry or `[Preserve]` attributes so unreferenced command methods are not removed.

## When to use

- Every project past the prototype stage: QA, designers and programmers all need shortcuts.
- Mobile and console builds, where editor tools are unavailable.
- Reproducing bugs: jump to a level, spawn an enemy, set a stat, toggle debug views.

## When not to use

- Shipping to players without stripping or locking it. Cheats left in can break competitive or economy games.
- Game jams and very small projects. Inspector buttons and keyboard shortcuts are faster to add.

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
