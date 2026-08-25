# Benchmarks

One app, written five times — in Markout, Alpine 3, React, Svelte 5 and Vue
3.6 Vapor — driven through the same four interactions in a real Chromium, and
weighed as well as timed. Markout appears in two rows, because it has two
deliveries an app like this would use: served by Node, and compiled by
`markout build` to resolve in the browser like the other four.

The point is not to win a chart. It is to know where Markout actually stands
against the tools its users are choosing between, including the columns where
it loses. Markout is of course much younger than the other three, and this is
how we find out which of those columns need optimization work.

## The app

`markout-catalog/` is a product catalog: a stats board, a search box, three
facet groups, a paged grid of cards, and a cart. Every card has an image, a
five-star rating, a spec list, a stock line and an add button. It was chosen
because it is the shape of page these tools are for — a lot of small
components, a lot of derived state, and one list that dominates everything.

| | Source | Components |
| --- | --- | --- |
| Markout | `markout-catalog/` | 10 `<:define>`s |
| Alpine | `alpine-catalog/` | 1 `Alpine.data()`, no markup components |
| React | `react-catalog/` | 10 `.tsx` components |
| Svelte | `svelte-catalog/` | 10 `.svelte` components |
| Vue | `vue-catalog/` | 10 `.vue` components, Vapor mode |

That Alpine row needs a word, because "no components" would be too blunt.
Alpine reuses *behavior* perfectly well: `Alpine.data(name, fn)` registers a
state-and-methods object that any element can adopt with `x-data="name"`, and
`Alpine.bind(name, fn)` does the same for a bundle of attributes. What it has
no primitive for is reusable *markup* — there is no way to declare a
parameterized chunk of HTML and instantiate it, the way `<:define>`, a `.tsx`
function and a `.svelte` file all do. Alpine's answer is that markup reuse
belongs to whatever renders the page — Blade, ERB, Twig, a Django include — or
is written out where it is used. This app has no such layer, so the card is
written once, inline. That is a fair reflection of Alpine, not a handicap
imposed on it.

### Why these five

One port per rendering technology, not one per popular framework. Markout hangs
a scope graph on the real DOM; Alpine walks the real DOM from attributes, with
no build step; React diffs a virtual DOM at runtime; Svelte compiles to direct
DOM operations with no virtual DOM at all.

Vue is here in **Vapor mode** (`3.6.0-rc.5`), which is the version of Vue that
is actually different. Ordinary Vue 3 would not have earned a slot: it is a
virtual-DOM framework in the same family as React, and a port of it would tell
us where Vue lands between two numbers we already have. Vapor compiles
components to direct DOM operations with no virtual DOM — verified rather than
assumed, by building against the unminified runtime and confirming the output
contains `renderEffect`, `setText`, `createFor` and `createVaporApp` and no
`createVNode`/`createElementBlock` at all.

Strictly, that puts Vue on Svelte's axis rather than an axis of its own, and
the honest reason to keep both is that Vue is the far more likely thing a
reader is already using — a number they can locate themselves against is worth
the parity cost. It is an RC, so treat its row as provisional.

The Vue that is still missing is its global build with in-DOM templates:
script tag, markup in the page, no build step. That is a *delivery* mode the
set lacks rather than a rendering strategy it lacks, and it is the mode Markout
itself claims. (`petite-vue`, the obvious candidate there, last published
0.4.1 in May 2022.)

The Markout port is laid out the way a modular Markout app is meant to be —
the page at `markout-catalog/index.html`, its components beside it in
`markout-catalog/app-kit/`, and one relative `<:import src="app-kit/all.htm">`
joining them. `app-kit` gathers `parts/base.htm`, `chrome.htm`, `facets.htm`,
`product.htm` and `cart.htm` behind a single entry point, so the page names one
file and the split behind it stays the kit's business. The kit lives inside
the app because it belongs to it: nothing else imports it, and a relative
import says that where a docroot-absolute one would suggest a shared library.
Its stylesheet is linked the same way — `href="app.css"`, not
`/markout-catalog/app.css` — so the whole app is one directory that can be
renamed or moved without editing anything inside it.

