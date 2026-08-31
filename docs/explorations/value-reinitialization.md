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

1. **Which scope does the replacement expression resolve against?**
   *Decided: where it is written*, like every other expression. That is not a
   new rule but the existing one declining an exception — choosing the target
   value's scope would make an expression's meaning depend on which value it
   happened to land on, which the language does nowhere else. The precedent is
   already running: a usage site's `:edits=${0}` resolves in the caller's
   scope while acting on the instance, which is this shape exactly, and is
   what `resolvesFrom`/`callSiteScope` in
   [stage4](../../packages/core/src/compiler/stages/stage4-resolve.ts)
   implement. It is also the cheaper half: expressions are qualified against
   the scope they sit in as a matter of course, so a replacement written in a
   handler needs no special casing, where the other choice would need
   deliberate re-resolution against a different scope — the manoeuvre whose
   comments there record it landing one scope off and staying quiet.

   It is the useful answer as well, and that is the stronger argument. A
   replacement resolved at the target could only ever recombine names the
   original declaration already saw, which makes the whole variant list
   close to vacuous. The case that motivates the feature runs the other way:
   a handler inside a replica saying *track this item from now on*, where the
   per-item binding exists at the handler and nowhere near the value being
   reinitialized.

   **What follows from it** is a lifetime rule. A replacement captures the
   scope it was written in, so a reinitialization has to be **checked against
   that scope's lifespan and rejected when the check fails**: a value may not
   be given an expression borrowed from a scope shorter-lived than itself.
   That is better than defining what disposal does to a borrowed expression,
   because it means no value can ever come to hold one — the situation is
   refused rather than handled. What it costs is nothing, for the reason the
   next section gives.

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

## What it actually buys, which is narrower than it looks

A conditional expression already says "derive from this, and then from that",
and says it correctly:

```html
<body :n=${mode === 'a' ? a : b}>
```

That value carries **three** dependencies — `mode`, `a` and `b`, the union of
both branches. Move `b` while the first branch is taken and `n` keeps the
right answer; flip `mode` and it follows the other source. Every switching
case anyone has wanted so far is writable today, declaratively, with the
alternatives in view.

What it does *not* do is stop depending on `b` while `b` is unused. The value
stays subscribed and re-evaluates whenever the branch nobody is reading moves.

So a reinitialization with a different dependency list buys **dependency-set
narrowing** and not expressiveness — dropping edges the declarative form has
to keep, because it cannot know which branch is live until it runs. That is a
real thing to want on a page where the unused source moves often and the
derived value is expensive, and it is a much smaller claim than
"re-initialize".

Two things follow. It lowers the priority: a performance option waits for a
page that measures badly, not for a design. And it is why the lifetime check
above costs nothing — a replacement that would outlive its scope can always be
written as a branch instead, so refusing it removes no capability.

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

Nothing to build, and less reason to than when this entry was started. (1) is
answered, and answered itself once the question was put as "what can a
replacement usefully say" rather than "which scope is tidier". The lifetime
rule under it is answered too: rejected at the check rather than handled at
disposal.

What changed the entry's weight is the section above. A conditional expression
already covers the switching cases, so this is an optimisation — narrowing a
dependency set — rather than a capability. It should wait for a page that
measures badly, and the four remaining pieces are ordinary work when one
turns up.
