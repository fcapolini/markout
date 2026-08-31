# Re-initializing a value

Status: **exploratory, and not urgent.** Nothing is designed and no code has
been written. Parked here because the interesting part is a language question
rather than an implementation one, and it is cheaper to decide that before
anyone writes the easy half.

## The question

A value follows its expression until something assigns it, and is whatever it
was assigned from then on — the rule stated in
[values](../concepts/values.md). That transition runs one way. This is about
the other: putting a value *back* to following an expression, and possibly a
different expression, with a different dependency list.

## Reactive to static is cheap, and so is half of the reverse

Going static costs nothing because nothing is dismantled. The compiler
discovered the dependency edges once, they are still there, and assignment
only means the cell stops recomputing.

Which makes **re-attaching to the same expression** nearly free as well: clear
whatever marks it as assigned, set `dirty`, and let the next settle do the
rest. No graph changes at all. Worth separating out, because it is the case
most likely to be wanted and it is not the case that is hard.

The hard one is a **different dependency list**, and it is hard for an
architectural reason. "The compiler discovers dependencies once; the runtime
executes them" is the whole model, and props are a function of the source
rather than of the request — which is exactly what lets a served page and a
hydrating browser agree by construction. An expression assembled at runtime
has nothing compiled behind it and nothing the server could have rendered.

## The shape that works

Every alternative is **declared**, so the compiler can find them all, work out
each one's dependencies up front, and emit expression-and-dependencies as a
list where there is a singleton today. A reinitialization at runtime then
selects among known graphs rather than mutating one: replace the pair in the
cell and let propagation carry on.

The runtime is already shaped for it.
[`CoreValue`](../../packages/core/src/runtime/core/core-value.ts) holds `src`
and `dst` as explicit sets of values, plus `exp`, so a swap is: unsubscribe
from the old sources, subscribe to the new, replace `exp`, set `dirty`. Four
steps against structure that exists.

**So the swap was never the expensive part.** What follows is.

## The five that decide what it costs

1. **Which scope does the replacement expression resolve against?** The
   language question, and the one to answer first. A reinitialization written
   in a handler in one scope targets a value in another; the compiled function
   takes the scope as an argument, and it matters greatly whether it is handed
   the value's scope or the site's. The value's is consistent with "an
   expression resolves where it was written" — but it was written somewhere
   else, and its author will read its names as local. The site's means one
   value now has two expressions resolving in two different scopes. This is
   the seam `hostFor`, `callSite` and `detachedUsageSite` already sit on in
   [stage4](../../packages/core/src/compiler/stages/stage4-resolve.ts), whose
   comments record it landing one scope off and staying quietly wrong.
2. **Hydration has to know which variant is live.** Which expression a value
   is on is runtime state, and nothing in a served page encodes it today. The
   browser would recompute from the first variant and disagree with what was
   rendered — the same shape as a `:server-if` decision crossing frozen, and
   the same fix: the index travels in the props.
3. **The compile-time answers become unions.** `declarationFor`,
   `referencesTo` and `visibleFrom` are exported for the editor, and "what
   does this value depend on" acquires N answers. Go-to-definition and any
   dependency diagnostic need a stated rule rather than picking the first.
4. **`:const-` cannot take part.** It is folded and dropped while the page is
   built, so there is no cell to reinitialize. A compile error from the first
   day rather than a discovery later.
5. **Every alternative ships.** Props size is already tracked in
   [TODO](../../TODO.md), and this multiplies the compiled expressions of any
   value that has variants.

And one constraint that comes free if it is taken early: **handlers only**, so
a swap never happens while propagation is walking the graph. The comment on
`CoreValue.dirty` is a fair warning about that path — a spurious
re-evaluation there once cost 59 seconds on a sort of 10k rows.

## How big is it, really

Smaller than "re-initialize" suggests, because most of what the word means is
already writable. `_count = start` in a handler re-seeds to whatever `start`
holds now, and covers very nearly every reset button anyone writes. What it
does not do is resume *tracking*. So the actual content of the feature is the
mode change on its own — which is worth knowing before it gets designed as the
larger thing.

## Spelling, if it ever happens

First thought was a `:init-` or `:reset-` family. It sits badly: a family or a
modifier says what a value *is* — `:const-`, `:server-` — and this says what
to do to one, later. The imperative corner already has the right slot, since
[scope](../concepts/scope.md) supplies `$value("name")` to read and
`$set("name", v)` to assign. A `$reset("name")` belongs beside them, adds no
grammar, and is a verb where verbs already live.

A separate question, considered and dropped, was whether a *declaration*
should be able to mark itself a seed rather than a rule — `:value!=` by
analogy with `class!=`/`style!=`. That is about intent at the declaration
rather than a change at runtime, and the reasoning is in the message of the
commit that documented the rule instead.

## Where this leaves it

Nothing to build. The order, if it is ever picked up: decide (1), because it
is a language question wearing an implementation's clothes, and every other
line here is straightforward once it is answered.
