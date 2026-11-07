// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_director_ai
{
    public struct DamageInfo { public float Amount; }

    public class Health : MonoBehaviour
    {
        public event Action<DamageInfo> Damaged;
        public float Max;
        public float Fraction;
    }

    public class DirectorSpawner : MonoBehaviour
    {
        public int EnemiesNear(Vector3 position, float radius) => 0;
        public float SpendBudget(float available) => 0f;
        public void MaybeDropSupplies(Vector3 near) { }
    }
}
