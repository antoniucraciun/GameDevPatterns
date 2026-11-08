# Dialogue System

> Branching conversations as a node graph with conditions and side effects.

**Category:** Gameplay Systems

## Problem

The first NPC conversation is a `switch` in the NPC script, with lines hard-coded in English. The second NPC copies it. Then writers want choices, lines that depend on whether a quest is done, choices that only appear with enough gold, and conversations that give items or start quests. Localisation needs every line extracted. Writers cannot change a single word without a programmer, and nobody can see the shape of a conversation.

## Solution

Represent each conversation as **data**: a graph of **nodes**.

- A **line node** has a speaker, the text (a **localisation key**, not a literal string) and the next node.
- A **choice node** offers several options. Each option has its own text, an optional **condition** (shown only if true), optional **effects** (run if chosen), and a next node.
- **Conditions** read game state: quest started or completed, item count, relationship value, flags.
- **Effects** change game state: start or complete a quest, give items, set a flag, change relationship.
- A **dialogue runner** walks the graph, evaluates conditions, runs effects, and tells the UI what to show. The UI never decides anything.

Conditions and effects are small data objects, so writers combine them in the editor. Dedicated tools such as **Ink** and **Yarn Spinner** implement this pattern with a scripting language and integrations for Unity, Godot and Unreal (official or community-made), and are worth considering before building your own.

## Pseudocode

```text
Conversation:               // data, written in the editor
    start_node_id
    nodes                   // found by id
DialogueNode:
    id, speaker, text_key   // "mira.greeting", not the text itself
    next_id                 // used when there are no choices; empty = end
    choices, on_enter       // on_enter: effects run when the node is shown
DialogueChoice:
    text_key, next_id
    conditions              // all must hold for the choice to appear
    effects                 // run when it is picked: start quest, set flag…

DialogueRunner:             // decides everything; the UI only displays
    current, visible_choices

    start(conversation): go_to(conversation.start_node_id)

    go_to(id):
        current ← the node with that id, or nothing if id is empty
        if there is no current: announce ended; return
        run each effect in current.on_enter
        visible_choices ← the choices whose conditions are all met
        announce show(current.speaker, translate(current.text_key),
                      translate each visible choice's text_key)

    select(index):          // called by the UI
        if visible_choices is empty: go_to(current.next_id)   // a plain line
        else:
            choice ← visible_choices[index]
            run each effect in choice.effects
            go_to(choice.next_id)
```

## Example

### The conversation as data

A conversation is a list of nodes with choices; conditions and effects are small objects designers pick from a list. Quests are from the [Quest System](./quest-system) page.

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(menuName = "Dialogue/Conversation")]
public class Conversation : ScriptableObject
{
    public string startNodeId;
    public List<DialogueNode> nodes = new();

    public DialogueNode Find(string id) => nodes.Find(n => n.id == id);
}

[Serializable]
public class DialogueNode
{
    public string id;
    public string speaker;
    public string textKey;                              // localisation key, e.g. "mira.greeting"
    public string nextId;                               // used when there are no choices; empty = end
    public List<DialogueChoice> choices = new();
    [SerializeReference] public List<DialogueEffect> onEnter = new();
}

[Serializable]
public class DialogueChoice
{
    public string textKey;
    public string nextId;
    [SerializeReference] public List<DialogueCondition> conditions = new();
    [SerializeReference] public List<DialogueEffect> effects = new();
}

// ── Conditions and effects: small, composable, editable in the inspector ──

public interface IGameState                              // what dialogue may read and change
{
    QuestLog Quests { get; }
    int ItemCount(string itemId);
    void GiveItem(string itemId, int count);
    bool GetFlag(string flag);
    void SetFlag(string flag, bool value);
}

[Serializable] public abstract class DialogueCondition { public abstract bool IsMet(IGameState s); }
[Serializable] public abstract class DialogueEffect { public abstract void Apply(IGameState s); }

