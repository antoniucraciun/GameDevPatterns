# Localization Tables

> All player-facing text lives in keyed tables per locale.

**Category:** Data, Content & Procedural Generation

## Problem

Text is written directly in code and scenes: `label.text = "You found " + count + " coins!"`. When the game is translated, someone must hunt down every string in scripts and scenes, and some are missed. Word order differs between languages, so string concatenation produces broken grammar. "1 coins" is wrong in English, and other languages have more than two plural forms. German text is 30% longer and overflows buttons. Japanese needs a different font. Translators cannot work in the game's scenes.

## Solution

Never put player-facing text in code or scenes. Instead:

- **Keys, not text.** Code and UI refer to keys: `"loot.found_coins"`.
- **Tables per locale.** Each language has a table mapping keys to text. Translators edit the tables (often exported as CSV, XLIFF or a Google Sheet), never the game.
- **Formatting in the string.** Variables and plurals are placeholders *inside* the translated string, so each language controls its own word order and grammar: `"You found {count} {count:plural:coin|coins}"`.
- **Fallback.** A missing translation falls back to the base language, and is reported, never shown as a blank or a key.
- **Assets too.** Fonts, voice-over, images with text and even UI layouts can vary per locale.

Each engine has this built in or as a package:

- **Unity:** the **Localization** package provides string tables, asset tables, `LocalizedString` fields with smart-string formatting (plurals, variables, gender), locale selection, and import/export for translators.
- **Godot:** localization is built in. `tr()` and `tr_n()` translate keys from CSV or PO files, controls translate matching text automatically, and `TranslationServer.set_locale()` switches language.
- **Unreal:** player-facing text is `FText`. String Tables hold keyed entries, `FText::Format` handles plurals and gender, and the **Localization Dashboard** gathers text and exports PO files for translators.

## Pseudocode

```text
// The tables: one per locale, key → text. Translators edit only these.
Loc:
    current                // the selected locale's table
    fallback               // the base language's table
    changed                // event: the locale switched

    set_locale(locale):
        current ← table for locale
        notify changed     // every visible text refreshes itself

    get(key, arguments):
        text ← current[key]
        if missing:
            report "missing translation: key"
            text ← fallback[key]
            if still missing: return "#key#"    // visible, searchable marker
        if text has plural forms:               // e.g. one = "coin", other = "coins"
            text ← the form the locale's plural rule picks for arguments.count
        replace each {name} in text with arguments[name]
        return text        // word order belongs to the translation

// UI stores a key, never text.
CoinPickupMessage:
    key ← "loot.found_coins"
    count

    show(n):  count ← n; refresh()
    on Loc changed: refresh()
    refresh(): label ← Loc.get(key, { count })

LanguageMenu.choose(code):   Loc.set_locale(code)   // "en", "de", "ja"
```

## Example

### With the engine's localization system

Each engine ships a string-table system with plural support and live language switching. In Unity it's the Localization package: a `LocalizedString` is a table + key reference, editable in the inspector, that updates automatically when the language changes. Godot uses translation files and `tr()`; Unreal uses String Tables and `FText`.

::: code-group

```csharp [Unity (C#)]
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

```gdscript [Godot (GDScript)]
# Translations are .po (gettext) or .csv files, added under Project Settings > Localization.
# CSV is one row per key and has no plural forms, so plurals use a .po file. de.po:
#   msgid "You found {count} coin!"
#   msgid_plural "You found {count} coins!"
#   msgstr[0] "Du hast {count} Münze gefunden!"
#   msgstr[1] "Du hast {count} Münzen gefunden!"

# coin_pickup_message.gd
class_name CoinPickupMessage
extends Label

var _count := 0


func show_coins(count: int) -> void:
	_count = count
	_refresh()


# Every node gets this when the locale changes (and when it enters the tree).
func _notification(what: int) -> void:
	if what == NOTIFICATION_TRANSLATION_CHANGED:
		_refresh()


