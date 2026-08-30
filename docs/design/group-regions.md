# Wrapper-less regions — `<:group>` with attributes

Status: **partly built.** Rules 1 and 3 are in stage1's
`resolveActiveGroups`, with the refusals that go with them; rule 2 — the
region itself — is not, and what it needs from the runtime is the last
section of this note.

## The gap

`:if` and `:for-each` are attributes, so they need an element to sit on.
That is fine until the element is not wanted, and there are cases where it
is not merely ugly but wrong:

- a `<div>` inside `<tbody>` is invalid, and the browser relocates it, so
  a conditional group of `<tr>`s has nowhere to hang its condition;
- the same for `<option>` in `<select>`, and `<dt>`/`<dd>` pairs in a
  `<dl>`;
- **grid and flex**, where an intermediate element becomes an item and
  changes the layout. The workaround is `display: contents`, which has
  known accessibility bugs;
- a component that renders a region per level pays an element per level —
  [router-kit](router-kit.md) is the current example.

Every other template language answers this: React's `<>`, Vue's
`<template v-if>`, Svelte's `{#if}`. markout has the tag already and
throws it away.

## Today, a group vanishes

[preprocessor.ts](../../packages/core/src/html/preprocessor.ts)'s
`flattenGroups` splices a `<:group>`'s children into its parent and drops
the element, before the compiler sees the document:

```html
<body>
  <:group>hello <span>there</span></:group>!
</body>
```
becomes `hello <span>there</span>!`. It nests, and it runs at preprocess
time alongside `<:include>` and triple-dash comment removal.

So the tag is a syntactic wrapper for markup that has to parse as one tree
and arrive as several nodes. Anything written **on** it is deleted with
it, which used to happen silently — `<:group :if=${x}>` rendered its
content unconditionally and said nothing, the failure
[silent-failures.md](silent-failures.md) exists to prevent. It is now
refused with a message that says to put the attribute on an element
around the group. That is the honest answer while a group cannot be one,
and the rules below are what would let it be.

## Three rules

**1. A passive group is flattened.** *(built)* No attribute, no change:
the preprocessor splices it as it always did. An active one is left
standing for the compiler.

**2. An active group with more than one child is a region.** *(not
built)* It gets a scope and a stencil like any `:if` or `:for-each` does,
and is delimited by a marker at each end rather than by the element that
used to carry the attribute. Refused with a message meanwhile.

**3. An active group with a single element child transfers its attributes
onto that child.** *(built)* `<:group :if=${x}><p>…</p></:group>` compiles
byte-for-byte as `<p :if=${x}>…</p>` — the test asserts exactly that. One
marker, no range, no new machinery.

Together, 2 and 3 mean the cost is proportional: range machinery exists
only where there is a range. Rule 3 also keeps refactoring free — adding
or removing a sibling inside a group changes the output but never the
meaning.

Whichever rule applies, **the tag goes and the content stays**, refusal
included. A directive tag left standing serializes to nothing and takes
its children with it, so a refusal that stopped early would delete the
markup it was complaining about.

### Rule 3 collapses only when it is provably identical

The transfer is an optimization, so it must never decide anything. Where
the merge is ambiguous it falls back to rule 2, which has defined
semantics for every case — a fallback, not an error, and not a warning:
the author wrote something meaningful either way.

It must fall back when:

- **the child carries the same control attribute** — or another of the
  same family. `<:group :if=${a}>` around `<div :else>` is two nested
  regions; one element cannot hold both, and rewriting it is a different
  dependency graph. Two *different* families do merge, and legitimately:
  `:if` and `:for-each` on one element is something the language already
  accepts, and the test pins the nested-group form to it.
- **the siblings are not only whitespace.** A comment or text beside the
  element is content, and content belongs inside the region.

A third condition the note used to carry — *merging would move a name* —
cannot arise as built: a value or an `:aka` on a group is refused outright
for wanting a scope the group has not got, so nothing that declares a name
ever reaches the transfer.

And whitespace-only siblings are worth one deliberate decision rather than
an accident: after a transfer they sit *outside* the region and survive
its hiding, where in rule 2 they are inside it and go with it. HTML
collapses runs of whitespace, so this is invisible except under
`white-space: pre` — which is exactly the kind of divergence worth writing
down before somebody finds it.

