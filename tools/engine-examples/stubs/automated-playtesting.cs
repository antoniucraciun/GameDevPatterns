// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using UnityEngine;

namespace Page_automated_playtesting
{
    // From the Input Abstraction page.
    public interface ICharacterInput
    {
        Vector2 Move { get; }
        bool JumpPressed { get; }
        bool AttackHeld { get; }
    }

    // The player's controller, which reads an ICharacterInput.
    public class CharacterMotor : MonoBehaviour
    {
        public ICharacterInput Input { get; set; }
    }
}
