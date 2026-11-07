// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using UnityEngine;

namespace Page_chain_of_responsibility
{
    public static class ModalPopup { public static bool IsOpen => false; }

    public class BuildingPlacer
    {
        public void Cancel() { }
        public bool TryPlaceAt(Vector2 screenPosition) => false;
    }

    public static class Selection
    {
        public static bool TrySelectAt(Vector2 screenPosition) => false;
        public static bool OrderMoveTo(Vector2 screenPosition) => false;
    }
}
