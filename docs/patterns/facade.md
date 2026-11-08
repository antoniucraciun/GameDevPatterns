# Facade

> Hide a complicated subsystem (audio, save, analytics) behind one simple interface.

**Category:** Architecture & Structure

## Problem

Playing a sound "properly" involves: picking a pooled audio player, routing it to the right mixer group, randomising pitch, choosing one of several clip variants, setting 2D or 3D spatial settings, respecting the player's volume settings, ducking music during dialogue, and returning the source to the pool afterwards. Every gameplay script that wants a sound repeats some of these steps and gets others wrong. Swapping Unity audio for FMOD or Wwise later would touch hundreds of files.

## Solution

Put a **facade** in front of the subsystem: a small, task-oriented interface that does the right thing internally.

- Callers use **intent-level methods**: `Audio.PlaySfx(cue, position)`, `Audio.PlayMusic(track)`, `Audio.DuckMusic(true)`.
- The facade coordinates the subsystem's many parts (pools, mixers, settings, spatialisation) in one place.
- The subsystem's details stay **hidden**. The rest of the game cannot couple to them, so they can change, or be replaced, without touching callers.

A facade does not stop advanced code from using the subsystem directly when it really needs to. It makes the **common case simple and correct**.

## Pseudocode

```text
// Data: what a sound is, not how to play it.
SoundCue:
    variants, mixer_group, volume, pitch_variation, spatial

// The facade: four intent-level calls over pools, mixers and fades.
Audio:
    sfx_pool                       // reusable sound players
    music_a, music_b               // two players, so tracks can crossfade
    current_music ← music_a

    play_sfx(cue, position):  play(cue, position, cue.spatial)
    play_ui(cue):             play(cue, nowhere, spatial = false)

    play(cue, position, spatial):
        if cue has no variants: return
        player ← take one from sfx_pool
        put player at position
        player plays a random variant, through cue.mixer_group,
            at cue.volume, pitch 1 ± random(cue.pitch_variation),
            3D if spatial, otherwise 2D
        when player finishes: return it to sfx_pool

    play_music(track, fade_seconds):
        next ← whichever of music_a, music_b is not current_music
        next starts track at volume 0
        over fade_seconds: raise next to full, lower current_music to 0
        then stop current_music
        current_music ← next

    duck_music(duck):
        music mixer volume ← -10 dB if duck, else 0 dB

// Gameplay sees only this:
Audio.play_sfx(footstep_cue, player position)
Audio.play_music(boss_theme)
```

## Example

An audio facade: one small API for gameplay (play a sound here, play this music, duck the music) over pooling, mixer routing, variation, spatialisation and crossfades.

::: code-group

```csharp [Unity (C#)]
using System.Collections;
using UnityEngine;
using UnityEngine.Audio;
using UnityEngine.Pool;

[CreateAssetMenu(menuName = "Audio/Sound Cue")]
public class SoundCue : ScriptableObject          // data: what a sound is, not how to play it
{
    public AudioClip[] variants;
    public AudioMixerGroup group;
    [Range(0f, 1f)] public float volume = 1f;
    [Range(0f, 0.3f)] public float pitchVariation = 0.05f;
    public bool spatial = true;
}

public interface IAudio
{
    void PlaySfx(SoundCue cue, Vector3 position);
    void PlayUi(SoundCue cue);
    void PlayMusic(AudioClip track, float fadeSeconds = 1.5f);
    void DuckMusic(bool duck);
}

// The facade: one simple API over pooling, mixers, variation, spatialisation and crossfades.
public class AudioFacade : MonoBehaviour, IAudio
{
    [SerializeField] AudioMixer mixer;
    [SerializeField] AudioSource musicA, musicB;      // two sources for crossfading

    ObjectPool<AudioSource> sfxPool;
    AudioSource currentMusic;

    void Awake()
    {
        sfxPool = new ObjectPool<AudioSource>(
            () => new GameObject("Sfx").AddComponent<AudioSource>(),
            s => s.gameObject.SetActive(true),
            s => s.gameObject.SetActive(false),
            s => Destroy(s.gameObject), maxSize: 64);
        currentMusic = musicA;
    }

    public void PlaySfx(SoundCue cue, Vector3 position) => Play(cue, position, spatial: cue.spatial);
    public void PlayUi(SoundCue cue) => Play(cue, Vector3.zero, spatial: false);

    void Play(SoundCue cue, Vector3 position, bool spatial)
    {
        if (cue.variants.Length == 0) return;
        var src = sfxPool.Get();
        src.transform.position = position;
        src.clip = cue.variants[Random.Range(0, cue.variants.Length)];
        src.outputAudioMixerGroup = cue.group;
        src.volume = cue.volume;
        src.pitch = 1f + Random.Range(-cue.pitchVariation, cue.pitchVariation);
        src.spatialBlend = spatial ? 1f : 0f;
        src.Play();
        StartCoroutine(ReleaseWhenDone(src));
    }

    IEnumerator ReleaseWhenDone(AudioSource src)
    {
        yield return new WaitWhile(() => src.isPlaying);
        sfxPool.Release(src);
    }

    public void PlayMusic(AudioClip track, float fadeSeconds = 1.5f)
    {
        var next = currentMusic == musicA ? musicB : musicA;
        next.clip = track;
        next.volume = 0f;
        next.Play();
        StartCoroutine(Crossfade(currentMusic, next, fadeSeconds));
        currentMusic = next;
    }

    IEnumerator Crossfade(AudioSource from, AudioSource to, float seconds)
    {
        for (float t = 0f; t < 1f; t += Time.unscaledDeltaTime / seconds)
        {
            from.volume = 1f - t;
            to.volume = t;
            yield return null;
        }
        from.Stop();
        to.volume = 1f;
    }

    public void DuckMusic(bool duck) => mixer.SetFloat("MusicVolume", duck ? -10f : 0f);
}

// Gameplay code: one line, always correct.
//   audio.PlaySfx(footstepCue, transform.position);
//   audio.PlayMusic(bossTheme);
```

