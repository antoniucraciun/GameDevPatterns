// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_subclass_sandbox
{
    public class SoundCue : ScriptableObject { }
    public interface IAudio { void PlaySfx(SoundCue cue, Vector3 position); }
    public struct DamageInfo { public float Amount; public GameObject Source; public Vector3 Point; }
    public interface IDamageable { void TakeDamage(DamageInfo info); }
    public static class Services { public static T Get<T>() where T : class => null; }
}
