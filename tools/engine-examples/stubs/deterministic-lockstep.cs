// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
namespace Page_deterministic_lockstep
{
    // From the Determinism page.
    public class Simulation
    {
        public void Apply(PlayerCommand command) { }
        public void Step() { }
        public uint Checksum() => 0;
    }

    // The transport, left to the reader.
    public static class Network
    {
        public static void SendToAll(PlayerCommand command) { }
        public static void ShowWaitingForPlayers() { }
        public static void SendChecksum(int turn, uint checksum) { }
    }
}
