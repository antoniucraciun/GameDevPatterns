# Feature Flags

> Toggle features at build or run time without branching the codebase.

**Category:** Architecture & Structure

## Problem

A new crafting system is half finished, but the main branch must ship a patch next week. Keeping crafting on a long-lived feature branch leads to painful merges. Merging it unfinished exposes it to players. A seasonal event must turn on at a specific date on every platform, without an app-store update. A new matchmaking algorithm should go to 5% of players first, and be switched off instantly if it causes problems. Each of these turns into a different hack: commented-out code, `#if` blocks, a special build.

## Solution

Wrap features in **flags**: named switches that code checks, whose values come from **configuration** rather than code.

- **Code checks the flag**, never the reason: `if (Flags.IsOn(Feature.Crafting))`.
- **Values come from layered sources**, later ones overriding earlier ones:
  1. **Defaults** compiled in (safe: usually off).
  2. **Build configuration**: on in development builds, off in release.
  3. **Remote config**: change values for live players without an update (Unity Remote Config, Firebase, your own server).
  4. **Local overrides**: QA and developers toggle flags in a debug menu.
- **Kinds of flags:**

| Kind | Lifetime | Example |
| --- | --- | --- |
| **Release toggle** | Until the feature ships | Unfinished crafting merged but hidden |
| **Kill switch** | Permanent | Turn off a buggy store or leaderboard instantly |
| **Experiment** | Until the test ends | New tutorial for 50% of new players |
| **Operational** | Permanent | Seasonal events, maintenance mode |

For code that must not even *exist* in a build (cheats, unlicensed SDKs), use compile-time scripting defines instead of runtime flags.

## Example (Unity C#)

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

public enum Feature { Crafting, WinterEvent, NewMatchmaking, Store, PhotoMode }

public static class Flags
{
    static readonly Dictionary<Feature, bool> defaults = new()
    {
        { Feature.Crafting, false },              // release toggle: off until ready
        { Feature.WinterEvent, false },           // operational: switched on remotely
        { Feature.NewMatchmaking, false },        // experiment: rolled out to a percentage
        { Feature.Store, true },                  // kill switch: on, can be turned off remotely
        { Feature.PhotoMode, Debug.isDebugBuild },// build config: dev builds only for now
    };

    static readonly Dictionary<Feature, bool> remote = new();
    static readonly Dictionary<Feature, bool> local = new();   // debug menu overrides
    public static event Action Changed;

    public static bool IsOn(Feature f) =>
        local.TryGetValue(f, out var l) ? l :
        remote.TryGetValue(f, out var r) ? r :
        defaults.TryGetValue(f, out var d) && d;

    // Remote config arrives as name → value (from any provider), plus rollout percentages.
    public static void ApplyRemote(IDictionary<string, string> config, string playerId)
    {
        foreach (var (key, value) in config)
        {
            if (!Enum.TryParse(key, out Feature f)) continue;                   // ignore unknown flags
            if (value.EndsWith("%") && float.TryParse(value.TrimEnd('%'), System.Globalization.NumberStyles.Float,
                                                      System.Globalization.CultureInfo.InvariantCulture, out var pct))
                remote[f] = InRollout(playerId, f, pct);                         // "5%" → stable 5% of players
            else if (bool.TryParse(value, out var on))
                remote[f] = on;
        }
        Changed?.Invoke();
    }

    // A player always lands in the same bucket for a given flag, so they don't flip between sessions.
    static bool InRollout(string playerId, Feature f, float percent)
    {
        uint h = 2166136261;
        foreach (char c in playerId + f) h = (h ^ c) * 16777619;               // FNV-1a: stable across runs
        return h % 10000 < percent * 100f;
    }

    public static void SetLocalOverride(Feature f, bool? value)              // from the debug menu
    {
        if (value.HasValue) local[f] = value.Value; else local.Remove(f);
        Changed?.Invoke();
    }
}

// Code checks intent, not reasons:
// craftingButton.SetActive(Flags.IsOn(Feature.Crafting));
// if (!Flags.IsOn(Feature.Store)) { storeScreen.ShowUnavailable(); return; }
```

The remote values come from whatever config service you use. Fetch them during [boot](./bootstrapper), cache the last known values on disk so offline players get them too, and fall back to defaults if nothing is available. Listen to `Changed` for flags that can change mid-session, or read flags only at safe points (menu, level load).

## When to use

- Merging unfinished work to the main branch continuously, hidden behind release toggles.
- Live games: kill switches for risky systems, timed events, gradual rollouts, A/B tests.
- QA: testing combinations of features without special builds.

## Pitfalls

- **Flag debt.** Release toggles that are never removed leave dead branches and untested combinations. Give each flag an owner and a removal date, and delete it once the feature has shipped.
- **Combinatorial testing.** Ten independent flags means 1,024 combinations. Test the configurations that actually ship, and avoid flags that depend on other flags.
- **Flags read everywhere.** Checking the same flag in 30 places makes removal painful, and makes inconsistent states likely (UI on, logic off). Check at a few entry points, such as showing the button and registering the system.
- **Unsafe defaults.** If remote config fails, defaults apply. Make sure defaults are safe: unfinished features off, kill switches in their normal state.
- **Hidden code still ships.** Runtime flags hide features but leave the code in the build, where dataminers can find it. Use compile-time defines for anything that must not leak.

## Related

- [Data-Driven Design](./data-driven-design) — flags are configuration that designers and live-ops can change.
- [Bootstrapper](./bootstrapper) — fetches remote values before gameplay starts.
- [Debug Console & Cheats](./debug-console) and [Immediate-Mode GUI](./immediate-mode-gui) — debug menus for local overrides.
- [Strategy](./strategy) — flags often choose which strategy implementation to use.
- [Seeded Randomness](./seeded-randomness) — stable hashing puts players in consistent rollout buckets.
