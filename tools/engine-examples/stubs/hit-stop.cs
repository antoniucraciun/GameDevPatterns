// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using UnityEngine;

namespace Page_hit_stop
{
    // From the Time Scale page.
    public static class GameTime
    {
        public sealed class Request : IDisposable { public void Dispose() { } }
        public static Request Push(float factor, string reason) => new Request();
    }
}
