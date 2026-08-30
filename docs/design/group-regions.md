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
2. **An end marker.** The identity check has nothing to attach to — a text
   node cannot carry `data-markout` — so a group region is `[start … end]`
   and the three operations become range operations. This is what Vue and
   Solid do for fragments; it costs one comment per region.
3. **stage1 / stage7**: a group with attributes takes the path an `:if`
   element takes, plus the second marker.
4. **The clone path.** `:for-each` over a group clones a range per
   replica, and `acquireCloneDom`'s hydrated-prefix logic and
   `reorderClones`' forward walk are both per element. This is the largest
   piece and the least explored.
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

## Open

- **Replicating a range.** Keyed reordering over ranges is the part of
  item 4 above that most wants a prototype before the design is trusted.
- **Nested groups.** A group directly inside a group, both active, is two
  regions with four markers; whether the compiler should collapse that
  pair the way rule 3 collapses a single element is unexplored.
- **Where the stencil goes.** Region stencils live in `<head>` and are
  restored per render; a range stencil holds several top-level nodes,
  which `restoreStencils` and `dropSpentStencils` have not seen before.
- **Whether rule 3's fallback deserves a dev-mode note.** It is invisible
  by design, and invisible optimizations are hard to reason about when the
  output is bigger than expected.
