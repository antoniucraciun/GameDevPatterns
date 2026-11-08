// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using UnityEngine;

namespace Page_debug_console
{
    // The game's own player and wallet, left to the reader.
    public class Wallet
    {
        public void Add(int amount) { }
    }

    public class Player : MonoBehaviour
    {
        public static Player Instance;
        public bool Invulnerable;
        public Wallet Wallet;
    }
}
