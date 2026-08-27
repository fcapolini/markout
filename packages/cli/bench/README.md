# Benchmarks

One app, written six times — in Markout, Alpine 3, React, Svelte 5, Vue 3.6
Vapor and Next 15 — driven through the same four interactions in a real
Chromium, and weighed as well as timed. Markout appears in two rows, because it
has two deliveries an app like this would use: served by Node, and compiled by
`markout build` to resolve in the browser like the four SPA ports.

The Next port is the newest and is read differently from the rest: it is the
only other entrant that renders on the server, so it exists to give Markout's
served mode a peer in four columns rather than to be a sixth runtime. It is
also optional and not installed by default. *The Next.js row* below says why.

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
| Next | `next-catalog/` | the 10 `.tsx` components, one server route, one client boundary |

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

One port per rendering technology, not one per popular framework. Next is the
exception and is deliberately outside this count — it reuses React's rendering
entirely, and is here for its *delivery*, which is the axis *The Next.js row*
covers. Markout hangs
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

All six share `shared/catalog.mjs`, the single source of truth for the seed
data and the item-generation formula. It is plain zero-dependency JS so the
same file is importable from a bare `node` script (the Markout side, which
generates its scaled pages ahead of time), from a Vite build (the four SPA
ports) and from a webpack one (Next). They also share `markout-catalog/app.css` byte for byte, and the same
class names on the same elements — which is what lets one measurement script
drive all seven rows.

### The rating stars are deliberately naive

