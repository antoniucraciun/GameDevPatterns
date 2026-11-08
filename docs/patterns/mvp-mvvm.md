# MVC / MVP / MVVM

> Keep UI views dumb and push state and logic into a model and presenter.

**Category:** UI

## Problem

The inventory screen's script does everything. It reads the player's items, sorts them, calculates the total weight, decides which buttons are enabled, formats "12.5 / 40 kg", handles clicks, plays sounds and talks to the save system. Changing the layout breaks the logic. Testing "you cannot equip a two-handed sword with a shield" requires a scene with the UI in it. Building a controller-friendly version of the same screen means copying all of it.

## Solution

Split each screen into roles:

| Role | Knows about | Responsibility |
| --- | --- | --- |
| **Model** | Nothing about UI | Game data and rules: the inventory, items, "can equip?". Raises events when it changes. |
| **View** | Engine UI widgets only (uGUI or UI Toolkit, Control nodes, UMG) | Displays what it is told, and reports user actions ("slot 3 clicked"). No decisions. |
| **Presenter** (MVP) / **ViewModel** (MVVM) | Model, and the view through an interface | Turns model state into display state (text, enabled flags), and user actions into model calls. |

The variants differ in how the middle layer talks to the view:

- **MVC:** the controller handles input, and the view reads the model directly. Common on the web, less common in games.
- **MVP:** the presenter *pushes* to a passive view through an interface (`view.SetWeight("12.5 / 40 kg")`). It is easy to test with a fake view, and works with any UI system.
- **MVVM:** the view model exposes *observable properties*, and the view *binds* to them, so updates flow automatically. It suits UI systems with binding built in: Unity's UI Toolkit runtime binding and Unreal's UMG Viewmodel plugin. Godot has no built-in binding, so MVVM there is wired by hand with signals. See [Data Binding](./data-binding).

## Pseudocode

```text
// Model: game data and rules. Knows nothing about UI.
Inventory:
    items, weight, max_weight ← 40
    changed                          // event raised after every change
    can_add(item): return weight + item.weight ≤ max_weight
    drop(i): subtract items[i].weight from weight, remove items[i], raise changed

// View: shows what it is told and reports what the player did. No decisions.
InventoryView:
    show_items(rows), show_weight(text, overloaded), set_drop_enabled(on)
    events: slot_clicked(index), drop_clicked

// Presenter: every decision, and no engine UI types, so a fake view can test it.
InventoryPresenter:
    model, view
    selected ← none

    on creation: listen to model.changed, view.slot_clicked and view.drop_clicked, then refresh()

    on slot_clicked(i):
        selected ← i if it is a valid item, else none
        refresh()

    on drop_clicked:
        if selected is none: return
        i ← selected
        selected ← none              // clear first: drop refreshes at once
        model.drop(i)                // refresh runs through model.changed

    refresh():
        view.show_items(for each item: "name (weight kg)" and its icon)
        view.show_weight("weight / max_weight kg", overloaded ← weight > 90% of max_weight)
        view.set_drop_enabled(selected is not none)

    on dispose: stop listening to the model and the view
```

## Example

MVP for an inventory screen. For MVVM with engine-supported bindings, see [Data Binding](./data-binding), which uses Unreal's UMG Viewmodel plugin.

### Model: pure game logic, no UI

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;

public class Inventory
{
    readonly List<Item> items = new();
    public IReadOnlyList<Item> Items => items;
    public float MaxWeight { get; } = 40f;
    public float Weight { get; private set; }

    public event Action Changed;

    public bool CanAdd(Item item) => Weight + item.Weight <= MaxWeight;

    public bool TryAdd(Item item)
    {
        if (!CanAdd(item)) return false;
        items.Add(item);
        Weight += item.Weight;
        Changed?.Invoke();
        return true;
    }

    public void Drop(int index)
    {
        Weight -= items[index].Weight;
        items.RemoveAt(index);
        Changed?.Invoke();
    }
}

public class Item
{
    public readonly string Name;
    public readonly float Weight;
    public readonly UnityEngine.Sprite Icon;
    public Item(string name, float weight, UnityEngine.Sprite icon) { Name = name; Weight = weight; Icon = icon; }
}
```

```gdscript [Godot (GDScript)]
# item.gd: a Resource, so items can be authored as .tres files.
class_name Item
extends Resource

