---
"@markout-lang/core": patch
---

An attribute's own quote character can be used inside its `${…}` (#30).

`:v="${"x"}"` and `:v='${'x'}'` both parse now. Before, the attribute-value
scanner ended at the first matching quote whether or not it was inside an
expression, so what reached the JS parser was a fragment and the error was a
`SyntaxError` pointing *inside* the expression, at nothing the author had got
wrong.

It is HTML's rule, but `${…}` already suppresses the other delimiter — a `>`
inside an expression does not end the tag — so the quote was the one place a
delimiter stayed live inside an expression. Now nothing does, which is one
fewer rule rather than one more.

The scanner asks acorn where each expression ends rather than lexing
JavaScript a second time, so strings, template literals, object literals and
nested `${}` all end where the real parse says they do — and it hands those
nodes to the parse that follows, so nothing is parsed twice. An attribute
with no expression takes the path it always did.

Measured, interleaved to cancel drift: this repository's homepage 37.8ms →
39.0ms to compile, and its heaviest page unchanged at ~82ms.