All five share `shared/catalog.mjs`, the single source of truth for the seed
data and the item-generation formula. It is plain zero-dependency JS so the
same file is importable from a bare `node` script (the Markout side, which
generates its scaled pages ahead of time) and from a Vite build (the other
three). They also share `markout-catalog/app.css` byte for byte, and the same
class names on the same elements — which is what lets one measurement script
drive all six rows.

### The rating stars are deliberately naive

All five ports build the five-star rating by iterating — `:for-each`, `.map`,
`{#each}`, `x-for` — over `[1, 2, 3, 4, 5]` and emitting a `<span>` per star.
An app that cared would not do this. It would render one element and clip it
with a CSS width, or emit a single string of five glyphs and colour a prefix,
turning five reactive units per card into zero.

That is the point. Ten of the sixteen scopes a Markout card builds are two
small loops like this one, and Svelte's ten `cloneNode` calls include five for
the same stars. Writing them the efficient way would remove real work from
every port at once and make the benchmark measure less. It is a stress test:
the loops stay so the per-unit cost of a replicated, reactive, keyed thing is
what the numbers are made of.

The same applies to the three-item spec list under each card.

## Running them

```
npm run bench:catalog    # Markout only, three catalog sizes
npm run bench:compare    # all six rows, three catalog sizes
```

Both regenerate the scaled Markout pages first — `scripts/gen-bench-pages.mjs`
writes `markout-catalog/bench-1000.html` and `bench-10000.html`, which are
gitignored. `bench:compare` additionally runs `npm run build` in each of the
four Vite ports and serves the production output through `vite preview` —
React on 4410, Svelte on 4411, Alpine on 4412, Vue on 4413 — while Markout is
served by the CLI's own `Server` on an ephemeral port. Nothing is measured
against a dev build.

Each port takes `?rows=N`. The Markout side gets the same three sizes as
generated files instead, because its catalog is written in the page.

## What is measured

Four interactions, in this order, on a page that has already loaded and
mounted its first 24 cards:

| | What it does | What it costs |
| --- | --- | --- |
| **Mount all** | clicks the largest page-size chip | creating every row at once |
| **Filter** | types `Model0001` into the search box | destroying almost every row |
| **Sort** | clicks *Price up* | keyed DOM moves, no create or destroy |
| **20× add-to-cart** | clicks the first 20 buy buttons | 20 rapid unbatched mutations, each touching three independent consumers |

Five timed repeats per size, plus one discarded warm-up, reported as the
median. A fresh page per repeat.

**The timing is polled, not bracketed.** Alpine, React, Svelte and Vue all
batch
DOM updates onto a scheduler tick after the click handler returns; Markout
happens to be synchronous. Timing from `.click()` to the next statement would
measure "handler dispatched" for every port but Markout, and "DOM updated" for
Markout — a comparison Markout would lose for a reason that isn't real. So the
harness polls on `requestAnimationFrame` until the DOM actually reflects the
change, which is the latency a user perceives, for all of them.

## What weight is measured

Speed is not the only cost a page has, so `bench:compare` prints a second
table:

- **Bytes** — the page's own HTML, JS and CSS, uncompressed and gzipped here in
  Node at a fixed level rather than read off the wire. Whether a server happens
  to compress is a property of the server, not of the tool, and Markout is
  served by its own `Server` while the others go through `vite preview`;
  reading `transferSize` would compare configurations. Images are excluded —
  all five load identical Unsplash URLs, which is the app's content, not the
  tool's weight. Only the **total** is comparable across ports: Markout carries
  its app in the document where the other four carry theirs in a bundle, so the
  HTML/JS split says where the weight sits, not how much there is.