@export var display_name: String
@export var weight: float
@export var icon: Texture2D


# inventory.gd
class_name Inventory
extends RefCounted

signal changed

const MAX_WEIGHT := 40.0

var items: Array[Item] = []
var weight := 0.0


func can_add(item: Item) -> bool:
	return weight + item.weight <= MAX_WEIGHT


func try_add(item: Item) -> bool:
	if not can_add(item):
		return false
	items.append(item)
	weight += item.weight
	changed.emit()
	return true


func drop(index: int) -> void:
	weight -= items[index].weight
	items.remove_at(index)
	changed.emit()
```

```cpp [Unreal (C++)]
// Inventory.h
#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "Inventory.generated.h"

class UTexture2D;

USTRUCT(BlueprintType)
struct FInventoryItem
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere) FText Name;
	UPROPERTY(EditAnywhere) float Weight = 0.f;
	UPROPERTY(EditAnywhere) TObjectPtr<UTexture2D> Icon;
};

DECLARE_MULTICAST_DELEGATE(FOnInventoryChanged);

UCLASS()
class UInventory : public UObject
{
	GENERATED_BODY()

public:
	FOnInventoryChanged OnChanged;

	const TArray<FInventoryItem>& GetItems() const { return Items; }
	float GetWeight() const { return Weight; }
	float GetMaxWeight() const { return MaxWeight; }

	bool CanAdd(const FInventoryItem& Item) const { return Weight + Item.Weight <= MaxWeight; }

	bool TryAdd(const FInventoryItem& Item)
	{
		if (!CanAdd(Item)) return false;
		Items.Add(Item);
		Weight += Item.Weight;
		OnChanged.Broadcast();
		return true;
	}

	void Drop(int32 Index)
	{
		Weight -= Items[Index].Weight;
		Items.RemoveAt(Index);
		OnChanged.Broadcast();
	}

private:
	UPROPERTY() TArray<FInventoryItem> Items;
	float Weight = 0.f;
	float MaxWeight = 40.f;
};
```

:::

### View: an interface plus a dumb widget

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;

public interface IInventoryView
{
    void ShowItems(IReadOnlyList<(string label, UnityEngine.Sprite icon)> rows);
    void ShowWeight(string text, bool overloaded);
    void SetDropEnabled(bool enabled);
    event Action<int> SlotClicked;
    event Action DropClicked;
}

public class InventoryView : UnityEngine.MonoBehaviour, IInventoryView
{
    [UnityEngine.SerializeField] TMPro.TMP_Text weightLabel;
    [UnityEngine.SerializeField] UnityEngine.UI.Button dropButton;
    [UnityEngine.SerializeField] SlotView[] slots;      // a SlotView shows an icon and label and raises Clicked

    public event Action<int> SlotClicked;
    public event Action DropClicked;

    void Awake()
    {
        dropButton.onClick.AddListener(() => DropClicked?.Invoke());
        for (int i = 0; i < slots.Length; i++)
        {
            int index = i;
            slots[i].Clicked += () => SlotClicked?.Invoke(index);
        }
    }

    public void ShowItems(IReadOnlyList<(string label, UnityEngine.Sprite icon)> rows)
    {
        for (int i = 0; i < slots.Length; i++)
            slots[i].Show(i < rows.Count ? rows[i] : default);
    }

    public void ShowWeight(string text, bool overloaded)
    {
        weightLabel.text = text;
        weightLabel.color = overloaded ? UnityEngine.Color.red : UnityEngine.Color.white;
    }

    public void SetDropEnabled(bool enabled) => dropButton.interactable = enabled;
}
```

