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

## Example

Gameplay only publishes facts ("an orc died", "a herb was picked up") on the [Event Bus](./event-bus); quests listen and count. The bus is the one from that page, with an `ItemCollected` event added.

### Definitions as data

::: code-group

```csharp [Unity (C#)]
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

```gdscript [Godot (GDScript)]
# The Events autoload from the Event Bus page, with one more signal:
#   signal item_collected(item_id: StringName, count: int)

# quest_definition.gd: one .tres per quest.
class_name QuestDefinition
extends Resource

@export var id: StringName
@export var title := ""
@export_multiline var description := ""
@export var stages: Array[QuestStage] = []
@export var reward_gold := 0
@export var unlocks_on_complete: Array[QuestDefinition] = []


# quest_stage.gd
class_name QuestStage
extends Resource

@export var journal_text := ""  # "Collect healing herbs (3/10)"
@export var objectives: Array[Objective] = []
@export var any_objective := false  # false = all must complete; true = any one


# objective.gd: objectives are templates. Runtime progress is stored separately, per active quest.
class_name Objective
extends Resource

@export var required := 1


func subscribe(_add_progress: Callable) -> void:  # call add_progress.call(n) when relevant events happen
	pass


func unsubscribe() -> void:
	pass


# kill_objective.gd
class_name KillObjective
extends Objective

@export var enemy_type_id := 0

var _handler: Callable


func subscribe(add_progress: Callable) -> void:
	_handler = func(type_id: int, _position: Vector3) -> void:
		if type_id == enemy_type_id:
			add_progress.call(1)
	Events.enemy_killed.connect(_handler)


func unsubscribe() -> void:
	Events.enemy_killed.disconnect(_handler)


# collect_objective.gd
class_name CollectObjective
extends Objective

@export var item_id: StringName

var _handler: Callable


func subscribe(add_progress: Callable) -> void:
	_handler = func(id: StringName, count: int) -> void:
		if id == item_id:
			add_progress.call(count)
	Events.item_collected.connect(_handler)


func unsubscribe() -> void:
	Events.item_collected.disconnect(_handler)
```

```cpp [Unreal (C++)]
// QuestDefinition.h: objectives are instanced sub-objects, picked from a class dropdown in the
// details panel. They are stateless: the quest subsystem asks them how much an event counts.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "GameEventsSubsystem.h"                    // Event Bus page, plus:
// struct FItemCollected { FName ItemId; int32 Count = 1; };   and   FOnItemCollected ItemCollected;
#include "QuestDefinition.generated.h"

UCLASS(Abstract, EditInlineNew, DefaultToInstanced, CollapseCategories)
class UQuestObjective : public UObject
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Objective") int32 Required = 1;

	virtual int32 ProgressFrom(const FEnemyKilled& Event) const { return 0; }
	virtual int32 ProgressFrom(const FItemCollected& Event) const { return 0; }
};

UCLASS(meta = (DisplayName = "Kill"))
class UKillObjective : public UQuestObjective
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Objective") int32 EnemyTypeId = 0;
	virtual int32 ProgressFrom(const FEnemyKilled& Event) const override { return Event.EnemyTypeId == EnemyTypeId ? 1 : 0; }
};

UCLASS(meta = (DisplayName = "Collect"))
class UCollectObjective : public UQuestObjective
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Objective") FName ItemId;
	virtual int32 ProgressFrom(const FItemCollected& Event) const override { return Event.ItemId == ItemId ? Event.Count : 0; }
};

USTRUCT()
struct FQuestStage
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Quest") FText JournalText;          // "Collect healing herbs"
	UPROPERTY(EditAnywhere, Instanced, Category = "Quest") TArray<TObjectPtr<UQuestObjective>> Objectives;
	UPROPERTY(EditAnywhere, Category = "Quest") bool bAnyObjective = false; // false = all must complete
};

UCLASS(BlueprintType)
class UQuestDefinition : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditDefaultsOnly, Category = "Quest") FName Id;
	UPROPERTY(EditDefaultsOnly, Category = "Quest") FText Title;
	UPROPERTY(EditDefaultsOnly, Category = "Quest", meta = (MultiLine = true)) FText Description;
	UPROPERTY(EditDefaultsOnly, Category = "Quest") TArray<FQuestStage> Stages;
	UPROPERTY(EditDefaultsOnly, Category = "Quest") int32 RewardGold = 0;
	UPROPERTY(EditDefaultsOnly, Category = "Quest") TArray<TObjectPtr<UQuestDefinition>> UnlocksOnComplete;
};
```

:::

### Runtime progress

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;
using UnityEngine;

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

```gdscript [Godot (GDScript)]
# quest_log.gd: autoload named QuestLog.
extends Node