- **Heap** — used JS heap after a forced GC with the whole catalog mounted.
  This is where a per-row structure turns into megabytes, and no timing column
  shows it.
- **DOM parity** — a check, not a metric. Every port renders the same markup,
  so every tag+class count must agree; two structural differences are expected
  and named in the output, and anything else means the ports have drifted.
  This is the check that would have caught `class="catalog"` silently replacing
  the definition's `class="panel"` — a node *count* would not have, since that
  bug changed an attribute and not the number of elements.

## The catalog sizes

`categories × models × finishes`, where categories (6) and finishes (5) are
fixed and only the model count grows: **300**, **1,020** and **10,020** rows.

10,020 is past what any of these tools is really for, and past what real apps
will most likely need. It is in the set because costs that are invisible at 300
are legible at 10,020, and because the mount/filter columns are close to linear
in row count — so a gap that only appears at the top is a real gap, not noise.

The id formula spaces categories by `models × finishes` rather than a
hardcoded constant. That is load-bearing: with a fixed spacing, ids collide
across categories once the model count changes, which starves keyed
reconciliation of a real key and forces every port into spurious
destroy-and-recreate churn on reorder. It is the kind of bug that makes a
benchmark measure nothing.

## The parity contract

A comparison is only worth the care taken to keep it fair, so:

- Same data, same CSS, same class names, same DOM structure, same interactions.
- Each port is written the way its own community would write it — idiomatic,
  not translated. That includes using each one's memoization: React's
  `useMemo`, Svelte's `$derived`, Markout's cached `:name=`.
- **Alpine has no memoized derived value.** A getter re-runs on every read, so
  the six bindings that want the filtered list would each re-filter the whole
  catalog. The Alpine port therefore recomputes into plain state once per state
  change, and keeps cart membership in a mutated `Set` rather than a derived
  one. Both are what an Alpine app this size has to do, and both are commented
  where they appear. Writing it the naive way would have produced a number that
  says more about the port than about Alpine.
- Nobody's catalog constant is handed to a deep reactive proxy. It is a
  constant in all five.
- All five render the same DOM, and that is checked rather than assumed. The
  Markout port once wrote `<mk-section class="catalog">`, which **replaces**
  the definition's own `class="panel"` rather than adding to it (`class+=`
  adds) — so its panel rendered with no background, no border and 51px more
  inner width than the other three, and every Markout number was measured
  against a different box. The compiler warned on every page load; the harness
  was passing `logger: () => {}` over the top of it. Both harnesses now print
  `warn` and above.
- The ports are close in size — 327 lines for Markout, 328 for Alpine, 356 for
  Svelte, 451 for React, comments included. That is a sanity check that no port
  was quietly given less work to do, not a metric.

## Results

Markout 0.6.0 — `@markout-lang/core` and `@markout-lang/cli`, runtime at
`56000b4`. The harness stamped `+dirty` on this run because the bench apps
were uncommitted, not the runtime. Alpine 3.16.3, React 18.3.1, Svelte 5.56.9
and Vue 3.6.0-rc.5 in Vapor mode, all four via Vite 5.4.21. Apple M1 Pro, macOS
26.5.2, Node 24.4.0, Chromium 151.0.7922.34 (Playwright). Measured 2026-08-25.
Timings are the median of 5; weight is a single pass.

The commit matters more than the version here: a whole release cycle of runtime
work lands under one `0.6.0`, and mount moved 19% inside it. `bench:compare`
prints both above its table, along with a `+dirty` marker if anything in
`packages/cli` or `packages/core` was uncommitted — paste that line in with any
numbers that replace these.

