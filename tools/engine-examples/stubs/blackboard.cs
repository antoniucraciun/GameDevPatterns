// Stub declarations for types this page's Unity snippets use but don't define (see ../README.md).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Page_blackboard
{
    // From the Behavior Tree page.
    public enum Status { Success, Failure, Running }
    public abstract class Node { public abstract Status Tick(); }
}
