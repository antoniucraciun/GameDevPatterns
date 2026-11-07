// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System.Collections;
using UnityEngine;

namespace Page_template_method
{
    public class StatusEffectContainer : MonoBehaviour { public void TickTurn() { } public bool HasTag(string tag) => false; }
    public class Health : MonoBehaviour { public bool IsAlive => true; }

    public class TurnAction
    {
        public int Cost;
        public static TurnAction Attack(TurnTaker target) => null;
        public static TurnAction MoveToward(TurnTaker target) => null;
        public IEnumerator Execute(TurnTaker actor) { yield break; }
    }

    public static class Board
    {
        public static TurnTaker NearestEnemyOf(TurnTaker unit) => null;
        public static bool InMeleeRange(TurnTaker a, TurnTaker b) => false;
    }

    public static class PlayerInputQueue { public static TurnAction TakeChosenAction() => null; }
    public static class CameraRig { public static void FocusOn(Transform t) { } }
}
