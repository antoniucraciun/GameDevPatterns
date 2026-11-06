# Quest System

> Quests as data: objectives, conditions and rewards driven by gameplay events.

**Category:** Gameplay Systems

## Problem

The first quest is code: the wolf's death script checks `if (questManager.wolfQuestActive) wolfKills++`, and the item pickup checks for the herb quest. Every new quest adds checks to unrelated gameplay code. Writers cannot create quests without programmers. "Kill 5 wolves *or* 3 alpha wolves", "collect 10 herbs, then return to the healer", tracking several quests at once, and saving progress all turn into special cases.

## Solution

Separate the **definition** of a quest from its **runtime progress**, and let objectives **listen to gameplay events** instead of gameplay code knowing about quests:

- **`QuestDefinition`** (an asset): id, title, description, an ordered list of **stages**. Each stage has one or more **objectives**, plus rewards and follow-up quests.
- **Objective types** are small classes: *kill N of enemy type*, *collect N of item*, *reach location*, *talk to NPC*. Each listens to the relevant gameplay event on the [Event Bus](./event-bus) and reports progress.
- **`QuestLog`** holds the runtime state: which quests are active, the current stage, each objective's progress. It completes stages, grants rewards, and saves as plain data.
- Gameplay code just **publishes events** (`EnemyKilled`, `ItemCollected`, `TalkedTo`, `EnteredArea`). It knows nothing about quests.

## Example (Unity C#)

### Definitions as data

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(menuName = "Quests/Quest")]
public class QuestDefinition : ScriptableObject
{
    public string id;
    public string title;
    [TextArea] public string description;
    public List<QuestStage> stages = new();
    public int rewardGold;
    public List<QuestDefinition> unlocksOnComplete = new();
}

[Serializable]
public class QuestStage
{
    public string journalText;                          // "Collect healing herbs (3/10)"
    [SerializeReference] public List<Objective> objectives = new();
    public bool anyObjective;                           // false = all must complete; true = any one
}

// Objectives are templates. Runtime progress is stored separately, per active quest.
[Serializable]
public abstract class Objective
{
    public int required = 1;
    public abstract void Subscribe(Action<int> addProgress);   // call addProgress(n) when relevant events happen
    public abstract void Unsubscribe();
}

[Serializable]
public class KillObjective : Objective
{
    public int enemyTypeId;
    Action<EnemyKilled> handler;

    public override void Subscribe(Action<int> addProgress)
    {
        handler = e => { if (e.EnemyTypeId == enemyTypeId) addProgress(1); };
        EventBus<EnemyKilled>.Subscribe(handler);
    }
    public override void Unsubscribe() => EventBus<EnemyKilled>.Unsubscribe(handler);
}

public readonly struct ItemCollected : IEvent
{
    public readonly string ItemId; public readonly int Count;
    public ItemCollected(string itemId, int count) { ItemId = itemId; Count = count; }
}

[Serializable]
public class CollectObjective : Objective
{
    public string itemId;
    Action<ItemCollected> handler;

    public override void Subscribe(Action<int> addProgress)
    {
        handler = e => { if (e.ItemId == itemId) addProgress(e.Count); };
        EventBus<ItemCollected>.Subscribe(handler);
    }
    public override void Unsubscribe() => EventBus<ItemCollected>.Unsubscribe(handler);
}
```

### Runtime progress

```csharp
public class QuestLog
{
    class ActiveQuest
    {
        public QuestDefinition Definition;
        public int Stage;
        public int[] Progress;                              // per objective of the current stage
    }

    readonly Dictionary<string, ActiveQuest> active = new();
    readonly HashSet<string> completed = new();

    public event Action<QuestDefinition> Started, Updated, Completed;

    public bool IsActive(string id) => active.ContainsKey(id);
    public bool IsCompleted(string id) => completed.Contains(id);

