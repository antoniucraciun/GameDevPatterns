// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_dialogue_system
{
    // From the Quest System page.
    public class QuestDefinition : ScriptableObject { }
    public class QuestLog
    {
        public bool IsActive(string id) => false;
        public bool IsCompleted(string id) => false;
        public void Start(QuestDefinition def) { }
    }
}
