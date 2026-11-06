# Automated Playtesting

> Bots and scripted inputs that play the game to catch regressions.

**Category:** Tooling, Debugging & Testing

## Problem

A change to the jump code makes level 4 impossible to finish, and nobody notices for two weeks. A refactor breaks loading of one scene that QA does not visit. Performance drops by 30% in the city level after a lighting change. Unit tests cover pure logic, such as damage formulas and inventories, but games mostly break in the *interactions*: physics, timing, scene setup, content. Manual playtesting cannot replay every level after every commit.

## Solution

Let the game play itself, automatically and repeatably, and check the outcome. There are several levels of automation, from cheapest to richest:

| Test | What it does | Catches |
| --- | --- | --- |
| **Smoke test** | Load every scene, run a few seconds, fail on errors or exceptions | Missing references, broken scenes, startup crashes |
| **Scripted bot** | Feed recorded or scripted inputs through the input layer | Movement, physics and level regressions ("can still reach the exit") |
| **Replay test** | Replay a recorded session and compare checksums or end state | Any change in deterministic behaviour |
| **Monkey test** | Random inputs for minutes, fail on exceptions or stuck states | Crashes, soft-locks, unhandled edge cases |
| **Performance test** | Fly a camera along a path, record frame times | Performance regressions per level |

Two design decisions make this possible:
- **Input goes through an abstraction**, so a bot can drive the player exactly as a person would. See [Input Abstraction](./input-abstraction).
- **Tests run in CI**, in batch mode, on every change, and fail the build.

## Example (Unity C#)

Unity Test Framework **Play Mode** tests. A smoke test that loads every scene and fails on any logged error:

```csharp
using System.Collections;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

public class SceneSmokeTests
{
    static IEnumerable<string> AllScenes()
    {
        for (int i = 0; i < SceneManager.sceneCountInBuildSettings; i++)
            yield return System.IO.Path.GetFileNameWithoutExtension(SceneUtility.GetScenePathByBuildIndex(i));
    }

    [UnityTest]
    public IEnumerator SceneLoadsAndRunsWithoutErrors([ValueSource(nameof(AllScenes))] string scene)
    {
        yield return SceneManager.LoadSceneAsync(scene);
        float end = Time.time + 3f;
        while (Time.time < end) yield return null;   // run the scene for a few seconds
        // Any Debug.LogError or exception during the test fails it automatically
        // (LogAssert); nothing else to check.
    }
}
```

A scripted bot that drives the real player controller through the input interface:

```csharp
public class ScriptedInput : ICharacterInput          // from the Input Abstraction page
{
    readonly (float until, Vector2 move, bool jump)[] script;   // "until" = seconds since the script started
    readonly float start;
    int lastJumpStep = -1;

    public ScriptedInput(params (float, Vector2, bool)[] script)
    {
        this.script = script;
        start = Time.time;
    }

    int StepIndex()
    {
        float t = Time.time - start;
        for (int i = 0; i < script.Length; i++) if (t < script[i].until) return i;
        return -1;                                              // script finished: no input
    }

    public Vector2 Move { get { int i = StepIndex(); return i < 0 ? Vector2.zero : script[i].move; } }

    // A jump step presses Jump on its first frame only, like a real button press.
    public bool JumpPressed
    {
        get
        {
            int i = StepIndex();
            if (i < 0 || !script[i].jump || i == lastJumpStep) return false;
            lastJumpStep = i;
            return true;
        }
    }

    public bool AttackHeld => false;
}

public class Level1Tests
{
    [UnityTest]
    public IEnumerator BotCanReachTheFirstGoal()
    {
        yield return SceneManager.LoadSceneAsync("Level1");
        var player = Object.FindFirstObjectByType<CharacterMotor>();
        var goal = GameObject.Find("Goal_A").transform;

        player.Input = new ScriptedInput(
            (2.0f, Vector2.right, false),        // run right for 2 s
            (2.2f, Vector2.right, true),         // jump over the gap
            (5.0f, Vector2.right, false));       // keep running

        float timeout = Time.time + 8f;
        while (Time.time < timeout && Vector3.Distance(player.transform.position, goal.position) > 1f)
            yield return null;

        Assert.Less(Vector3.Distance(player.transform.position, goal.position), 1f,
                    "The bot no longer reaches the first goal: did movement, physics or level layout change?");
    }
}
```

A monkey test that mashes random inputs and fails if the game throws or the player gets stuck:

```csharp
public class MonkeyTests
{
    class RandomInput : ICharacterInput
    {
        readonly System.Random rng = new(12345);          // seeded: failures can be reproduced
        public Vector2 Move => new((float)rng.NextDouble() * 2f - 1f, (float)rng.NextDouble() * 2f - 1f);
        public bool JumpPressed => rng.NextDouble() < 0.05;
        public bool AttackHeld => rng.NextDouble() < 0.3;
    }

    [UnityTest, Timeout(180000)]
    public IEnumerator TwoMinutesOfRandomInputDoesNotBreakTheGame()
    {
        yield return SceneManager.LoadSceneAsync("Level1");
        var player = Object.FindFirstObjectByType<CharacterMotor>();
        player.Input = new RandomInput();

        float end = Time.time + 120f;
        while (Time.time < end)
        {
            Assert.Greater(player.transform.position.y, -100f, "Player fell out of the world");
            yield return null;
        }
    }
}
```

Run them from the command line in CI:

```bash
Unity -batchmode -projectPath . -runTests -testPlatform PlayMode -testResults results.xml
```

## When to use

- Any project past the prototype stage, starting with smoke tests, which take an hour to set up and catch the most embarrassing breakages.
- Games with levels, where content changes can break progression.
- Projects with deterministic simulation, where replays give complete regression tests for free.

## Pitfalls

- **Flaky tests.** Tests depending on frame timing, unseeded randomness or physics differences fail randomly, and people start ignoring them. Seed randomness, use generous timeouts, and keep inputs on a fixed step where possible.
- **Brittle scripted bots.** A bot scripted with exact timings breaks with every small level tweak. Prefer goal-based bots (navigate to X using the navmesh) for long paths, and scripted inputs only for short, precise checks.
- **Tests that are too slow.** Running every level for minutes on every commit slows everyone down. Run smoke tests on every commit, and long bot and monkey runs nightly.
- **Testing through the UI.** Clicking menus by screen position breaks with any layout change. Drive the game through its APIs (state manager, scene loader), and test UI separately.
- **No one looks at failures.** Automated tests only help if failures stop the build and are fixed quickly. Make CI red when they fail.

## Related

- [Input Abstraction](./input-abstraction) — lets bots drive the same controller as players.
- [Replay System](./replay-system) and [Determinism](./determinism) — replays as regression tests.
- [Seeded Randomness](./seeded-randomness) — reproducible bot and monkey runs.
- [Debug Console & Cheats](./debug-console) — tests can use cheats to set up situations quickly.
- [Bootstrapper](./bootstrapper) — tests need the game's services initialised, just like a normal run.
