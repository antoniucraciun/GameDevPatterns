// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_dependency_injection
{
    public class Wallet : IWallet { public Wallet(int startingGold) { } public int Gold => 0; public bool TrySpend(int amount) => false; }
    public class Inventory : IInventory { public void Add(string itemId) { } }
    public class LogAnalytics : IAnalytics { public void Track(string evt, string data) { } }
    public class RemoteAnalytics : IAnalytics { public void Track(string evt, string data) { } }
    public class NullAnalytics : IAnalytics { public void Track(string evt, string data) { } }
    public class EnemySpawner : MonoBehaviour { public void Construct(EnemyFactory factory) { } }
    public class Enemy : MonoBehaviour { public void Construct(IWallet wallet, IAnalytics analytics) { } }
}
