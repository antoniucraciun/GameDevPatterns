# Facade

> Hide a complicated subsystem (audio, save, analytics) behind one simple interface.

**Category:** Architecture & Structure

## Problem

Playing a sound "properly" involves: picking a pooled `AudioSource`, routing it to the right mixer group, randomising pitch, choosing one of several clip variants, setting 2D or 3D spatial settings, respecting the player's volume settings, ducking music during dialogue, and returning the source to the pool afterwards. Every gameplay script that wants a sound repeats some of these steps and gets others wrong. Swapping Unity audio for FMOD or Wwise later would touch hundreds of files.

## Solution

Put a **facade** in front of the subsystem: a small, task-oriented interface that does the right thing internally.

- Callers use **intent-level methods**: `Audio.PlaySfx(cue, position)`, `Audio.PlayMusic(track)`, `Audio.DuckMusic(true)`.
- The facade coordinates the subsystem's many parts (pools, mixers, settings, spatialisation) in one place.
- The subsystem's details stay **hidden**. The rest of the game cannot couple to them, so they can change, or be replaced, without touching callers.

A facade does not stop advanced code from using the subsystem directly when it really needs to. It makes the **common case simple and correct**.

## Example (Unity C#)

```csharp
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
// audio.PlaySfx(footstepCue, transform.position);
// audio.PlayMusic(bossTheme);
```

Callers depend on `IAudio`, obtained through a [Service Locator](./service-locator) or [Dependency Injection](./dependency-injection). Replacing Unity audio with FMOD means writing an `FmodAudioFacade : IAudio`, and nothing else changes.

## When to use

- Subsystems with many moving parts that most callers use in the same few ways: audio, saving, analytics, platform services, input rumble, haptics.
- Third-party middleware you may replace later.
- Onboarding: new team members learn five facade methods, not the whole subsystem.

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
