// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_game_state_manager
{
    public static class LoadingScreen { public static void Show() { } public static void Hide() { } }
    public static class PauseMenu { public static void Show() { } public static void Hide() { } }
    public static class GameTime
    {
        public sealed class Request : IDisposable { public void Dispose() { } }
        public static Request Push(float factor, string reason) => new Request();
    }
}
