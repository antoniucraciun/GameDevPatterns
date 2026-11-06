# Localization Tables

> All player-facing text lives in keyed tables per locale.

**Category:** Data, Content & Procedural Generation

## Problem

Text is written directly in code and prefabs: `label.text = "You found " + count + " coins!"`. When the game is translated, someone must hunt down every string in scripts, scenes and prefabs, and some are missed. Word order differs between languages, so string concatenation produces broken grammar. "1 coins" is wrong in English, and other languages have more than two plural forms. German text is 30% longer and overflows buttons. Japanese needs a different font. Translators cannot work in Unity scenes.

## Solution

Never put player-facing text in code or prefabs. Instead:

- **Keys, not text.** Code and UI refer to keys: `"loot.found_coins"`.
- **Tables per locale.** Each language has a table mapping keys to text. Translators edit the tables (often exported as CSV, XLIFF or a Google Sheet), never the game.
- **Formatting in the string.** Variables and plurals are placeholders *inside* the translated string, so each language controls its own word order and grammar: `"You found {count} {count:plural:coin|coins}"`.
- **Fallback.** A missing translation falls back to the base language, and is reported, never shown as a blank or a key.
- **Assets too.** Fonts, voice-over, images with text and even UI layouts can vary per locale.

Unity's **Localization** package provides string tables, asset tables, `LocalizedString` fields with smart-string formatting (plurals, variables, gender), locale selection, and import/export for translators.

## Example (Unity C#)

With the Unity Localization package. A `LocalizedString` is a table + key reference, editable in the inspector, that updates automatically when the language changes:

```csharp
using UnityEngine;
using UnityEngine.Localization;
using UnityEngine.Localization.Settings;

public class CoinPickupMessage : MonoBehaviour
{
    // In the inspector: table "Gameplay", key "loot.found_coins".
    // English entry (Smart String):  "You found {count} {count:plural:coin|coins}!"
    // German entry:                  "Du hast {count} {count:plural:Münze|Münzen} gefunden!"
    [SerializeField] LocalizedString foundCoins;
    [SerializeField] TMPro.TMP_Text label;

    public void Show(int count)
    {
        foundCoins.Arguments = new object[] { new { count } };   // named argument for the smart string
        foundCoins.RefreshString();
    }

    void OnEnable()  => foundCoins.StringChanged += UpdateText;  // also fires when the locale changes
    void OnDisable() => foundCoins.StringChanged -= UpdateText;

    void UpdateText(string text) => label.text = text;
}

public class LanguageMenu : MonoBehaviour
{
    public void SetLanguage(string code)                         // "en", "de", "ja"
    {
        var locale = LocalizationSettings.AvailableLocales.GetLocale(code);
        if (locale != null) LocalizationSettings.SelectedLocale = locale;   // every LocalizedString updates
    }
}
```

The underlying idea is small enough to build yourself, which helps explain what the package does:

```csharp
using System.Collections.Generic;

public static class Loc
{
    static Dictionary<string, string> current = new(), fallback = new();
    public static event System.Action Changed;

    public static void Load(Dictionary<string, string> table, Dictionary<string, string> baseLanguage)
    {
        current = table; fallback = baseLanguage;
        Changed?.Invoke();
    }

    public static string Get(string key, params (string name, object value)[] args)
    {
        if (!current.TryGetValue(key, out var text))
        {
            UnityEngine.Debug.LogWarning($"Missing translation: {key}");
            if (!fallback.TryGetValue(key, out text)) return $"#{key}#";   // visible, searchable marker
        }
        foreach (var (name, value) in args) text = text.Replace("{" + name + "}", value.ToString());
        return text;
    }
}

// Loc.Get("ui.greeting", ("name", playerName));
```

Plurals, genders and number formatting are where hand-made systems fall short, which is the main reason to use the package or a library with proper plural rules.

## When to use

- Any game that may ever be translated. Retrofitting localisation is far more expensive than starting with keys.
- Even single-language games benefit: all text in one place for proofreading, consistent terminology, and no text in prefabs.

## Pitfalls

- **Concatenation.** `"You found " + n + " coins"` cannot be translated correctly. Every sentence must be one string with placeholders.
- **Hard-coded plurals.** `n == 1 ? "coin" : "coins"` is wrong for Russian, Polish, Arabic and many others. Use plural rules from the localisation system.
- **Layouts that assume English length.** German and French run 20–35% longer. Use auto-sizing and flexible layouts, and test with a pseudo-locale that lengthens all strings.
- **Fonts.** A Latin font has no Japanese, Chinese or Korean glyphs, so text shows as boxes. Configure font fallbacks or font assets per locale, and check TextMeshPro atlas coverage.
- **Text in images and textures.** Signs and UI baked into art cannot be translated. Use asset tables for localised textures, or overlay text.
- **Keys reused for different meanings.** "Close" (a door) and "Close" (a window) may need different words in other languages. Give each use its own key, with a comment for translators.

## Related

- [Data-Driven Design](./data-driven-design) — text is content, kept out of code.
- [Data Binding](./data-binding) — UI updates when the locale changes, like any other observable value.
- [Dialogue System](./dialogue-system) — dialogue nodes store keys, not text.
- [Asset References & Addressing](./asset-reference) — localised voice-over and textures loaded per locale.
