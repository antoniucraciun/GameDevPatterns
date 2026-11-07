// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_builder
{
    public class WeaponBase : ScriptableObject { public float BaseDamage; public string DisplayName; }
    public class Affix : ScriptableObject { public bool IsPrefix; public string Text; public float ModifyDamage(float d) => d; }
    public class AffixTable : ScriptableObject { public Affix Roll(System.Random rng, int level, List<Affix> exclude) => null; }
}
