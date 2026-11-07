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

## Example

### Core: expression nodes

::: code-group

```csharp [Unity (C#)]
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

```gdscript [Godot (GDScript)]
# expr_context.gd: supplies variable values. Subclass it, or see StatContext below.
class_name ExprContext
extends RefCounted


func get_value(_variable: String) -> float:
	return 0.0


# expr.gd
class_name Expr
extends RefCounted


func eval(_ctx: ExprContext) -> float:
	return 0.0


# num_expr.gd
class_name NumExpr
extends Expr

var _value: float


func _init(value: float) -> void:
	_value = value


func eval(_ctx: ExprContext) -> float:
	return _value


# var_expr.gd
class_name VarExpr
extends Expr

var _variable: String


func _init(variable: String) -> void:
	_variable = variable


func eval(ctx: ExprContext) -> float:
	return ctx.get_value(_variable)


# binary_expr.gd
class_name BinaryExpr
extends Expr

var _op: String
var _left: Expr
var _right: Expr


func _init(op: String, left: Expr, right: Expr) -> void:
	_op = op
	_left = left
	_right = right


func eval(ctx: ExprContext) -> float:
	var a := _left.eval(ctx)
	var b := _right.eval(ctx)
	match _op:
		"+": return a + b
		"-": return a - b
		"*": return a * b
		"/": return 0.0 if b == 0.0 else a / b  # designers shouldn't crash the game
		"^": return pow(a, b)
		"<": return 1.0 if a < b else 0.0
		">": return 1.0 if a > b else 0.0
	push_error("Unknown operator %s" % _op)
	return 0.0
```

```cpp [Unreal (C++)]
// Expr.h
#pragma once

#include "CoreMinimal.h"

class IExprContext
{
public:
	virtual ~IExprContext() = default;
	virtual float Get(const FString& Variable) const = 0;
};

class FExpr
{
public:
	virtual ~FExpr() = default;
	virtual float Eval(const IExprContext& Ctx) const = 0;
};

class FNumExpr final : public FExpr
{
public:
	explicit FNumExpr(float InValue) : Value(InValue) {}
	virtual float Eval(const IExprContext&) const override { return Value; }

private:
	float Value;
};

class FVarExpr final : public FExpr
{
public:
	explicit FVarExpr(FString InName) : Name(MoveTemp(InName)) {}
	virtual float Eval(const IExprContext& Ctx) const override { return Ctx.Get(Name); }

private:
	FString Name;
};

class FBinaryExpr final : public FExpr
{
public:
	FBinaryExpr(TCHAR InOp, TUniquePtr<FExpr> InLeft, TUniquePtr<FExpr> InRight)
		: Op(InOp), Left(MoveTemp(InLeft)), Right(MoveTemp(InRight)) {}