```gdscript [Godot (GDScript)]
# sound_cue.gd: data, what a sound is, not how to play it.
class_name SoundCue
extends Resource

@export var variants: Array[AudioStream] = []
@export var bus := &"SFX"
@export_range(-40.0, 6.0) var volume_db := 0.0
@export_range(0.0, 0.3) var pitch_variation := 0.05
@export var spatial := true


# audio.gd: autoload named Audio. The facade over players, buses, variation and crossfades.
extends Node

const POOL_SIZE := 32

var _pool_3d: Array[AudioStreamPlayer3D] = []
var _pool_ui: Array[AudioStreamPlayer] = []
var _music_a := AudioStreamPlayer.new()
var _music_b := AudioStreamPlayer.new()
var _current_music: AudioStreamPlayer


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS  # music and UI sounds keep playing while paused
	for i in POOL_SIZE:
		var p3 := AudioStreamPlayer3D.new()
		add_child(p3)
		_pool_3d.append(p3)
		var p := AudioStreamPlayer.new()
		add_child(p)
		_pool_ui.append(p)
	for m in [_music_a, _music_b]:
		m.bus = &"Music"
		add_child(m)
	_current_music = _music_a


func play_sfx(cue: SoundCue, position: Vector3) -> void:
	if not cue.spatial:
		play_ui(cue)  # non-spatial cues play in 2D
		return
	if cue.variants.is_empty():
		return
	var player := _free_player(_pool_3d) as AudioStreamPlayer3D
	if player == null:
		return  # all voices busy: drop the sound rather than cut another
	player.global_position = position
	_start(player, cue)


func play_ui(cue: SoundCue) -> void:
	var player := _free_player(_pool_ui) as AudioStreamPlayer
	if player and not cue.variants.is_empty():
		_start(player, cue)


func play_music(track: AudioStream, fade_seconds := 1.5) -> void:
	var next := _music_b if _current_music == _music_a else _music_a
	next.stream = track
	next.volume_db = -80.0
	next.play()
	var tween := create_tween().set_parallel()
	tween.tween_property(next, "volume_db", 0.0, fade_seconds)
	tween.tween_property(_current_music, "volume_db", -80.0, fade_seconds)
	tween.chain().tween_callback(_current_music.stop)
	_current_music = next


func duck_music(duck: bool) -> void:
	AudioServer.set_bus_volume_db(AudioServer.get_bus_index(&"Music"), -10.0 if duck else 0.0)


func _start(player: Node, cue: SoundCue) -> void:
	player.stream = cue.variants.pick_random()
	player.bus = cue.bus
	player.volume_db = cue.volume_db
	player.pitch_scale = 1.0 + randf_range(-cue.pitch_variation, cue.pitch_variation)
	player.play()


func _free_player(pool: Array) -> Node:
	for p in pool:
		if not p.playing:
			return p
	return null

# Gameplay code: one line, always correct.
#   Audio.play_sfx(footstep_cue, global_position)
#   Audio.play_music(boss_theme)
```

