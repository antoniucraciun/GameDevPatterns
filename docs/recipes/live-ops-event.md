# Live-Ops Seasonal Event

> A time-limited event switched on remotely, with downloaded content, translated text and event quests, and no app update.

## Goal

A two-week winter event in a live game:

- It starts and ends at **exact UTC times**, switched on **remotely**. No app-store update, and no build with the event baked in.
- Event content (a snowy town decoration, a reindeer mount, event music) is **downloaded on demand**, not shipped in the base app, and only by players who play during the event.
- Event text is **translated** and arrives with the event.
- **Event quests** ("Collect 50 snowflakes") appear for its duration, and rewards stay with the player afterwards.
- If anything fails (offline, download error), the game **still works**, just without the event.
- The team can **kill** the event instantly if something goes wrong.

## Patterns used

| Pattern | Its job in this recipe |
| --- | --- |
| [Bootstrapper](../patterns/bootstrapper) | Fetches remote config at startup, before the main menu decides what to show. |
| [Feature Flags](../patterns/feature-flags) | The event's on/off switch and kill switch, plus start/end times from remote config. |
| [Asset References & Addressing](../patterns/asset-reference) | Event content in a remote Addressables group: size check, download, load and release. |
| [Localization Tables](../patterns/localization-tables) | An event string table, delivered with the event content. |
| [Quest System](../patterns/quest-system) | Event quests registered while the event runs, and their progress saved like any other quest. |

## How they fit together

```
 Boot (Bootstrapper)
   ├─ fetch remote config (cached on disk; defaults if offline)          ─► Flags: WinterEvent = true
   │     { "WinterEvent": "true", "WinterEvent.start": "2026-12-15T00:00Z", "WinterEvent.end": "...", "contentVersion": 3 }
   ├─ server time (never trust the device clock)
   └─ LiveEvents.Evaluate(now)
         active = Flags.IsOn(WinterEvent) && start ≤ now < end
         │
         ▼ active
   Addressables: GetDownloadSizeAsync("winter-event") ─► ask the player if large ─► DownloadDependenciesAsync
         │                                              (failure: event hidden, game continues)
         ▼
   load: town decorations, mount, music (Asset References)
   locale: "WinterEvent" string table added (Localization)
   quests: event quest definitions registered with the QuestLog (Quest System)
         │
   at end time (or kill switch): unregister quests, hide content, release handles; rewards stay
```

The joins:

- **Bootstrapper ↔ Feature Flags.** Remote config must arrive *before* the menu builds its event banner. Boot fetches it with a short timeout, caches the last good copy on disk, and falls back to defaults (event off) when offline.
- **Feature Flags ↔ time.** The flag says the event *may* run, and the start and end times say *when*. The kill switch is the same flag set to false. Evaluate with **server time**, or a player can extend the event by changing their device clock.
- **Asset References ↔ Localization.** Event text lives in a string table inside the event's Addressables group, so content and translations are always downloaded, versioned and released together.
- **Quest System ↔ event lifetime.** Event quests are registered while the event is active and unregistered afterwards. Progress and rewards go through the normal save system, so a player who finishes a quest keeps the reward when the event ends.

## Example (Unity C#)

This builds on `Flags` ([Feature Flags](../patterns/feature-flags)), the Addressables usage from [Asset References](../patterns/asset-reference), and `QuestLog` and `QuestDefinition` ([Quest System](../patterns/quest-system)). The flag enum includes `Feature.WinterEvent`.

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;
using UnityEngine.Localization.Settings;

public class LiveEvent
{
    public Feature Flag;
    public string ContentLabel;                 // Addressables label of the event group, e.g. "winter-event"
    public string StringTable;                  // localisation table inside that group
    public DateTime StartUtc, EndUtc;
}

public class LiveEventService : IDisposable
{
    readonly QuestLog quests;
    readonly Func<DateTime> serverNowUtc;       // from your backend; never DateTime.Now on the device
    readonly List<AsyncOperationHandle> handles = new();
    readonly List<QuestDefinition> registeredQuests = new();

    public LiveEvent Active { get; private set; }
    public event Action<LiveEvent> Started, Ended;

    public LiveEventService(QuestLog quests, Func<DateTime> serverNowUtc)
    {
        this.quests = quests; this.serverNowUtc = serverNowUtc;
        Flags.Changed += OnFlagsChanged;                       // kill switch takes effect mid-session
    }

