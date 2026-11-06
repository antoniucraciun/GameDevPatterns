# Settings & Accessibility Menu

> Audio, language, controls and accessibility options that apply live, persist safely and can be reverted.

## Goal

The settings menu every shipped game needs:

- **Audio:** master, music, SFX and voice volume, applied **live** while dragging.
- **Language:** switching applies immediately, everywhere, including the settings menu itself.
- **Controls:** rebind any action, per device, with conflict detection and "reset to default".
- **Accessibility:** screen-shake intensity, reduced flashing, subtitle size, hold-to-toggle and colour-blind filters.
- **Display:** resolution changes show a **"Keep these settings? Reverting in 10 s"** confirmation.
- Settings **persist** across sessions, separate from save slots, and survive crashes.
- Options a platform does not support (resolution on consoles) or that are still experimental are **hidden** cleanly.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Data Binding](../patterns/data-binding) | Every setting is an observable value. Widgets bind to it, and systems react to it, so changes apply live. |
| [Screen Stack](../patterns/screen-stack) | Settings → Controls → Rebind prompt → Confirm, with Back behaving correctly at every level. |
| [Input Abstraction](../patterns/input-abstraction) | Rebinding actions, with binding overrides stored as data. |
| [Save System](../patterns/save-system) | Settings saved atomically to their own file, versioned, with defaults for new options. |
| [Localization Tables](../patterns/localization-tables) | Language selection, plus every label in the menu itself. |
| [Feature Flags](../patterns/feature-flags) | Hide options per platform, and gate experimental ones. |

## How they fit together

```
 GameSettings (observables) ◄──── loaded at boot from settings.json (Save System: versioned, atomic)
   │ MasterVolume, MusicVolume, Language, ShakeScale, ReduceFlashing, SubtitleSize, Bindings
   │
   ├── Widgets ⇄ bind two-way (Data Binding) ──── inside screens on the Screen Stack
   │      Settings ─► Controls ─► "Press a key…" ─► "Conflict: swap?" (each Back pops one)
   │
   └── Appliers subscribe once, react to changes:
          AudioMixer volumes · LocalizationSettings.SelectedLocale · TraumaShake.userScale
          InputActionAsset.LoadBindingOverridesFromJson · Screen.SetResolution (with confirm)
   Feature Flags: which rows exist at all (platform, experiments)
   On closing Settings: save once (not on every slider tick)
```

The joins:

- **Data Binding ↔ systems.** The menu never calls the audio mixer or the localisation system directly. It edits values, and *appliers* react. The same values apply at boot, before the menu has ever opened, which is what makes settings consistent.
- **Screen Stack ↔ confirmation flows.** The rebind prompt and the "keep resolution?" dialog are screens pushed on top. Back cancels them without leaving Settings, and the resolution timer reverts automatically if nobody confirms.
- **Input Abstraction ↔ Save System.** Bindings are saved as the Input System's override JSON, inside the settings file. Loading applies them before gameplay reads any input.
- **Localization ↔ Data Binding.** Language is just another observable. Every `LocalizedString` in the menu updates when it changes, including the language dropdown itself.
- **Feature Flags ↔ menu layout.** Rows are built from a list filtered by flags and platform, so console builds never show a resolution row, and experimental options appear only where enabled.

## Example (Unity C#)

This builds on `Observable<T>` and `Bind` ([Data Binding](../patterns/data-binding)), `Flags` ([Feature Flags](../patterns/feature-flags)) and the atomic-write approach from [Save System](../patterns/save-system).

### The settings model, persisted separately from save slots

```csharp
using System;
using System.IO;
using UnityEngine;

public class GameSettings
{
    public const int Version = 3;

    public readonly Observable<float> MasterVolume = new(1f);
    public readonly Observable<float> MusicVolume = new(0.8f);
    public readonly Observable<float> SfxVolume = new(1f);
    public readonly Observable<string> Language = new("en");
    public readonly Observable<float> ShakeScale = new(1f);            // accessibility: 0 = off
    public readonly Observable<bool> ReduceFlashing = new(false);
    public readonly Observable<int> SubtitleSize = new(1);             // 0 small, 1 medium, 2 large
    public readonly Observable<string> Bindings = new("");             // Input System override JSON

    [Serializable]
    class Data
    {
        public int version;
        public float master = 1f, music = 0.8f, sfx = 1f, shake = 1f;
        public string language = "en", bindings = "";
        public bool reduceFlashing;
        public int subtitleSize = 1;
    }

    static string PathOf => System.IO.Path.Combine(Application.persistentDataPath, "settings.json");

    public void Load()
    {
        var d = File.Exists(PathOf) ? JsonUtility.FromJson<Data>(File.ReadAllText(PathOf)) : new Data();
        // Fields added in newer versions keep their defaults (JsonUtility leaves missing fields untouched).
        MasterVolume.Value = d.master; MusicVolume.Value = d.music; SfxVolume.Value = d.sfx;
        Language.Value = d.language; ShakeScale.Value = d.shake; ReduceFlashing.Value = d.reduceFlashing;
        SubtitleSize.Value = d.subtitleSize; Bindings.Value = d.bindings;
    }

    public void Save()
    {
        var d = new Data
        {
            version = Version, master = MasterVolume.Value, music = MusicVolume.Value, sfx = SfxVolume.Value,
            language = Language.Value, shake = ShakeScale.Value, reduceFlashing = ReduceFlashing.Value,
            subtitleSize = SubtitleSize.Value, bindings = Bindings.Value,
        };
        string temp = PathOf + ".tmp";
        File.WriteAllText(temp, JsonUtility.ToJson(d));
        if (File.Exists(PathOf)) File.Replace(temp, PathOf, PathOf + ".bak"); else File.Move(temp, PathOf);
    }
}
```

