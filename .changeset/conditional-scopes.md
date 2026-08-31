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

**`<:mode>` is a scope on its parent's element**, borrowing the nearest one
above it so that a modality can arrive and leave without the element moving:

```html
<div class="card">
  <:mode :if=${editing} :_draft=${text} :class-editing :attr-contenteditable=${true}>
    <button :on-click=${() => { text = _draft; editing = false }}>Save</button>
  </:mode>
  <p>${text}</p>
</div>
```

**The element stays**, which is the difference from `:if` on it — that takes
the markup away and loses focus, scroll position and whatever else the DOM was
holding — and from a handler bound once and guarded from inside, which goes on
firing for every `pointermove` to decide it has nothing to do.

**And `_draft` belongs to the edit rather than to the card**, so it is gone
when the edit is. That is the argument for the tag more than the listener is:
without it a modality's state lives on the element and has to be cleared by
hand, which is the bug everybody writes once.

A mode carries handlers, classes, styles, attributes, children and values of
its own, and takes all of them back. Its children are **built and destroyed**
rather than parked, which is the one place it departs from the region
machinery instead of reusing it — every region here preserves, so a hide keeps
focus and a playing video, and a modality wants the opposite.

Nothing is remembered: what an element's `title` is, is whatever the innermost
live declaration says, and handing it back is asking the one underneath to say
again. Where two modes want one attribute, `:priority` decides — higher owns
it while both are on, and hands it down the stack rather than to the element.
Equal ranks are a compile error, since precedence between siblings is a rule
nobody could guess.

Two things it refuses on purpose: `:prop-`, a DOM property being state on the
element instance with no declaration underneath to hand back to, and a
*static* plain attribute, which a mode has no markup of its own to write.

**A compiler crash went with it.** Reading a name declared inside a region
whose host is unnamed — `${field.text}`, where every existing case reached
`panel.field.text` — threw `TypeError: Cannot read properties of undefined`
instead of reporting anything, and threw for `${field?.text}` too, so the
crash landed on the one spelling the rule exists to accept.
