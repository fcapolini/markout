---
"@markout-lang/core": patch
---

A usage site's `style` replaces a definition's, as the rule has always said
it does.

`class` and `style` are kept as element PROPERTIES rather than attribute
nodes. Writing a class went to the property and replaced it; writing a style
fell through to the generic path, landed in an attribute node BESIDE the
property, and was merged with it on the way out:

```html
<:define tag="my-box:div" style="gap: 1rem"><:slot /></:define>
<my-box style="color: red">hi</my-box>
```

served `style="color: red; gap: 1rem;"` where the same page's `class` would
have replaced. One rule, two behaviours, decided by which of the two
composite attributes it was — and the compiler warns about that `style`
precisely on the grounds that it replaces.

**It was also a difference between the server and the browser.** A real DOM's
`setAttribute("style", ...)` replaces, so the instance built during a render
and the instance built on hydration disagreed about what the element wore.

Nothing in the demos or the kits writes a literal `style` at a usage site, so
no built page changes. `style+=` and `style-=` are unaffected: those compose,
and always went through the property.