[Serializable]
public class QuestStateCondition : DialogueCondition
{
    public string questId;
    public bool mustBeCompleted;                         // false = must be active
    public override bool IsMet(IGameState s) =>
        mustBeCompleted ? s.Quests.IsCompleted(questId) : s.Quests.IsActive(questId);
}

[Serializable]
public class HasItemCondition : DialogueCondition
{
    public string itemId; public int count = 1;
    public override bool IsMet(IGameState s) => s.ItemCount(itemId) >= count;
}

[Serializable]
public class StartQuestEffect : DialogueEffect
{
    public QuestDefinition quest;
    public override void Apply(IGameState s) => s.Quests.Start(quest);
}

[Serializable]
public class SetFlagEffect : DialogueEffect
{
    public string flag; public bool value = true;
    public override void Apply(IGameState s) => s.SetFlag(flag, value);
}
```

```gdscript [Godot (GDScript)]
# conversation.gd: one .tres per conversation; nodes, choices, conditions and effects are
# sub-resources edited in place in the inspector.
class_name Conversation
extends Resource

@export var start_node_id: StringName
@export var nodes: Array[DialogueNode] = []


func find(id: StringName) -> DialogueNode:
	for n in nodes:
		if n.id == id:
			return n
	return null


# dialogue_node.gd
class_name DialogueNode
extends Resource

@export var id: StringName
@export var speaker := ""
@export var text_key := ""  # translation key, e.g. "MIRA_GREETING"
@export var next_id: StringName  # used when there are no choices; empty = end
@export var choices: Array[DialogueChoice] = []
@export var on_enter: Array[DialogueEffect] = []


# dialogue_choice.gd
class_name DialogueChoice
extends Resource

@export var text_key := ""
@export var next_id: StringName
@export var conditions: Array[DialogueCondition] = []
@export var effects: Array[DialogueEffect] = []


# game_state.gd: what dialogue may read and change. Autoload it as "Game":
# an autoload can't have the same name as its script's class_name.
class_name GameState
extends Node

var flags := {}


func get_flag(flag: StringName) -> bool:
	return flags.get(flag, false)


func set_flag(flag: StringName, value: bool) -> void:
	flags[flag] = value


func item_count(_item_id: StringName) -> int:
	return 0  # ask the player's inventory


# dialogue_condition.gd: base class.
class_name DialogueCondition
extends Resource


func is_met(_state: GameState) -> bool:
	return true


# dialogue_effect.gd: base class.
class_name DialogueEffect
extends Resource


func apply(_state: GameState) -> void:
	pass


# quest_state_condition.gd: QuestLog is the autoload from the Quest System page.
class_name QuestStateCondition
extends DialogueCondition

@export var quest_id: StringName
@export var must_be_completed := false  # false = must be active


func is_met(_state: GameState) -> bool:
	return QuestLog.is_completed(quest_id) if must_be_completed else QuestLog.is_active(quest_id)


# has_item_condition.gd
class_name HasItemCondition
extends DialogueCondition

@export var item_id: StringName
@export var count := 1


func is_met(state: GameState) -> bool:
	return state.item_count(item_id) >= count


# start_quest_effect.gd
class_name StartQuestEffect
extends DialogueEffect

@export var quest: QuestDefinition


func apply(_state: GameState) -> void:
	QuestLog.start(quest)


# set_flag_effect.gd
class_name SetFlagEffect
extends DialogueEffect

@export var flag: StringName
@export var value := true


func apply(state: GameState) -> void:
	state.set_flag(flag, value)
```

```cpp [Unreal (C++)]
// Conversation.h: text is FText, so the engine's localization tools translate it; no keys needed.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "Engine/GameInstance.h"
#include "QuestSubsystem.h"
#include "Conversation.generated.h"

// Conditions and effects are instanced sub-objects, picked from a class dropdown in the details panel.
UCLASS(Abstract, EditInlineNew, DefaultToInstanced, CollapseCategories)
class UDialogueCondition : public UObject
{
	GENERATED_BODY()

public:
	virtual bool IsMet(const UGameInstance* Game) const { return true; }
};