func _refresh() -> void:
	# tr_n picks the plural form for the current locale; format() fills the named placeholder.
	text = tr_n("You found {count} coin!", "You found {count} coins!", _count).format({"count": _count})


# language_menu.gd
extends Control


func set_language(code: String) -> void:  # "en", "de", "ja"
	# Controls showing plain keys re-translate themselves; scripts refresh on the notification above.
	TranslationServer.set_locale(code)
```

```cpp [Unreal (C++)]
// CoinPickupMessage.h: in the widget Blueprint's defaults, link FoundCoins to a String Table
// entry (table ST_Gameplay, key loot.found_coins) with the flag button next to the text field.
//   English entry:  "You found {count} {count}|plural(one=coin,other=coins)!"
//   German entry:   "Du hast {count} {count}|plural(one=Münze,other=Münzen) gefunden!"
#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "CoinPickupMessage.generated.h"

class UTextBlock;

UCLASS()
class UCoinPickupMessage : public UUserWidget
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, Category = "Loot")
	void Show(int32 Count);

protected:
	UPROPERTY(EditAnywhere, Category = "Text") FText FoundCoins;
	UPROPERTY(meta = (BindWidget)) TObjectPtr<UTextBlock> Label;

	virtual void NativeConstruct() override;
	virtual void NativeDestruct() override;

private:
	void Refresh();

	int32 LastCount = 0;
	FDelegateHandle CultureChangedHandle;
};

UCLASS()
class ULanguageLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, Category = "Localization")
	static void SetLanguage(const FString& Code);   // "en", "de", "ja"
};

// CoinPickupMessage.cpp
#include "CoinPickupMessage.h"
#include "Components/TextBlock.h"
#include "Internationalization/Internationalization.h"
#include "Kismet/KismetInternationalizationLibrary.h"

void UCoinPickupMessage::NativeConstruct()
{
	Super::NativeConstruct();
	CultureChangedHandle = FInternationalization::Get().OnCultureChanged().AddUObject(this, &UCoinPickupMessage::Refresh);
}

void UCoinPickupMessage::NativeDestruct()
{
	FInternationalization::Get().OnCultureChanged().Remove(CultureChangedHandle);
	Super::NativeDestruct();
}

void UCoinPickupMessage::Show(int32 Count)
{
	LastCount = Count;
	Refresh();
}

void UCoinPickupMessage::Refresh()
{
	FFormatNamedArguments Args;
	Args.Add(TEXT("count"), LastCount);                 // plural rules come from the current culture
	Label->SetText(FText::Format(FoundCoins, Args));
}

