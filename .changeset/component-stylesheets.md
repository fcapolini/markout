---
"@markout-lang/core": minor
---

A `<:define>` can carry its own `<style>`, served once and dropped with the
definition — and treeshaking now follows the usage graph rather than a flat
set of mentions.

**A component's stylesheet.** A `<style>` written as a direct child of a
`<:define>` is that component's, structurally rather than by an author's
say-so:

```html
<:define tag="x-card:div" class="card">
  <style>.card { border: 1px solid }</style>
  <:slot />
</:define>
```

It is lifted out of the stencil and served **once**, and it goes when the
definition does. That is the whole difference from `:when-used`, which is an
assertion an author can get wrong: nobody claims this stylesheet belongs to
the component, it was *written inside* it.

Left in place it was copied per instance — the definition's stencil held one
and every usage site given content cloned another, so three instances shipped
four copies of the same rules and mounted one apiece. That cost is why the
pattern was unwritable.

**Where it lands is part of the promise:** immediately before the definition,
not appended to `<head>`. A stencil is inert and a stylesheet cascades, so
appending would put every component's rules after the page's own and let a
component win an equal-specificity tie it should lose. In place, cascade order
is import order, which is the order the fragments were written.

Two cases are deliberately left alone. A `<style>` that interpolates a value
renders once per instance with its own text, so there is no single copy to
hoist. One nested deeper — inside an `:if` or a `:for-each` — is conditional
markup, which is the author having already answered this question differently.
A definition in `<body>` cannot carry one at all: lifted out it would be
invalid markup where it stands and would land somewhere else if moved, so it
is refused rather than guessed at.

**Treeshaking follows the graph.** A definition is kept when the page can
*reach* it: the tags the page writes itself, then the tags those definitions'
bodies write, and so on. One reachable only through a definition that is
itself unused now goes with it.

The flat set was wrong in a way that cost more than it looked. A `dash-stat`
whose body writes `<dash-chart>` kept the chart's stencil on a page writing
neither — kept it, in fact, on the strength of a mention inside a definition
the same pass had just deleted. For a kit whose components compose, which is
the ordinary kind, that is not a corner case. On a page importing a four-
component set and writing one of them: 10821 bytes to 10120, and 4093 to 3924
gzipped. Every page of the site renders identically — body, props and CSS byte
for byte — and only unreachable stencils went.

**A borrowed class is reported.** Class names stay global: nothing is
rewritten or hashed, so a page may wear `.card` without ever writing
`<x-card>`. Do both and the rules are deleted out from under markup that
stayed. The compiler now says so:

```
warning: <x-card> is never used, so its <style> went with it -- but "card"
is still applied by markup that stayed, which now renders unstyled.
Write <x-card>, or move those rules out of the definition
```

It fires only when it has actually happened — the definition gone *and* a
surviving element still applying the class — so a page that wears `.card` and
also writes `<x-card>` hears nothing. Both static `class` and `:class-`
toggles count as applying it, and only the text before each `{` is read for
class names, so `url(logo.card)` in a declaration is not mistaken for a
selector.
