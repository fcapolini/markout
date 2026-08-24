---
"@markout-lang/core": patch
"@markout-lang/bootstrap-kit": patch
---

Warn when a page writes a value the user can take away from it.

`value=${v}` on an input reads as "this is the value" and behaves as "this
was the initial value": HTML's dirty flag makes the element's own state
independent of both the attribute and the content from the first keystroke,
so `v = ''` after a submit empties the model and leaves the typed text on
screen.

The fix is `:prop-value=${v}` **beside** the attribute — the attribute is
what the element is served with, the property is what it shows afterwards —
and the compiler now says so when it sees one without the other: `value` on a
typed-in `<input>` and on a `<textarea>` (its content as well as its
attribute), `checked` on an `<input>`, `selected` on an `<option>`.

`value=` was deliberately **not** made to write the property when it happens
to be on an input: that would be one attribute meaning two different things
depending on the element it sits on.

The warning found five in `bootstrap-kit`, all fixed: `bs-input`,
`bs-textarea`, `bs-check`, `bs-range` and `bs-select` were read-write
everywhere except the direction a form needs after a submit.