| Target | Mount all | Filter | Sort | 20× add-to-cart |
| --- | --- | --- | --- | --- |
| Markout (server) @ 300 | 47.1 | 5.0 | 27.1 | 13.2 |
| Markout (build) @ 300 | 44.6 | 5.0 | 27.2 | 13.8 |
| Alpine @ 300 | 98.3 | 15.9 | 33.5 | 30.6 |
| React @ 300 | 14.2 | 3.5 | 31.9 | 16.5 |
| Svelte @ 300 | 10.9 | 5.6 | 28.2 | 16.5 |
| Vue @ 300 | 13.0 | 5.2 | 23.3 | 16.5 |
| Markout (server) @ 1,020 | 139.2 | 21.0 | 85.1 | 25.2 |
| Markout (build) @ 1,020 | 144.7 | 20.5 | 88.7 | 20.6 |
| Alpine @ 1,020 | 271.2 | 42.8 | 111.8 | 16.0 |
| React @ 1,020 | 38.8 | 7.0 | 104.2 | 11.3 |
| Svelte @ 1,020 | 29.4 | 8.6 | 110.6 | 16.7 |
| Vue @ 1,020 | 35.7 | 8.1 | 90.6 | 16.2 |
| Markout (server) @ 10,020 | 1258.1 | 163.0 | 1023.5 | 236.3 |
| Markout (build) @ 10,020 | 1312.6 | 160.1 | 1153.5 | 269.5 |
| Alpine @ 10,020 | 2565.0 | 370.8 | 1009.5 | 64.6 |
| React @ 10,020 | 501.0 | 78.4 | 965.1 | 72.1 |
| Svelte @ 10,020 | 271.8 | 44.8 | 820.9 | 74.6 |
| Vue @ 10,020 | 316.3 | 40.8 | 817.3 | 71.4 |

### First content

When content appears, as opposed to how fast it updates once it is there.
Unsplash is stubbed with a 1×1 PNG so this measures the tool rather than a CDN;
the CSS sizes every card image with `aspect-ratio: 1.4; width: 100%`, so layout
is unchanged.

| Target | First card (ms) | Cards without JS | FCP (ms) |
| --- | --- | --- | --- |
| Markout (server) @ 300 | **15.8** | **24** | 36.0 |
| Markout (build) @ 300 | 19.6 | 0 | 40.0 |
| Alpine @ 300 | 39.2 | 0 | 24.0 |
| React @ 300 | 21.3 | 0 | 48.0 |
| Svelte @ 300 | 17.7 | 0 | 40.0 |
| Vue @ 300 | 18.7 | 0 | 40.0 |
| Markout (server) @ 1,020 | **13.5** | **24** | 36.0 |
| Markout (build) @ 1,020 | 20.3 | 0 | 40.0 |
| Alpine @ 1,020 | 33.0 | 0 | 20.0 |
| React @ 1,020 | 20.0 | 0 | 40.0 |
| Svelte @ 1,020 | 17.9 | 0 | 40.0 |
| Vue @ 1,020 | 19.3 | 0 | 40.0 |
| Markout (server) @ 10,020 | **19.8** | **24** | 44.0 |
| Markout (build) @ 10,020 | 25.3 | 0 | 44.0 |
| Alpine @ 10,020 | 41.9 | 0 | 20.0 |
| React @ 10,020 | 24.3 | 0 | 44.0 |
| Svelte @ 10,020 | 20.6 | 0 | 40.0 |
| Vue @ 10,020 | 23.3 | 0 | 44.0 |

**Read this as a delivery comparison, not a rendering one**, which is why
Markout is here twice. Served, it arrives with its rows in the markup. Built,
it ships a compiled artifact that fills itself in — the same shape as the four
SPA ports, and the row to read against them. React and Vue *can* render on the
server and these ports do not; that is each tool's default setup, not its
ceiling. Alpine is the only one with no server story of its own to reach for.

**On its own terms, Markout built is competitive and Alpine is not.** Ignore
the served row and compare the five client-rendering artifacts: first card at
19.6 / 20.3 / 25.3ms, ahead of React at two sizes of three, a shade behind
Svelte and Vue, and roughly twice as fast as Alpine at every size — which is
the comparison this benchmark exists for.