    void OnFlagsChanged() => _ = Evaluate(Current);

    public LiveEvent Current { get; set; }                     // parsed from remote config at boot

    public async Awaitable Evaluate(LiveEvent e)
    {
        if (e == null) return;
        var now = serverNowUtc();
        bool shouldRun = Flags.IsOn(e.Flag) && now >= e.StartUtc && now < e.EndUtc;

        if (shouldRun && Active == null) await TryStart(e);
        else if (!shouldRun && Active == e) Stop();
    }

    async Awaitable TryStart(LiveEvent e)
    {
        try
        {
            // 1. Download content (and its string table) only for players who play during the event.
            var size = Addressables.GetDownloadSizeAsync(e.ContentLabel);
            await size.Task;
            long bytes = size.Result;
            Addressables.Release(size);
            if (bytes > 50_000_000 && !await DownloadPrompt.Ask(bytes)) return;   // large: ask first (mobile data)

            var download = Addressables.DownloadDependenciesAsync(e.ContentLabel);
            await download.Task;
            bool ok = download.Status == AsyncOperationStatus.Succeeded;
            Addressables.Release(download);
            if (!ok) { Debug.LogWarning("Event content download failed; event hidden"); return; }

            // 2. Load the event's quests from the downloaded content, and register them.
            var questHandle = Addressables.LoadAssetsAsync<QuestDefinition>(e.ContentLabel, null);
            await questHandle.Task;
            handles.Add(questHandle);
            foreach (var q in questHandle.Result) { quests.Start(q); registeredQuests.Add(q); }

            // 3. Make the event's strings available (the table is in the same Addressables group).
            await LocalizationSettings.StringDatabase.GetTableAsync(e.StringTable).Task;

            Active = e;
            Started?.Invoke(e);                                   // menu banner, town decorations, music swap
        }
        catch (Exception ex)
        {
            Debug.LogException(ex);                               // the game must work without the event
            ReleaseAll();
        }
    }

    void Stop()
    {
        foreach (var q in registeredQuests) quests.Abandon(q.id);   // unfinished event quests close; rewards stay
        registeredQuests.Clear();
        var ended = Active;
        Active = null;
        ReleaseAll();
        Ended?.Invoke(ended);
    }

    void ReleaseAll()
    {
        foreach (var h in handles) Addressables.Release(h);
        handles.Clear();
    }

    public void Dispose()
    {
        Flags.Changed -= OnFlagsChanged;                       // static event: always unsubscribe
        ReleaseAll();
    }
}
```

The bootstrapper parses the remote config into `LiveEventService.Current` (flag, label, table, start and end times) and calls `Evaluate`. A [scheduled timer](../patterns/timer-scheduler) calls it again at the exact end time, so the event closes even in a long session. `QuestLog.Abandon` and `DownloadPrompt` are small helpers.

Testing: a debug-menu override of the flag, plus a server-time offset, lets QA start and end the event locally without waiting for the calendar.

## Where the patterns meet: pitfalls

- **Device clocks.** Using `DateTime.Now` lets players start events early or extend them by changing their clock. Use server time, and cache the last known offset for offline play.
- **Content without matching code.** A remote event can only use features the installed app already has. Ship event *systems* in app updates well before the event, and keep event *content* remote. Gate the event on a minimum app version.
- **Download at the wrong moment.** Downloading 200 MB on mobile data during a boss fight is a bad surprise. Download from the menu, ask for large downloads, and show progress.
- **Releasing content still in use.** Ending the event while the player rides the event mount releases its assets under them. End at a safe point (a scene load or menu), or keep the mount's assets loaded until the player dismounts.
- **Reward ownership.** Rewards granted during the event must be saved like any other item. Item definitions that live only in the event bundle disappear with it, so ship reward item definitions in the base app.
- **Kill switch speed.** If remote config is only fetched at boot, a kill switch takes effect at the next launch. Poll it periodically during sessions, and make stopping safe at any moment.

## Variations

- **Recurring events:** the same content returns next year with a new date range and content version, without changing code.
- **A/B-tested events:** a percentage rollout flag runs two event variants, and analytics compare them.
- **Global community goals:** event quests whose progress is summed on the server, with rewards for everyone when the goal is reached.
- **Store integration:** event bundles and cosmetics appear in the store only while the flag is on.
