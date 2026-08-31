---
"@markout-lang/core": minor
---

A scope can have a condition for a lifetime, and `<:mode>` can put one on
somebody else's element.

Three things arrive together, because the first two turned out not to be
separable and the third is built on them. The design is in
`docs/design/conditional-scopes.md`.

**`<:logic>` takes a condition.** `:if`, `:else-if`, `:else` and `:for-data`
are accepted, and what they decide is whether the scope exists at all — so
`:did-init` runs when the condition becomes true and `:will-dispose` when it
stops being, once per lifetime as always, with lifetimes now able to repeat:

```html
<:logic :if=${dragging}
        :_move=${(e) => track(e)}
        :did-init=${() => window.addEventListener('pointermove', _move)}
        :will-dispose=${() => window.removeEventListener('pointermove', _move)} />
```

`:for-each` stays refused, and the difference is the point: that objection was
never lifetime but arity. A name meaning as many scopes as there are items is
not fixed by knowing when each of them ends.

This also closes a silent one. A `tag="x:logic"` instance inside a region
compiled cleanly and then reported `init` once and nothing ever again — so a
timer opened there ran on while the region was hidden, with no callback able
to stop it.

**A conditional scope's readers are checked**, which is the half that cannot
be left out. `${app.foo}` where `app` may be gone is refused, and `${app?.foo}`
is the spelling that works. The guard is not only a check: classifying a read
as guarded is what registers the reader as a *maybe*, and maybes are what get
re-linked when a region comes back. Called plain, the read is evaluated once
against a name that is not there yet and never asked again.

**`<:mode>` is a scope on its parent's element** — partly built, handlers
only, with everything else refused in so many words:

```html
<div class="card">
  <:mode :if=${dragging} :_from=${null} :on-pointermove=${(e) => track(e)} />
  …the card, which never re-renders…
</div>
```

The element stays, which is the difference from `:if` on it — that takes the
markup away and loses focus, scroll position and whatever else the DOM was
holding — and from a handler bound once and guarded from inside, which goes on
firing for every `pointermove` to decide it has nothing to do. And `_from`
belongs to the drag rather than to the card, so it is gone when the drag is;
that is the argument for the tag more than the listener is.

`:class-`, `:style-`, `:attr-`, `:prop-`, plain attributes and content are
refused **as not built yet**. They need one answer — an attribute or a class
has one owner at a time, and handing it back is the part not written — and a
tag that quietly does half of what it reads as doing is worse than one that
says which half.

**A compiler crash went with it.** Reading a name declared inside a region
whose host is unnamed — `${field.text}`, where every existing case reached
`panel.field.text` — threw `TypeError: Cannot read properties of undefined`
instead of reporting anything, and threw for `${field?.text}` too, so the
crash landed on the one spelling the rule exists to accept.