**`Cards without JS` is the same fact with no stopwatch**: load each page with
JavaScript disabled and count what is on it. 24 for Markout served, 0 for
everything else including Markout built. A `<template>` is inert, so Alpine's
markup correctly counts zero — its rows do not exist until Alpine runs. This is
the column that says what the served mode buys and the built mode gives up.

**FCP is in this table because it is misleading, and that is worth showing
once.** It fires on the first contentful paint of *anything*, and all five
pages have a static header. Alpine posts the best FCP here — 24ms at 300 rows
— while rendering none of the catalog, and is the slowest of all six to a real
card at every size. That is the `x-cloak` gap scoring well on the metric
people quote. It is also why this benchmark reports no Lighthouse score: the
composite would be built on that number, on a stress harness, over a CDN.
**First card** is the column with the meaning.

### Server, build, and the one that is not here

Markout has three deliveries and the benchmark measures two of them, because
those are the two an app like this would have.

**`markout build`** compiles and stops: values resolve in the browser, exactly
as they do in the four SPA ports. That is the row to read against them, and it
is the row that needs nothing standing up to produce — no server, no reachable
backend.

**Served** puts Node in the request path. The render runs per request, so the
page arrives with its rows already in the markup.

**`markout prerender`** is deliberately absent. It runs the render once at
build time and freezes the result into the artifact, which is the right answer
for a documentation site whose content is fixed when it ships — and the wrong
one for a catalog, whose rows are the kind of thing that changes without a
redeploy. Measuring it here would flatter Markout with a mode nobody would
deploy for this app.

What separates served from built, over 25 requests each, median, warm:

| Rows | Server | Built file | Cost of the render |
| --- | --- | --- | --- |
| 300 | 5.30ms | 0.54ms | 4.8ms |
| 1,020 | 5.59ms | 0.43ms | 5.2ms |
| 10,020 | 11.27ms | 0.54ms | 10.7ms |

That is the honest answer to "what does putting Node in the request path
cost": about 5ms on this page, about 11ms at a catalog size nobody ships. What
it buys is in the first-content table — content in the markup, and 24 cards
for a visitor with JavaScript off.

### Weight

| Target | HTML (KB) | JS (KB) | CSS (KB) | Total gzip (KB) | Heap (MB) | DOM nodes |
| --- | --- | --- | --- | --- | --- | --- |
| Markout (server) @ 300 | 60.1 | 27.4 | 6.0 | 17.5 | 11.3 | 6,688 |
| Markout (build) @ 300 | 19.6 | 27.4 | 6.0 | **15.5** | 11.3 | 6,688 |
| Alpine @ 300 | 9.1 | 56.8 | 6.0 | 24.4 | 22.7 | 6,688 |
| React @ 300 | 0.4 | 147.8 | 6.0 | 49.6 | 4.4 | 6,688 |
| Svelte @ 300 | 0.4 | 47.9 | 6.0 | 20.2 | 4.6 | 6,688 |
| Vue @ 300 | 0.4 | 116.6 | 6.0 | 45.4 | 5.2 | 6,688 |
| Markout (server) @ 1,020 | 60.4 | 27.4 | 6.0 | 17.6 | 33.0 | 22,528 |
| Markout (build) @ 1,020 | 19.9 | 27.4 | 6.0 | **15.5** | 33.1 | 22,528 |
| Alpine @ 1,020 | 9.1 | 56.8 | 6.0 | 24.4 | 70.7 | 22,528 |
| React @ 1,020 | 0.4 | 147.8 | 6.0 | 49.6 | 8.9 | 22,528 |
| Svelte @ 1,020 | 0.4 | 47.9 | 6.0 | 20.2 | 10.0 | 22,528 |
| Vue @ 1,020 | 0.4 | 116.6 | 6.0 | 45.4 | 11.4 | 22,528 |
| Markout (server) @ 10,020 | 63.9 | 27.4 | 6.0 | 18.4 | 297.7 | 220,528 |
| Markout (build) @ 10,020 | 23.4 | 27.4 | 6.0 | **16.3** | 296.6 | 220,528 |
| Alpine @ 10,020 | 9.1 | 56.8 | 6.0 | 24.4 | 669.7 | 220,528 |
| React @ 10,020 | 0.4 | 147.8 | 6.0 | 49.6 | 64.5 | 220,528 |
| Svelte @ 10,020 | 0.4 | 47.9 | 6.0 | 20.2 | 79.6 | 220,528 |
| Vue @ 10,020 | 0.4 | 116.6 | 6.0 | 45.4 | 89.8 | 220,528 |