### Appliers: settings take effect everywhere, at boot and live

```csharp
using UnityEngine.Audio;
using UnityEngine.InputSystem;
using UnityEngine.Localization.Settings;

public class SettingsAppliers : MonoBehaviour
{
    [SerializeField] AudioMixer mixer;
    [SerializeField] InputActionAsset actions;

    readonly CompositeDisposable subscriptions = new();

    public void Bind(GameSettings s)          // called by the bootstrapper after Load()
    {
        subscriptions.Add(new Binding<float>(s.MasterVolume, v => mixer.SetFloat("Master", ToDb(v))));
        subscriptions.Add(new Binding<float>(s.MusicVolume, v => mixer.SetFloat("Music", ToDb(v))));
        subscriptions.Add(new Binding<float>(s.SfxVolume, v => mixer.SetFloat("Sfx", ToDb(v))));
        subscriptions.Add(new Binding<string>(s.Language, code =>
        {
            var locale = LocalizationSettings.AvailableLocales.GetLocale(code);
            if (locale != null) LocalizationSettings.SelectedLocale = locale;
        }));
        subscriptions.Add(new Binding<float>(s.ShakeScale, v => TraumaShake.UserScale = v));
        subscriptions.Add(new Binding<bool>(s.ReduceFlashing, v => FlashEffects.Reduced = v));
        subscriptions.Add(new Binding<string>(s.Bindings, json =>
        {
            actions.RemoveAllBindingOverrides();
            if (!string.IsNullOrEmpty(json)) actions.LoadBindingOverridesFromJson(json);
        }));
    }

    // Linear slider 0..1 → decibels, with true silence at 0.
    static float ToDb(float v) => v <= 0.0001f ? -80f : Mathf.Log10(v) * 20f;

    void OnDestroy() => subscriptions.Dispose();
}
```

### The screen: rows filtered by flags, widgets bound two-way

```csharp
public class SettingsScreen : UIScreen                    // from the Screen Stack page
{
    [SerializeField] UnityEngine.UI.Slider master, music, sfx, shake;
    [SerializeField] UnityEngine.UI.Toggle reduceFlashing;
    [SerializeField] GameObject resolutionRow, colourBlindRow;
    [SerializeField] UIScreen controlsScreen;
    [SerializeField] ScreenStack stack;

    readonly CompositeDisposable bindings = new();
    GameSettings settings;

    public override void OnPush()
    {
        base.OnPush();
        settings = Services.Get<GameSettings>();
        bindings.Add(Bind.TwoWay(settings.MasterVolume, master));     // dragging applies live
        bindings.Add(Bind.TwoWay(settings.MusicVolume, music));
        bindings.Add(Bind.TwoWay(settings.SfxVolume, sfx));
        bindings.Add(Bind.TwoWay(settings.ShakeScale, shake));
        reduceFlashing.SetIsOnWithoutNotify(settings.ReduceFlashing.Value);
        reduceFlashing.onValueChanged.AddListener(v => settings.ReduceFlashing.Value = v);

        resolutionRow.SetActive(Application.platform is RuntimePlatform.WindowsPlayer or RuntimePlatform.OSXPlayer
                                                     or RuntimePlatform.LinuxPlayer);
        colourBlindRow.SetActive(Flags.IsOn(Feature.ColourBlindModes));   // experimental: behind a flag
    }

    public override void OnPop()
    {
        bindings.Dispose();
        reduceFlashing.onValueChanged.RemoveAllListeners();
        settings.Save();                                  // one save when leaving, not on every tick
        base.OnPop();
    }

    public void OpenControls() => stack.Push(controlsScreen);
}
```

Small additions to other pages' code: `Feature.ColourBlindModes` joins the flag enum, and `TraumaShake.UserScale` and `FlashEffects.Reduced` are static accessibility settings that those systems read (the Screen Shake page's per-instance `userScale`, made global).

The controls screen calls `PerformInteractiveRebinding` on the selected action (see [Input Abstraction](../patterns/input-abstraction)), checks the new binding against the others in the same map, and pushes a "Conflict: swap bindings?" screen when needed. On completion, it writes `actions.SaveBindingOverridesAsJson()` into `settings.Bindings`, and the applier does the rest.

## Where the patterns meet: pitfalls

- **Settings applied only by the menu.** If the menu applies volume when a slider moves, but nothing applies it at boot, the game starts at full volume until the player opens Settings. Appliers bound at boot fix this for every option.
- **Saving on every change.** Writing the file on each slider tick is slow and wears storage on consoles and phones. Save once when leaving the menu, and on application quit.
- **Settings inside save slots.** Volume or bindings stored per save slot change when the player loads another slot. Keep settings in their own file.
- **Unrevertable display changes.** A resolution the monitor cannot show leaves the player with a black screen and no way back. Always push a confirmation screen with a timed automatic revert.
- **Rebinding conflicts and lockout.** Binding "Back" or "Confirm" to an unreachable key can lock players out of the menu itself. Protect essential UI actions, or always keep a fixed fallback key.
- **Language changing mid-frame.** Some text (cached strings, labels built once) does not update when the locale changes. Make every label a `LocalizedString`, or rebuild screens on the locale-changed event.

## Variations

- **Presets:** "Low / Medium / High" set several observables at once. Changing any individual one shows "Custom".
- **Per-profile settings:** consoles with several signed-in users keep one settings file per user.
- **Cloud sync:** save settings through the platform's cloud save behind an [Adapter](../patterns/adapter).
- **First-launch flow:** push the language and accessibility screens before the main menu on first launch.
