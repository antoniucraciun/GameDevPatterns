// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_damage_pipeline
{
    // From the Health / Damageable page.
    public enum DamageType { Physical, Fire, Ice, Poison, True }
    public struct DamageInfo
    {
        public float Amount;
        public DamageType Type;
        public GameObject Source;
        public Vector3 Point;
        public bool IsCritical;
    }
    public interface IDamageable { bool IsAlive { get; } void TakeDamage(DamageInfo info); }
    public class Health : MonoBehaviour
    {
        public bool IsAlive => true;
        public void TakeDamage(DamageInfo info) { }
    }

    // From the Status Effects page.
    public class StatusEffectContainer : MonoBehaviour { public bool HasTag(string tag) => false; }

    // From the Stat & Modifier System page.
    public class Stat { public float Value => 0f; }
}
