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

## Example

Each engine's own test runner: the **Unity Test Framework** (Play Mode tests), **GUT** in Godot (an add-on; GdUnit4 is similar), and Unreal's **Functional Tests**, actors placed in a test map that the Automation system finds and runs.

A smoke test that loads each scene and runs it for a few seconds, failing on errors:

::: code-group

```csharp [Unity (C#)]
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

```gdscript [Godot (GDScript)]
# test/test_scene_smoke.gd
extends GutTest

const SCENES := [
	"res://levels/level_1.tscn",
	"res://levels/level_2.tscn",
	"res://ui/main_menu.tscn",
]


# One test run per scene path.
func test_scene_loads_and_runs(scene_path = use_parameters(SCENES)) -> void:
	var packed: PackedScene = load(scene_path)
	assert_not_null(packed, "scene loads")
	var scene := packed.instantiate()
	add_child_autofree(scene)
	await wait_seconds(3.0)  # run the scene for a few seconds
	assert_true(is_instance_valid(scene) and scene.is_inside_tree(), "scene still running")
```

```cpp [Unreal (C++)]
// SmokeTest.h: place one in each map. "Project.Functional Tests" in the Automation tab (or the
// command line) runs every map that contains a functional test. Errors logged during a test fail it.
#pragma once

#include "CoreMinimal.h"
#include "FunctionalTest.h"                               // module dependency: "FunctionalTesting"
#include "SmokeTest.generated.h"