UCLASS(Abstract, EditInlineNew, DefaultToInstanced, CollapseCategories)
class UDialogueEffect : public UObject
{
	GENERATED_BODY()

public:
	virtual void Apply(UGameInstance* Game) const {}
};

UCLASS(meta = (DisplayName = "Quest State"))
class UQuestStateCondition : public UDialogueCondition
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Dialogue") FName QuestId;
	UPROPERTY(EditAnywhere, Category = "Dialogue") bool bMustBeCompleted = false;   // false = must be active

	virtual bool IsMet(const UGameInstance* Game) const override
	{
		const UQuestSubsystem* Quests = Game->GetSubsystem<UQuestSubsystem>();
		return bMustBeCompleted ? Quests->IsCompleted(QuestId) : Quests->IsActive(QuestId);
	}
};

UCLASS(meta = (DisplayName = "Start Quest"))
class UStartQuestEffect : public UDialogueEffect
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Dialogue") TObjectPtr<UQuestDefinition> Quest;

	virtual void Apply(UGameInstance* Game) const override { Game->GetSubsystem<UQuestSubsystem>()->Start(Quest); }
};
// HasItem and SetFlag follow the same shape, reading the inventory component and a flags subsystem.

USTRUCT()
struct FDialogueChoice
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Dialogue") FText Text;
	UPROPERTY(EditAnywhere, Category = "Dialogue") FName NextId;
	UPROPERTY(EditAnywhere, Instanced, Category = "Dialogue") TArray<TObjectPtr<UDialogueCondition>> Conditions;
	UPROPERTY(EditAnywhere, Instanced, Category = "Dialogue") TArray<TObjectPtr<UDialogueEffect>> Effects;
};

USTRUCT()
struct FDialogueNode
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Dialogue") FName Id;
	UPROPERTY(EditAnywhere, Category = "Dialogue") FText Speaker;
	UPROPERTY(EditAnywhere, Category = "Dialogue", meta = (MultiLine = true)) FText Text;
	UPROPERTY(EditAnywhere, Category = "Dialogue") FName NextId;               // used when there are no choices; None = end
	UPROPERTY(EditAnywhere, Category = "Dialogue") TArray<FDialogueChoice> Choices;
	UPROPERTY(EditAnywhere, Instanced, Category = "Dialogue") TArray<TObjectPtr<UDialogueEffect>> OnEnter;
};

UCLASS(BlueprintType)
class UConversation : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditDefaultsOnly, Category = "Dialogue") FName StartNodeId;
	UPROPERTY(EditDefaultsOnly, Category = "Dialogue") TArray<FDialogueNode> Nodes;

	const FDialogueNode* Find(FName Id) const
	{
		return Nodes.FindByPredicate([Id](const FDialogueNode& N) { return N.Id == Id; });
	}
};
```

:::

### The runner: walks the graph, the UI only displays

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;

public class DialogueRunner
{
    readonly IGameState state;
    readonly Func<string, string> localise;             // key → text in the current language

    Conversation conversation;
    DialogueNode current;
    readonly List<DialogueChoice> visibleChoices = new();

    public event Action<string, string, IReadOnlyList<string>> ShowNode;   // speaker, text, choice texts
    public event Action Ended;

    public DialogueRunner(IGameState state, Func<string, string> localise)
    {
        this.state = state; this.localise = localise;
    }

    public void Start(Conversation c)
    {
        conversation = c;
        GoTo(c.startNodeId);
    }

    // Called by the UI: index into the choices it was shown, or -1 to continue a plain line.
    public void Select(int choiceIndex)
    {
        if (current == null) return;
        if (visibleChoices.Count == 0) { GoTo(current.nextId); return; }

        var choice = visibleChoices[choiceIndex];
        foreach (var e in choice.effects) e.Apply(state);
        GoTo(choice.nextId);
    }

    void GoTo(string id)
    {
        current = string.IsNullOrEmpty(id) ? null : conversation.Find(id);
        if (current == null) { Ended?.Invoke(); return; }

        foreach (var e in current.onEnter) e.Apply(state);

        visibleChoices.Clear();
        foreach (var c in current.choices)
            if (c.conditions.TrueForAll(cond => cond.IsMet(state))) visibleChoices.Add(c);

        var texts = visibleChoices.ConvertAll(c => localise(c.textKey));
        ShowNode?.Invoke(current.speaker, localise(current.textKey), texts);
    }
}
```

