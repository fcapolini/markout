---
"@markout-lang/core": minor
---

`:if`, `:for-each` and `:for-data` on a `<:define>`, meaning it for every
instance of the tag.

A definition renders nowhere itself — it is a stencil in `<head>` — so the
only thing an arity written on one can say is how many times each *use* of it
renders. That is what it now says, which lets a component carry its own guard
instead of asking every caller to remember one:

```html
<:define tag="my-alert:div" ::msg=${null} :if=${msg} class="alert">
  ${msg}
</:define>

<my-alert ::msg=${error} />   <!-- nothing at all while `error` is null -->
```

Before, this was accepted, compiled clean, and rendered **nothing at all** —
whatever the condition said, and for every instance of the tag. The value
reached the instance like every other declaration, but nothing had made the
instance a region in the markup, so the runtime went looking for a marker
that was never written and found none. No compile error, no warning, no
runtime message.

**`:for-as` and `:for-key` go beside the `:for-each` that declares the loop**,
which now includes a definition's. Both already rode along on a definition —
they are values like any other — and both are now refused at a *usage site*
whose definition declares the loop: the item they rename or key is the one
the definition's body reads. `:for-as` there used to render, and render
wrongly — the body went on reading `data`, which after the rename resolved to
something else entirely and was written into the page as `true`.

**`:else` and `:else-if` are refused there**, and say so: a chain is resolved
by position among siblings, and a definition has none where its instances
stand. So is an arity on a `tag="x:logic"` definition, whose instances have
no element to park.

**A usage site writing a second one is a compile error**, naming both. "How
many times does this render" is single-valued, and which of the two would win
is a rule nobody could guess. An `AND` of the two is the plausible other
answer and is deliberately not what this does: the two conditions resolve in
different scopes — the definition's against the instance, the usage's against
the call site — so composing them is a runtime feature rather than a rewrite,
and a refusal can be relaxed into one later where the reverse could not.

**One runtime change came with it**, and it fixes the same shape written by
hand. A region that is not showing evaluates nothing inside itself, which is
what makes `${user.name}` safe to write in one — but that also covered a
component's *arguments*, and a guard on a parameter reads exactly those. So
`:if=${msg}` rendered correctly and then never came back, because the value
its condition reads was not linked and nothing that moved it reached the
condition. Arguments now stay live while the region is away: a `callSite`
value resolves at the usage site and can read nothing inside the region, so
there was never anything for its silence to protect.