void ULanguageLibrary::SetLanguage(const FString& Code)
{
	// Switches every FText to the new culture's .locres; true also saves it as the default.
	UKismetInternationalizationLibrary::SetCurrentCulture(Code, true);
}
```

:::

### The idea in miniature

The underlying idea is small enough to build yourself, which helps explain what the engine systems do:

::: code-group

```csharp [Unity (C#)]
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

```gdscript [Godot (GDScript)]
# loc.gd, registered as the autoload "Loc" (Project Settings > Globals).
extends Node

signal changed

var _current := {}
var _fallback := {}


func load_tables(table: Dictionary, base_language: Dictionary) -> void:
	_current = table
	_fallback = base_language
	changed.emit()


func get_text(key: String, args := {}) -> String:
	var text: String
	if _current.has(key):
		text = _current[key]
	else:
		push_warning("Missing translation: %s" % key)
		if not _fallback.has(key):
			return "#%s#" % key  # visible, searchable marker
		text = _fallback[key]
	return text.format(args)  # replaces {name} with args["name"]

# Loc.get_text("ui.greeting", {"name": player_name})
```

```cpp [Unreal (C++)]
// LocSubsystem.h
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "LocSubsystem.generated.h"

DECLARE_MULTICAST_DELEGATE(FOnLocChanged);

UCLASS()
class ULocSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	FOnLocChanged OnChanged;

	void Load(TMap<FString, FString> Table, TMap<FString, FString> BaseLanguage)
	{
		Current = MoveTemp(Table);
		Fallback = MoveTemp(BaseLanguage);
		OnChanged.Broadcast();
	}

	FString Get(const FString& Key, const TMap<FString, FString>& Args = {}) const
	{
		const FString* Text = Current.Find(Key);
		if (!Text)
		{
			UE_LOG(LogTemp, Warning, TEXT("Missing translation: %s"), *Key);
			Text = Fallback.Find(Key);
			if (!Text) return FString::Printf(TEXT("#%s#"), *Key);   // visible, searchable marker
		}
		FString Result = *Text;
		for (const TPair<FString, FString>& Arg : Args)
			Result.ReplaceInline(*(TEXT("{") + Arg.Key + TEXT("}")), *Arg.Value);
		return Result;
	}

private:
	TMap<FString, FString> Current, Fallback;
};

// GetGameInstance()->GetSubsystem<ULocSubsystem>()->Get(TEXT("ui.greeting"), {{TEXT("name"), PlayerName}});
```

:::

Plurals, genders and number formatting are where hand-made systems fall short, which is the main reason to use the engine's system or a library with proper plural rules.

**Engine notes**

- **Unity:** the Localization package (`com.unity.localization`) provides String and Asset Tables, Smart Strings with plural rules, and `LocalizeStringEvent` for no-code binding. This page isn't compile-checked here, because the check's project doesn't include the package.
- **Godot:** localization is built in. `tr()` and `tr_n()` translate, Controls auto-translate text that matches a key, and `TranslationServer.set_locale()` switches language. CSV suits simple key tables; PO files add plural forms and context and work with standard translation tools. The **POT Generation** tab in Project Settings > Localization extracts strings from scenes and scripts.
- **Unreal:** user-facing text is `FText`, never `FString`. String Tables hold keyed entries, the **Localization Dashboard** gathers text, exports PO files for translators and compiles `.locres`, and `FText::Format` handles plurals and gender with `|plural(...)` and `|gender(...)`. `NSLOCTEXT`/`LOCTEXT` mark text written in C++ for gathering.

## When to use

- Any game that may ever be translated. Retrofitting localisation is far more expensive than starting with keys.
- Even single-language games benefit: all text in one place for proofreading, consistent terminology, and no text in scenes.

## When not to use

- Game jams and throwaway prototypes.
- Games with no text, or only a title and a few icons.

## Pitfalls

- **Concatenation.** `"You found " + n + " coins"` cannot be translated correctly. Every sentence must be one string with placeholders.
- **Hard-coded plurals.** `n == 1 ? "coin" : "coins"` is wrong for Russian, Polish, Arabic and many others. Use plural rules from the localisation system.
- **Layouts that assume English length.** German and French run 20–35% longer. Use auto-sizing and flexible layouts, and test with a pseudo-locale that lengthens all strings.
- **Fonts.** A Latin font has no Japanese, Chinese or Korean glyphs, so text shows as boxes. Configure font fallbacks or font assets per locale, and check atlas coverage (TextMeshPro font assets in Unity, font fallbacks in Godot, composite fonts in Unreal).
- **Text in images and textures.** Signs and UI baked into art cannot be translated. Use asset tables for localised textures, or overlay text.
- **Keys reused for different meanings.** "Close" (a door) and "Close" (a window) may need different words in other languages. Give each use its own key, with a comment for translators.

## Related

- [Data-Driven Design](./data-driven-design) — text is content, kept out of code.
- [Data Binding](./data-binding) — UI updates when the locale changes, like any other observable value.
- [Dialogue System](./dialogue-system) — dialogue nodes store keys, not text.
- [Asset References & Addressing](./asset-reference) — localised voice-over and textures loaded per locale.