```cpp [Unreal (C++)]
// AudioFacadeSubsystem.h: Unreal already has variation (Sound Cues / MetaSounds), mixing
// (Sound Classes, Submixes) and fades (UAudioComponent). The facade hides those choices behind
// four calls so gameplay never sees them.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Components/AudioComponent.h"
#include "Kismet/GameplayStatics.h"
#include "Sound/SoundMix.h"
#include "AudioFacadeSubsystem.generated.h"

UCLASS()
class UAudioFacadeSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	// Concurrency settings on the sound asset limit voices, like a pool size.
	void PlaySfx(USoundBase* Sound, const FVector& Location)
	{
		UGameplayStatics::PlaySoundAtLocation(GetWorld(), Sound, Location);
	}

	void PlayUi(USoundBase* Sound) { UGameplayStatics::PlaySound2D(GetWorld(), Sound); }

	void PlayMusic(USoundBase* Track, float FadeSeconds = 1.5f)
	{
		if (CurrentMusic) CurrentMusic->FadeOut(FadeSeconds, 0.f);   // the old track stops when faded out
		CurrentMusic = UGameplayStatics::CreateSound2D(GetGameInstance(), Track, 1.f, 1.f, 0.f, nullptr,
			/*bPersistAcrossLevelTransition*/ true);
		CurrentMusic->FadeIn(FadeSeconds);
	}

	void DuckMusic(bool bDuck)
	{
		// A Sound Mix that lowers the Music sound class, authored in the editor.
		if (bDuck) UGameplayStatics::PushSoundMixModifier(GetWorld(), DuckMix);
		else UGameplayStatics::PopSoundMixModifier(GetWorld(), DuckMix);
	}

	UPROPERTY() TObjectPtr<USoundMix> DuckMix;   // assigned from project settings or a data asset

private:
	UPROPERTY() TObjectPtr<UAudioComponent> CurrentMusic;
};

// Gameplay code: one line, always correct.
//   GetGameInstance()->GetSubsystem<UAudioFacadeSubsystem>()->PlaySfx(FootstepSound, GetActorLocation());
```

:::

Callers depend on the facade (in Unity through `IAudio`, obtained via a [Service Locator](./service-locator) or [Dependency Injection](./dependency-injection)). Replacing the engine's audio with FMOD or Wwise means writing a new facade, and nothing else changes.

**Engine notes**

- **Unity:** the mixer's `MusicVolume` must be an **exposed parameter** on the mixer for `SetFloat` to work.
- **Godot:** set up the `SFX` and `Music` buses in the Audio panel. `AudioStreamRandomizer` can also handle variants and pitch inside a single stream.
- **Unreal:** most of what the Unity and Godot facades implement is configuration in Unreal (Sound Cues or MetaSounds for variation, Sound Concurrency for voice limits, Sound Mixes for ducking). The facade's value is the small, stable API in front of it.

## When to use

- Subsystems with many moving parts that most callers use in the same few ways: audio, saving, analytics, platform services, input rumble, haptics.
- Third-party middleware you may replace later.
- Onboarding: new team members learn five facade methods, not the whole subsystem.

## When not to use

- Subsystems that are already simple, or that callers use in many different ways. The facade either duplicates the API or becomes a bottleneck that blocks needed features.
- Wrapping the engine's own APIs "just in case". Its audio and scene-loading APIs are stable; wrap them only when you need extra behaviour or a test seam.
- As a way to hide a messy subsystem you should actually fix.

## Pitfalls

- **The facade becomes a god object.** If every feature adds a method, the facade grows into the whole subsystem again. Keep it to common tasks, and split by area (music, SFX, voice).
- **Leaky facades.** Methods that expose subsystem types (`AudioMixerGroup` parameters everywhere) couple callers to the implementation anyway. Use your own types, such as cue assets, at the boundary.
- **Blocking advanced use.** Some callers need fine control (a dynamic engine sound). Let them use the subsystem directly, or add a lower-level handle API, rather than bending the facade.
- **Hidden cost.** A one-line call might do a lot (allocate, start coroutines). Document performance-relevant behaviour.

## Related

- [Adapter](./adapter) — makes an existing interface fit another one. A facade simplifies a whole subsystem.
- [Service Locator](./service-locator) and [Dependency Injection](./dependency-injection) — how callers get the facade.
- [Object Pool](./object-pool) — what this facade uses internally.
- [Event Queue](./event-queue) — an audio facade often queues and merges requests.
