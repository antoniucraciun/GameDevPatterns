# Turn-Based Tactics Combat

> Grid combat with fixed turn rules, undoable moves, movement ranges and AI that picks safe, useful tiles.

## Goal

The combat layer of a grid tactics game:

- Every unit's turn follows the **same rules** (status effects, stun, action points), whoever controls it.
- The player sees exactly **which tiles a unit can reach** this turn, and the path it will take.
- Moves can be **undone** until the unit attacks, and the whole turn can be **restarted** from its beginning.
- Player input moves through clear **modes**: select a unit, choose a destination, choose a target, watch the animation. Clicks never land in the wrong mode.
- Enemy AI picks tiles that are **useful and safe**, not just the nearest enemy.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Template Method](../patterns/template-method) | One `TakeTurn` sequence for every unit. Player and AI only differ in how they choose actions. |
| [A* Pathfinding](../patterns/a-star) | Its cost-flood variant (Dijkstra) gives every reachable tile and its cost from one search. A* gives the path to the chosen tile. |
| [Command](../patterns/command) | Moves and attacks are commands, so moves can be undone and the log can be replayed. |
| [Memento](../patterns/memento) | Snapshot of the board at turn start, for "restart turn". |
| [State](../patterns/state) | Player input modes: selecting, choosing a destination, choosing a target, animating. |
| [Influence Map](../patterns/influence-map) | Enemy threat per tile. AI scores destinations by damage potential minus danger. |

## How they fit together

```
TurnManager ──► unit.TakeTurn()  (Template Method: status → stun? → AP → choose/perform loop → end)
                     │
        ┌────────────┴─────────────┐
   PlayerUnit.ChooseAction      AiUnit.ChooseAction
   (input State machine)        (score reachable tiles with Influence Map)
        │                            │
        └──── Reachable(unit) ◄──────┘   one Dijkstra flood: tile → cost (≤ AP)
                     │
              MoveCommand / AttackCommand (Command)
                     │  Execute / Undo
              CommandHistory: undo moves until an attack commits them
              BoardSnapshot at turn start (Memento): restart turn
```

The joins:

- **Template Method ↔ State.** The template asks the player unit "what's your action?", and the input state machine produces the answer. The template never sees clicks, and the input states never see turn rules.
- **A* ↔ Influence Map.** The movement flood gives *where the AI can go*, and the influence map gives *how dangerous each of those tiles is*. Scoring only reachable tiles keeps the AI cheap and legal.
- **Command ↔ Memento.** Commands undo individual moves cheaply. An attack is irreversible (it involves damage rolls and deaths), so it **commits** the history. The turn-start memento covers "restart the whole turn" without making every command perfectly reversible.
- **Command ↔ Template Method.** `Perform` executes commands, so the same command objects work for the player, the AI, replays and networked turns.

## Example (Unity C#)

This builds on the pattern pages: `TurnTaker` ([Template Method](../patterns/template-method)), `InfluenceMap` ([Influence Map](../patterns/influence-map)) and the `CommandHistory` idea from [Command](../patterns/command).

### Reachable tiles: one flood for the whole range

```csharp
using System.Collections.Generic;
using UnityEngine;

public class Board
{
    public readonly int Width, Height;
    readonly int[,] moveCost;                         // 1 = plain, 2 = rough, 0 = blocked
    readonly Dictionary<Vector2Int, GridUnit> occupants = new();

    public Board(int[,] moveCost) { this.moveCost = moveCost; Width = moveCost.GetLength(0); Height = moveCost.GetLength(1); }

    public GridUnit At(Vector2Int c) => occupants.TryGetValue(c, out var u) ? u : null;
    public void Place(GridUnit u, Vector2Int c) { occupants.Remove(u.Cell); u.Cell = c; occupants[c] = u; }

    static readonly Vector2Int[] Dirs = { Vector2Int.up, Vector2Int.down, Vector2Int.left, Vector2Int.right };

    // Dijkstra flood from the unit: every tile reachable with the AP it has, with its cost and parent.
    public Dictionary<Vector2Int, (int cost, Vector2Int from)> Reachable(GridUnit unit, int budget)
    {
        var result = new Dictionary<Vector2Int, (int, Vector2Int)> { [unit.Cell] = (0, unit.Cell) };
        var open = new List<Vector2Int> { unit.Cell };
        while (open.Count > 0)
        {
            open.Sort((a, b) => result[a].Item1.CompareTo(result[b].Item1));   // small grids: a sorted list is fine
            var c = open[0]; open.RemoveAt(0);
            foreach (var d in Dirs)
            {
                var n = c + d;
                if (n.x < 0 || n.y < 0 || n.x >= Width || n.y >= Height || moveCost[n.x, n.y] == 0) continue;
                if (At(n) != null) continue;                                   // can't walk through units
                int cost = result[c].Item1 + moveCost[n.x, n.y];
                if (cost > budget) continue;
                if (result.TryGetValue(n, out var old) && old.Item1 <= cost) continue;
                result[n] = (cost, c);
                open.Add(n);
            }
        }
        return result;
    }

    public static List<Vector2Int> PathTo(Dictionary<Vector2Int, (int cost, Vector2Int from)> reach, Vector2Int target)
    {
        var path = new List<Vector2Int>();
        for (var c = target; reach[c].from != c; c = reach[c].from) path.Add(c);
        path.Reverse();
        return path;
    }
}
```