	virtual float Eval(const IExprContext& Ctx) const override
	{
		const float A = Left->Eval(Ctx), B = Right->Eval(Ctx);
		switch (Op)
		{
		case '+': return A + B;
		case '-': return A - B;
		case '*': return A * B;
		case '/': return B == 0.f ? 0.f : A / B;            // designers shouldn't crash the game
		case '^': return FMath::Pow(A, B);
		case '<': return A < B ? 1.f : 0.f;
		case '>': return A > B ? 1.f : 0.f;
		default:  checkNoEntry(); return 0.f;
		}
	}

private:
	TCHAR Op;
	TUniquePtr<FExpr> Left, Right;
};
```

:::

### Core: a recursive-descent parser

Precedence from lowest to highest: comparison, then `+ -`, then `* /`, then `^`, then unary minus and parentheses.

::: code-group

```csharp [Unity (C#)]
using System;
using System.Globalization;

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

```gdscript [Godot (GDScript)]
# expr_parser.gd: GDScript has no exceptions, so the first error is stored and parse() returns null.
#   var parser := ExprParser.new(text)
#   var expr := parser.parse()
#   if expr == null: push_error(parser.error)
class_name ExprParser
extends RefCounted

var error := ""
var _s: String
var _i := 0


func _init(text: String) -> void:
	_s = text


func parse() -> Expr:
	var e := _comparison()
	_skip_spaces()
	if _i < _s.length():
		_fail("Unexpected '%s'" % _s[_i])
	return null if error != "" else e


func _comparison() -> Expr:
	var l := _sum()
	while _match("<") or _match(">"):
		l = BinaryExpr.new(_s[_i - 1], l, _sum())
	return l


func _sum() -> Expr:
	var l := _product()
	while _match("+") or _match("-"):
		l = BinaryExpr.new(_s[_i - 1], l, _product())
	return l


func _product() -> Expr:
	var l := _power()
	while _match("*") or _match("/"):
		l = BinaryExpr.new(_s[_i - 1], l, _power())
	return l


func _power() -> Expr:
	var l := _unary()
	if _match("^"):
		return BinaryExpr.new("^", l, _power())  # right-associative
	return l


func _unary() -> Expr:
	if _match("-"):
		return BinaryExpr.new("-", NumExpr.new(0.0), _unary())
	if _match("("):
		var e := _comparison()
		if not _match(")"):
			_fail("Expected ')'")
		return e

	_skip_spaces()
	var start := _i
	if _i < _s.length() and (_is_digit(_s[_i]) or _s[_i] == "."):
		while _i < _s.length() and (_is_digit(_s[_i]) or _s[_i] == "."):
			_i += 1
		return NumExpr.new(_s.substr(start, _i - start).to_float())  # to_float ignores the locale
	if _i < _s.length() and (_is_letter(_s[_i]) or _s[_i] == "_"):
		while _i < _s.length() and (_is_letter(_s[_i]) or _is_digit(_s[_i]) or _s[_i] in "_."):
			_i += 1
		return VarExpr.new(_s.substr(start, _i - start))
	_fail("Expected a value")
	return NumExpr.new(0.0)


func _skip_spaces() -> void:
	while _i < _s.length() and _s[_i] in " \t\n":
		_i += 1


func _match(c: String) -> bool:
	_skip_spaces()
	if _i < _s.length() and _s[_i] == c:
		_i += 1
		return true
	return false


func _fail(message: String) -> void:
	if error == "":  # keep the first error
		error = "%s at %d in \"%s\"" % [message, _i, _s]


static func _is_digit(c: String) -> bool:
	return c >= "0" and c <= "9"


static func _is_letter(c: String) -> bool:
	return (c >= "a" and c <= "z") or (c >= "A" and c <= "Z")
```

```cpp [Unreal (C++)]
// ExprParser.h: Unreal builds without exceptions, so Parse returns null and fills OutError.
#pragma once

#include "Expr.h"

class FExprParser
{
public:
	static TUniquePtr<FExpr> Parse(const FString& Text, FString& OutError)
	{
		FExprParser P(Text);
		TUniquePtr<FExpr> E = P.Comparison();
		P.SkipSpaces();
		if (P.I < P.S.Len()) P.Fail(FString::Printf(TEXT("Unexpected '%c'"), P.S[P.I]));
		OutError = P.Error;
		if (!P.Error.IsEmpty()) return nullptr;
		return E;
	}

private:
	explicit FExprParser(const FString& Text) : S(Text) {}

	using FExprPtr = TUniquePtr<FExpr>;

	FExprPtr Binary(TCHAR Op, FExprPtr L, FExprPtr R) { return MakeUnique<FBinaryExpr>(Op, MoveTemp(L), MoveTemp(R)); }

	FExprPtr Comparison() { FExprPtr L = Sum();     while (Match('<') || Match('>')) { const TCHAR Op = S[I - 1]; L = Binary(Op, MoveTemp(L), Sum()); }     return L; }
	FExprPtr Sum()        { FExprPtr L = Product(); while (Match('+') || Match('-')) { const TCHAR Op = S[I - 1]; L = Binary(Op, MoveTemp(L), Product()); } return L; }
	FExprPtr Product()    { FExprPtr L = Power();   while (Match('*') || Match('/')) { const TCHAR Op = S[I - 1]; L = Binary(Op, MoveTemp(L), Power()); }   return L; }
	FExprPtr Power()      { FExprPtr L = Unary();   if (Match('^')) return Binary('^', MoveTemp(L), Power()); return L; }   // right-associative

	FExprPtr Unary()
	{
		if (Match('-')) return Binary('-', MakeUnique<FNumExpr>(0.f), Unary());
		if (Match('(')) { FExprPtr E = Comparison(); if (!Match(')')) Fail(TEXT("Expected ')'")); return E; }

		SkipSpaces();
		const int32 Start = I;
		if (I < S.Len() && (FChar::IsDigit(S[I]) || S[I] == '.'))
		{
			while (I < S.Len() && (FChar::IsDigit(S[I]) || S[I] == '.')) ++I;
			return MakeUnique<FNumExpr>(FCString::Atof(*S.Mid(Start, I - Start)));
		}
		if (I < S.Len() && (FChar::IsAlpha(S[I]) || S[I] == '_'))
		{
			while (I < S.Len() && (FChar::IsAlnum(S[I]) || S[I] == '_' || S[I] == '.')) ++I;
			return MakeUnique<FVarExpr>(S.Mid(Start, I - Start));
		}
		Fail(TEXT("Expected a value"));
		return MakeUnique<FNumExpr>(0.f);
	}

	void SkipSpaces() { while (I < S.Len() && FChar::IsWhitespace(S[I])) ++I; }
	bool Match(TCHAR C) { SkipSpaces(); if (I < S.Len() && S[I] == C) { ++I; return true; } return false; }

	void Fail(const FString& Message)
	{
		if (Error.IsEmpty()) Error = FString::Printf(TEXT("%s at %d in \"%s\""), *Message, I, *S);   // keep the first error
	}

	const FString& S;
	int32 I = 0;
	FString Error;
};
```

:::

### Engine wiring: formulas as data, parsed once and evaluated many times

::: code-group

```csharp [Unity (C#)]
using System;
using System.Collections.Generic;

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

```gdscript [Godot (GDScript)]
# formula.gd: a .tres per formula. Add @tool to this script and the Expr scripts
# to see syntax errors while editing, not only when the game loads the resource.
class_name Formula
extends Resource

@export_multiline var expression := "base * (1 + strength / 100) - armor * 0.5":
	set(value):
		expression = value
		_parsed = null
		var parser := ExprParser.new(value)
		if parser.parse() == null:
			push_error("%s: %s" % [resource_path, parser.error])

var _parsed: Expr


func evaluate(ctx: ExprContext) -> float:
	if _parsed == null:  # also covers the default value, which never goes through the setter
		_parsed = ExprParser.new(expression).parse()
	return _parsed.eval(ctx) if _parsed else 0.0


# stat_context.gd
class_name StatContext
extends ExprContext

var _values: Dictionary


func _init(values: Dictionary) -> void:
	_values = values


func get_value(variable: String) -> float:
	return _values.get(variable, 0.0)

# damage_formula.evaluate(StatContext.new({"base": 20.0, "strength": 45.0, "armor": 12.0}))  →  23

# The built-in alternative, for formulas you trust: Godot's Expression class.
#   var e := Expression.new()
#   if e.parse("base * (1.0 + strength / 100.0) - armor * 0.5", ["base", "strength", "armor"]) == OK:
#       var damage: float = e.execute([20.0, 45.0, 12.0], null, false, true)  # const_calls_only = true
```

```cpp [Unreal (C++)]
// Formula.h
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "Expr.h"
#include "Formula.generated.h"

UCLASS(BlueprintType)
class UFormula : public UDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Formula", meta = (MultiLine = true))
	FString Expression = TEXT("base * (1 + strength / 100) - armor * 0.5");

	float Evaluate(const IExprContext& Ctx) const;

#if WITH_EDITOR
	virtual void PostEditChangeProperty(FPropertyChangedEvent& Event) override;
#endif

private:
	mutable TUniquePtr<FExpr> Parsed;                        // parsed on first use
};

// Formula.cpp
#include "Formula.h"
#include "ExprParser.h"

float UFormula::Evaluate(const IExprContext& Ctx) const
{
	if (!Parsed)
	{
		FString Error;
		Parsed = FExprParser::Parse(Expression, Error);
		if (!Parsed) { UE_LOG(LogTemp, Error, TEXT("%s: %s"), *GetName(), *Error); return 0.f; }
	}
	return Parsed->Eval(Ctx);
}

#if WITH_EDITOR
void UFormula::PostEditChangeProperty(FPropertyChangedEvent& Event)       // designers see syntax errors immediately
{
	Super::PostEditChangeProperty(Event);
	Parsed.Reset();
	FString Error;
	if (!FExprParser::Parse(Expression, Error)) UE_LOG(LogTemp, Error, TEXT("%s: %s"), *GetName(), *Error);
}
#endif

// StatContext.h
class FStatContext : public IExprContext
{
public:
	explicit FStatContext(TMap<FString, float> InValues) : Values(MoveTemp(InValues)) {}

	virtual float Get(const FString& Variable) const override
	{
		const float* Value = Values.Find(Variable);
		return Value ? *Value : 0.f;
	}

private:
	TMap<FString, float> Values;
};

// DamageFormula->Evaluate(FStatContext({{TEXT("base"), 20.f}, {TEXT("strength"), 45.f}, {TEXT("armor"), 12.f}}))  →  23
```

:::

Conditions use the same machinery: `gold > 49` evaluates to 1 or 0. Add `and`, `or` and `not` operators the same way to cover dialogue and quest conditions.

**Engine notes**

- **Unity:** `float.Parse` with `CultureInfo.InvariantCulture` matters: on a German system, `"0.5"` would otherwise fail to parse.
- **Godot:** The built-in `Expression` class parses and runs GDScript-like expressions, which is enough for trusted formulas. Its differences from the parser above: inputs are positional (names in `parse`, values in `execute`), `^` is bitwise XOR (use `pow(a, b)`), integer operands divide as integers (`45 / 100` is 0, so pass floats), comparisons return `bool`, and it can call methods on the base instance, so pass `null` and `const_calls_only = true` for untrusted text.
- **Unreal:** Exceptions are disabled, so the parser reports errors through `OutError`. `FString` keys in a `TMap` compare case-insensitively, so `Base` and `base` are the same variable. Blueprints and the Gameplay Ability System (magnitude calculations, `FScalableFloat` curve tables) cover many "designer formula" needs without a text language.

## When to use

- Designer-editable formulas: damage, XP curves, prices, drop chances, scaling.
- Conditions in data: dialogue choices, quest requirements, achievement triggers, AI considerations.
- Small domain-specific languages: cheat-console arguments, level scripting, mod support.

## When not to use

- Logic only programmers change. Write it in C#.
- Large scripting needs. A hand-rolled interpreter grows into a language; use an existing one (Lua, Ink, Yarn) instead.
- Hot loops evaluated thousands of times per frame. Tree-walking is slow; compile to [Bytecode](./bytecode) or C# delegates.

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
