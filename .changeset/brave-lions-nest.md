---
'@markout-lang/std-kit': minor
---

`std-router` nests. A router written inside a route owns the next segment of
the query path — `?about/team` is `about` outside and `team` within — so a
section's screens can share a layout without either level being told its own
ancestry: each asks the nearest router above it, through `$outer`.

A level the address says nothing about falls to its own `::defaultPage`, so
`?about` shows that section's index. Links are written whole from the root;
there is no relative form.
