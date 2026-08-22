# Stencils out of the way — a comment where the markup was

Status: **proposed.** Nothing here is built. This file is the argument for
moving `:if` / `:else` / `:for-data` / `:for-each` stencils out of the
usage point, what it makes possible, what it costs, and the shapes that
were rejected on the way.

User-facing behaviour today is documented in
[replication](../concepts/directives.md#the-stencil-is-a-real-element-and-css-can-see-it)
and in [the syntax reference](../reference/syntax.md); both would lose a
paragraph if this lands.

## What happens today

[stage1-load.ts](../../packages/core/src/compiler/stages/stage1-load.ts)'s
`wrapInTemplate()` puts a `<template>` where the element was written and
moves the element inside it. Every construct that renders zero, one, or
many times goes through it — `needsStencil()` is `:for-each`, `:for-data`,
or any of the three branch spellings.

The runtime then uses that one element for five different jobs, all
through `WebScope.templateEl`
([web-scope.ts](../../packages/core/src/runtime/web/web-scope.ts)):

| Job | Where |
| --- | --- |
| Am I currently showing? | `init()` — "is my previous sibling a `<template>`?" |
| Where do I go when shown | `showView()` — insert after it |
| Where do I go when hidden | `hideView()` — append into its `.content` |
| What do I stamp replicas from | `acquireCloneDom()` — clone its content |
| What do I order replicas against | `reorderClones()` — walk forward from it |

Two of those are about **position** and two are about **markup**. It is the
same element only because it happens to sit where the markup belongs.

## What it costs

### CSS counts it

This one is already documented, which is the reason to fix it rather than
document it again:

```css
ul > li:first-child   /* never matches: the <template> is the first child */
```

`:nth-child`, `:first-child`, `:only-child`, `+`, `~`, `:has()` and `> *`
all count the stencil. `:empty` too — a container holding nothing but a
stencil is not empty. So does anything reading `children` or
`childElementCount` off `$dom`.

The docs' advice is `:first-of-type` / `:nth-of-type`, which works and is
a rule the author has to know before it bites. It bites silently: the
selector simply never matches, so this belongs in
[silent failures](silent-failures.md) as much as anywhere.

### Foreign content breaks outright

Inside `<svg>` or `<math>` there is no such thing as an HTML `<template>`.
The parser is in foreign-content mode, so what comes back is an SVG element
named `template` with no `.content` at all — and `hideView()`'s
`template.content.appendChild(...)` throws on it. A comment is legal
everywhere in foreign content. This is not a styling inconvenience; it is
`:if`, `:for-data` and `:for-each` not working inside inline SVG.

### Every replica carries a copy

A `:if` inside a `:for-each` sits in a `<template>` inside the outer
stencil, so every replica clones the inner template *and its whole
subtree*. A thousand rows with a conditional cell hold a thousand copies of
markup that is showing nowhere. With the markup held once and referenced by
a comment, each replica carries one comment.

### What it does **not** cost

Worth stating, because it was half the original motivation and it turns out
not to hold: `<template>` is a *script-supporting element*, so `<table>`,
`<tbody>`, `<tr>`, `<ul>`, `<dl>`, `<select>` and `<optgroup>` all permit
it by their content models, and the HTML parser has insertion-mode support
for it in exactly those places. Markup constraints are not the argument.
CSS, foreign content and duplication are.

## The change

> **The stencil holds the markup. A comment holds the place.**

At the usage point, a marker comment. The `<template>` goes to `<head>`,
keyed by the scope id it belongs to.

This is not a new mechanism — it is the third use of one the page already
has twice:

- interpolated text is a `-t<n>` … `-/` comment pair, and the text node
  between them is found by id, never by counting siblings;
- a custom-tag usage site is a `-u<scopeId>` comment, replaced in place by
  a clone of a stencil that is found **document-wide**, because a
  `<:define>`'s stencil is nowhere near its usage
  (`WebScope.acquireUsageDom`).

Conditionals and replication are the only constructs left that put a real
element where a marker belongs.

### The marker

`-c<scopeId>`, alongside `DOM_TEXT_MARKER1` (`-t`) and `DOM_USE_MARKER`
(`-u`) in
[web-context.ts](../../packages/core/src/runtime/web/web-context.ts). The
leading `-` is what makes these collision-proof: triple-dash comments are
stripped from page source by the preprocessor before the compiler inserts
any of its own, so a page author cannot write one by accident.

The marker carries an **identity**, which the current arrangement does not.
`init()` today asks "is the node to my left a `<template>`?" and infers
from the shape; it would ask "is the node to my left *my* anchor?" and read
the answer.

### Where the templates go

`<head>`, one per stencil. A `<:define>`'s stencil already effectively
lives there — it stays where the `<:define>` was written, and `<:import>`
is confined to `<head>` — so the runtime's document-wide stencil lookup is
already written and already tested.

`<body>`'s end was the alternative, and is better for one thing only: a
page with heavy conditional markup pushes kilobytes ahead of anything
visible when the stencils go first. Start with `<head>` for consistency
with definitions, and move if the numbers ever say so.

## The runtime: anchor and stencil are two fields

`templateEl` splits along the line the table above already draws:

- `anchor: Comment` — the marker, in place, in the parent's own territory.
  `showView()` inserts after it; `acquireCloneDom()` inserts after it;
  `reorderClones()` walks forward from it; `init()` reads showing-ness off
  it.
- `stencil: TemplateElement` — found once, document-wide, by scope id.
  The only thing anyone clones from.

Most of the delicate code stays the same shape, with a comment where an
element used to be. `foundInTemplate` bookkeeping in `WebContext` — which
exists because a `DocumentFragment` does not link back to its
`<template>` — is needed only for `<:define>` after this, and the
if/for paths stop asking.

### Hidden means detached, and nothing is ever parked in a stencil

One stencil now serves however many live scopes point at it, and that is
the one place the old arrangement was carrying weight it did not look like
it was carrying. Today each replica of a `:for-each` clones the inner
`<template>` too, so a nested `:if` or `:for-data` parks its element into a
template *of its own*. Share one stencil naively and replica 3 parks into
the same fragment replica 7 is about to clone from.

Re-cloning on every show would fix that and break something else: a region
that comes back would come back as a different element, and
`:did-attach`/`:will-detach` are documented to bracket markup that *leaves
and returns without its scope going away*. The identity has to hold.

So the runtime rule is neither, and it is one rule rather than two:

> **A hidden region's element is detached and held by its scope. A stencil
> is a source, cloned at most once per scope — the first time a scope needs
> an element it hasn't got.**

`showView()` re-inserts the held element after the anchor; `hideView()`
takes it out and keeps the reference; nobody ever writes into a stencil.
Element identity survives any number of hide/show cycles, in a loop or out
of one, which is stronger than what the current arrangement guarantees and
strictly simpler than what it does.

### Which stencils survive serialization

Detaching moves the question to the serializer, which is where it belongs:
a region hidden at the moment the page is written out has an element that
is in no document, and something has to carry that markup to the browser.
Two cases, both decidable there:

- **Not replicated** (`page.optionalStencils`, outside any `:for-each`).
  Its stencil can have no other occupant, so the element is written into
  it. The browser then finds its element inside its own stencil instead of
  after its anchor — one more place to look, in `lookupView()`, and no
  clone.
- **Replicated.** The stencil is shared, so a hidden replica's element
  cannot go in it — and needn't: the shared stencil already holds the
  markup, and the replica stamps its copy the first time it shows.

The mirror of that rule pays for the shown case: a stencil that can have at
most one occupant, whose occupant already has its element, can never be
needed again — so it is dropped. Served bytes then come out at one copy of
everything, which is what they are today:

| Case | Today | After |
| --- | --- | --- |
| `:if` / `:for-data` showing | markup in place, empty `<template>` beside it | markup in place, one comment beside it, no stencil |
| `:if` / `:for-data` hidden | markup inside the in-place `<template>` | markup inside its stencil in `<head>` |
| `:for-each`, n items | stencil + n replicas | stencil + n replicas |
| a region inside `:for-each` | inner template copied into every replica | one head stencil, one comment per replica |

The last row is the only one that moves, and it moves down.

A page mounted in the browser with no server rendering behind it keeps
every stencil the compiler emitted — there is no state to decide against,
and nothing has been rendered to make one redundant.

## Where the relocation happens

Late — stage7, which already appends a `<template>` to `<body>` for the
class manifest and so has the vocabulary. Stages 1 through 6 keep seeing
exactly the tree they see today, which matters more than it sounds:
`findSlots()`, `checkSlotNames()`, `checkStraySlots()` and `optionalStencils`
all reason about *tree position* — "am I inside a stencil?" is what decides
whether a slot counts as replicated. Relocating in stage1 would mean
revisiting every one of them.

So the compiler-side change is: keep `wrapInTemplate()` exactly as it is,
and add a pass that, for each wrapped stencil, puts a `-c<id>` comment
where the template sits and moves the template to `<head>`.

A follow-up, deliberately **not** part of this: with the wrap gone from
stage1, `:else` adjacency would no longer be destroyed as the walk goes
("by the end of this loop no element is next to the one it was written
next to"), and the `previous` / `separated` bookkeeping in `load()` could
be simpler. That is a cleanup with its own risk and belongs after, not
with.

## What it costs to build

- The most delicate file in the runtime. Five call sites, plus hydration,
  plus keyed reordering — all covered by tests, which is the reason this is
  proposable at all.
- Hydration paths change shape: a hidden region's element is no longer
  found by walking into a template at the usage site; it is stamped from
  head the first time it shows. The "reuse an already-present element by
  id" path is unchanged and does the SSR case.
- Devtools reads slightly worse: the markup for a hidden branch is no
  longer next to where it belongs, it is in `<head>` under an id. The
  anchor comment names that id, so it is one search rather than a scroll.
- `<head>` grows by whatever the page's hidden branches weigh. It is the
  same bytes, in a different place.

## Rejected

**The comment carries the markup.** `<!---c5 <li>…</li> -->`, serialized
into the marker itself. Two things kill it. Comment text cannot contain
`--`, so a stencil holding a stencil needs escaping of the escaping, and
the depth compounds. And recovering it means `innerHTML`, which is exactly
what `<template>` exists to avoid: a `<tr>` stencil does not parse as a row
without a synthetic table wrapper, so the context-sensitive parsing the
platform does for free would have to be re-implemented — and paid for on
every show, against a `cloneNode` today.

**Leave it and document it.** This is the status quo, and the docs do
document it. It still fails silently, it still cannot work inside SVG, and
it still copies markup per replica.

**A hidden ordinary element instead of a `<template>`.** `hidden` or
`display:none` on the host. CSS still counts it, `:nth-child` is still off
by one, and the host would be a live element whose contents evaluate —
which is the one thing a stencil must not be.

**Relocate only where it hurts** — inside `<table>`, `<ul>`, `<select>`.
Two behaviours for one construct, chosen by a list of tag names, and the
CSS problem is not confined to those anyway.

## Follow-ups if it lands

- [directives.md](../concepts/directives.md) — "The stencil is a real
  element, and CSS can see it" goes away; the `:first-of-type` advice with
  it.
- [syntax.md](../reference/syntax.md) — the same paragraph in the
  `:for-each` section. The parking sentence under `:if` — "its element is
  parked in a `<template>` rather than rebuilt when it comes back" — stays
  true and stops being about a `<template>`: it is held by its scope.
- [silent-failures.md](silent-failures.md) — a closed row: a selector
  written against a replicated list matched nothing and said nothing.
- A measurement worth taking before and after: a thousand-row list with a
  conditional cell, in served bytes and in mount time. The duplication
  argument is the one claim here that is cheap to check and has not been.
