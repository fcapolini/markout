# Benchmarks

One app, written four times — in Markout, Alpine 3, React and Svelte 5 — and
driven through the same four interactions in a real Chromium.

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
| Alpine | `alpine-catalog/` | none — Alpine has no component system |
| React | `react-catalog/` | 10 `.tsx` components |
| Svelte | `svelte-catalog/` | 10 `.svelte` components |

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

All four share `shared/catalog.mjs`, the single source of truth for the seed
data and the item-generation formula. It is plain zero-dependency JS so the
same file is importable from a bare `node` script (the Markout side, which
generates its scaled pages ahead of time) and from a Vite build (the other
three). They also share `markout-catalog/app.css` byte for byte, and the same
class names on the same elements — which is what lets one measurement script
drive all four.

### The rating stars are deliberately naive

All four ports build the five-star rating by iterating — `:for-each`, `.map`,
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
npm run bench:compare    # all four, three catalog sizes
```

Both regenerate the scaled Markout pages first — `scripts/gen-bench-pages.mjs`
writes `markout-catalog/bench-1000.html` and `bench-10000.html`, which are
gitignored. `bench:compare` additionally runs `npm run build` in each of the
three Vite ports and serves the production output through `vite preview` —
React on 4410, Svelte on 4411, Alpine on 4412 — while Markout is served by the
CLI's own `Server` on an ephemeral port. Nothing is measured against a dev
build.

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

**The timing is polled, not bracketed.** Alpine, React and Svelte all batch
DOM updates onto a scheduler tick after the click handler returns; Markout
happens to be synchronous. Timing from `.click()` to the next statement would
measure "handler dispatched" for three of the four and "DOM updated" for
Markout — a comparison Markout would lose for a reason that isn't real. So the
harness polls on `requestAnimationFrame` until the DOM actually reflects the
change, which is the latency a user perceives, for all four.

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
  constant in all four.
- All four render the same DOM, and that is checked rather than assumed. The
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
`2093d22`. The harness stamped `+dirty` on this run because the bench apps
themselves were uncommitted, not the runtime. Alpine 3.16.3, React 18.3.1 and
Svelte 5.56.9, all three via Vite 5.4.21. Apple M1 Pro, macOS 26.5.2, Node
24.4.0, Chromium 151.0.7922.34 (Playwright). Measured 2026-08-25. Median of 5,
in milliseconds.

The commit matters more than the version here: a whole release cycle of runtime
work lands under one `0.6.0`, and mount moved 19% inside it. `bench:compare`
prints both above its table, along with a `+dirty` marker if anything in
`packages/cli` or `packages/core` was uncommitted — paste that line in with any
numbers that replace these.

| Target | Mount all | Filter | Sort | 20× add-to-cart |
| --- | --- | --- | --- | --- |
| Markout @ 300 | 44.3 | 5.4 | 27.9 | 16.8 |
| Alpine @ 300 | 96.0 | 15.6 | 31.4 | 29.7 |
| React @ 300 | 13.0 | 3.1 | 29.5 | 16.9 |
| Svelte @ 300 | 11.1 | 5.5 | 28.0 | 16.6 |
| Markout @ 1,020 | 138.9 | 20.5 | 85.6 | 23.0 |
| Alpine @ 1,020 | 271.9 | 39.6 | 112.8 | 16.0 |
| React @ 1,020 | 37.1 | 6.9 | 97.5 | 17.3 |
| Svelte @ 1,020 | 28.0 | 8.4 | 110.0 | 16.3 |
| Markout @ 10,020 | 1258.1 | 162.7 | 1019.1 | 244.3 |
| Alpine @ 10,020 | 2527.3 | 372.0 | 1029.4 | 63.6 |
| React @ 10,020 | 528.4 | 80.6 | 970.9 | 71.6 |
| Svelte @ 10,020 | 271.6 | 43.4 | 814.1 | 70.0 |

### Reading them

**Against Alpine, which is the comparison that matters.** Markout wins the two
columns that dominate a real catalog page, and wins them at every size: mount
is about 2× faster (2.17×, 1.96×, 2.01× as rows grow), filter 1.9–2.9×
faster. That gap is stable across a 33× range of row counts, which is what
makes it a property rather than a data point.

**Sort is a wash for all four.** 28–31ms at 300 rows and 0.8–1.0s at 10,020,
regardless of tool. It is a keyed DOM reorder, and no reactivity system can
avoid paying for the moves.

**Markout is the outlier on repeated small mutations at scale.** 20×
add-to-cart at 10,020 rows: Markout 244.3ms against Alpine's 63.6, React's 71.6
and Svelte's 70.0. Markout is 3.4× the *slowest* of the other three, having been
level with them at 300 (16.8, and the fastest of the four) and 1.4× off at
1,020. This is the structural cost noted in the root
`TODO.md` — a card builds 16 scopes, so the page builds ~160,000 of them —
showing up on mutation rather than on mount. It is the number to fix, and the
number not to omit.

**Against React and Svelte, Markout loses mount by 2.4–5.0×.** Compiling
`Card.svelte` and reading the output says where that goes. Svelte emits ten
`cloneNode` calls per card — the article shell, three spec `<li>`s, the rating
span, five stars — plus ten `template_effect`s, two component instances and
two keyed `each` blocks. Markout builds sixteen scopes. The unit counts are in
the same range; what differs is what a unit weighs. Svelte's is a closure over
a text node; Markout's is a scope with a values object, a children array, a
cache `Map`, a `Proxy` and a `CoreValue` per binding.

So the gap is not that Svelte collapses a card into one clone. Both levers are
real, and the root `TODO.md` has measured each: removing ten scopes per card
returned 46% of mount, and making each remaining scope allocate less returned
19%.

**A caveat that cuts against us.** Every mount number here is client-side
rendering of the whole catalog, which is the thing Markout's served-markup
story says you should not be doing — a Markout page can arrive with its rows
already in the HTML, and none of `mount all` measures that. The benchmark
makes all four do the same client-side work because that is the only way the
column compares. Read it as a stress test of the runtime, not as what a
Markout page costs a visitor.

## What this does not measure

Worth being explicit about, since a benchmark's silences get read as claims:

- **Served bytes and time-to-first-content.** Where Markout's two delivery
  modes differ most from Alpine's, and not measured here at all.
- **Compile and build time.** `LAST-MILE.md` has the Markout figures.
- **Memory.**
- **Anything about correctness, ergonomics or what a mistake costs**, which is
  where the README's Alpine comparison actually rests.
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
