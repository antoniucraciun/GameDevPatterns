# Data Binding

> UI elements update automatically from observable properties.

**Category:** UI

## Problem

The HUD shows health, ammo, gold, level and a quest tracker. Every place that changes one of these values must also remember to update the right label: `gold += 10; goldLabel.text = gold.ToString();`. Some places forget, so the HUD shows stale numbers. Others poll every frame, updating forty labels that rarely change and allocating strings each time. Adding a second place that shows gold, such as the shop, means finding every write again.

## Solution

Make the data **observable**, and **bind** UI elements to it once:

- An **observable property** holds a value and raises a change event when the value actually changes.
- A **binding** connects a property to a UI element through a **converter** (int → "1,250 G", float → fill amount, bool → visible). When the property changes, the binding updates the element.
- **Two-way bindings** also write user input (a slider, a toggle) back into the property.
- Bindings are **disposed** when the UI goes away, which removes the subscriptions.

Code that changes data no longer knows that UI exists, and UI no longer polls.

## Example (Unity C#)

A minimal observable property and binding helpers for uGUI:

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class Observable<T>
{
    T value;
    public event Action<T> Changed;

    public Observable(T initial = default) => value = initial;

    public T Value
    {
        get => value;
        set
        {
            if (EqualityComparer<T>.Default.Equals(this.value, value)) return;   // no change, no event
            this.value = value;
            Changed?.Invoke(value);
        }
    }
}

// Disposable binding: subscribe now, apply the current value immediately, unsubscribe on Dispose.
public sealed class Binding<T> : IDisposable
{
    readonly Observable<T> source;
    readonly Action<T> apply;

    public Binding(Observable<T> source, Action<T> apply)
    {
        this.source = source; this.apply = apply;
        source.Changed += apply;
        apply(source.Value);
    }

    public void Dispose() => source.Changed -= apply;
}

public static class Bind
{
    public static IDisposable Text<T>(Observable<T> source, TMPro.TMP_Text label, Func<T, string> format) =>
        new Binding<T>(source, v => label.text = format(v));

    public static IDisposable Fill(Observable<float> source, Image image) =>
        new Binding<float>(source, v => image.fillAmount = v);

    public static IDisposable Active(Observable<bool> source, GameObject go) =>
        new Binding<bool>(source, v => go.SetActive(v));

    // Two-way: the slider writes back into the property.
    public static IDisposable TwoWay(Observable<float> source, Slider slider)
    {
        var binding = new Binding<float>(source, v => slider.SetValueWithoutNotify(v));
        slider.onValueChanged.AddListener(OnSlider);
        return new CompositeDisposable(binding, new ActionDisposable(() => slider.onValueChanged.RemoveListener(OnSlider)));

        void OnSlider(float v) => source.Value = v;
    }
}

public sealed class ActionDisposable : IDisposable
{
    Action action;
    public ActionDisposable(Action action) => this.action = action;
    public void Dispose() { action?.Invoke(); action = null; }
}

public sealed class CompositeDisposable : IDisposable
{
    readonly List<IDisposable> items;
    public CompositeDisposable(params IDisposable[] items) => this.items = new List<IDisposable>(items);
    public void Add(IDisposable d) => items.Add(d);
    public void Dispose() { foreach (var d in items) d.Dispose(); items.Clear(); }
}
```

Game data exposes observables, and the HUD binds once:

```csharp
public class PlayerData
{
    public readonly Observable<int> Gold = new(0);
    public readonly Observable<float> HealthFraction = new(1f);
    public readonly Observable<bool> HasQuest = new(false);
    public readonly Observable<float> MusicVolume = new(0.8f);
}

public class Hud : MonoBehaviour
{
    [SerializeField] TMPro.TMP_Text goldLabel;
    [SerializeField] Image healthFill;
    [SerializeField] GameObject questTracker;
    [SerializeField] Slider musicSlider;

    readonly CompositeDisposable bindings = new();

    public void Show(PlayerData data)
    {
        bindings.Add(Bind.Text(data.Gold, goldLabel, g => $"{g:N0} G"));
        bindings.Add(Bind.Fill(data.HealthFraction, healthFill));
        bindings.Add(Bind.Active(data.HasQuest, questTracker));
        bindings.Add(Bind.TwoWay(data.MusicVolume, musicSlider));
    }

    void OnDestroy() => bindings.Dispose();
}

// Anywhere in gameplay — no UI code:
// data.Gold.Value += 10;
```

Unity's **UI Toolkit** has built-in runtime data binding (`dataSource` and `SetBinding`, Unity 2023.2+), and libraries such as **R3** and **UniRx** provide richer reactive properties. The idea is the same in each.

## When to use

- HUDs and menus that show many values that change occasionally.
- Values displayed in several places at once (gold in the HUD, shop and crafting screens).
- Settings screens with two-way controls.
- MVVM-style UI, where view models expose observables. See [MVC / MVP / MVVM](./mvp-mvvm).

## When not to use

- A few values that change every frame, such as a speedometer. Update the label directly.
- Static text that never changes after the screen opens.
- Hand-rolling a binding framework. UI Toolkit has runtime binding built in; use it if you're on UI Toolkit.

## Pitfalls

- **Forgetting to dispose.** Bindings subscribe to data that usually outlives the UI. Without disposal, destroyed labels keep receiving updates and throw `MissingReferenceException`.
- **Feedback loops in two-way bindings.** A slider updating the property updates the slider, which updates the property… Use `SetValueWithoutNotify` and the equality check, as above.
- **Binding values that change every frame.** A timer or position bound through events fires every frame anyway. Plain polling in `Update` is simpler and cheaper for continuously changing values.
- **Allocation in converters.** String formatting allocates. That is fine on change, but expensive if the value changes every frame. Cache strings for small ranges, or use TextMeshPro's `SetText` with number arguments.
- **Mutating collections inside an observable.** Adding to a `List` inside `Observable<List<T>>` does not raise `Changed`. Use an observable collection, or replace the list.

## Related

- [MVC / MVP / MVVM](./mvp-mvvm) — binding is the glue in MVVM.
- [Observer](./observer) — observables are subjects with one property each.
- [Dirty Flag](./dirty-flag) — an alternative for values that change often: mark dirty and refresh once per frame.
- [ScriptableObject Architecture](./scriptable-object-architecture) — observable variables as assets, bindable across scenes.