    public void Start(QuestDefinition def)
    {
        if (active.ContainsKey(def.id) || completed.Contains(def.id)) return;
        var q = new ActiveQuest { Definition = def };
        active[def.id] = q;
        EnterStage(q, 0);
        Started?.Invoke(def);
    }

    void EnterStage(ActiveQuest q, int stage)
    {
        q.Stage = stage;
        var objectives = q.Definition.stages[stage].objectives;
        q.Progress = new int[objectives.Count];
        for (int i = 0; i < objectives.Count; i++)
        {
            int index = i;
            objectives[i].Subscribe(n => AddProgress(q, index, n));
        }
    }

    void AddProgress(ActiveQuest q, int objective, int amount)
    {
        var stage = q.Definition.stages[q.Stage];
        q.Progress[objective] = Mathf.Min(q.Progress[objective] + amount, stage.objectives[objective].required);
        Updated?.Invoke(q.Definition);

        bool done = stage.anyObjective
            ? Exists(stage, q, (o, p) => p >= o.required)
            : !Exists(stage, q, (o, p) => p < o.required);
        if (!done) return;

        foreach (var o in stage.objectives) o.Unsubscribe();
        if (q.Stage + 1 < q.Definition.stages.Count) EnterStage(q, q.Stage + 1);
        else Complete(q);
    }

    static bool Exists(QuestStage s, ActiveQuest q, Func<Objective, int, bool> test)
    {
        for (int i = 0; i < s.objectives.Count; i++) if (test(s.objectives[i], q.Progress[i])) return true;
        return false;
    }

    void Complete(ActiveQuest q)
    {
        active.Remove(q.Definition.id);
        completed.Add(q.Definition.id);
        // Grant q.Definition.rewardGold through the wallet/inventory...
        Completed?.Invoke(q.Definition);
        foreach (var next in q.Definition.unlocksOnComplete) Start(next);
    }
}

// Gameplay only publishes facts:
// EventBus<ItemCollected>.Publish(new ItemCollected("healing_herb", 1));
```

Objectives here subscribe their own handlers, so one objective asset must not be active in two quests at once. If definitions are shared, create a runtime copy of each objective per active quest (or keep the handler in the quest log, keyed by quest and objective). Saving stores `{ questId, stage, progress[] }` per active quest, plus the completed IDs. Objectives resubscribe on load.

## When to use

- RPGs, adventure games, open worlds and any game with tasks, missions, achievements or tutorials.
- When writers and designers should create quests without code.

## When not to use

- A linear game with a few objectives. A script per level or a simple list is easier.
- Tracking a single goal, such as "reach the exit". A [Trigger Volume](./trigger-volume) is enough.

## Pitfalls

- **Progress made before the quest starts.** Herbs collected before accepting "collect 10 herbs" do not count with pure event listening. Decide per objective: count from acceptance, or initialise from current state (count the herbs already in the inventory).
- **Shared objective instances.** `[SerializeReference]` objects live in the asset and are shared, so the same objective subscribed twice gets confused. Keep runtime state out of definitions.
- **Leaked subscriptions.** Objectives must unsubscribe when their stage completes, the quest is abandoned, or a save is loaded. Otherwise old quests keep counting.
- **Saving references.** Save quest IDs and integers, never `QuestDefinition` references.
- **Order of rewards and unlocks.** A follow-up quest that starts *before* the rewards are granted may check for an item that has not been given yet. Grant first, then unlock.
- **Hard-coded quest logic.** `if (quest.id == "wolves")` in gameplay code brings back the original problem. Express special cases as new objective types.

## Related

- [Event Bus](./event-bus) — objectives listen to gameplay events.
- [Data-Driven Design](./data-driven-design) and [Type Object](./type-object) — quests and objectives as assets.
- [Save System](./save-system) — quest progress saved as plain data.
- [Dialogue System](./dialogue-system) — dialogue starts quests and checks their state.
- [Inventory](./inventory) — collect objectives and rewards.
