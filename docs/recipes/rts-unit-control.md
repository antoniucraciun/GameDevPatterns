# RTS Unit Control

> Box selection, control groups, queued orders and hundreds of units moving together to one click.

## Goal

The command layer of a real-time strategy game:

- **Drag a box** to select units, click to select one, **shift** to add, and **Ctrl+1..9** to save control groups.
- **Right-click** issues a context order: move on ground, attack on an enemy, gather on a resource.
- **Shift+right-click queues** orders: move here, then there, then attack that.
- **400 units** ordered to one point all move there **together**, without 400 path searches, and arrive in a formation instead of a pile.
- UI, minimap, building placement and selection never fight over the same click.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Chain of Responsibility](../patterns/chain-of-responsibility) | Routes each click: UI, then the minimap, then build placement, then selection, then orders. |
| [Spatial Partition](../patterns/spatial-partition) | Box selection and click-picking query a grid instead of every unit. |
| [Composite](../patterns/composite) | The selection and control groups are groups of units that accept the same orders as one unit. |
| [Command](../patterns/command) | Orders are objects in a per-unit queue, which makes shift-queuing, replays and networking possible. |
| [Flow Field](../patterns/flow-field) | One field per destination, shared by every unit in the group heading there. |

## How they fit together

```
 mouse ──► PointerChain (Chain of Responsibility)
             UI → Minimap → BuildPlacement → SelectionHandler → OrderHandler
                                   │                    │
               drag box ───────────┘                    └── right-click
               UnitGrid.Query(rect) (Spatial Partition)      target under cursor? attack / gather / move
               → Selection : UnitGroup (Composite)           → Command per order (shift = enqueue, else replace)
                                                                  │
                         UnitGroup.Issue(cmd) fans out to every unit (with a formation slot)
                                                                  ▼
                         MoveCommand: FlowFieldCache.Get(destination) (Flow Field, shared)
                         unit steers along the field to its formation slot; next command when done
```

The joins:

- **Chain of Responsibility ↔ everything.** A click over the UI never selects units, and build mode swallows clicks while active. One ordered chain makes priorities explicit, instead of every system checking `IsPointerOverUI` and build mode.
- **Spatial Partition ↔ Composite.** Box queries return candidates from a few grid cells. Exact screen-rectangle checks then build the selection group. The group is a composite, so "selection", "control group 3" and "this one unit" all accept the same orders.
- **Command ↔ Composite.** Ordering a group creates **one command per unit**, each with that unit's formation offset, appended to each unit's own queue. Units finish orders at different times, and queues stay independent.
- **Command ↔ Flow Field.** Move commands do not compute paths. They ask a shared cache for the flow field toward their destination. 400 units moving to one point cost one field, not 400 searches.

## Example (Unity C#)

This builds on `PointerChain` and `IPointerHandler` ([Chain of Responsibility](../patterns/chain-of-responsibility)), `FlowField` ([Flow Field](../patterns/flow-field)) and the grid idea from [Spatial Partition](../patterns/spatial-partition).

### Units with order queues

```csharp
using System.Collections.Generic;
using UnityEngine;

public interface IUnitOrder                                  // Command
{
    void Begin(RtsUnit unit);
    bool Tick(RtsUnit unit, float dt);                       // true when finished
}

public class RtsUnit : MonoBehaviour
{
    public float Speed = 4f;
    public int Team;
    readonly Queue<IUnitOrder> orders = new();
    IUnitOrder current;

    public void Order(IUnitOrder order, bool queue)
    {
        if (!queue) { orders.Clear(); current = null; }      // a plain right-click replaces everything
        orders.Enqueue(order);
    }

    void Update()
    {
        if (current == null && orders.Count > 0) { current = orders.Dequeue(); current.Begin(this); }
        if (current != null && current.Tick(this, Time.deltaTime)) current = null;
    }
}

public class MoveOrder : IUnitOrder
{
    readonly Vector3 destination, slotOffset;
    FlowField field;
    public MoveOrder(Vector3 destination, Vector3 slotOffset) { this.destination = destination; this.slotOffset = slotOffset; }

    public void Begin(RtsUnit unit) => field = FlowFieldCache.Get(destination);   // shared per destination

    public bool Tick(RtsUnit unit, float dt)
    {
        Vector3 slot = destination + slotOffset;
        Vector3 toSlot = slot - unit.transform.position;
        if (toSlot.sqrMagnitude < 0.25f) return true;

        // Far away: follow the shared field. Close to the destination: head for this unit's own slot.
        Vector3 dir = toSlot.magnitude > 6f ? field.DirectionAt(unit.transform.position) : toSlot.normalized;
        unit.transform.position += dir * unit.Speed * dt;    // add separation from Steering Behaviors in production
        return false;
    }
}

public static class FlowFieldCache
{
    static readonly Dictionary<Vector2Int, FlowField> fields = new();
    public static FlowField World;                            // template with the map's costs

    public static FlowField Get(Vector3 destination)
    {
        var key = World.CellOf(destination);
        if (fields.TryGetValue(key, out var f)) return f;
        f = World.CloneCosts();                               // same terrain costs, new integration
        f.Build(destination);
        fields[key] = f;                                      // evict old fields with an LRU in practice
        return f;
    }
}
```