```gdscript [Godot (GDScript)]
# inventory_view.gd: on the root Control of inventory_view.tscn. No interfaces in GDScript: this
# script's signals and methods are the view's contract, and a test fake extends it.
class_name InventoryView
extends Control

signal slot_clicked(index: int)
signal drop_clicked

@export var weight_label: Label
@export var drop_button: Button
@export var slot_list: ItemList  # one row per slot: icon and label


func _ready() -> void:
	drop_button.pressed.connect(func() -> void: drop_clicked.emit())
	slot_list.item_selected.connect(func(index: int) -> void: slot_clicked.emit(index))


func show_items(rows: Array[Dictionary]) -> void:  # [{"label": String, "icon": Texture2D}]
	slot_list.clear()
	for row in rows:
		slot_list.add_item(row["label"], row["icon"])


func show_weight(text: String, overloaded: bool) -> void:
	weight_label.text = text
	weight_label.add_theme_color_override("font_color", Color.RED if overloaded else Color.WHITE)


func set_drop_enabled(enabled: bool) -> void:
	drop_button.disabled = not enabled
```

```cpp [Unreal (C++)]
// InventoryView.h: a plain C++ interface (not a UINTERFACE), so the presenter can be tested with
// a fake that isn't a widget.
#pragma once

#include "CoreMinimal.h"

class UTexture2D;

struct FInventoryRow
{
	FText Label;
	TObjectPtr<UTexture2D> Icon;
};

DECLARE_MULTICAST_DELEGATE_OneParam(FOnSlotClicked, int32);
DECLARE_MULTICAST_DELEGATE(FOnDropClicked);

class IInventoryView
{
public:
	virtual ~IInventoryView() = default;
	virtual void ShowItems(const TArray<FInventoryRow>& Rows) = 0;
	virtual void ShowWeight(const FText& Text, bool bOverloaded) = 0;
	virtual void SetDropEnabled(bool bEnabled) = 0;

	FOnSlotClicked OnSlotClicked;
	FOnDropClicked OnDropClicked;
};

// InventoryWidget.h: the UMG widget implements it. BindWidget links to widgets of the same name
// in the Widget Blueprint that derives from this class.
#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "InventoryView.h"
#include "InventoryPresenter.h"                // complete type for TUniquePtr
#include "InventoryWidget.generated.h"

class UButton;
class UTextBlock;
class UInventorySlotWidget;                       // shows an icon and label; OnClicked is a multicast delegate
class UInventory;

UCLASS(Abstract)
class UInventoryWidget : public UUserWidget, public IInventoryView
{
	GENERATED_BODY()

public:
	void Init(UInventory* Model);                 // creates the presenter

	virtual void ShowItems(const TArray<FInventoryRow>& Rows) override;
	virtual void ShowWeight(const FText& Text, bool bOverloaded) override;
	virtual void SetDropEnabled(bool bEnabled) override;

protected:
	virtual void NativeConstruct() override;
	virtual void NativeDestruct() override;

	UPROPERTY(meta = (BindWidget)) TObjectPtr<UTextBlock> WeightLabel;
	UPROPERTY(meta = (BindWidget)) TObjectPtr<UButton> DropButton;
	UPROPERTY() TArray<TObjectPtr<UInventorySlotWidget>> Slots;   // collected from the widget tree

private:
	UFUNCTION() void HandleDropClicked() { OnDropClicked.Broadcast(); }

	TUniquePtr<FInventoryPresenter> Presenter;
};

// InventoryWidget.cpp
#include "InventoryWidget.h"
#include "Components/Button.h"
#include "Components/TextBlock.h"
#include "InventorySlotWidget.h"

void UInventoryWidget::NativeConstruct()
{
	Super::NativeConstruct();
	DropButton->OnClicked.AddDynamic(this, &UInventoryWidget::HandleDropClicked);
	for (int32 i = 0; i < Slots.Num(); ++i)
	{
		Slots[i]->OnClicked.AddWeakLambda(this, [this, i] { OnSlotClicked.Broadcast(i); });
	}
}

void UInventoryWidget::Init(UInventory* Model)
{
	Presenter = MakeUnique<FInventoryPresenter>(Model, *this);
}

void UInventoryWidget::NativeDestruct()
{
	Presenter.Reset();                            // unsubscribes before the widget goes away
	Super::NativeDestruct();
}

void UInventoryWidget::ShowItems(const TArray<FInventoryRow>& Rows)
{
	for (int32 i = 0; i < Slots.Num(); ++i)
	{
		Slots[i]->Show(Rows.IsValidIndex(i) ? Rows[i] : FInventoryRow());
	}
}

void UInventoryWidget::ShowWeight(const FText& Text, bool bOverloaded)
{
	WeightLabel->SetText(Text);
	WeightLabel->SetColorAndOpacity(FSlateColor(bOverloaded ? FLinearColor::Red : FLinearColor::White));
}

void UInventoryWidget::SetDropEnabled(bool bEnabled)
{
	DropButton->SetIsEnabled(bEnabled);
}
```

