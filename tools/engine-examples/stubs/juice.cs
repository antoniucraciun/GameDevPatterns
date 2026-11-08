// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using UnityEngine;

namespace Page_juice
{
    // From the Screen Shake page.
    public class TraumaShake : MonoBehaviour
    {
        public static TraumaShake Instance { get; private set; }
        public void AddTrauma(float amount) { }
    }

    // From the Hit Stop page.
    public class HitStop : MonoBehaviour
    {
        public static HitStop Instance { get; private set; }
        public void Trigger(float duration, float scale = 0f) { }
    }

    // From the Event Queue page.
    public class AudioQueue : MonoBehaviour
    {
        public static AudioQueue Instance { get; private set; }
        public void Request(AudioClip clip, Vector3 position, float volume) { }
    }

    // From the Tweening page.
    public static class Ease
    {
        public static float OutElastic(float t) => t;
    }

    public class Tweener : MonoBehaviour
    {
        public static void Run(object owner, float duration, Func<float, float> ease, Action<float> apply,
                               Action onComplete = null, bool unscaled = false) { }
    }
}