signal started(quest: QuestDefinition)
signal updated(quest: QuestDefinition)
signal completed(quest: QuestDefinition)


class ActiveQuest:
	var definition: QuestDefinition
	var stage := 0
	var progress: Array[int] = []  # per objective of the current stage


var _active := {}  # StringName -> ActiveQuest
var _completed := {}  # StringName -> true, used as a set


func is_active(id: StringName) -> bool:
	return _active.has(id)


func is_completed(id: StringName) -> bool:
	return _completed.has(id)


func start(def: QuestDefinition) -> void:
	if _active.has(def.id) or _completed.has(def.id):
		return
	var q := ActiveQuest.new()
	q.definition = def
	_active[def.id] = q
	_enter_stage(q, 0)
	started.emit(def)


func _enter_stage(q: ActiveQuest, stage: int) -> void:
	q.stage = stage
	q.progress.clear()
	var objectives := q.definition.stages[stage].objectives
	for i in objectives.size():
		q.progress.append(0)
		# bind() appends q and i after the amount the objective passes in.
		objectives[i].subscribe(_add_progress.bind(q, i))


func _add_progress(amount: int, q: ActiveQuest, objective: int) -> void:
	var stage := q.definition.stages[q.stage]
	q.progress[objective] = mini(q.progress[objective] + amount, stage.objectives[objective].required)
	updated.emit(q.definition)

	var done_count := 0
	for i in stage.objectives.size():
		if q.progress[i] >= stage.objectives[i].required:
			done_count += 1
	var done := done_count > 0 if stage.any_objective else done_count == stage.objectives.size()
	if not done:
		return

	for o in stage.objectives:
		o.unsubscribe()
	if q.stage + 1 < q.definition.stages.size():
		_enter_stage(q, q.stage + 1)
	else:
		_complete(q)


func _complete(q: ActiveQuest) -> void:
	_active.erase(q.definition.id)
	_completed[q.definition.id] = true
	# Grant q.definition.reward_gold through the wallet/inventory...
	completed.emit(q.definition)
	for next in q.definition.unlocks_on_complete:
		start(next)

# Gameplay only publishes facts:
# Events.item_collected.emit(&"healing_herb", 1)
```

```cpp [Unreal (C++)]
// QuestSubsystem.h: lives with the game instance, so quests survive level loads.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "QuestDefinition.h"
#include "QuestSubsystem.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnQuestEvent, const UQuestDefinition*, Quest);

USTRUCT()
struct FActiveQuest
{
	GENERATED_BODY()

	UPROPERTY() TObjectPtr<const UQuestDefinition> Definition;
	UPROPERTY() int32 Stage = 0;
	UPROPERTY() TArray<int32> Progress;             // per objective of the current stage
};

UCLASS()
class UQuestSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;

	UFUNCTION(BlueprintCallable, Category = "Quests") void Start(const UQuestDefinition* Def);
	UFUNCTION(BlueprintPure, Category = "Quests") bool IsActive(FName Id) const { return Active.Contains(Id); }
	UFUNCTION(BlueprintPure, Category = "Quests") bool IsCompleted(FName Id) const { return Completed.Contains(Id); }

	UPROPERTY(BlueprintAssignable) FOnQuestEvent OnStarted;
	UPROPERTY(BlueprintAssignable) FOnQuestEvent OnUpdated;
	UPROPERTY(BlueprintAssignable) FOnQuestEvent OnCompleted;

private:
	template <typename TEvent> void HandleEvent(const TEvent& Event);
	void AddProgress(FName QuestId, int32 Objective, int32 Amount);
	void EnterStage(FActiveQuest& Quest, int32 Stage);

	UPROPERTY() TMap<FName, FActiveQuest> Active;
	UPROPERTY() TSet<FName> Completed;
};

// QuestSubsystem.cpp
#include "QuestSubsystem.h"

void UQuestSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	UGameEventsSubsystem* Events = Collection.InitializeDependency<UGameEventsSubsystem>();
	Events->EnemyKilled.AddUObject(this, &UQuestSubsystem::HandleEvent<FEnemyKilled>);
	Events->ItemCollected.AddUObject(this, &UQuestSubsystem::HandleEvent<FItemCollected>);
}

void UQuestSubsystem::Start(const UQuestDefinition* Def)
{
	if (!Def || Active.Contains(Def->Id) || Completed.Contains(Def->Id)) return;
	FActiveQuest& Quest = Active.Add(Def->Id);
	Quest.Definition = Def;
	EnterStage(Quest, 0);
	OnStarted.Broadcast(Def);
}

void UQuestSubsystem::EnterStage(FActiveQuest& Quest, int32 Stage)
{
	Quest.Stage = Stage;
	Quest.Progress.Init(0, Quest.Definition->Stages[Stage].Objectives.Num());
}

// Every event is offered to every objective of every active quest's current stage.
template <typename TEvent>
void UQuestSubsystem::HandleEvent(const TEvent& Event)
{
	TArray<TTuple<FName, int32, int32>> Hits;      // collected first: AddProgress can change Active
	for (const TPair<FName, FActiveQuest>& Pair : Active)
	{
		const TArray<TObjectPtr<UQuestObjective>>& Objectives = Pair.Value.Definition->Stages[Pair.Value.Stage].Objectives;
		for (int32 i = 0; i < Objectives.Num(); ++i)
			if (const int32 Amount = Objectives[i]->ProgressFrom(Event)) Hits.Emplace(Pair.Key, i, Amount);
	}
	for (const TTuple<FName, int32, int32>& Hit : Hits) AddProgress(Hit.Get<0>(), Hit.Get<1>(), Hit.Get<2>());
}

void UQuestSubsystem::AddProgress(FName QuestId, int32 Objective, int32 Amount)
{
	FActiveQuest* Quest = Active.Find(QuestId);
	if (!Quest) return;                             // completed by an earlier hit of the same event
	const UQuestDefinition* Def = Quest->Definition;
	const FQuestStage& Stage = Def->Stages[Quest->Stage];
	if (!Stage.Objectives.IsValidIndex(Objective)) return;   // the stage moved on during this event

	Quest->Progress[Objective] = FMath::Min(Quest->Progress[Objective] + Amount, Stage.Objectives[Objective]->Required);
	OnUpdated.Broadcast(Def);

	int32 Done = 0;
	for (int32 i = 0; i < Stage.Objectives.Num(); ++i) Done += Quest->Progress[i] >= Stage.Objectives[i]->Required;
	if (Stage.bAnyObjective ? Done == 0 : Done < Stage.Objectives.Num()) return;

	if (Quest->Stage + 1 < Def->Stages.Num()) { EnterStage(*Quest, Quest->Stage + 1); return; }

	Active.Remove(QuestId);                         // Quest is invalid from here on
	Completed.Add(QuestId);
	// Grant Def->RewardGold through the wallet/inventory...
	OnCompleted.Broadcast(Def);
	for (const UQuestDefinition* Next : Def->UnlocksOnComplete) Start(Next);
}

// Gameplay only publishes facts:
// GetGameInstance()->GetSubsystem<UGameEventsSubsystem>()->ItemCollected.Broadcast({TEXT("healing_herb"), 1});
```

:::

In the Unity and Godot tabs, objectives subscribe their own handlers, so one objective asset must not be active in two quests at once. If definitions are shared, create a runtime copy of each objective per active quest (or keep the handler in the quest log, keyed by quest and objective, which is what the Unreal tab does). Saving stores `{ questId, stage, progress[] }` per active quest, plus the completed IDs. Objectives resubscribe on load.

**Engine notes**

- **Unity:** `[SerializeReference]` lists have no "add element of type…" menu in the default inspector; add a small property drawer for designers.
- **Godot:** typed `Array[Objective]` exports let designers create `KillObjective` or `CollectObjective` resources in place. Objective resources are shared between every quest that uses the same `.tres` (see the note above); `duplicate()` the quest when it starts if that can happen. `Callable.bind` appends its arguments after the ones the caller passes.
- **Unreal:** there is no built-in quest system. `Instanced` objective arrays inside a data asset give designers a class dropdown per entry. `InitializeDependency` makes sure the event subsystem exists before the quest subsystem subscribes to it. Lyra's **Gameplay Message Router** works just as well as the event source.

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
