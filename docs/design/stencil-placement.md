# Stencils out of the way — a comment where the markup was

Status: **built.** `:if` / `:else` / `:else-if` / `:for-data` /
`:for-each` stencils live in `<head>`, with a marker comment where the
markup was written. This file is the argument for the move, what it made
possible, what it cost, and the shapes that were rejected on the way.

The behaviour is documented in
[replication](../concepts/directives.md#the-stencil-is-not-where-you-wrote-it)
and in [the syntax reference](../reference/syntax.md).

## What it used to do

[stage1-load.ts](../../packages/core/src/compiler/stages/stage1-load.ts)'s
`wrapInTemplate()` put a `<template>` where the element was written, moved
the element inside it, and left it there. Every construct that renders
zero, one or many times goes through it — `needsStencil()` is `:for-each`,
`:for-data`, or any of the three branch spellings.

The runtime then used that one element for five different jobs, all
through `WebScope.templateEl`
([web-scope.ts](../../packages/core/src/runtime/web/web-scope.ts)):

| Job | Where |
| --- | --- |
| Am I currently showing? | `init()` — "is my previous sibling a `<template>`?" |
| Where do I go when shown | `showView()` — insert after it |
| Where do I go when hidden | `hideView()` — append into its `.content` |
| What do I stamp replicas from | `acquireCloneDom()` — clone its content |
| What do I order replicas against | `reorderClones()` — walk forward from it |

Two of those are about **position**, two about **markup**, and one about
state. It was the same element only because it happened to sit where the
markup belonged.

## What it cost

### CSS counted it

This one was already documented, which is the reason it was worth fixing
rather than documenting again:

```css
ul > li:first-child   /* never matches: the <template> is the first child */
```

`:nth-child`, `:first-child`, `:only-child`, `+`, `~`, `:has()` and `> *`
all count the stencil. `:empty` too — a container holding nothing but a
stencil is not empty. So does anything reading `children` or
`childElementCount` off `$dom`.

The advice was `:first-of-type` / `:nth-of-type`, which works and is a rule
the author had to know before it bit. It bit silently: the selector simply
never matched, which is why this was a
[silent failure](silent-failures.md) as much as a styling one.

### Foreign content broke outright

Inside `<svg>` or `<math>` there is no such thing as an HTML `<template>`.
The parser is in foreign-content mode, so what came back was an SVG element
named `template` with no `.content` at all — and `hideView()`'s
`template.content.appendChild(...)` threw on it. Not a styling
inconvenience: `:if`, `:for-data` and `:for-each` did not work inside
inline SVG.

A comment is legal everywhere in foreign content, so moving the stencil out
was half the answer. The other half is below, and it was nearly missed.

### Every replica carried a copy

A `:if` inside a `:for-each` sat in a `<template>` inside the outer
stencil, so every replica cloned the inner template *and its whole
subtree*. A thousand rows with a conditional cell held a thousand copies of
markup that was showing nowhere. With the markup held once and referenced
by a comment, each replica carries one comment. Measured, at the end of
this file.

### What it did **not** cost

Worth stating, because it was half the original motivation and turned out
not to hold: `<template>` is a *script-supporting element*, so `<table>`,
`<tbody>`, `<tr>`, `<ul>`, `<dl>`, `<select>` and `<optgroup>` all permit
it by their content models, and the HTML parser has insertion-mode support
for it in exactly those places. Markup constraints were not the argument.
CSS, foreign content and duplication were.

## The change

> **The stencil holds the markup. A comment holds the place.**

At the usage point, a marker comment. The `<template>` goes to `<head>`,
keyed by the scope id it belongs to.

It is not a new mechanism — it is the third use of one the page already had
twice:

- interpolated text is a `-t<n>` … `-/` comment pair, and the text node
  between them is found by id, never by counting siblings;
- a custom-tag usage site is a `-u<scopeId>` comment, replaced in place by
  a clone of a stencil that is found **document-wide**, because a
  `<:define>`'s stencil is nowhere near its usage
  (`WebScope.acquireUsageDom`).

Conditionals and replication were the only constructs left putting a real
element where a marker belongs.

### The marker

`-c<scopeId>.<stencilKey>`, alongside `DOM_TEXT_MARKER1` (`-t`) and
`DOM_USE_MARKER` (`-u`) in
[web-context.ts](../../packages/core/src/runtime/web/web-context.ts). The
leading `-` is what makes these collision-proof: triple-dash comments are
stripped from page source by the preprocessor before the compiler inserts
any of its own, so a page author cannot write one by accident.

**Two ids rather than one**, because they answer different questions, and
finding that out was the one real surprise of building this. A scope id is
unique only among its container's descendants — which is exactly what lets
one marker stand in every replica of a loop, each region finding the copy
in its own subtree. A stencil key has to be unique in the document, because
a `<:define>` body is *cloned per usage site that fills a slot*
(`slotUsage`), and those copies keep the scope ids of the scopes they were
copied from. Keying stencils by scope id would have given two stencils one
name on any page with two such call sites.

The marker also carries an **identity**, which the old arrangement did not.
`init()` asked "is the node to my left a `<template>`?" and inferred from
the shape; it asks "is the node to my left *my* marker?" and reads the
answer.

### Where the templates go

`<head>`, one per stencil, and the runtime indexes them from there rather
than by walking the document — see the measurement below for why that
mattered. A `<:define>`'s stencil already effectively lives there, so the
document-wide stencil lookup this needed was already written and tested.

`<body>`'s end was the alternative, and is better for one thing only: a
page with heavy conditional markup pushes kilobytes ahead of anything
visible when the stencils go first. `<head>` won on consistency with
definitions; the numbers have not asked for the other.

## The runtime: anchor and stencil are two fields

`templateEl` split along the line the table above already draws:

- `anchor: Comment` — the marker, in place, in the parent's own territory.
  `showView()` inserts after it; `acquireCloneDom()` inserts after it;
  `reorderClones()` walks forward from it; `init()` reads showing-ness off
  the node beside it.
- `stencil: Element` — the `<template>`, found by key. The only thing
  anyone clones from.

Most of the delicate code kept its shape, with a comment where an element
used to be. `foundInTemplate` bookkeeping in `WebContext` — which exists
because a `DocumentFragment` does not link back to its `<template>` — is
needed only for `<:define>` now, and the if/for paths stopped asking.
`lookupView()` and the new `lookupMarker()` share one containment walk,
which is the same rule both always wanted: everything under my parent's
element, down to but never into the next scope's.

### Hidden means detached, and nothing is ever parked in a stencil

One stencil now serves however many live scopes point at it, and that is
the one place the old arrangement was carrying weight it did not look like
it was carrying. Each replica of a `:for-each` used to clone the inner
`<template>` too, so a nested `:if` or `:for-data` parked its element into
a template *of its own*. Share one stencil naively and replica 3 parks into
the same fragment replica 7 is about to clone from.

Re-cloning on every show would fix that and break something else: a region
that comes back would come back as a different element, and
`:did-attach`/`:will-detach` are documented to bracket markup that *leaves
and returns without its scope going away*. The identity has to hold.

So the rule is neither, and it is one rule rather than two:

> **A hidden region's element is detached and held by its scope. A stencil
> is a source, cloned at most once per scope — the first time a scope needs
> an element it hasn't got.**

`showView()` re-inserts the held element after the marker; `hideView()`
takes it out and keeps the reference; nobody ever writes into a stencil.
Element identity survives any number of hide/show cycles, in a loop or out
of one — stronger than what the old arrangement guaranteed, and simpler
than what it did.

### Which stencils survive serialization

Detaching moves one question to the serializer, which is where it belongs.
A `:if` that is *showing* has its markup standing in the page, and its
stencil in `<head>` holds a second copy that nothing can ever need again:
the region hides by detaching that element and shows by putting the same
one back. So the render drops it.

Which stencils that applies to is decided at compile time and written on
the stencil as `data-markout-once`: an optional arity
(`page.optionalStencils` — `:if`, `:else`, `:else-if`, `:for-data`) that is
also not standing inside another stencil, and so can have at most one live
scope. A `:for-each`'s stencil is never dropped, because replica n+1 is
still to come; nor is a region's inside one, because the next replica's
copy is.

`dropSpentStencils` asks the scopes rather than the markup — `dom` is the
element and `isConnected` is the question, which are the two facts the
runtime already shows and hides by. Served bytes then come out at one copy
of everything:

| Case | Before | After |
| --- | --- | --- |
| `:if` / `:for-data` showing | markup in place, empty `<template>` beside it | markup in place, one comment beside it, no stencil |
| `:if` / `:for-data` hidden | markup inside the in-place `<template>` | markup inside its stencil in `<head>` |
| `:for-each`, n items | stencil + n replicas | stencil + n replicas |
| a region inside `:for-each` | inner template copied into every replica | one head stencil, one comment per replica |

The last row is the only one that moves, and it moves down.

**And the trap that came with it.** A compiled page is cached and rendered
once per request, so a stencil one response proved spent has to be back for
the next — whose data may hide the very region that was showing.
`restoreStencils` puts every one of them back, and puts them *all* back
rather than only the missing ones, so two responses to the same page are
byte-for-byte alike whatever either dropped. The same arrangement
`stateScriptAt` already lives with, and the test that pins it
([stencils.test.ts](../../packages/core/test/render/stencils.test.ts))
caught a second-render bug in the first cut: the hydration path returned
its element before resolving its stencil, so a scope that adopted what SSR
rendered answered that it had spent nothing.

A page mounted in the browser with no server rendering behind it keeps
every stencil the compiler emitted — there is no state to decide against,
and nothing rendered to make one redundant.

### A stencil in `<head>` is in the HTML namespace

The one place this arrangement cannot be naive, and it very nearly shipped
wrong.

`<circle>` means an SVG circle inside `<svg>` and an unknown HTML element
anywhere else — the namespace comes from where the parser met it, not from
the tag. A stencil in `<head>` is anywhere else. So
`<template><circle/></template>` parses into the HTML namespace, and the
clone stamped out of it is an `HTMLUnknownElement` that renders nothing.

That is worse than the crash it replaced. The old arrangement threw, and a
page that throws is a page someone fixes; this one draws nothing and says
nothing, which is the exact failure [silent
failures](silent-failures.md) exists to catalogue.

So a stencil whose markup was written inside foreign content travels with
the element that names the namespace around it:

```html
<template data-markout-stencil="q0"><svg><circle data-markout="s4"/></svg></template>
```

The wrapper is never cloned and never named anywhere else — the region
finds its own element inside the stencil **by its id**, which it now does
in every case, wrapper or no wrapper. `<foreignObject>` is the door back
out, and the walk that decides this closes it: markup written in there is
HTML again, and an `<svg>` around it would put it in the wrong namespace
just as surely.

Asserted against a real parse of the served bytes
([svg-regions.test.ts](../../packages/cli/test/server/svg-regions.test.ts)),
because the compiler's own DOM has no namespaces to get wrong — which is
precisely why the first cut passed every test it had.

## Where the relocation happens

Late — stage7, which already appends a `<template>` to `<body>` for the
class manifest and so had the vocabulary. Stages 1 through 6 see exactly
the tree they always saw, which matters more than it sounds:
`findSlots()`, `checkSlotNames()`, `checkStraySlots()` and
`optionalStencils` all reason about *tree position* — "am I inside a
stencil?" is what decides whether a slot counts as replicated. Relocating
in stage1 would have meant revisiting every one of them.

So the compiler-side change is small: `wrapInTemplate()` is as it was, plus
a `data-markout-region` marker attribute, and `relocateStencils()` in
stage7 walks the document, keys each stencil, wraps it if it was written in
foreign content, drops a comment where it stood and moves it to `<head>`.

The marker is an **attribute rather than a list on the Page** for one
reason, and it is the same reason the marker carries two ids: a `<:define>`
body holding a region is cloned per usage site that fills a slot, so the
copies exist in no list stage1 could have kept. An attribute travels with
the markup it belongs to. For the same reason, which scope a stencil
belongs to is read off the markup — the id on the element it wraps, or the
`-u` usage marker where the region is a custom tag — rather than looked up
in the scope tree: a usage instance has no element to match against, and a
definition's copies share the id of the scope they were copied from, so
neither an element nor an id identifies one scope there.

A follow-up, deliberately **not** part of this: with the wrap gone from
stage1, `:else` adjacency would no longer be destroyed as the walk goes
("by the end of this loop no element is next to the one it was written
next to"), and the `previous` / `separated` bookkeeping in `load()` could
be simpler. That is a cleanup with its own risk and belongs after, not
with.

## What it cost to build

- The most delicate file in the runtime, and two bugs that no test then in
  the suite could have shown: one that needed a *second* render, and one
  that needed a DOM with namespaces (both above).
- One latent bug found on the way, in a place that had nothing to do with
  this: `document.createElement('template')` returned an ordinary element
  with no content fragment, so anything walking the document by the rules a
  template asks for crashed on the class manifest. It now returns a
  `ServerTemplateElement`, as a browser does.
- Devtools reads slightly worse: the markup for a hidden branch is no
  longer next to where it belongs, it is in `<head>` under a key. The
  marker comment names that key, so it is one search rather than a scroll.
- `<head>` grows by whatever the page's hidden branches weigh. Those are
  the same bytes, in a different place.

## Measured

A thousand-row list, each row with a conditional cell holding a small
subtree — the shape that has the most to gain and the most to lose. Served
bytes, server render, and a browser mount over the served markup, median of
five, against the commit before this one:

| | Before | After |
| --- | --- | --- |
| served bytes | 179,321 | **132,401** (−26%) |
| server render | 34.8ms | 35.4ms |
| browser mount | 35.4ms | 38.4ms (+8%) |

The bytes are the inner stencil no longer being copied into all thousand
replicas. The mount is the other side of exactly that: what used to arrive
pre-cloned inside each replica is now one `cloneNode` per region that
shows — about 6µs each, five hundred times. It is the trade the design
makes, and this is the shape that pays the most of it: a page with a few
conditionals on it mounts as it always did.

One thing that did **not** survive measurement: the stencil index was
originally built by walking the whole document once per mount, which cost
more than everything else this change added put together. It reads the two
levels of `<head>` the stencils are actually put in.

## Rejected

**The comment carries the markup.** `<!---c5 <li>…</li> -->`, serialized
into the marker itself. Two things kill it. Comment text cannot contain
`--`, so a stencil holding a stencil needs escaping of the escaping, and
the depth compounds. And recovering it means `innerHTML`, which is exactly
what `<template>` exists to avoid: a `<tr>` stencil does not parse as a row
without a synthetic table wrapper, so the context-sensitive parsing the
platform does for free would have to be re-implemented — and paid for on
every show, against a `cloneNode` today.

**Leave it and document it.** The status quo, and the docs did document it.
It still failed silently, it still could not work inside SVG, and it still
copied markup per replica.

**A hidden ordinary element instead of a `<template>`.** `hidden` or
`display:none` on the host. CSS still counts it, `:nth-child` is still off
by one, and the host would be a live element whose contents evaluate —
which is the one thing a stencil must not be.

**Relocate only where it hurts** — inside `<table>`, `<ul>`, `<select>`.
Two behaviours for one construct, chosen by a list of tag names, and the
CSS problem is not confined to those anyway.

**Park the hidden element back in its stencil, as before.** It saves the
drop pass and costs the thing this change is worth least giving up: with
one stencil serving many scopes, a region writing itself back into it
writes into what its siblings stamp out. See "hidden means detached" above.

## What changed elsewhere

- [directives.md](../concepts/directives.md) — "the stencil is a real
  element, and CSS can see it" is now "the stencil is not where you wrote
  it"; the `:first-of-type` advice went with it.
- [syntax.md](../reference/syntax.md) — the same paragraph in the
  `:for-each` section, and the parking sentence under `:if`, which stays
  true and stops being about a `<template>`: the element is held by its
  scope.
- [silent-failures.md](silent-failures.md) — a closed row: a selector
  written against a replicated list matched nothing and said nothing.
- The Orbit demo's `:first-of-type` workaround, which is now merely
  equally correct rather than necessary.
