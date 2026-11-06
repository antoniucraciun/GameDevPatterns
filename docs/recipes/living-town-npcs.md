# Living Town NPCs

> Villagers with daily routines and needs who plan their day, walk the town, and cost almost nothing when far away.

## Goal

A town in an RPG or life sim that feels inhabited:

- Each villager has **needs** (hunger, energy, social) and a **job**. They go to work in the morning, eat at noon, chat in the square in the evening and sleep at night, but **adapt** to their needs: a hungry villager eats early.
- Activities have **steps**: going to eat means walking to the tavern, opening the door, sitting, eating and leaving.
- Villagers **walk** through the town on proper paths, through doors.
- **200 villagers** in a town cost very little: the ones far away do not run full AI or navigation, but are still in the right place at the right time when the player arrives.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Timer / Scheduler](../patterns/timer-scheduler) | A game clock with hour-change events: work starts, shops open, villagers reconsider their plans. |
| [Utility AI](../patterns/utility-ai) | Chooses *what* to do next (work, eat, sleep, socialise) from needs, time of day and personality. |
| [HTN Planning](../patterns/htn-planning) | Decomposes the chosen activity into concrete steps (walk to the tavern, enter, sit, eat). |
| [Navigation Mesh](../patterns/navigation-mesh) | Walking between buildings, with doors as navmesh links. |
| [Level of Detail](../patterns/level-of-detail) | Near villagers run the full simulation. Far ones advance abstractly along their plan, with no navigation or animation. |

## How they fit together

```
 GameClock (Scheduler): every in-game hour ──► villagers re-evaluate (staggered)
                                                    │
   Utility AI: score { Work, Eat, Sleep, Socialise, Idle }                (WHAT)
     inputs: hunger, energy, social, hour, job hours, personality weights
                                                    ▼
   HTN: decompose the winning activity into primitive tasks               (HOW)
     Eat → [WalkTo(tavern.door), Enter(tavern), WalkTo(seat), Sit, Eat(30 min), Leave]
                                                    ▼
   Executor by LOD level:
     Full    → NavMeshAgent walks, Animator plays, tasks finish on arrival   (near the player)
     Abstract→ each task takes its estimated duration, position jumps to its end point (far away)
```

The joins:

- **Scheduler ↔ Utility AI.** Villagers do not think every frame. They re-evaluate on hour changes, when a plan finishes, or when a need becomes urgent. The scheduler spreads re-evaluations so 200 villagers do not all think on the same frame.
- **Utility AI ↔ HTN.** Utility decides *what is most important now*. HTN decides *how to do it here*, with this tavern, this door and this seat. Neither has to do the other's job.
- **HTN ↔ Navigation Mesh.** Primitive tasks like `WalkTo` are executed by the navmesh agent at full detail. Planning only needs estimates (distance ÷ walking speed), so the same plan works at any level of detail.
- **Level of Detail ↔ everything.** The *plan* is identical at every LOD, and only the *executor* changes. A far villager "walks" by waiting the estimated time and appearing at the destination. When the player approaches, it switches to full execution from wherever it is in the plan, with no pop or reset.

## Example (Unity C#)

This builds on `Scheduler` ([Timer / Scheduler](../patterns/timer-scheduler)), the utility scoring idea ([Utility AI](../patterns/utility-ai)), `HtnPlanner` ([HTN](../patterns/htn-planning)) and `SimulationLod` ([Level of Detail](../patterns/level-of-detail)).

### The game clock

```csharp
using System;
using UnityEngine;

public class GameClock : MonoBehaviour
{
    public const float RealSecondsPerGameHour = 30f;   // a 12-minute day
    public static float Hour { get; private set; } = 6f;
    public static event Action<int> HourChanged;

    void Start() => Scheduler.Every(RealSecondsPerGameHour, () =>
    {
        Hour = (Hour + 1f) % 24f;
        HourChanged?.Invoke((int)Hour);
    }, owner: this);
}
```

### The villager: utility picks WHAT, HTN plans HOW, LOD picks the executor