Every port builds the five-star rating by iterating — `:for-each`, `.map`,
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
npm run bench:catalog    # Markout only, four catalog sizes
npm run bench:compare    # all seven rows, four catalog sizes
npm run bench:build      # build time per port, no browser
```

The first two regenerate the scaled Markout pages first — `scripts/gen-bench-pages.mjs`
writes `markout-catalog/bench-30.html`, `bench-1000.html` and
`bench-10000.html`, which are gitignored. `bench:compare` additionally runs `npm run build` in each of the
four Vite ports and serves the production output through `vite preview` —
React on 4410, Svelte on 4411, Alpine on 4412, Vue on 4413 — while Markout is
served by the CLI's own `Server` on an ephemeral port. Nothing is measured
against a dev build.

Each port takes `?rows=N`. The Markout side gets the same four sizes as files
instead — `index.html` at 300 rows and three generated beside it — because its
catalog is written in the page.

`next-catalog` is the exception to all of that. It is optional and not
installed by default — both harnesses print `Next: skipped` and carry on
without it. `cd next-catalog && npm install` turns it on; after that
`bench:compare` builds it with `next build` and serves it with `next start` on
4415, and `bench:build` times its `next build`. See
`next-catalog/PORT-NOTES.md` for why it is a separate, optional, partial row
rather than a sixth port.

`bench:build` needs no browser and no generated page — it times each port's
own build command over the committed source. It runs Markout through the
built CLI rather than through `tsx`, so `npm run build` in `packages/cli` has
to have happened; loading the compiler through a TypeScript hook would time
the hook.

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
  every port loads identical Unsplash URLs, which is the app's content, not the
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
fixed and only the model count grows: **30**, **300**, **1,020** and **10,020**
rows.

**30 is the size that matters most**, and it is the one this benchmark went
without for too long. It is one model — six categories, five finishes — and it
is roughly the size a real page of this shape is. A cost that only shows at
10,020 is a curiosity; a cost that shows at 30 is one a visitor waits for.

10,020 is the other end, past what any of these tools is really for and past
what real apps will most likely need. It is in the set because costs invisible
at 300 are legible at 10,020, and because the mount and filter columns are
close to linear in row count — so a gap that only appears at the top is a real
gap, not noise. Having both ends is what shows which costs are structural and
which are just scale.

The filter step searches for `Model0001 Ash` rather than `Model0001`, and the
30-row size is why: a 30-row catalog has exactly one model, so the shorter term
matches every row, the card count never changes, and the harness waits forever
for a change that cannot come. The longer term leaves exactly **6** rows
standing at every size — the number destroyed scales with the catalog, the
number surviving does not, which is the shape that column wants.

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
  constant in every port.
- Every port renders the same DOM, and that is checked rather than assumed. The
  Markout port once wrote `<mk-section class="catalog">`, which **replaces**
  the definition's own `class="panel"` rather than adding to it (`class+=`
  adds) — so its panel rendered with no background, no border and 51px more
  inner width than the other three, and every Markout number was measured
  against a different box. The compiler warned on every page load; the harness
  was passing `logger: () => {}` over the top of it. Both harnesses now print
  `warn` and above.
- The ports are close in size — 327 lines for Markout, 328 for Alpine, 356 for
  Svelte, 451 for React, comments included. Next runs about 70 lines above
  React measured the same way, and nearly all of it is the two files React does
  not need (a server route and a root layout) plus the comment block explaining
  the RSC-boundary decision. That is a sanity check that no port
  was quietly given less work to do, not a metric.

## Results

Markout 0.6.1 — `@markout-lang/core` and `@markout-lang/cli`, runtime at
`68168a5`. The harness stamped `+dirty` on this run because the bench scripts
were uncommitted, not the runtime. Alpine 3.16.3, React 18.3.1, Svelte 5.56.9
and Vue 3.6.0-rc.5 in Vapor mode, all four via Vite 5.4.21; Next 15.5.24 on
React 19.2.8. Apple M1 Pro, macOS 26.5.2, Node 24.4.0, Chromium 151.0.7922.34
(Playwright). Measured 2026-08-27. Timings are the median of 5; weight is a
single pass.

Every number below comes from that one run. The previous set was Markout 0.6.0
at `70724ab` and is not mixed in here — a Next row pasted into tables measured
against a different runtime would be the exact failure this section's
provenance line exists to prevent.

The commit matters more than the version here: a whole release cycle of runtime
work lands under one version. `bench:compare` prints both above its table,
along with a `+dirty` marker if anything in `packages/cli` or `packages/core`
was uncommitted — paste that line in with any numbers that replace these.

### Interactions

All four columns in milliseconds, median of 5, one table per catalog size.
**Bold marks the best in each column.**

**30 rows** — one model, six categories, five finishes, and the size a real
page of this shape usually is.

| Target | Mount all | Filter | Sort | 20× add-to-cart |
| --- | --- | --- | --- | --- |
| Markout (server) | 2.0 | 1.4 | **3.9** | **14.3** |
| Markout (build) | 1.7 | 1.3 | 4.0 | 16.4 |
| Alpine | 3.0 | 5.8 | 12.2 | 16.8 |
| React | 2.2 | **1.1** | 10.8 | 17.0 |
| Svelte | **1.4** | 5.5 | 16.7 | 16.6 |
| Vue | 2.0 | 8.5 | 16.8 | 16.5 |
| Next | 1.9 | 1.7 | 10.2 | 16.7 |

**300 rows** — ten models. It is the size `markout-catalog/index.html` is
written at; the other three sizes are generated from it.

| Target | Mount all | Filter | Sort | 20× add-to-cart |
| --- | --- | --- | --- | --- |
| Markout (server) | 45.0 | 5.6 | 27.9 | 17.9 |
| Markout (build) | 45.2 | 5.4 | 28.0 | **14.2** |
| Alpine | 97.0 | 14.5 | 29.9 | 31.4 |
| React | 12.7 | **3.2** | 28.2 | 16.6 |
| Svelte | **10.7** | 3.5 | **27.6** | 16.6 |
| Vue | 12.9 | 3.4 | 28.3 | 16.6 |
| Next | 11.9 | 3.4 | 30.6 | 16.2 |

**1,020 rows** — thirty-four models.

| Target | Mount all | Filter | Sort | 20× add-to-cart |
| --- | --- | --- | --- | --- |
| Markout (server) | 139.2 | 20.8 | **85.8** | 23.8 |
| Markout (build) | 146.6 | 20.7 | 87.1 | 22.6 |
| Alpine | 275.2 | 40.0 | 113.8 | 16.0 |
| React | 38.6 | 7.1 | 107.3 | **12.6** |
| Svelte | **29.1** | 6.4 | 112.4 | 16.9 |
| Vue | 35.2 | **6.0** | 93.4 | 15.3 |
| Next | 36.2 | 7.7 | 105.0 | 19.5 |

**10,020 rows** — three hundred and thirty-four models: the stress end, past
what any of these tools is really for. Costs invisible at 300 are legible
here.

| Target | Mount all | Filter | Sort | 20× add-to-cart |
| --- | --- | --- | --- | --- |
| Markout (server) | 1269.9 | 165.8 | 1014.9 | 249.6 |
| Markout (build) | 1312.8 | 158.2 | 1164.0 | 292.7 |
| Alpine | 2559.2 | 357.8 | 1046.6 | 71.5 |
| React | 502.3 | 79.5 | 955.3 | **62.7** |
| Svelte | **268.5** | 40.6 | **796.4** | 71.0 |
| Vue | 315.4 | **36.8** | 809.7 | 69.9 |
| Next | 428.2 | 73.5 | 945.6 | 68.2 |

Sixteen bolds across sixteen columns: Svelte six, React four, Markout four
(three served, one built), Vue two — and **Alpine and Next take none**.

Next taking none is the expected result and the reason this port is not read
as a fifth runtime. Its interaction columns are React's columns: mount within
6% of React at three sizes of four, filter and sort within a few percent
everywhere. Where it does diverge — 428ms against React's 502ms mounting
10,020 rows — the likeliest cause is not the App Router at all but React 19
against `react-catalog`'s React 18, which is a version gap this table cannot
separate out. Read the Next row in the three tables below instead; those are
the ones it is here for.

Markout's three served bolds are at 30 and 1,020 rows, and it takes nothing at
all at 10,020 — which is the shape *Reading them* below is about.

### First content

When content appears, as opposed to how fast it updates once it is there.
Unsplash is stubbed with a 1×1 PNG so this measures the tool rather than a CDN;
the CSS sizes every card image with `aspect-ratio: 1.4; width: 100%`, so layout
is unchanged.

| Target | First card (ms) | Interactive (ms) | Cards without JS | FCP (ms) |
| --- | --- | --- | --- | --- |
| Markout (server) @ 30 | 13.4 | 38.1 | **24** | 36.0 |
| Markout (build) @ 30 | 18.7 | 18.7 | 0 | 40.0 |
| Alpine @ 30 | 32.2 | 32.2 | 0 | 20.0 |
| React @ 30 | 20.1 | 20.1 | 0 | 40.0 |
| Svelte @ 30 | 15.7 | **15.7** | 0 | 36.0 |
| Vue @ 30 | 21.5 | 21.5 | 0 | 44.0 |
| Next @ 30 | **10.6** | 57.8 | **24** | 32.0 |
| Markout (server) @ 300 | 13.8 | 38.0 | **24** | 36.0 |
| Markout (build) @ 300 | 19.2 | 19.2 | 0 | 40.0 |
| Alpine @ 300 | 33.1 | 33.1 | 0 | 20.0 |
| React @ 300 | 20.1 | 20.1 | 0 | 44.0 |
| Svelte @ 300 | 16.5 | **16.5** | 0 | 36.0 |
| Vue @ 300 | 19.0 | 19.0 | 0 | 40.0 |
| Next @ 300 | **10.4** | 56.7 | **24** | 32.0 |
| Markout (server) @ 1,020 | 12.4 | 37.2 | **24** | 36.0 |
| Markout (build) @ 1,020 | 22.1 | 22.1 | 0 | 44.0 |
| Alpine @ 1,020 | 33.7 | 33.7 | 0 | 20.0 |
| React @ 1,020 | 19.8 | 19.8 | 0 | 40.0 |
| Svelte @ 1,020 | 17.1 | **17.1** | 0 | 36.0 |
| Vue @ 1,020 | 20.0 | 20.0 | 0 | 40.0 |
| Next @ 1,020 | **9.8** | 56.5 | **24** | 32.0 |
| Markout (server) @ 10,020 | 20.8 | 51.0 | **24** | 44.0 |
| Markout (build) @ 10,020 | 25.8 | 25.8 | 0 | 44.0 |
| Alpine @ 10,020 | 44.9 | 44.9 | 0 | 24.0 |
| React @ 10,020 | 24.4 | 24.4 | 0 | 48.0 |
| Svelte @ 10,020 | 20.3 | **20.3** | 0 | 40.0 |
| Vue @ 10,020 | 22.7 | 22.7 | 0 | 44.0 |
| Next @ 10,020 | **11.1** | 60.1 | **24** | 32.0 |

**Read this as a delivery comparison, not a rendering one**, which is why
Markout is here twice. Served, it arrives with its rows in the markup. Built,
it ships a compiled artifact that fills itself in — the same shape as the four
SPA ports, and the row to read against them. React and Vue *can* render on the
server and those ports do not; that is each tool's default setup, not its
ceiling. Alpine is the only one with no server story of its own to reach for.
Next is the one port that does render on the server, which is why it is here.

**Next takes first card at every size, and Markout served loses that column.**
9.8–11.1ms against 12.4–20.8ms: content is on screen sooner from Next at all
four catalog sizes. The cause is visible in the weight table — Markout's served
document is 60KB where Next's is 27.6KB, because Markout carries the page's
expressions and scope tree in the document itself. More markup to parse before
the first card exists.

**Markout served takes the column next to it, by a wider margin.** Interactive
— when a click on those cards actually does something — is 37.2–51.0ms for
Markout against 56.5–60.1ms for Next, at every size. Turn the two columns into
the gap between them and the shapes separate cleanly:

| | First card | Interactive | Gap |
| --- | --- | --- | --- |
| Markout (server) @ 1,020 | 12.4 | 37.2 | 24.8ms |
| Next @ 1,020 | 9.8 | 56.5 | 46.7ms |

Next arrives 2.6ms earlier and stays inert for nearly twice as long. Both ship
the same 24 cards in the markup; what differs is what has to happen afterwards
before those cards respond — and 350KB of JavaScript reconciling a server-
rendered tree is more of it than 27KB walking a scope graph.

**Interactive is a real thing a visitor can hit**, not a synthetic metric: a
button on screen that does nothing yet. It is also why the harness needs a
handshake at all. The measurement script clicks a chip as soon as it sees one,
and on both server-rendered rows that chip exists long before it works, so
every target declares an expression that is true only once its handlers are
live and nothing is timed until it holds. The alternative — a fixed sleep —
would fold hydration into the mount column silently.

For a port that builds its own content in the browser the two columns are
identical, and that is not a tie: the content existing and the handlers
existing are the same instant, because the same code produced both. Those rows
report one measurement twice.

**On its own terms, Markout built is competitive and Alpine is not.** Ignore
the two served rows and compare the five client-rendering artifacts: first card
at 18.7 / 19.2 / 22.1 / 25.8ms, ahead of React at the two smaller sizes and
behind it at the two larger, close to Vue throughout, a shade behind Svelte at
all four, and 1.5–1.7× faster than Alpine at every size
— which is the comparison this benchmark exists for.

**`Cards without JS` is the same fact with no stopwatch**: load each page with
JavaScript disabled and count what is on it. 24 for the two server-rendered
rows, 0 for everything else including Markout built. A `<template>` is inert,
so Alpine's markup correctly counts zero — its rows do not exist until Alpine
runs. This is the column that says what a server delivery buys and a built one
gives up, and it is the one place Markout served and Next are simply level.

**FCP is in this table because it is misleading, and that is worth showing
once.** It fires on the first contentful paint of *anything*, and every page
here has a static header. Alpine posts the best FCP at every size — 20ms at
three of them — while rendering none of the catalog, and is the slowest of all seven to
a real card at every size. That is the `x-cloak` gap scoring well on the metric
people quote. It is also why this benchmark reports no Lighthouse score: the
composite would be built on that number, on a stress harness, over a CDN.
**First card** is the column with the meaning, and **Interactive** is the one
that keeps it honest.

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

### The Next.js row

Everything above this section compares Markout's SERVED mode to Markout. The
four ports it is read against are Vite SPAs, so `markout build` has peers and
the row that puts Node in the request path has none — which left the delivery
this whole benchmark is arranged around measured only against itself.

`next-catalog/` is that missing peer, and it is deliberately a *partial* one.
Its interaction columns are React's columns and it takes no bolds in any of
them. Four columns are the ones it is here for:

| Column | Markout (server) | Next | Reading |
| --- | --- | --- | --- |
| First card @ 1,020 | 12.4ms | **9.8ms** | Next |
| Interactive @ 1,020 | **37.2ms** | 56.5ms | Markout |
| Total gzip | **17.6 KB** | 108.8 KB | Markout, 6.2× |
| Build | **261ms** | 8,147ms | Markout, 31× |

**Next wins first card, at every size.** That is a genuine loss for Markout
served and the most useful thing this port produced. The cause is in the weight
table: Markout's served document is 60 KB against Next's 27.6 KB, because
Markout carries the page's expressions and scope tree in the document. There is
more to parse before the first card exists.

**Markout wins the three columns either side of it.** Interactive by ~19ms at
every size, wire weight by 6.2×, and build time by 30×. The pattern is the same
one three times: Next spends bytes and build seconds to arrive 2.6ms earlier
and then stays inert for nearly twice as long.

**Interactive is new to this document and Next is why it exists.** A page built
by its own JavaScript has one instant — content and handlers appear together,
because the same code made both. A page that arrives rendered has two, and the
gap is a real thing a visitor can hit: a button on screen that does nothing
yet. It is a correctness requirement before it is a metric. The measurement
script clicks a chip as soon as it sees one, and on a server-rendered page that
chip is in the wire markup long before it works, so every target now declares an
expression that is true only once handlers are live, and nothing is timed until
it holds. A fixed sleep would have folded hydration into the mount column
silently. Both expressions are documented on the `Target` interface in
`../scripts/bench-compare.ts`.

**Two caveats, both in Next's favour.** The port passes the catalog *seed*
across the RSC boundary and rebuilds in the browser rather than serializing
10,020 objects into the flight payload; both are real App Router code and this
is the lighter one, chosen for the same reason `markout prerender` is kept out
of the comparison. And it runs React 19 where `react-catalog` runs React 18,
which is forced by Next 15 and is a second reason not to read its interaction
columns as React-plus-overhead. `next-catalog/PORT-NOTES.md` has both in full,
along with the two parity lines the port is expected to add.

**Adding the port also found a bug in the harness.** Next is the first entrant
to preload a script with `<link rel=preload as=script>`, and `measureWeight`
classified every `link` initiator as CSS — filing 3.3 KB of JavaScript in the
stylesheet column. The classifier now decides on the extension. No other port
was affected, and the totals never were, but the split was wrong for exactly as
long as nothing preloaded anything.

**Nuxt is not here.** It would tell the same story in Vue, at the cost of a
second heavyweight install and a second thing to keep current. Add it if a
number in this table raises a question that is specifically about Vue.

### Build time

The cost nobody in the first-content table pays: turning source into the
artifact that gets shipped. A visitor never waits for it, but a developer
waits for it on every change, which makes it the number felt most often.

Every build command is timed at the same layer — the whole command, process
startup included, because that is the wall clock somebody actually watches.
The one row that is not a command is Markout's served mode, explained under
the table. Caches are cleared before each run: `dist/`, Vite's dependency pre-bundle in
`node_modules/.vite`, and tsc's `tsconfig.tsbuildinfo`. A run that keeps them
times the cache rather than the build. `npm run` is not a tax on the four Vite
ports — measured against a direct `npx vite build`, it is the faster of the
two — so each runs its own build script unchanged.

| Target | Build | What runs |
| --- | --- | --- |
| Markout (server) | **33ms** | compile, on the first request for a page |
| Markout (build) | **261ms** | `markout build` |
| Alpine | 599ms | `vite build` — bundles the library, compiles nothing |
| React | 1,472ms | `tsc -b && vite build` |
| Svelte | 884ms | `vite build` |
| Vue | 1,005ms | `vite build` |
| Next | 8,147ms | `next build` |

Same machine and toolchain as the tables above, measured 2026-08-27; median of
5 after a discarded warm-up, and the run-to-run spread is a few percent except
React's, which moves by about 100ms.

**One caveat on the built row, found while adding Next.** Invoked from a
shell, `node dist/cli.js build …` takes about 155ms, not 261ms; `node` alone
starts in 30ms and loading the CLI's module graph brings it to about 120ms.
The harness spawns each build from its own already-loaded parent process, and
that costs roughly 110ms of extra wall clock per spawn. Every row pays it, so
the table is internally consistent — but it is 40% of Markout's number and
1.3% of Next's, so it distorts the *ratios* in Markout's disfavour. An earlier
published run recorded 162ms here, close to the shell figure; 261–277ms
reproduced across four runs today, with and without the Next port present. The harness's
spawn cost is the difference, and removing it is a fix this table still wants.

Markout appears twice for the usual reason, but here the two rows differ by
more than the artifact. **`markout build`** is a command someone runs, so its
number includes Node starting up and loading the CLI. **Served**,
that startup is already paid: the process is up and the compiler is loaded, so
the 33ms is the whole of it, and it is what the first request for a page
costs. The server caches the compiler's output per page and renders that per
request, so the first visitor to a page waits for the compile and everyone
after waits only for the render — which is why the `Server` column in the
table above is warm on purpose and excludes it. That cache is emptied by any
change anywhere under the docroot, which makes it a development cost rather
than a production one: in production nothing under the docroot changes, so
each page pays it once for the life of the process; while editing, it comes
back on the next request after every save.

**Only the built row compares like for like with the four.** It is a cold
build measured against cold builds. The served row is a warm process
compiling one page, and the four have a warm mode of their own — a Vite dev
server applying an incremental update, which for three of them is HMR and for
Alpine is a reload — that this table does not measure. Read it as
what Markout's server does on a first request, not as a race it won.

The margin is wide either way: on the built row, 3.4× against Svelte's 884ms,
5.6× against React's and 31× against Next's 8.1 seconds; on the served row,
27× against Svelte and 247× against Next. The four run a
bundler, which resolves a module graph, pre-bundles dependencies, tree-shakes
and minifies; Markout reads one HTML file and writes one HTML file, because
the app was already in a format a browser accepts and the runtime it links is
a fixed file that was built when Markout was.

**Next's 8.1 seconds is the widest gap in this document**, and unlike the
interaction columns it is not React's number wearing a different label —
React's own build is 1,472ms including its typecheck. The remaining ~6.7
seconds is the App Router's: two compilation environments, route collection,
static generation of the routes that can be static, and build traces. A
developer pays it on every change, which makes it the cost met most often, and
it is the one column where the difference between a tool designed around a
server and a tool that grew one is measured in seconds rather than
milliseconds.

**Alpine's row is a packaging cost, not a compile, and it is the one row that
could be deleted outright.** Alpine has no compiler and no component step: its
599ms is Vite bundling and minifying the Alpine library together with the
shared catalog generator, and the markup in `index.html` ships exactly as
written. That is what `npm install alpinejs` gives an app, and this port is
set up that way so it is measured as production output like the others —
but Alpine's own answer is the one it is known for, a `<script src>` tag and
**no build at all**. The cost of taking it is shipping the library as the CDN
serves it rather than bundled and minified with the app, which would move
Alpine's weight row rather than its timing rows. Read 599ms as what this
port's packaging costs, not as something Alpine requires.

That is worth holding next to Markout's own rows, because it is the same claim
Markout makes. Alpine and Markout are the two here that can be delivered with
no build step, and the difference is what each does with the markup: Alpine's
`<script src>` ships the page and the library and interprets attributes in the
browser, while Markout's served mode compiles the page once and caches it, at
the 33ms above.

React's number is the one that needs a caveat, and it is not a Vite caveat:
run separately, `tsc -b` and `vite build` split its time about 59/41, so the
typecheck is roughly 870ms of the 1,472ms and the bundling is roughly 600ms —
which puts React's bundler right alongside Alpine's. That typecheck is the
build React ships with in this port, though, and dropping it to "make the
comparison fair" would time a build nobody runs. What each row says is what
that port asks a developer to wait for, and a typecheck is part of React's
answer.

This table is one page's build, which is where it stops being a proxy for a
real project. Bundler time grows with the module graph, so a real app's four
Vite numbers grow well past these; Markout's does not have a module graph to
grow, but its per-page compile does multiply by the page count, and its
startup cost is paid once no matter how many pages follow. A ten-page site is
about one startup + 10 × the per-page compile, not 10 × 261ms.

### Weight

| Target | HTML (KB) | JS (KB) | CSS (KB) | Total gzip (KB) | Heap (MB) | DOM nodes |
| --- | --- | --- | --- | --- | --- | --- |
| Markout (server) @ 30 | 60.0 | 27.4 | 6.0 | 17.4 | 3.2 | 748 |
| Markout (build) @ 30 | 19.5 | 27.4 | 6.0 | **15.4** | 3.2 | 748 |
| Alpine @ 30 | 9.1 | 56.8 | 6.0 | 24.4 | 4.6 | 748 |
| React @ 30 | 0.4 | 147.8 | 6.0 | 49.6 | 2.6 | 748 |
| Svelte @ 30 | 0.4 | 47.9 | 6.0 | 20.2 | **2.4** | 748 |
| Vue @ 30 | 0.4 | 116.6 | 6.0 | 45.4 | 2.6 | 748 |
| Next @ 30 | 27.6 | 351.6 | 6.0 | 108.8 | 3.3 | 749 |
| Markout (server) @ 300 | 60.1 | 27.4 | 6.0 | 17.5 | 11.3 | 6,688 |
| Markout (build) @ 300 | 19.6 | 27.4 | 6.0 | **15.5** | 11.3 | 6,688 |
| Alpine @ 300 | 9.1 | 56.8 | 6.0 | 24.4 | 22.7 | 6,688 |
| React @ 300 | 0.4 | 147.8 | 6.0 | 49.6 | **4.4** | 6,688 |
| Svelte @ 300 | 0.4 | 47.9 | 6.0 | 20.2 | 4.6 | 6,688 |
| Vue @ 300 | 0.4 | 116.6 | 6.0 | 45.4 | 5.2 | 6,688 |
| Next @ 300 | 27.6 | 351.6 | 6.0 | 108.8 | 5.0 | 6,689 |
| Markout (server) @ 1,020 | 60.4 | 27.4 | 6.0 | 17.6 | 33.0 | 22,528 |
| Markout (build) @ 1,020 | 19.9 | 27.4 | 6.0 | **15.5** | 33.0 | 22,528 |
| Alpine @ 1,020 | 9.1 | 56.8 | 6.0 | 24.4 | 70.7 | 22,528 |
| React @ 1,020 | 0.4 | 147.8 | 6.0 | 49.6 | **8.9** | 22,528 |
| Svelte @ 1,020 | 0.4 | 47.9 | 6.0 | 20.2 | 9.9 | 22,528 |
| Vue @ 1,020 | 0.4 | 116.6 | 6.0 | 45.4 | 11.4 | 22,528 |
| Next @ 1,020 | 27.6 | 351.6 | 6.0 | 108.8 | 9.4 | 22,529 |
| Markout (server) @ 10,020 | 63.9 | 27.4 | 6.0 | 18.4 | 297.7 | 220,528 |
| Markout (build) @ 10,020 | 23.4 | 27.4 | 6.0 | **16.3** | 296.6 | 220,528 |
| Alpine @ 10,020 | 9.1 | 56.8 | 6.0 | 24.4 | 669.7 | 220,528 |
| React @ 10,020 | 0.4 | 147.8 | 6.0 | 49.6 | 64.5 | 220,528 |
| Svelte @ 10,020 | 0.4 | 47.9 | 6.0 | 20.2 | 79.6 | 220,528 |
| Vue @ 10,020 | 0.4 | 116.6 | 6.0 | 45.4 | 89.7 | 220,528 |
| Next @ 10,020 | 27.6 | 351.6 | 6.0 | 108.8 | **63.7** | 220,529 |

**Markout is the lightest thing here over the wire, in both modes and at every
size.** Built, 15.5 KB gzipped; served, 17.5 KB — against Svelte's 20.2,
Alpine's 24.4, Vue's 45.4, React's 49.6 and Next's 108.8. Neither moves much
with the catalog: 15.4 → 16.3 and 17.4 → 18.4 across a 334× row increase.

**Next is the heaviest by a distance: 108.8 KB gzipped, 6.2× Markout served.**
351.6 KB of uncompressed JavaScript, against React's 147.8 for the same
components — the difference is the App Router's client runtime, and it is fixed
overhead that does not shrink for a smaller app. This is the column where the
server delivery is paid for, and it is worth reading next to first card: Next
wins that by ~2.6ms and spends 91 KB gzipped to do it.

Its 27.6 KB document deserves one clarification, because it looks better than
the 60 KB Markout serves. Both carry 24 rendered cards. Markout's extra 32 KB
is the page's expressions and scope tree; Next's document is smaller because
this port passes the catalog *seed* across the RSC boundary and rebuilds in the
browser. Serializing the catalog instead — which a large number of real App
Router codebases do — would put megabytes of flight payload in that document at
10,020 rows. The favourable configuration was chosen deliberately; see
`next-catalog/PORT-NOTES.md`.

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
10,020 rows it holds 297.7 MB against Next's 63.7, React's 64.5 and Svelte's
79.6 — 4.7×, 4.6× and 3.7× — where the mount gap is 2.5–4.8×. This is the
16-scopes-per-card cost from the root `TODO.md` measured in bytes rather than
milliseconds, and it is the clearest single argument for the per-unit-weight
work that entry lists. It also scales worse than linearly against the others:
2.5× Svelte at 300 rows, 3.3× at 1,020, 3.7× at 10,020.

That Next holds the *lowest* heap of all seven at 10,020 rows is the sharpest
form of the point. The heaviest thing on the wire is the lightest thing in
memory, and the two costs are genuinely independent — bytes shipped once
against bytes held for the life of the page.

**Alpine is heavier still, which is the one place it loses outright.** 669.7 MB
at 10,020 rows, 2.2× Markout and 8.4× Svelte, plus 20,048 `<template>` hosts
that exist only to anchor its `x-for` loops. It is the heaviest at 30 rows too
— 4.6 MB against Markout's 3.2 and Svelte's 2.4 — so this one is not a scale
artefact either.

**DOM node counts agree exactly, except Next's, which is one higher at every
size** — 749 / 6,689 / 22,529 / 220,529 against everyone else's 748 / 6,688 /
22,528 / 220,528. That one element is `<next-route-announcer>`, which Next
injects after hydration to hold route-change text for screen readers. It is not
in the wire markup at all; `curl` the page and it is absent. The census is
taken after mount, so it appears there.

Otherwise the counts hold: body elements, no `<template>`, no `<script>`.
Counting scripts used to put the two Markout modes one apart, since a built
page carries one more, which is not rendered content and not something a parity
check should have an opinion about. That is the contract holding.

### Reading them

**Against Alpine, which is the comparison that matters.** Markout wins the two
columns that dominate a real catalog page, and wins them at every size: mount
is about 2× faster from 300 rows up (2.17×, 1.98×, 2.00×), filter 2.0–2.8×
faster at every size. That gap is stable across a 33× range of row counts,
which is what makes it a property rather than a data point. At 30 rows the
mount gap narrows to 1.5× — both are fast enough there that it stops
mattering, which is worth saying rather than quoting the biggest number.
Weight cuts the same way on the wire and the other way in memory — see above.

**Sort is a wash for everyone above 30 rows.** 24–29ms at 300 and 0.8–1.1s at
10,020, regardless of tool: it is a keyed DOM reorder, and no reactivity system
avoids paying for the moves. At 30 rows it is not a wash at all — Markout sorts
in 3.9ms against Next's 10.2, React's 10.8 and Svelte's and Vue's 16.7, which
is 2.6–4.3× and the largest margin Markout has anywhere in this file.

**Markout is the outlier on repeated small mutations at scale.** 20×
add-to-cart at 10,020 rows: Markout 249.6ms served against React's 62.7,
Next's 68.2, Vue's 69.9, Svelte's 71.0 and Alpine's 71.5 — 3.5× the *slowest*
of the other five. It is emphatically not a small-page problem: at 30 rows
Markout is the fastest of all seven at 14.3ms. The cost appears
with scale, which points at per-row structure rather than per-event work. This
is the structural cost noted in the root `TODO.md` — a card builds 16 scopes,
so the page builds ~160,000 of them — showing up on mutation rather than on
mount. The heap column above is the same cost weighed instead of timed. It is
the number to fix, and the number not to omit.

**At 30 rows the mount gap is gone.** Markout builds the page in 1.7ms
against Svelte's 1.4, Next's 1.9, Vue's 2.0 and React's 2.2 — 0.3ms off the
fastest, ahead of three of them. That matters more than it looks: 16 scopes per card is a
*scale* cost, and at the size most pages of this shape actually are, it does
not show. Everything below about mount is about what happens when a page is
ten to three hundred times bigger than that.

**Against the framework ports, from 300 rows up, Markout loses mount by
2.5–4.8×.**
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
on Svelte's axis rather than React's, and the numbers agree: at 10,020 rows
Vue mounts in 315.4ms against Svelte's 268.5 and React's 502.3, and it is the
*fastest* of all seven on filter at 36.8ms. Its sort at 1,020 rows (93.4ms)
beats React, Svelte and Next alike. Its one weak spot is the opposite end: at
30 rows it filters in 8.5ms, the slowest of the seven, where Markout takes
1.4.
Compiled-no-VDOM is a tier, and Vue is now in it — so a reader who knows Vue
can locate the others against a number they recognise.

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

- **Anything over a network.** Every number is localhost. First card and
  Interactive both shift under real latency, and they shift by different
  amounts — a bundle that has to arrive before the page works is hurt more by
  a slow link than markup that is already useful. The two server-rendered rows
  would separate further, not less, but by how much is not measured here.
- **Any Next configuration but this one.** One route, dynamic, seed passed
  across the RSC boundary. Partial prerendering, a cached route, or a port that
  serializes the catalog would each move its rows, and the last of those would
  move them a long way.
- **Nuxt, or any second server-rendering port.** See *The Next.js row*.
- **Anything under memory pressure.** Heap is read once, on an idle page, on a
  machine with plenty free.
- **Anything about correctness, ergonomics or what a mistake costs**, which is
  where the root README's Alpine comparison actually rests — and which is the
  argument that matters more than any column here.
- **Pages that are not this shape.** A catalog is a lot of small components
  over one dominant list. A form-heavy page, a dashboard of independent
  widgets, a document — none of those are measured, and their costs need not
  look like these.

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
6. If the port renders on the SERVER, give its target a `ready` expression —
   its controls are in the markup before they work, and without one the harness
   clicks dead buttons. Give it an `interactiveAt` too, so the gap is reported
   rather than merely waited out. A port that builds its own content in the
   browser needs neither.
7. Write down the judgment calls you had to make, next to the code that makes
   them. Every one of them is a place the comparison could have been rigged.
8. Run it and read the DOM parity block. A new port should add no new lines
   there; if it does, its markup differs from everyone else's and its numbers
   are not comparable yet. `text:` lines matter as much as structural ones — a
   port that renders `$105` where the rest render `$106` has drifted.
