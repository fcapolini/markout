---
"@markout-lang/core": patch
---

Write a text interpolation that can never change into the markup, and drop
the binding (#33).

After `:const-` substitution a token sheet comes out as `'... ' + '#2C88E7' +
' ...'`: no scope references left, no dependencies, and a value that will be
evaluated once and never again. It shipped in full anyway. A whole stylesheet
is one text node, so on the site the issue was filed against that was 3,136
bytes on every page — 30% of everything those pages carried, for a binding
that cannot produce anything the served markup does not already contain.

The rewrite is safe because it is not a new write: server rendering already
evaluates that value against that same document and puts the result in that
same node. Only the *when* changes — once at compile time instead of once per
render — and the served bytes are what they were, interpolation markers
included.

Written into the node rather than merely withheld from the client, which
reaches a case a props-level fix could not: a stencil's markup is never
rendered, so a constant inside an `:if` region or a `<:define>` body has to be
in the template for a client-side instantiation to show it.

Text only, and that is what makes it sound: a text value's key is generated,
no expression can name one, so nothing can be reading it. What counts as
constant is a whitelist of literal shapes rather than "has no dependencies" —
`$id`, a global and a call have no dependencies either, and none of them is a
constant.

Measured on this repository's own site: 371 bytes a page on the two that
import a token sheet, and nothing on the two that do not.
