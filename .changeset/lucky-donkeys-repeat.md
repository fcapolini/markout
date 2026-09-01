---
'@markout-lang/std-kit': minor
---

`std-router` and `std-route`: an app router keyed on the query string, so the
same markup is a single-page app where the browser has the Navigation API and
a multi-page one where it does not — with nothing to configure on the server
either way, since every route is the same static file.

The router discovers its routes rather than being told them, and resolves
while rendering, so the served markup already shows the right page. An address
naming no page at all — a bare `/`, or a page built with no address — gets
`::defaultPage`; one naming a page that does not exist gets `::fallback`. Both
default to `index`. A route publishes `::selected`, which a page can read for
nav highlighting.