:::

### Presenter: all the decisions, no UI types

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;

public class InventoryPresenter : IDisposable
{
    readonly Inventory model;
    readonly IInventoryView view;
    int selected = -1;

    public InventoryPresenter(Inventory model, IInventoryView view)
    {
        this.model = model; this.view = view;
        model.Changed += Refresh;
        view.SlotClicked += OnSlotClicked;
        view.DropClicked += OnDropClicked;
        Refresh();
    }

    void OnSlotClicked(int index) { selected = index < model.Items.Count ? index : -1; Refresh(); }

    void OnDropClicked()
    {
        if (selected < 0) return;
        int index = selected;
        selected = -1;
        model.Drop(index);                              // Refresh runs through model.Changed
    }

    void Refresh()
    {
        var rows = new List<(string, UnityEngine.Sprite)>();
        foreach (var item in model.Items) rows.Add(($"{item.Name} ({item.Weight:0.#} kg)", item.Icon));
        view.ShowItems(rows);
        view.ShowWeight($"{model.Weight:0.#} / {model.MaxWeight:0} kg", model.Weight > model.MaxWeight * 0.9f);
        view.SetDropEnabled(selected >= 0);
    }

    public void Dispose()
    {
        model.Changed -= Refresh;
        view.SlotClicked -= OnSlotClicked;
        view.DropClicked -= OnDropClicked;
    }
}
```

```gdscript [Godot (GDScript)]
# inventory_presenter.gd
class_name InventoryPresenter
extends RefCounted

var _model: Inventory
var _view: InventoryView
var _selected := -1


func _init(model: Inventory, view: InventoryView) -> void:
	_model = model
	_view = view
	_model.changed.connect(_refresh)
	_view.slot_clicked.connect(_on_slot_clicked)
	_view.drop_clicked.connect(_on_drop_clicked)
	_refresh()


func _on_slot_clicked(index: int) -> void:
	_selected = index if index < _model.items.size() else -1
	_refresh()


func _on_drop_clicked() -> void:
	if _selected < 0:
		return
	var index := _selected
	_selected = -1
	_model.drop(index)  # _refresh runs through model.changed


func _refresh() -> void:
	var rows: Array[Dictionary] = []
	for item in _model.items:
		rows.append({"label": "%s (%.1f kg)" % [item.display_name, item.weight], "icon": item.icon})
	_view.show_items(rows)
	_view.show_weight("%.1f / %.0f kg" % [_model.weight, Inventory.MAX_WEIGHT],
		_model.weight > Inventory.MAX_WEIGHT * 0.9)
	_view.set_drop_enabled(_selected >= 0)


func dispose() -> void:
	_model.changed.disconnect(_refresh)
	_view.slot_clicked.disconnect(_on_slot_clicked)
	_view.drop_clicked.disconnect(_on_drop_clicked)
```

```cpp [Unreal (C++)]
// InventoryPresenter.h: plain C++, no UMG types, so it can be unit tested with a fake view.
#pragma once

#include "CoreMinimal.h"
#include "Inventory.h"
#include "InventoryView.h"

class FInventoryPresenter
{
public:
	FInventoryPresenter(UInventory* InModel, IInventoryView& InView);
	~FInventoryPresenter();

private:
	void OnSlotClicked(int32 Index);
	void OnDropClicked();
	void Refresh();

	TWeakObjectPtr<UInventory> Model;             // owned by the player, not by the UI
	IInventoryView& View;
	int32 Selected = INDEX_NONE;
	FDelegateHandle ModelHandle, SlotHandle, DropHandle;
};

// InventoryPresenter.cpp
#include "InventoryPresenter.h"

