# @markout-lang/std-kit

## 0.4.0

### Minor Changes

- 8d121f7: `std-router` nests. A router written inside a route owns the next segment of
  the query path — `?about/team` is `about` outside and `team` within — so a
  section's screens can share a layout without either level being told its own
  ancestry: each asks the nearest router above it, through `$outer`.
  
  A level the address says nothing about falls to its own `::defaultPage`, so
  `?about` shows that section's index. Links are written whole from the root;
  there is no relative form.
- 46c3cf1: `std-router` and `std-route`: an app router keyed on the query string, so the
  same markup is a single-page app where the browser has the Navigation API and
  a multi-page one where it does not — with nothing to configure on the server
  either way, since every route is the same static file.
  
  The router discovers its routes rather than being told them, and resolves
  while rendering, so the served markup already shows the right page. An address
  naming no page at all — a bare `/`, or a page built with no address — gets
  `::defaultPage`; one naming a page that does not exist gets `::fallback`,
  which follows `::defaultPage` unless given one of its own, so a site with no
  404 screen never names it twice. A route publishes `::selected`, which a page
  can read for nav highlighting.
- 48599d0: `std-params`: the query's parameters, as a source shaped like `std-data`.
  
  `<std-params :aka="q" />` hands the page `q.data` — the parameters as a plain
  object — and `q.href({ page: 2 })`, a relative link for this page with those
  changes merged in. `null` removes a parameter; a second argument moves the
  page and keeps them.
  
  `href` is the reason it is more than `$url.searchParams`: round-tripping a
  query through `URLSearchParams` turns the router's page path into
  `user%2Forders=`, which no router reads back.
  
  The line between the two is now stated once and read the same way by both
  parts: the query's leading segment is the page path, and a segment carrying
  `=` is a parameter, never a page. So `?user=42` is a parameter to both, where
  before `std-router` would have selected a route called `user`.

Entries below are the released history, written after the fact in 2026-08
when [Changesets](https://github.com/changesets/changesets) was adopted. From
then on each entry is generated from the changeset files committed with the
work. Anything older than 0.4.0 is in the git history rather than here.

## 0.3.0

### Minor Changes

- Rewritten against
  [`@markout-lang/core@0.5.0`](https://github.com/fcapolini/markout/blob/main/packages/core/CHANGELOG.md):
  `std-data`'s parameters are declared and passed with `::`.

## 0.2.x

`std-data`, the datasource component — a value whose contents are fetched
rather than written down, computed while the page renders and carried to the
browser with it. A component rather than a language feature, which is the
point: [kits carry the framework layer](https://github.com/fcapolini/markout/blob/main/docs/concepts/kits.md).
