// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_perception_system
{
    // From the Blackboard page.
    public sealed class BlackboardKey<T> { public BlackboardKey(string name) { } }

    public static class Keys
    {
        public static readonly BlackboardKey<Transform> Target = new("Target");
        public static readonly BlackboardKey<Vector3> LastKnownPosition = new("LastKnownPosition");
        public static readonly BlackboardKey<Vector3> NoiseLocation = new("NoiseLocation");
    }

    public class Blackboard
    {
        public void Set<T>(BlackboardKey<T> key, T value) { }
    }
}
