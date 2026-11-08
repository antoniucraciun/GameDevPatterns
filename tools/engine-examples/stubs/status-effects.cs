// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_status_effects
{
    // From the Health / Damageable page (int overload for brevity).
    public class Health : MonoBehaviour { public void TakeDamage(int amount) { } }

    // From the RPG Character Sheet recipe.
    public enum StatType { MoveSpeed }
    public enum ModType { Flat = 100, PercentAdd = 200, PercentMult = 300 }
    public readonly struct StatModifier
    {
        public StatModifier(float value, ModType type, object source, string label) { }
    }
    public class Stat
    {
        public void Add(StatModifier mod) { }
        public void RemoveAllFrom(object source) { }
    }
    public class CharacterStats
    {
        public Stat this[StatType type] => null;
    }
}
