---
"@markout-lang/bootstrap-kit": patch
---

`bs-link` and `bs-badge` no longer carry a leading/trailing space inside
their rendered content.

Both are `<:define>`d with `<:slot />` indented on its own line, so the
definition's own template held a "\n    " text node before it and a
"\n  " after — verbatim, since markout preserves whitespace and slot
substitution removes only the `<:slot>` element itself, not its siblings.
Invisible on a padded button, but `bs-link` used as a plain inline link
rendered its underline a few pixels past the actual text, into that
trailing space.

`<:slot />` now sits on the same line as the surrounding tags, matching
the convention `navbar.htm`'s brand link already used. No visible change
to a button-styled `bs-link` or an ordinary `bs-badge`; a plain inline
`bs-link`'s underline now ends where its text does.
