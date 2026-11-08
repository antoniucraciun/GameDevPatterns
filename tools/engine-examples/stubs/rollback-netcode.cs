// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
namespace Page_rollback_netcode
{
    // The game's own per-fighter data, left to the reader.
    public struct FighterState { public int X, Y, Health; }

    // From the Determinism page: the deterministic, pure game update.
    public static class Simulation
    {
        public static GameState Step(GameState state, FrameInput p0, FrameInput p1) { state.Frame++; return state; }
    }

    // The transport, left to the reader.
    public static class Network
    {
        public static void SendInput(int frame, FrameInput input) { }
    }
}