**Markout is the lightest thing here over the wire, in both modes and at every
size.** Built, 15.5 KB gzipped; served, 17.5 KB — against Svelte's 20.2,
Alpine's 24.4, Vue's 45.4 and React's 49.6. Neither moves much with the
catalog: 15.5 → 16.3 and 17.5 → 18.4 across a 33× row increase.

The HTML/JS split is where the shape shows. Served, Markout ships a 60.1 KB
document and a 27.4 KB runtime; built, the document falls to 19.6 KB because
the rows are no longer in it. The four SPA ports ship a 0.4 KB shell and put
everything in a bundle. Markup compresses better than code, which is why the
served page wins on the total while looking largest uncompressed, and why the
built page — the one directly comparable to the SPAs — wins outright.

Worth naming the caveat before someone else does: Alpine's 24.4 KB is for a
tool that needs no build step at all, and Markout's 17.5 KB assumes the
compiled output. It is a fair comparison of what the browser downloads, not of
what the project costs to set up.

**Heap is the column Markout loses worst, and by more than any timing.** At
10,020 rows it holds 297.7 MB against React's 64.5 and Svelte's 79.6 — 4.6×
and 3.7× — where the mount gap is 2.4–4.8×. This is the 16-scopes-per-card
cost from the root `TODO.md` measured in bytes rather than milliseconds, and
it is the clearest single argument for the per-unit-weight work that entry
lists. It also scales worse than linearly against the others: 2.5× Svelte at
300 rows, 3.2× at 1,020, 3.7× at 10,020.

**Alpine is heavier still, which is the one place it loses outright.** 669.7 MB
at 10,020 rows, 2.2× Markout and 8.4× Svelte, plus 20,048 `<template>` hosts
that exist only to anchor its `x-for` loops.

**DOM node counts agree exactly** — 6,688 / 22,528 / 220,528, every row.
They count what the census counts: body elements, no `<template>`, no
`<script>`. Counting scripts used to put the two Markout modes one apart, since
a built page carries one more, which is not rendered content and not something
a parity check should have an opinion about. That is the contract holding.

### Reading them

**Against Alpine, which is the comparison that matters.** Markout wins the two
columns that dominate a real catalog page, and wins them at every size: mount
is about 2× faster (2.09×, 1.95×, 2.04× as rows grow), filter 2.0–3.2×
faster. That gap is stable across a 33× range of row counts, which is what
makes it a property rather than a data point. Weight cuts the same way on the
wire and the other way in memory — see above.

**Sort is a wash for everyone.** 23–34ms at 300 rows and 0.8–1.2s at 10,020,
regardless of tool. It is a keyed DOM reorder, and no reactivity system can
avoid paying for the moves.

**Markout is the outlier on repeated small mutations at scale.** 20×
add-to-cart at 10,020 rows: Markout 236.3ms served against Alpine's 64.6,
React's 72.1, Vue's 71.4 and Svelte's 74.6 — 3.2× the *slowest* of the other
four. It is not a small-page problem: at 300 rows Markout is 13.2ms, the
fastest of all six, and at 1,020 it is 2.2× off the best. The cost appears
with scale, which points at per-row structure rather than per-event work. This
is the structural cost noted in the root `TODO.md` — a card builds 16 scopes,
so the page builds ~160,000 of them — showing up on mutation rather than on
mount. The heap column above is the same cost weighed instead of timed. It is
the number to fix, and the number not to omit.

