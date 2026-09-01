---
'@markout-lang/std-kit': minor
---

`std-params`: the query's parameters, as a source shaped like `std-data`.

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
