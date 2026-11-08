// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using UnityEngine;

namespace Page_mvp_mvvm
{
    // Left to the reader: one inventory slot that shows an icon and a label.
    public class SlotView : MonoBehaviour
    {
        public event Action Clicked;
        public void Show((string label, Sprite icon) row) { }
    }
}