**Against the three framework ports, Markout loses mount by 2.5–4.7×.**
Compiling `Card.svelte` and reading the output says where that goes. Svelte
emits ten `cloneNode` calls per card — the article shell, three spec `<li>`s,
the rating span, five stars — plus ten `template_effect`s, two component
instances and two keyed `each` blocks. Markout builds sixteen scopes. The unit
counts are in the same range; what differs is what a unit weighs. Svelte's is
a closure over a text node; Markout's is a scope with a values object, a
children array, a cache `Map`, a `Proxy` and a `CoreValue` per binding.

So the gap is not that Svelte collapses a card into one clone. Both levers are
real, and the root `TODO.md` has measured each: removing ten scopes per card
returned 46% of mount, and making each remaining scope allocate less returned
19%.

**Vue Vapor lands where the technology says it should, which is worth
recording because it was a prediction.** `Why these five` argues Vapor belongs
on Svelte's axis rather than React's, and the numbers agree: at 10,020 rows Vue
mounts in 316.3ms against Svelte's 271.8 and React's 501.0, and it is the
*fastest* of the four SPA ports on filter at 40.8ms. Its sort at 1,020 rows
(90.6ms) beats both React and Svelte. Compiled-no-VDOM is a tier, and
Vue is now in it — so a reader who knows Vue can locate the others against
a number they recognise.

Its weight tells the other half: 45.4 KB gzipped, second heaviest after React,
because Vapor changes how a component renders and not how much framework ships
to render it.

**A caveat that cuts against us.** Every mount number here is client-side
rendering of the whole catalog, which is the thing Markout's served-markup
story says you should not be doing — a Markout page can arrive with its rows
already in the HTML, and none of `mount all` measures that. The benchmark
makes every port do the same client-side work because that is the only way the
column compares. Read it as a stress test of the runtime, not as what a
Markout page costs a visitor.

## What this does not measure

Worth being explicit about, since a benchmark's silences get read as claims:

- **Time-to-first-content.** Bytes and heap are measured now; *when* content
  appears is not, and that is where Markout's two delivery modes differ most
  from Alpine's.
- **Compile and build time.** `LAST-MILE.md` has the Markout figures.
- **Anything under memory pressure.** Heap is read once, on an idle page, on a
  machine with plenty free.
- **Anything about correctness, ergonomics or what a mistake costs**, which is
  where the root README's Alpine comparison actually rests — and which is the
  argument that matters more than any column here.
- **Small pages.** Nothing here says what a 30-row page costs, and that is most
  pages.

## Adding a port

1. Copy the app faithfully — same class names on the same elements, or the
   shared measurement script will not find its handles. In particular it needs
   `button.chip` (the four page-size chips first in DOM order), a
   `.chip` reading exactly `Price up`, `input[type=search]`, `.card`, and
   `.card .buy`.
2. Import `shared/catalog.mjs`. Do not re-implement the formula.
3. Read `?rows=N` and divide by 30 for the model count.
4. Copy `markout-catalog/app.css` into the port's static directory, and link
   it relatively. The measurement script refuses to run against a page whose
   stylesheet did not apply — an unstyled page lays out differently and would
   otherwise produce plausible, meaningless numbers.
5. Add a directory, a port number and a target entry in
   `../scripts/bench-compare.ts`.
6. Write down the judgment calls you had to make, next to the code that makes
   them. Every one of them is a place the comparison could have been rigged.
7. Run it and read the DOM parity block. A new port should add no new lines
   there; if it does, its markup differs from everyone else's and its numbers
   are not comparable yet. `text:` lines matter as much as structural ones — a
   port that renders `$105` where the rest render `$106` has drifted.
