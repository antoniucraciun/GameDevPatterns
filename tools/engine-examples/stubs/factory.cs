// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_factory
{
    public interface IAnalytics { }
    public class DifficultySettings { public float HealthMultiplier; }
    public class EnemyType : ScriptableObject { public GameObject Prefab; }
    public class Enemy : MonoBehaviour
    {
        public EnemyType Type;
        public void Init(EnemyType type, float healthMultiplier) { }
        public void Construct(IAnalytics analytics) { }
    }
    public static class EnemyRegistry { public static void Add(Enemy e) { } public static void Remove(Enemy e) { } }
    public class Button { }
    public class Panel { }
}