### Selection as a composite, filled from a grid query

```csharp
public class UnitGroup                                        // Composite
{
    public readonly List<RtsUnit> Units = new();

    public void Issue(System.Func<RtsUnit, Vector3, IUnitOrder> makeOrder, Vector3 target, bool queue)
    {
        // Formation: a grid of slots around the target, one per unit.
        int cols = Mathf.CeilToInt(Mathf.Sqrt(Units.Count));
        for (int i = 0; i < Units.Count; i++)
        {
            var offset = new Vector3((i % cols - cols / 2f) * 1.5f, 0f, (i / cols - cols / 2f) * 1.5f);
            Units[i].Order(makeOrder(Units[i], offset), queue);  // one command per unit
        }
    }
}

public class SelectionHandler : IPointerHandler
{
    public int Priority => 20;
    public readonly UnitGroup Selection = new();
    readonly UnitGroup[] controlGroups = new UnitGroup[10];
    readonly Camera cam;
    Vector2 dragStart;
    bool dragging;

    public SelectionHandler(Camera cam) => this.cam = cam;

    public bool Handle(in PointerEvent e)
    {
        if (e.Button != 0) return false;                      // only left clicks are selection
        dragStart = e.ScreenPosition;
        dragging = true;
        return true;
    }

    // Called on mouse-up (from the same input layer).
    public void EndDrag(Vector2 end, bool additive)
    {
        if (!dragging) return;
        dragging = false;
        if (!additive) Selection.Units.Clear();

        var rect = Rect.MinMaxRect(Mathf.Min(dragStart.x, end.x), Mathf.Min(dragStart.y, end.y),
                                   Mathf.Max(dragStart.x, end.x), Mathf.Max(dragStart.y, end.y));

        // Spatial Partition: only units in grid cells under the box's ground footprint are tested.
        foreach (var unit in UnitGrid.QueryScreenRect(cam, rect))
            if (unit.Team == 0 && rect.Contains(cam.WorldToScreenPoint(unit.transform.position)) && !Selection.Units.Contains(unit))
                Selection.Units.Add(unit);
    }

    public void SaveGroup(int n)                              // Ctrl+n
    {
        var group = new UnitGroup();
        group.Units.AddRange(Selection.Units);
        controlGroups[n] = group;
    }

    public void RecallGroup(int n)                            // n
    {
        if (controlGroups[n] == null) return;
        Selection.Units.Clear();
        Selection.Units.AddRange(controlGroups[n].Units);
    }
}

public class OrderHandler : IPointerHandler
{
    public int Priority => 10;
    readonly SelectionHandler selection;
    readonly Camera cam;
    public OrderHandler(SelectionHandler selection, Camera cam) { this.selection = selection; this.cam = cam; }

    public bool Handle(in PointerEvent e)
    {
        if (e.Button != 1 || selection.Selection.Units.Count == 0) return false;
        if (!Physics.Raycast(cam.ScreenPointToRay(e.ScreenPosition), out var hit)) return false;
        bool queue = Input.GetKey(KeyCode.LeftShift);

        if (hit.collider.TryGetComponent(out RtsUnit enemy) && enemy.Team != 0)
            selection.Selection.Issue((u, _) => new AttackOrder(enemy), hit.point, queue);
        else
            selection.Selection.Issue((u, slot) => new MoveOrder(hit.point, slot), hit.point, queue);
        return true;
    }
}

// Wiring: chain.Add(new UiHandler()); chain.Add(minimap); chain.Add(selection); chain.Add(orders);
// AttackOrder: move toward the target via the field until in range, then attack until it dies.
// UnitGrid.QueryScreenRect: projects the rect's corners onto the ground and queries the grid cells inside.
// FlowField.CloneCosts: a small helper that copies the cost grid into a new field (not on the Flow Field page).
```

## Where the patterns meet: pitfalls

- **Orders that reference dead units.** An attack order whose target died, or a group containing destroyed units, throws or stalls. Remove units from groups on death ([Observer](../patterns/observer)), and let orders finish immediately when their target is gone.
- **One field per click.** Every right-click on a slightly different spot creates a new flow field. Key fields by destination *cell*, as above, cache them, and evict unused ones.
- **Everyone to the same point.** Without formation slots, 400 units fight for the exact click position forever. Give each unit its own slot, and treat "close enough" as arrived.
- **Selection through UI.** If the chain order is wrong, dragging over a panel selects units underneath. UI must come first in the chain.
- **Shift-queue ambiguity.** Queued orders for a group are queued per unit. Units that finish early start their next order early. If orders must be synchronised ("all arrive, then all attack"), add a group-level wait order.
- **Networked RTS.** Orders are commands, so send *orders*, not positions, and run the simulation deterministically ([Deterministic Lockstep](../patterns/deterministic-lockstep)).

## Variations

- **Formations as data:** line, wedge and box layouts, chosen per group, computed by the same slot function.
- **Smart orders:** right-click on a resource means gather for workers but move for soldiers. The order factory asks each unit what the click means for it.
- **Attack-move and patrol:** orders that interrupt themselves when an enemy enters range, then resume.
- **Group speed:** a group moves at its slowest member's speed, to keep formations together.