```gdscript [Godot (GDScript)]
# dialogue_runner.gd: walks the graph; the UI only displays.
# tr() is Godot's translation lookup (CSV or PO files in Project Settings → Localization).
class_name DialogueRunner
extends RefCounted

signal show_node(speaker: String, text: String, choices: PackedStringArray)
signal ended

var _state: GameState
var _conversation: Conversation
var _current: DialogueNode
var _visible_choices: Array[DialogueChoice] = []


func _init(state: GameState) -> void:
	_state = state


func start(c: Conversation) -> void:
	_conversation = c
	_go_to(c.start_node_id)


# Called by the UI: index into the choices it was shown, or -1 to continue a plain line.
func select(choice_index: int) -> void:
	if _current == null:
		return
	if _visible_choices.is_empty():
		_go_to(_current.next_id)
		return
	var choice := _visible_choices[choice_index]
	for e in choice.effects:
		e.apply(_state)
	_go_to(choice.next_id)


func _go_to(id: StringName) -> void:
	_current = null if id == &"" else _conversation.find(id)
	if _current == null:
		ended.emit()
		return

	for e in _current.on_enter:
		e.apply(_state)

	_visible_choices.clear()
	var texts := PackedStringArray()
	for c in _current.choices:
		if c.conditions.all(func(cond: DialogueCondition) -> bool: return cond.is_met(_state)):
			_visible_choices.append(c)
			texts.append(tr(c.text_key))
	show_node.emit(_current.speaker, tr(_current.text_key), texts)

# Usage: var runner := DialogueRunner.new(Game); runner.show_node.connect(dialogue_box.show_line)
```

```cpp [Unreal (C++)]
// DialogueRunner.h: create it with the game instance as its outer:
//   UDialogueRunner* Runner = NewObject<UDialogueRunner>(GetGameInstance());
#pragma once

#include "CoreMinimal.h"
#include "Conversation.h"
#include "DialogueRunner.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FOnShowDialogueNode, FText, Speaker, FText, Text, const TArray<FText>&, Choices);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnDialogueEnded);

UCLASS(BlueprintType)
class UDialogueRunner : public UObject
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, Category = "Dialogue") void Start(const UConversation* InConversation);
	UFUNCTION(BlueprintCallable, Category = "Dialogue") void Select(int32 ChoiceIndex);   // -1 continues a plain line

	UPROPERTY(BlueprintAssignable) FOnShowDialogueNode OnShowNode;
	UPROPERTY(BlueprintAssignable) FOnDialogueEnded OnEnded;

private:
	void GoTo(FName Id);
	UGameInstance* GetGame() const { return GetTypedOuter<UGameInstance>(); }

	UPROPERTY() TObjectPtr<const UConversation> Conversation;
	const FDialogueNode* Current = nullptr;          // points into the asset, which doesn't change at runtime
	TArray<const FDialogueChoice*> VisibleChoices;
};

// DialogueRunner.cpp
#include "DialogueRunner.h"
#include "Algo/AllOf.h"

void UDialogueRunner::Start(const UConversation* InConversation)
{
	Conversation = InConversation;
	GoTo(Conversation->StartNodeId);
}

void UDialogueRunner::Select(int32 ChoiceIndex)
{
	if (!Current) return;
	if (VisibleChoices.IsEmpty()) { GoTo(Current->NextId); return; }

	const FDialogueChoice* Choice = VisibleChoices[ChoiceIndex];
	for (const UDialogueEffect* Effect : Choice->Effects) Effect->Apply(GetGame());
	GoTo(Choice->NextId);
}

void UDialogueRunner::GoTo(FName Id)
{
	Current = Id.IsNone() ? nullptr : Conversation->Find(Id);
	if (!Current) { OnEnded.Broadcast(); return; }

	for (const UDialogueEffect* Effect : Current->OnEnter) Effect->Apply(GetGame());

	VisibleChoices.Reset();
	TArray<FText> Texts;
	for (const FDialogueChoice& Choice : Current->Choices)
	{
		const bool bVisible = Algo::AllOf(Choice.Conditions, [this](const UDialogueCondition* C) { return C->IsMet(GetGame()); });
		if (!bVisible) continue;
		VisibleChoices.Add(&Choice);
		Texts.Add(Choice.Text);
	}
	OnShowNode.Broadcast(Current->Speaker, Current->Text, Texts);
}
```

