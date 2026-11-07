// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_influence_map
{
    public class Unit : MonoBehaviour
    {
        public static readonly List<Unit> All = new();
        public bool IsEnemyOfPlayerTeam;
        public float CombatPower;
        public float ThreatRadius;
    }
}