### Commands with undo, committed by attacks

```csharp
public interface ITacticsCommand
{
    int Cost { get; }
    bool IsReversible { get; }
    System.Collections.IEnumerator Execute(Board board);   // animates
    void Undo(Board board);                                  // instant
}

public class MoveCommand : ITacticsCommand
{
    readonly GridUnit unit; readonly List<Vector2Int> path; readonly int cost; Vector2Int from;
    public MoveCommand(GridUnit u, List<Vector2Int> path, int cost) { unit = u; this.path = path; this.cost = cost; }
    public int Cost => cost;
    public bool IsReversible => true;

    public System.Collections.IEnumerator Execute(Board board)
    {
        from = unit.Cell;
        foreach (var step in path) yield return unit.AnimateStepTo(step);
        board.Place(unit, path[^1]);
    }

    public void Undo(Board board) { board.Place(unit, from); unit.SnapTo(from); }
}

public class AttackCommand : ITacticsCommand
{
    readonly GridUnit attacker, target;
    public AttackCommand(GridUnit a, GridUnit t) { attacker = a; target = t; }
    public int Cost => 1;
    public bool IsReversible => false;                       // damage and deaths: no undo
    public System.Collections.IEnumerator Execute(Board board) { yield return attacker.AnimateAttack(target); }
    public void Undo(Board board) => throw new System.InvalidOperationException("Attacks can't be undone");
}

public class TurnHistory
{
    readonly Stack<ITacticsCommand> undoable = new();
    public void Record(ITacticsCommand c) { if (c.IsReversible) undoable.Push(c); else undoable.Clear(); }  // attacks commit
    public bool TryUndo(Board board, GridUnit unit)
    {
        if (!undoable.TryPop(out var c)) return false;
        c.Undo(board);
        unit.RefundActionPoints(c.Cost);
        return true;
    }
}
```

### AI: score reachable tiles with the influence map

```csharp
public class AiUnit : TurnTaker
{
    [SerializeField] int attackRange = 1;
    GridUnit self;
    Board board;
    InfluenceMap threat;                                     // enemy (player) threat per tile, rebuilt each turn

    protected override TurnAction ChooseAction()
    {
        var reach = board.Reachable(self, ActionPoints);
        Vector2Int best = self.Cell;
        float bestScore = float.MinValue;

        foreach (var (cell, info) in reach)
        {
            var target = BestTargetFrom(cell);                // weakest player unit in attack range, if any
            float score = 0f;
            if (target != null) score += 10f + (100f - target.Health) * 0.1f;   // want to hit, prefer finishing blows
            score -= threat[cell.x, cell.y] * 4f;                                  // avoid danger
            score -= info.cost * 0.2f;                                             // prefer shorter moves
            if (score > bestScore) { bestScore = score; best = cell; }
        }

        if (best != self.Cell)
            return TurnAction.From(new MoveCommand(self, Board.PathTo(reach, best), reach[best].cost));
        var t = BestTargetFrom(self.Cell);
        return t != null ? TurnAction.From(new AttackCommand(self, t)) : null;   // null = end turn
    }

    GridUnit BestTargetFrom(Vector2Int cell) { /* lowest-health player unit within attackRange of cell */ return null; }
    protected override System.Collections.IEnumerator Perform(TurnAction a) => a.Command.Execute(board);
    protected override bool IsAlive => self.Health > 0;
}
```

Here, `TurnAction` from the Template Method page simply wraps a command: `TurnAction.From(command)` exposes the command and takes its `Cost` from it.

The player unit's `ChooseAction` is driven by an input state machine (*SelectingUnit → ChoosingDestination → ChoosingTarget → Animating*). Reachable tiles are highlighted when entering *ChoosingDestination*. "Restart turn" restores the board snapshot taken when the player's turn began.

## Where the patterns meet: pitfalls

- **Reachability out of date.** The reachable set depends on unit positions and remaining AP. Recompute it after every move and every undo, or the highlight shows tiles the unit can no longer reach.
- **Undo after hidden information.** If moving reveals an enemy (fog of war) or triggers a trap, undoing the move would let players scout for free. Treat such moves as irreversible, and commit the history.
- **AP and undo drift.** Undo must refund exactly the cost that `Execute` spent, including terrain costs. Store the paid cost in the command, as above.
- **Threat map that ignores the AI's own move.** The influence map shows threat *now*. Moving next to three enemies may be "safe" only until their turn. Weight threat heavily, and consider enemy reach (their own movement floods) for better AI.
- **Animations blocking turn logic.** Commands animate inside `Execute`. If the player can click during animations, input reaches the wrong state. The *Animating* input state ignores everything.

## Variations

- **Overwatch and reactions:** units with overwatch interrupt a move command at the first tile in their view. Model it as a check inside `MoveCommand.Execute` that can cut the path short.
- **Simultaneous turns:** all sides plan commands, and then a resolver executes them together. The commands do not change.
- **Replays and networked play:** send and store the command log. Every client executes the same commands (combined with [Deterministic Lockstep](../patterns/deterministic-lockstep)).
- **Utility AI:** replace the hand-written score with [Utility AI](../patterns/utility-ai) considerations, so designers can tune aggression per enemy type.
