// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using UnityEngine;

namespace Page_authoritative_server
{
    // The server's simulation objects, left to the reader.
    public class Weapon
    {
        public float ReadyAt, Cooldown, Range, Damage;
    }

    public class ItemDefinition { }

    public class Inventory
    {
        public bool TryAdd(ItemDefinition item, int count) => true;
    }

    public class ShopItem
    {
        public int Price;
        public ItemDefinition Definition;
    }

    public class Shop
    {
        public ShopItem Find(int itemId) => null;
    }

    public class ServerPlayer
    {
        public bool IsAlive;
        public Weapon[] Weapons;
        public Vector3 EyePosition, CenterPosition, Position;
        public float Health, MoveSpeed;
        public int Gold;
        public Inventory Inventory;
    }

    public readonly struct HitEvent
    {
        public HitEvent(int shooterId, int targetId, float damage) { }
    }

    public class ServerWorld
    {
        public float Time;
        public Shop Shop;
        public bool TryGetPlayer(int id, out ServerPlayer player) { player = null; return false; }
        public bool Raycast(Vector3 from, Vector3 to, out RaycastHit hit) { hit = default; return false; }
        public void Broadcast(HitEvent e) { }
        public Vector3 MoveWithCollisions(Vector3 position, Vector3 delta) => position + delta;
    }
}