```csharp
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

public enum Activity { Work, Eat, Sleep, Socialise, Idle }

public class Villager : MonoBehaviour
{
    [Range(0, 1)] public float Hunger = 0.2f, Energy = 0.9f, Social = 0.5f;
    [SerializeField] Building home, workplace, tavern;
    [SerializeField] int workStart = 8, workEnd = 17;
    [SerializeField] float sociability = 1f;                  // personality weight
    [SerializeField] NavMeshAgent agent;
    [SerializeField] SimulationLod lod;

    readonly Queue<VillagerTask> plan = new();
    Activity current = Activity.Idle;
    Coroutine executing;

    void OnEnable()
    {
        GameClock.HourChanged += OnHour;
        lod.Changed += OnLodChanged;                          // switch executor mid-plan
        Reconsider();
    }

    void OnDisable()
    {
        GameClock.HourChanged -= OnHour;                      // static event: always unsubscribe
        lod.Changed -= OnLodChanged;
    }

    void OnHour(int hour) => Scheduler.After(Random.Range(0f, 3f), Reconsider, owner: this);   // staggered
    void OnLodChanged(DetailLevel _) => RestartExecution();

    void Update()
    {
        float hours = Time.deltaTime / GameClock.RealSecondsPerGameHour;
        Hunger = Mathf.Clamp01(Hunger + hours * 0.06f);
        Energy = Mathf.Clamp01(Energy - hours * 0.04f);
        if (Hunger > 0.9f && current != Activity.Eat) Reconsider();      // urgent needs interrupt
    }

    // ── Utility AI: what matters most right now? ──
    void Reconsider()
    {
        int h = (int)GameClock.Hour;
        bool workHours = h >= workStart && h < workEnd;
        var scores = new Dictionary<Activity, float>
        {
            [Activity.Work]      = workHours ? 0.6f * (1f - Hunger * 0.5f) : 0f,
            [Activity.Eat]       = Mathf.Pow(Hunger, 2f) * 1.2f,
            [Activity.Sleep]     = (h >= 22 || h < 6 ? 0.8f : 0f) + Mathf.Pow(1f - Energy, 3f),
            [Activity.Socialise] = (h >= 18 && h < 22 ? 0.4f : 0.1f) * (1f - Social) * sociability,
            [Activity.Idle]      = 0.05f,
        };

        Activity best = Activity.Idle; float bestScore = float.MinValue;
        foreach (var (a, s) in scores)
        {
            float score = s + (a == current ? 0.1f : 0f);              // commitment: avoid dithering
            if (score > bestScore) { bestScore = score; best = a; }
        }
        if (best == current && plan.Count > 0) return;                // keep going with the current plan

        current = best;
        BuildPlan(best);                                              // HTN decomposition
        RestartExecution();
    }

    // ── HTN-style decomposition into primitive tasks (inline for brevity) ──
    void BuildPlan(Activity a)
    {
        plan.Clear();
        switch (a)
        {
            case Activity.Eat:
                if (tavern.IsOpen(GameClock.Hour)) { Go(tavern); plan.Enqueue(VillagerTask.Do("Eat", 0.5f, () => Hunger = 0f)); }
                else { Go(home); plan.Enqueue(VillagerTask.Do("EatAtHome", 0.75f, () => Hunger = 0.1f)); }   // alternative method
                break;
            case Activity.Work:      Go(workplace); plan.Enqueue(VillagerTask.Do("Work", workEnd - GameClock.Hour, null)); break;
            case Activity.Sleep:     Go(home); plan.Enqueue(VillagerTask.Do("Sleep", 8f, () => Energy = 1f)); break;
            case Activity.Socialise: Go(tavern); plan.Enqueue(VillagerTask.Do("Chat", 1.5f, () => Social = 1f)); break;
            default:                 plan.Enqueue(VillagerTask.Do("Idle", 0.5f, null)); break;
        }
    }

    void Go(Building b)
    {
        plan.Enqueue(VillagerTask.WalkTo(b.Door.position));
        plan.Enqueue(VillagerTask.Do("Enter", 0.05f, null));
        plan.Enqueue(VillagerTask.WalkTo(b.Inside.position));
    }

    // ── Execution, by level of detail ──
    void RestartExecution()
    {
        if (executing != null) StopCoroutine(executing);
        executing = StartCoroutine(lod.Level <= DetailLevel.Medium ? ExecuteFull() : ExecuteAbstract());
    }

    IEnumerator ExecuteFull()
    {
        agent.enabled = true;
        while (plan.Count > 0)
        {
            var t = plan.Peek();
            if (t.IsWalk)
            {
                agent.SetDestination(t.Destination);
                while (agent.pathPending || agent.remainingDistance > agent.stoppingDistance) yield return null;
            }
            else yield return new WaitForSeconds(t.Hours * GameClock.RealSecondsPerGameHour);
            plan.Dequeue().OnDone?.Invoke();
        }
        Reconsider();
    }

    IEnumerator ExecuteAbstract()
    {
        agent.enabled = false;                                        // no navigation, no animation
        while (plan.Count > 0)
        {
            var t = plan.Peek();
            // A walk takes as long as it would at full detail; activities take their game-time duration.
            float seconds = t.IsWalk
                ? Vector3.Distance(transform.position, t.Destination) / agent.speed
                : t.Hours * GameClock.RealSecondsPerGameHour;
            yield return new WaitForSeconds(seconds);
            if (t.IsWalk) transform.position = t.Destination;          // "arrive"
            plan.Dequeue().OnDone?.Invoke();
        }
        Reconsider();
    }
}

public readonly struct VillagerTask
{
    public readonly bool IsWalk; public readonly Vector3 Destination;
    public readonly string Name; public readonly float Hours; public readonly System.Action OnDone;
    VillagerTask(bool walk, Vector3 dest, string name, float hours, System.Action done)
    { IsWalk = walk; Destination = dest; Name = name; Hours = hours; OnDone = done; }
    public static VillagerTask WalkTo(Vector3 p) => new(true, p, "Walk", 0f, null);
    public static VillagerTask Do(string name, float hours, System.Action done) => new(false, default, name, hours, done);
}

// Building: Door and Inside transforms, IsOpen(hour).
```

