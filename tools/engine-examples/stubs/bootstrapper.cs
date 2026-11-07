// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_bootstrapper
{
    public static class Services { public static void Register<T>(T s) where T : class { } public static T Get<T>() where T : class => null; }
    [Serializable] public class GameSettings { }
    public class PlatformStep : IBootStep { public string Name => "Platform"; public async Awaitable Run() { await Awaitable.NextFrameAsync(); } }
    public class AnalyticsStep : IBootStep { public string Name => "Analytics"; public async Awaitable Run() { await Awaitable.NextFrameAsync(); } }
    public class LoadSaveStep : IBootStep { public string Name => "Save"; public async Awaitable Run() { await Awaitable.NextFrameAsync(); } }
}
