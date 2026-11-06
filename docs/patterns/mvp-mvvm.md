# MVC / MVP / MVVM

> Keep UI views dumb and push state and logic into a model and presenter.

**Category:** UI

## Problem

The inventory screen's MonoBehaviour does everything. It reads the player's items, sorts them, calculates the total weight, decides which buttons are enabled, formats "12.5 / 40 kg", handles clicks, plays sounds and talks to the save system. Changing the layout breaks the logic. Testing "you cannot equip a two-handed sword with a shield" requires a scene with a Canvas. Building a controller-friendly version of the same screen means copying all of it.

## Solution

Split each screen into roles:

| Role | Knows about | Responsibility |
| --- | --- | --- |
| **Model** | Nothing about UI | Game data and rules: the inventory, items, "can equip?". Raises events when it changes. |
| **View** | Unity UI components only | Displays what it is told, and reports user actions ("slot 3 clicked"). No decisions. |
| **Presenter** (MVP) / **ViewModel** (MVVM) | Model, and the view through an interface | Turns model state into display state (text, enabled flags), and user actions into model calls. |

The variants differ in how the middle layer talks to the view:

- **MVC:** the controller handles input, and the view reads the model directly. Common on the web, less common in games.
- **MVP:** the presenter *pushes* to a passive view through an interface (`view.SetWeight("12.5 / 40 kg")`). It is easy to test with a fake view, and it is the most common choice in Unity.
- **MVVM:** the view model exposes *observable properties*, and the view *binds* to them, so updates flow automatically. It suits Unity's UI Toolkit runtime binding. See [Data Binding](./data-binding).

## Example (Unity C#)

MVP for an inventory screen.

### Model: pure game logic, no UI

```csharp
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

### View: an interface plus a dumb MonoBehaviour

```csharp
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

### Presenter: all the decisions, no Unity UI types

```csharp
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
        model.Drop(selected);
        selected = -1;                                  // Refresh runs through model.Changed
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

Testing the presenter needs no scene. Pass a `FakeInventoryView` that records what it was told, and assert on it.

## When to use

- Screens with real logic: inventories, shops, crafting, skill trees, settings with validation.
- When the same data appears in several views (HUD and pause menu), or the same screen needs several layouts (mouse and gamepad, portrait and landscape).
- When UI logic should be unit tested.

## Pitfalls

- **Ceremony for trivial UI.** A label showing the score does not need three classes. Use the split where there is logic to separate.
- **Presenters that touch Unity UI types.** Once a presenter references `Button` or `TMP_Text`, it can no longer be tested without a scene. Keep Unity UI types behind the view interface.
- **Full refresh on every change.** Rebuilding every row on any change is simple and usually fine. For long lists, diff the rows, or use a pooled, virtualised list view.
- **Leaked subscriptions.** The presenter subscribes to the model, so dispose it when the screen closes, or the model keeps calling into a destroyed view.

## Related

- [Data Binding](./data-binding) — the MVVM mechanism that replaces manual `Refresh` calls.
- [Observer](./observer) — the model's `Changed` event.
- [Screen Stack](./screen-stack) — manages which screens (and presenters) are open.
- [Dependency Injection](./dependency-injection) — wires models into presenters.
