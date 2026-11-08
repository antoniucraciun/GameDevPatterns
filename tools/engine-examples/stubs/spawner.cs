// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_spawner
{
    // From the Type Object page.
    public class EnemyType : ScriptableObject { public Enemy Spawn(Vector3 position) => null; }
    public class Enemy : MonoBehaviour { public event Action<Enemy> Died; }
}