Diagnostics have to survive the collapse too: the dev `locs` map is keyed
`scopeId.key`, and after a transfer the key belongs to the child's scope
while the author wrote it on the group. It must name the group.

## What it takes

Reading the region path as it stands ([web-scope.ts](../../packages/core/src/runtime/web/web-scope.ts),
and [stencil-placement.md](stencil-placement.md) for why it is shaped this
way), a region today is **a marker comment plus exactly one element**:

| what | how |
| --- | --- |
| where it goes when shown | `showView()` — `insertBefore(this.dom, anchor.nextSibling)` |
| where it goes when hidden | `hideView()` — `parentNode.removeChild(this.dom)` |
| is it already there | `acquireRegionDom()` — the node after the marker, `data-markout` matching the scope id |
| what replicas stamp from | the stencil in `<head>` |

Only the first three assume one element. So:

1. **Preprocessor**: flatten a group only when it carries no attribute.
   *Built* — one condition in `flattenGroups`, and stage1 takes an active
   group from there.
2. **An end marker.** *Built.* The identity check has nothing to attach
   to — a text node cannot carry `data-markout` — so a group region is
   `[start … end]` and the three operations became range operations. The
   pair is emitted whether the region shows or not: an empty pair is what
   "hidden" looks like to a browser that has to fill it later. One comment
   per region.
3. **stage1 / stage7**: *Built.* A group with a branch takes the path an
   `:if` element takes, plus the second marker — and stage7 unwraps the tag
   afterwards, for the reason below.
4. **The clone path.** *Not built*, and the reason `:for-each` over a run
   is refused: replicating one clones a range per replica, and
   `acquireCloneDom`'s hydrated-prefix logic and `reorderClones`' forward
   walk are both per element.
5. **The allowlist**, below. *Built*, in the refusing direction: every
   attribute a group cannot carry now says which of the two reasons it is.

## What a group must refuse

There is no element, so anything that needs one is an error naming the
reason rather than an attribute quietly doing nothing:

| allowed | refused |
| --- | --- |
| `:if`, `:else-if`, `:else` | `:class-`, `:style-` |
| `:for-each`, `:for-data`, `:for-as`, `:for-key` | `:on-` handlers |
| `:aka`, declared values, `:server-` | attribute values (`:href=`, `:src=`) |

The left column is refused today only where it has nowhere to land — more
than one node inside the group, or a clash with the content's own control
attribute. The right column is refused always, in two messages that say
which is missing: *no element of its own* for what needs one to apply to,
*no scope of its own* for what needs somewhere to live. Building rule 2
turns the first refusal into behaviour and leaves the second where it is.

## What building it turned up

**The tag cannot survive compilation, even on the server.** The first
working version left the `<:group>` standing in the rendering document and
made serialization transparent instead. That rendered correctly until a
group was nested in another: the tag carries a scope id, `lookupWithin`
declines to descend into another scope's element, and the inner region
could not find its own marker — so it rendered empty on the server and
appeared on hydration, the two halves of an isomorphic render disagreeing
in silence. stage7 now unwraps every surviving group after the props are
read off the scopes, and from there the rendering document holds exactly
what a browser holds.

**`showing` is already false when `hideView` runs.** `CoreScope.toggle`
clears it first, so a range read that consulted the flag looked in the
holder at the one moment the page is what has to be emptied. The run is
read live, always.

**Replicas needed nothing.** A group inside a `:for-each` works because
each replica's marker lookup is bounded by the replica's own element, so
ids never collide — the part expected to break.

**A `<:slot>` is not a transfer target.** Rule 3 would have moved an `:if`
onto one and turned a region into an error. A group holding a lone slot is
the region form, which is exactly what a definition placing its caller's
markup conditionally needs — and what removes the wrapper element
router-kit was paying per route level.

## Open

- **Replicating a range.** Item 4 above, and why `:for-each` on a group is
  refused. Keyed reordering over runs is the part that most wants a
  prototype.
- **Nested groups.** Two active groups nested is two regions and four
  markers, which works; whether the compiler should collapse that pair the
  way rule 3 collapses a single element is unexplored.
- **Whether rule 3's fallback deserves a dev-mode note.** It is invisible
  by design, and invisible optimizations are hard to reason about when the
  output is bigger than expected.