The decomposition is written inline here. For villagers with many activities and alternatives, express it as an [HTN](../patterns/htn-planning) domain, and let the planner check preconditions (tavern open, has money) before committing.

An abstract walk takes exactly as long as the agent would take to walk it (distance ÷ agent speed), so a far villager is never ahead of or behind where it would be at full detail. That is what makes switching levels of detail invisible.

## Where the patterns meet: pitfalls

- **Everyone thinks at once.** Hour changes make 200 villagers replan on the same frame. Stagger re-evaluation with random delays, as above, or a round-robin ([Time Slicing](../patterns/time-slicing)).
- **Dithering between activities.** Two close utility scores make a villager alternate every hour. Add a commitment bonus for the current activity, and only reconsider when a plan ends, an hour passes or a need becomes urgent.
- **LOD switch mid-task.** Switching from abstract to full detail while "walking" must not teleport the villager to the destination or back to the start. Keep the plan, and let the full executor continue the current task from the current position.
- **Abstract positions that make no sense.** A far villager "arriving" inside a wall or a locked building is noticed when the player rounds the corner. Abstract destinations must be valid navmesh points, such as door and inside markers.
- **Plans that ignore the world changing.** The tavern closes while a villager walks there. Re-check preconditions when each task starts, and replan on failure.
- **Clock and time scale.** If the game clock uses scaled time, pausing freezes the town correctly. If parts use real time (UI timers), keep them separate ([Time Scale](../patterns/time-scale)).

## Variations

- **Relationships:** socialising picks partners by affinity, and both villagers plan to meet at the same place and time.
- **Reactions to the player:** greet, flee or trade. A perception layer raises urgent needs ("danger") that override the schedule.
- **Persistent towns:** save each villager's needs, current activity and plan position with the [Save System](../patterns/save-system). Abstract simulation means the town keeps "living" correctly between visits.
- **Crowds:** for hundreds of background pedestrians, drop HTN and use precomputed routes with [Flow Fields](../patterns/flow-field).