FInventoryPresenter::FInventoryPresenter(UInventory* InModel, IInventoryView& InView)
	: Model(InModel), View(InView)
{
	ModelHandle = InModel->OnChanged.AddRaw(this, &FInventoryPresenter::Refresh);
	SlotHandle = View.OnSlotClicked.AddRaw(this, &FInventoryPresenter::OnSlotClicked);
	DropHandle = View.OnDropClicked.AddRaw(this, &FInventoryPresenter::OnDropClicked);
	Refresh();
}

FInventoryPresenter::~FInventoryPresenter()
{
	if (UInventory* M = Model.Get()) M->OnChanged.Remove(ModelHandle);
	View.OnSlotClicked.Remove(SlotHandle);
	View.OnDropClicked.Remove(DropHandle);
}

void FInventoryPresenter::OnSlotClicked(int32 Index)
{
	Selected = Model.IsValid() && Model->GetItems().IsValidIndex(Index) ? Index : INDEX_NONE;
	Refresh();
}

void FInventoryPresenter::OnDropClicked()
{
	if (Selected == INDEX_NONE || !Model.IsValid()) return;
	const int32 Index = Selected;
	Selected = INDEX_NONE;
	Model->Drop(Index);                           // Refresh runs through OnChanged
}

void FInventoryPresenter::Refresh()
{
	UInventory* M = Model.Get();
	if (!M) return;

	TArray<FInventoryRow> Rows;
	for (const FInventoryItem& Item : M->GetItems())
	{
		Rows.Add({ FText::Format(INVTEXT("{0} ({1} kg)"), Item.Name, FText::AsNumber(Item.Weight)), Item.Icon });
	}
	View.ShowItems(Rows);
	View.ShowWeight(FText::Format(INVTEXT("{0} / {1} kg"), FText::AsNumber(M->GetWeight()), FText::AsNumber(M->GetMaxWeight())),
		M->GetWeight() > M->GetMaxWeight() * 0.9f);
	View.SetDropEnabled(Selected != INDEX_NONE);
}
```

:::

Testing the presenter needs no scene. Pass a `FakeInventoryView` that records what it was told, and assert on it.

**Engine notes**

- **Unity:** the same presenter works with UI Toolkit: only `InventoryView` changes. Unity 6's UI Toolkit runtime data binding makes MVVM practical too (see [Data Binding](./data-binding)).
- **Godot:** Godot has no interfaces, so the view's signals and methods are its contract and a test fake extends `InventoryView`. Signal connections don't keep the presenter alive, so store it in a variable (for example on the view itself), or it is freed at once. When it is freed, Godot removes its connections, so a presenter stored on its view needs no `dispose()`.
- **Unreal:** a `UUserWidget` can also inherit a plain C++ interface, as here, which keeps UMG types out of the presenter. For MVVM, the **UMG Viewmodel** plugin (UE 5.1+) binds widget properties to `FieldNotify` properties of a viewmodel in the UMG designer, with no presenter code at all.

## When to use

- Screens with real logic: inventories, shops, crafting, skill trees, settings with validation.
- When the same data appears in several views (HUD and pause menu), or the same screen needs several layouts (mouse and gamepad, portrait and landscape).
- When UI logic should be unit tested.

## When not to use

- Simple HUD elements that show one value. A small script updating a label is enough.
- Debug and tool UI. Use [Immediate-Mode GUI](./immediate-mode-gui).
- Prototypes, where screens change daily. Separate the layers once a screen stabilises.

## Pitfalls

- **Ceremony for trivial UI.** A label showing the score does not need three classes. Use the split where there is logic to separate.
- **Presenters that touch engine UI types.** Once a presenter references a widget type (`Button`, `TMP_Text`, `Label`, `UTextBlock`), it can no longer be tested without a scene. Keep engine UI types behind the view interface.
- **Full refresh on every change.** Rebuilding every row on any change is simple and usually fine. For long lists, diff the rows, or use a pooled, virtualised list view.
- **Leaked subscriptions.** The presenter subscribes to the model, so dispose it when the screen closes, or the model keeps calling into a destroyed view.

## Related

- [Data Binding](./data-binding) — the MVVM mechanism that replaces manual `Refresh` calls.
- [Observer](./observer) — the model's `Changed` event.
- [Screen Stack](./screen-stack) — manages which screens (and presenters) are open.
- [Dependency Injection](./dependency-injection) — wires models into presenters.
