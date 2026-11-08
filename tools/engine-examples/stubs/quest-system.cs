// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_quest_system
{
    // From the Event Bus page.
    public interface IEvent { }
    public readonly struct EnemyKilled : IEvent { public readonly int EnemyTypeId; }
    public static class EventBus<T> where T : struct, IEvent
    {
        public static void Subscribe(Action<T> handler) { }
        public static void Unsubscribe(Action<T> handler) { }
        public static void Publish(in T evt) { }
    }
}