UCLASS()
class ASmokeTest : public AFunctionalTest
{
	GENERATED_BODY()

public:
	ASmokeTest() { TimeLimit = 10.f; }                    // fail if it hasn't finished by then

protected:
	virtual void StartTest() override
	{
		Super::StartTest();
		GetWorldTimerManager().SetTimer(RunTimer, [this]  // run the map for a few seconds
		{
			FinishTest(EFunctionalTestResult::Succeeded, TEXT("Ran for 3 seconds"));
		}, 3.f, false);
	}

private:
	FTimerHandle RunTimer;
};
```

:::

A scripted bot that drives the real player controller through its input:

::: code-group

```csharp [Unity (C#)]
using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

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
        var player = Object.FindAnyObjectByType<CharacterMotor>();
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

```gdscript [Godot (GDScript)]
# test/test_level_1.gd: presses the same input actions a player would, so the real controller runs.
extends GutTest


func after_each() -> void:
	for action in ["move_right", "jump"]:
		Input.action_release(action)


func test_bot_can_reach_the_first_goal() -> void:
	var packed: PackedScene = load("res://levels/level_1.tscn")
	var level := packed.instantiate()
	add_child_autofree(level)
	var player: Node3D = level.get_node("Player")
	var goal: Node3D = level.get_node("Goal_A")

	Input.action_press("move_right")  # run right for 2 s
	await wait_seconds(2.0)
	Input.action_press("jump")  # jump over the gap
	await wait_seconds(0.2)
	Input.action_release("jump")  # and keep running

	var timeout := Time.get_ticks_msec() + 6000
	while Time.get_ticks_msec() < timeout and player.global_position.distance_to(goal.global_position) > 1.0:
		await get_tree().physics_frame

	assert_lt(player.global_position.distance_to(goal.global_position), 1.0,
			"The bot no longer reaches the first goal: did movement, physics or level layout change?")
```

```cpp [Unreal (C++)]
// ReachGoalTest.h: placed in Level1 next to the player start, with Goal set to the goal actor.
#pragma once

#include "CoreMinimal.h"
#include "FunctionalTest.h"
#include "GameFramework/Character.h"
#include "Kismet/GameplayStatics.h"
#include "ReachGoalTest.generated.h"

UCLASS()
class AReachGoalTest : public AFunctionalTest
{
	GENERATED_BODY()

public:
	AReachGoalTest()
	{
		PrimaryActorTick.bCanEverTick = true;
		TimeLimit = 8.f;                                  // running out of time fails the test
	}

	UPROPERTY(EditInstanceOnly)
	TObjectPtr<AActor> Goal;

protected:
	virtual void StartTest() override
	{
		Super::StartTest();
		StartTime = GetWorld()->GetTimeSeconds();
	}

	virtual void Tick(float DeltaSeconds) override
	{
		Super::Tick(DeltaSeconds);
		ACharacter* Player = UGameplayStatics::GetPlayerCharacter(this, 0);
		if (!IsRunning() || !Player || !Goal) return;

		// The same calls the player's input handlers make, so the real movement code runs.
		const double Elapsed = GetWorld()->GetTimeSeconds() - StartTime;
		Player->AddMovementInput(FVector::RightVector, 1.f);   // keep running right
		if (Elapsed >= 2.0 && !bJumped)                       // jump over the gap
		{
			Player->Jump();
			bJumped = true;
		}

		if (FVector::Dist(Player->GetActorLocation(), Goal->GetActorLocation()) < 100.f)
			FinishTest(EFunctionalTestResult::Succeeded, TEXT("Reached the first goal"));
	}

private:
	double StartTime = 0.0;
	bool bJumped = false;
};
```

:::

A monkey test that mashes random inputs and fails if the game throws or the player falls out of the world:

::: code-group

```csharp [Unity (C#)]
using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

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
        var player = Object.FindAnyObjectByType<CharacterMotor>();
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

```gdscript [Godot (GDScript)]
# test/test_monkey.gd
extends GutTest

const ACTIONS := ["move_left", "move_right", "jump", "attack"]


func after_each() -> void:
	for action in ACTIONS:
		Input.action_release(action)


func test_two_minutes_of_random_input_does_not_break_the_game() -> void:
	var packed: PackedScene = load("res://levels/level_1.tscn")
	var level := packed.instantiate()
	add_child_autofree(level)
	var player: Node3D = level.get_node("Player")
	var rng := RandomNumberGenerator.new()
	rng.seed = 12345  # seeded: failures can be reproduced

	var end := Time.get_ticks_msec() + 120_000
	while Time.get_ticks_msec() < end:
		for action in ACTIONS:
			if rng.randf() < 0.1:  # toggle each action now and then
				if Input.is_action_pressed(action):
					Input.action_release(action)
				else:
					Input.action_press(action)
		await get_tree().physics_frame
		if player.global_position.y < -100.0:
			fail_test("Player fell out of the world")
			return
	pass_test("Survived two minutes of random input")
```

```cpp [Unreal (C++)]
// MonkeyTest.h
#pragma once

#include "CoreMinimal.h"
#include "FunctionalTest.h"
#include "GameFramework/Character.h"
#include "Kismet/GameplayStatics.h"
#include "MonkeyTest.generated.h"

UCLASS()
class AMonkeyTest : public AFunctionalTest
{
	GENERATED_BODY()

public:
	AMonkeyTest()
	{
		PrimaryActorTick.bCanEverTick = true;
		TimeLimit = 130.f;
	}

protected:
	virtual void StartTest() override
	{
		Super::StartTest();
		Random.Initialize(12345);                         // seeded: failures can be reproduced
		EndTime = GetWorld()->GetTimeSeconds() + 120.0;
	}

	virtual void Tick(float DeltaSeconds) override
	{
		Super::Tick(DeltaSeconds);
		ACharacter* Player = UGameplayStatics::GetPlayerCharacter(this, 0);
		if (!IsRunning() || !Player) return;

		Player->AddMovementInput(FVector(Random.FRandRange(-1.f, 1.f), Random.FRandRange(-1.f, 1.f), 0.f));
		if (Random.FRand() < 0.05f) Player->Jump();

		if (Player->GetActorLocation().Z < -10000.f)
			FinishTest(EFunctionalTestResult::Failed, TEXT("Player fell out of the world"));
		else if (GetWorld()->GetTimeSeconds() >= EndTime)
			FinishTest(EFunctionalTestResult::Succeeded, TEXT("Survived two minutes of random input"));
	}

private:
	FRandomStream Random;
	double EndTime = 0.0;
};
```

:::

Run them from the command line in CI:

```bash
# Unity: Play Mode tests
Unity -batchmode -projectPath . -runTests -testPlatform PlayMode -testResults results.xml

# Godot: every GUT test under res://test, then quit
godot --headless -s addons/gut/gut_cmdln.gd -gdir=res://test -gexit

# Unreal: every functional test map, without rendering
UnrealEditor-Cmd MyGame.uproject -ExecCmds="Automation RunTests Project.Functional; Quit" -unattended -nullrhi -ReportExportPath=TestReport
```

**Engine notes**

- **Unity:** The Unity Test Framework package (`com.unity.test-framework`) provides `[UnityTest]` coroutine tests and `LogAssert`; any unexpected `Debug.LogError` or exception fails the test. The bot and monkey tests drive the controller through the `ICharacterInput` interface from [Input Abstraction](./input-abstraction). With the Input System, `InputTestFixture` can simulate real devices instead.
- **Godot:** GUT and GdUnit4 are add-ons, installed from the Asset Library. `Input.action_press` sets action state for `Input.is_action_pressed` / `get_vector`, but sends no `InputEvent`, so code in `_input` / `_unhandled_input` doesn't see it; for that, use `Input.parse_input_event` with an `InputEventAction`. Whether `push_error` and engine errors fail a test depends on the add-on and its version, so check the run's error output in CI too.
- **Unreal:** Functional tests need the **FunctionalTesting** module, and appear under *Project > Functional Tests* in the Session Frontend's Automation tab. For logic without a world, use `IMPLEMENT_SIMPLE_AUTOMATION_TEST` (see [Determinism](./determinism)). **Gauntlet** runs tests on packaged builds and devices, including multiplayer sessions with several clients.

## When to use

- Any project past the prototype stage, starting with smoke tests, which take an hour to set up and catch the most embarrassing breakages.
- Games with levels, where content changes can break progression.
- Projects with deterministic simulation, where replays give complete regression tests for free.

## When not to use

- Game jams and very early prototypes, when everything changes daily.
- Testing whether the game is fun. Bots find breakages and regressions, not boredom.

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
