# The Next.js port

Not a fifth runtime. React's interaction numbers are already in the table and
this port does not produce them a second time — App Router or not, a click here
is React reconciling. It is here to be the one thing the benchmark did not have:
a peer for **Markout (server)**. Until now the only row that put anything in the
request path was compared against itself.

Read this row against that one, in four places:

| Where | What it answers |
| --- | --- |
| First card | when content exists, for two tools that both send it rendered |
| Interactive | what each one charges to make that content answer a click |
| Weight | what the payload in the document costs |
| Build time (`bench:build`) | what a developer pays per change |

## Install

Optional, and both harnesses skip it when absent:

```
cd packages/cli/bench/next-catalog && npm install
```

`bench:compare` prints `Next: skipped` and runs the other five; `bench:build`
does the same. Nothing else changes.

## The judgment calls

**The catalog is rebuilt in the browser, not serialized.** The full argument is
in the comment above `Catalog` in `app/Catalog.tsx`, because that is the line
that decides it. Short version: passing 10,020 objects across the RSC boundary
would inline megabytes of flight payload into the document, and passing the
seed integer instead does not. Both are real App Router code. This port takes
the second, which is the *favourable* one for Next — the same reason
`markout prerender` is kept out of the comparison, pointed the other way.

**`next build && next start`, never `next dev`.** Dev mode compiles on request;
timing it would time the compiler.

**This port runs React 19; `react-catalog` runs React 18.** Not a choice — Next
15 requires 19 — but it is a confound, and it is the second reason not to read
this port's interaction columns as "React plus App Router overhead". They are
React 19 plus App Router overhead, measured against a React 18 row. Pinning
`react-catalog` to 19 would remove it, at the cost of changing a column that
has a published history.

**The route is dynamic on purpose.** Reading `searchParams` opts out of static
generation, so the render happens per request. A statically prerendered variant
would be the peer of `markout prerender`, which the benchmark does not measure.

**The stylesheet is a plain `<link>` to the shared `app.css`.** Importing it
would let Next hash, split or inline it, and this port's CSS bytes would stop
being the same quantity as everyone else's in the weight table.

## Expected parity lines

Measured, not predicted — an earlier draft of this file guessed both of these
wrong.

**`NEXT-ROUTE-ANNOUNCER`, count 1.** Next injects
`<next-route-announcer style="position:absolute">` after hydration, an empty
element that holds route-change text for screen readers. It is not in the wire
markup — `curl` the page and it is not there — so it appears only in the
census, which is taken after the catalog has mounted. It is also the single
extra element behind this port's DOM-node count sitting one above everyone
else's.

**`DIV.` (no class), count 2 — the same number as the four SPA ports, for a
different reason.** Alpine, React, Svelte and Vue each count two because they
have `Section`'s unclassed `<div>` plus the root they mount into; Markout
counts one because it has no mount root. Next has no mount root either, and
still counts two: `Section`'s div, plus `<div hidden><!--$--><!--/$--></div>`,
a React Suspense boundary marker that Next adds client-side. The number agrees
with the SPA ports by coincidence. Do not read the line as Next sharing their
structure.

Anything beyond those two is drift, and the port's numbers are not comparable
until it is explained.

## What this port does not settle

Whether Nuxt would say anything different. It would be the same story told in
Vue, so it is deliberately not here — add it only if a result in this table
raises a question that is specifically about Vue.
