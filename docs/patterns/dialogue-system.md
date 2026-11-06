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

Conditions and effects are small data objects, so writers combine them in the editor. Dedicated tools such as **Ink** and **Yarn Spinner** implement this pattern with a scripting language and Unity integration, and are worth considering before building your own.

## Example (Unity C#)

### The conversation as data

```csharp
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

### The runner: walks the graph, the UI only displays

```csharp
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

A conversation might look like this:

| Node | Content |
| --- | --- |
| `greet` | Mira: *"mira.greeting"* → choices: |
| | "Any work?" → `offer` (condition: herbs quest **not** active) |
| | "I have your herbs." → `thanks` (condition: has 10 `healing_herb`; effects: complete quest, take herbs) |
| | "Goodbye." → end |
| `offer` | Mira: *"mira.offer"* → onEnter: **StartQuest** "Healing Herbs" → end |

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
