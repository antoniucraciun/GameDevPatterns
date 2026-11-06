# Interpreter

> Evaluate a small language or expression tree (formulas, conditions, dialogue logic).

**Category:** Behavioral & Communication

## Problem

Designers want to tune formulas without programmers: damage is `base * (1 + strength / 100) - armor * 0.5`, XP for a level is `100 * level ^ 1.5`, a dialogue choice appears when `gold >= 50 and reputation > 10`. Hard-coding each formula in C# means a code change and recompile for every balance tweak. Building a field in the inspector for every possible term does not scale. What designers need is a tiny **language** for expressions, stored as text in data.

## Solution

Represent an expression as a **tree of nodes**, where each node knows how to **evaluate itself**:

- **Leaf nodes:** numbers (`100`) and variables (`strength`, looked up in a context at evaluation time).
- **Operator nodes:** `Add`, `Multiply`, `Compare`… Each evaluates its children and combines the results.
- A **parser** turns text into the tree once, at load time. Evaluation then walks the tree with a **context** that supplies variable values.

```
base * (1 + strength / 100) - armor * 0.5

            (-)
          /     \
        (*)      (*)
       /   \     /  \
    base   (+)  armor 0.5
          /   \
         1    (/)
             /   \
        strength  100
```

The tree is the "interpreter": evaluation is a recursive walk. For a few expressions, it is fast enough. For thousands per frame, compile the tree into [Bytecode](./bytecode) or C# delegates.

## Example (Unity C#)

Expression nodes:

```csharp
using System;
using System.Collections.Generic;
using System.Globalization;

public interface IExprContext { float Get(string variable); }

public abstract class Expr { public abstract float Eval(IExprContext ctx); }

public sealed class Num : Expr
{
    readonly float value; public Num(float v) => value = v;
    public override float Eval(IExprContext ctx) => value;
}

public sealed class Var : Expr
{
    readonly string name; public Var(string n) => name = n;
    public override float Eval(IExprContext ctx) => ctx.Get(name);
}

public sealed class Binary : Expr
{
    readonly char op; readonly Expr left, right;
    public Binary(char op, Expr l, Expr r) { this.op = op; left = l; right = r; }

    public override float Eval(IExprContext ctx)
    {
        float a = left.Eval(ctx), b = right.Eval(ctx);
        return op switch
        {
            '+' => a + b, '-' => a - b, '*' => a * b,
            '/' => b == 0f ? 0f : a / b,                       // designers shouldn't crash the game
            '^' => MathF.Pow(a, b),
            '<' => a < b ? 1f : 0f, '>' => a > b ? 1f : 0f,
            _ => throw new InvalidOperationException($"Unknown operator {op}"),
        };
    }
}
```

A small recursive-descent parser, with precedence from lowest to highest: comparison, then `+ -`, then `* /`, then `^`, then unary minus and parentheses:

```csharp
public sealed class ExprParser
{
    readonly string s; int i;
    ExprParser(string text) { s = text; }

    public static Expr Parse(string text)
    {
        var p = new ExprParser(text);
        var e = p.Comparison();
        p.SkipSpaces();
        if (p.i < p.s.Length) throw new FormatException($"Unexpected '{p.s[p.i]}' at {p.i} in \"{text}\"");
        return e;
    }

    Expr Comparison() { var l = Sum(); while (Match('<') || Match('>')) { char op = s[i - 1]; l = new Binary(op, l, Sum()); } return l; }
    Expr Sum()        { var l = Product(); while (Match('+') || Match('-')) { char op = s[i - 1]; l = new Binary(op, l, Product()); } return l; }
    Expr Product()    { var l = Power(); while (Match('*') || Match('/')) { char op = s[i - 1]; l = new Binary(op, l, Power()); } return l; }
    Expr Power()      { var l = Unary(); return Match('^') ? new Binary('^', l, Power()) : l; }   // right-associative

    Expr Unary()
    {
        if (Match('-')) return new Binary('-', new Num(0), Unary());
        if (Match('(')) { var e = Comparison(); Expect(')'); return e; }

        SkipSpaces();
        int start = i;
        if (i < s.Length && (char.IsDigit(s[i]) || s[i] == '.'))
        {
            while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '.')) i++;
            return new Num(float.Parse(s.Substring(start, i - start), CultureInfo.InvariantCulture));
        }
        if (i < s.Length && (char.IsLetter(s[i]) || s[i] == '_'))
        {
            while (i < s.Length && (char.IsLetterOrDigit(s[i]) || s[i] == '_' || s[i] == '.')) i++;
            return new Var(s.Substring(start, i - start));
        }
        throw new FormatException($"Expected a value at {i} in \"{s}\"");
    }

    void SkipSpaces() { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }
    bool Match(char c) { SkipSpaces(); if (i < s.Length && s[i] == c) { i++; return true; } return false; }
    void Expect(char c) { if (!Match(c)) throw new FormatException($"Expected '{c}' at {i} in \"{s}\""); }
}
```

Formulas as data, parsed once and evaluated many times:

```csharp
[UnityEngine.CreateAssetMenu(menuName = "Formulas/Formula")]
public class Formula : UnityEngine.ScriptableObject
{
    [UnityEngine.TextArea] public string expression = "base * (1 + strength / 100) - armor * 0.5";
    Expr parsed;

    public float Evaluate(IExprContext ctx) => (parsed ??= ExprParser.Parse(expression)).Eval(ctx);

    void OnValidate()                                     // designers see syntax errors immediately
    {
        parsed = null;
        try { ExprParser.Parse(expression); }
        catch (FormatException e) { UnityEngine.Debug.LogError($"{name}: {e.Message}", this); }
    }
}

public class StatContext : IExprContext
{
    readonly Dictionary<string, float> values;
    public StatContext(Dictionary<string, float> values) => this.values = values;
    public float Get(string variable) => values.TryGetValue(variable, out var v) ? v : 0f;
}

// damageFormula.Evaluate(new StatContext(new() { ["base"] = 20, ["strength"] = 45, ["armor"] = 12 }))  →  23
```

Conditions use the same machinery: `gold > 49` evaluates to 1 or 0. Add `and`, `or` and `not` operators the same way to cover dialogue and quest conditions.

## When to use

- Designer-editable formulas: damage, XP curves, prices, drop chances, scaling.
- Conditions in data: dialogue choices, quest requirements, achievement triggers, AI considerations.
- Small domain-specific languages: cheat-console arguments, level scripting, mod support.

## Pitfalls

- **Parsing every evaluation.** Parse once at load (or on validation) and cache the tree. Parsing in a hot path is slow and allocates.
- **Unknown variables.** A typo like `strenght` silently evaluates to 0. Validate variable names against a known list at edit time.
- **Building a whole programming language.** Loops, functions and assignment turn a formula language into a scripting language with its own debugger needs. For full scripting, embed an existing language (Lua, a visual scripting graph) rather than growing your own.
- **Performance at scale.** Walking trees with virtual calls for thousands of evaluations per frame is slow. Compile to [Bytecode](./bytecode), or to delegates with `System.Linq.Expressions` (not available under IL2CPP), or precompute results.
- **Culture.** Parse numbers with `CultureInfo.InvariantCulture`, or `1.5` fails on machines that use decimal commas.

## Related

- [Bytecode](./bytecode) — compile the tree into instructions for a faster virtual machine.
- [Composite](./composite) — expression trees are composites of nodes.
- [Visitor](./visitor) — print, optimise or validate trees without changing node classes.
- [Data-Driven Design](./data-driven-design) — formulas are data.
- [Dialogue System](./dialogue-system) and [Quest System](./quest-system) — common users of conditions.