:::

A conversation might look like this:

| Node | Content |
| --- | --- |
| `greet` | Mira: *"mira.greeting"* → choices: |
| | "Any work?" → `offer` (condition: herbs quest **not** active) |
| | "I have your herbs." → `thanks` (condition: has 10 `healing_herb`; effects: complete quest, take herbs) |
| | "Goodbye." → end |
| `offer` | Mira: *"mira.offer"* → onEnter: **StartQuest** "Healing Herbs" → end |

**Engine notes**

- **Unity:** no built-in dialogue system; **Yarn Spinner** and **Ink** are widely used. With the **Localization** package, the `localise` function can be `key => LocalizationSettings.StringDatabase.GetLocalizedString("Dialogue", key)`.
- **Godot:** **Dialogic** and **Dialogue Manager** are popular add-ons with their own editors and script formats; the runner above is the core idea in a few dozen lines. `tr()` is available on every object and uses the project's translations.
- **Unreal:** there is no built-in branching dialogue system. `FText` fields are picked up by the **Localization Dashboard**, and **Dialogue Wave** assets cover voiced lines with subtitles. Large projects often use a marketplace dialogue plugin or a graph editor built on this kind of data.

## When to use

- RPGs, adventure games, visual novels, narrative games and any NPC conversation with choices or state.
- Tutorials and in-game messages that depend on progress.

## When not to use

- A few lines of fixed text. Show them directly.
- Large branching narratives. Use an existing tool (Ink, Yarn Spinner) instead of building your own editor and runtime.

## Pitfalls

- **Text in code or literal strings.** Store localisation keys from day one. Retrofitting localisation into hundreds of literal lines is painful.
- **Effects that run twice.** If the UI calls `Select` twice (double-click), a quest starts twice or an item is given twice. Ignore input while transitioning, and make effects idempotent where possible.
- **Dead ends and broken links.** A `nextId` with a typo ends the conversation silently. Validate the graph in the editor: unknown IDs, unreachable nodes, choice nodes where every option can be hidden.
- **Conditions evaluated once.** Choices are filtered when a node is shown. If an effect in the same node changes state, refresh the choices after effects run.
- **Building your own editor.** A good node-graph editor is a big project. Use Ink or Yarn Spinner, or keep the data simple enough for spreadsheets, before writing tools.
- **Dialogue during gameplay.** Starting a conversation should switch input maps, and possibly pause or slow enemies. Route it through the [Game State Manager](./game-state-manager) or [Screen Stack](./screen-stack).

## Related

- [Quest System](./quest-system) — dialogue starts and completes quests, and checks their state.
- [Data-Driven Design](./data-driven-design) — conversations as data that writers edit.
- [Interaction System](./interaction-system) — talking to an NPC starts a conversation.
- [MVC / MVP / MVVM](./mvp-mvvm) — the runner is the presenter, and the dialogue box is a passive view.
- [Localization Tables](./localization-tables) — where the text behind each key lives.
