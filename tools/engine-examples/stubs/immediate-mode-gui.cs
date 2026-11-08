// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
// The snippets are inside #if UNITY_EDITOR / DEVELOPMENT_BUILD, so these are used only when those are defined.
using System.Collections.Generic;
using UnityEngine;

namespace Page_immediate_mode_gui
{
    // Left to the reader: the game's own classes.
    public class PlayerStats : MonoBehaviour
    {
        public float Health, MaxHealth, MoveSpeed, JumpHeight;
        public bool GodMode;
    }

    public class Enemy : MonoBehaviour
    {
        public string State;
        public float Health;
    }

    public class EnemySpawner : MonoBehaviour
    {
        public List<Enemy> Alive = new();
        public void Spawn(int count) { }
        public void KillAll() { }
    }
}
