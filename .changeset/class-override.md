---
"@markout-lang/core": minor
---

`class!=` and `style!=`: replacing what a component composed, said on
purpose.

A `class` written at a usage site replaces the one the component derived for
itself. That is the rule and it is the right one, but from a component that
derives its own classes it is almost never what was meant, so it warns — and
the only answers the warning had were `class+=`, which means something else
entirely, and silence. A warning nobody can answer is a warning people learn
to scroll past.

This is the answer that agrees with it:

```html
<bs-alert ::variant="warning" class!="my-own-alert">Nothing of the kit's</bs-alert>
```

It compiles to exactly what `class=` compiles to — the same value under the
same name, nothing downstream aware the spelling exists. All it adds is the
statement, which the compiler accepts as its answer and stops asking, and
which the next reader gets for free: a plain `class` on a component is
ambiguous between "I meant this" and "I did not know", and this one is not.

**`!` because it is not a set operation.** `+=` and `-=` say what happens to
the set; this says what the author intends about a collision. CSS spells that
same idea `!important`.

**It expects something to replace.** On a plain element, or on a component
that sets no `class` of its own, there is nobody it can be addressing — which
it says, while going on working, since it is a `class` either way. That is
what catches the stale one: a component that stops setting a class leaves
every `class!=` aimed at it saying something no longer true.

The warning it answers now names it:

```
warning: <bs-alert> sets "class" itself, and a "class" here replaces it -- did you mean "class+=", or "class!=" if you meant to replace it?
```
