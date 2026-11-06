# Template Method

> A base class fixes the steps of an algorithm and lets subclasses fill some in.

**Category:** Behavioral & Communication

## Problem

In a turn-based tactics game, every unit's turn follows the same rules: tick status effects, skip the turn if stunned, regenerate action points, choose an action, perform it, trigger end-of-turn effects, and tell the turn manager it is done. The knight, the archer and the AI-controlled goblin differ only in *how they choose and perform* their action. When each class writes its whole turn itself, the shared rules are copied, and then drift. One forgets to tick poison, another lets stunned units act. A rule change ("regenerate AP *before* status effects") must be made in every class.

## Solution

Put the **fixed sequence of steps** in one method of the base class: the **template method**. Make it non-overridable. The steps that vary are **abstract** (every subclass must provide them) or **virtual hooks** (optional, with default behaviour).

- The **invariant parts** (order, bookkeeping, rules) are written once, and cannot be broken by subclasses.
- **Subclasses only fill in the gaps.**
- The base class calls the subclass, not the other way round ("don't call us, we'll call you").

## Example (Unity C#)

```csharp
using System.Collections;
using UnityEngine;

public abstract class TurnTaker : MonoBehaviour
{
    [SerializeField] int maxActionPoints = 2;
    public int ActionPoints { get; protected set; }
    public StatusEffectContainer Effects { get; private set; }

    void Awake() => Effects = GetComponent<StatusEffectContainer>();

    // The template method: the order of a turn is fixed here, for every unit.
    // (Not virtual: subclasses cannot reorder or skip the rules.)
    public IEnumerator TakeTurn()
    {
        Effects.TickTurn();                                  // 1. damage over time, durations
        if (!IsAlive) yield break;

        if (Effects.HasTag("Stun"))                          // 2. shared rule: stunned units skip
        {
            OnTurnSkipped();
            yield break;
        }

        ActionPoints = maxActionPoints;                      // 3. shared rule: regenerate AP
        OnTurnStarted();                                     //    hook (optional)

        while (ActionPoints > 0)
        {
            var action = ChooseAction();                     // 4. varies: player input, AI, ...
            if (action == null) break;                       //    null = end turn early
            yield return Perform(action);                    // 5. varies: animations, effects
            ActionPoints -= action.Cost;
        }

        OnTurnEnded();                                       // 6. hook (optional)
    }

    // ── Steps subclasses must provide ──
    protected abstract TurnAction ChooseAction();
    protected abstract IEnumerator Perform(TurnAction action);

    // ── Hooks subclasses may override ──
    protected virtual void OnTurnStarted() { }
    protected virtual void OnTurnEnded() { }
    protected virtual void OnTurnSkipped() => Debug.Log($"{name} is stunned and skips the turn");

    protected abstract bool IsAlive { get; }
}

public class GoblinAI : TurnTaker
{
    protected override bool IsAlive => GetComponent<Health>().IsAlive;

    protected override TurnAction ChooseAction()
    {
        var target = Board.NearestEnemyOf(this);
        if (target == null) return null;
        return Board.InMeleeRange(this, target) ? TurnAction.Attack(target) : TurnAction.MoveToward(target);
    }

    protected override IEnumerator Perform(TurnAction action) => action.Execute(this);
}

public class PlayerKnight : TurnTaker
{
    protected override bool IsAlive => GetComponent<Health>().IsAlive;
    protected override TurnAction ChooseAction() => PlayerInputQueue.TakeChosenAction();   // set by the UI
    protected override IEnumerator Perform(TurnAction action) => action.Execute(this);
    protected override void OnTurnStarted() => CameraRig.FocusOn(transform);              // optional hook
}
```

`TurnAction`, `Board`, `PlayerInputQueue` and `CameraRig` stand in for game-specific code. In the player version, `ChooseAction` would wait for input, which a coroutine-based step handles naturally.

Unity's MonoBehaviour lifecycle works the same way: the engine owns the sequence (`Awake` → `OnEnable` → `Start` → `Update`…), and your scripts fill in hooks.

## When to use

- Several classes share the *structure* of an algorithm but differ in some steps: turns, level loading sequences, AI update loops, attack sequences (wind-up → strike → recover), save/load pipelines.
- When the order of steps is a rule that must not be broken.

## Pitfalls

- **Deep inheritance.** Template methods encourage hierarchies. If variations multiply (melee AI, ranged AI, flying ranged AI…), move the varying steps into [Strategy](./strategy) objects instead of subclasses.
- **Too many hooks.** A base class with fifteen virtual hooks is hard to understand. Keep hooks to the places where variation is actually needed.
- **Subclasses calling base steps out of order.** If subclasses can call `Perform` themselves, the sequence is no longer guaranteed. Keep step methods `protected`, and the template method non-virtual.
- **Forgetting `base.` calls.** Virtual hooks that do work in the base class break silently when an override forgets `base.OnTurnEnded()`. Keep hooks empty in the base class, so overriding them is always safe.

## Related

- [Subclass Sandbox](./subclass-sandbox) — the inverse: the subclass drives, and the base class offers tools.
- [Strategy](./strategy) — composition instead of inheritance for varying steps.
- [State](./state) — states often share a template for enter/update/exit.
- [Status Effects](./status-effects) and [Gameplay Tags](./tags) — the shared rules this example enforces.
