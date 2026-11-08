// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_checkpoint
{
    // From the Health / Damageable page.
    public class Health : MonoBehaviour
    {
        public float Current => 0f;
        public float Max => 1f;
        public void Revive(float fraction = 1f) { }
    }
}
