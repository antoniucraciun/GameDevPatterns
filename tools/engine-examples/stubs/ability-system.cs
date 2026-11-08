// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_ability_system
{
    // From the Health / Damageable page (int overloads for brevity).
    public class Health : MonoBehaviour { public void TakeDamage(int amount) { } public void Heal(int amount) { } }

    // From the Status Effects page.
    public class StatusEffectDefinition : ScriptableObject { }
    public class StatusEffectContainer : MonoBehaviour
    {
        public void Apply(StatusEffectDefinition def, object source) { }
        public bool HasTag(string tag) => false;
    }
}
