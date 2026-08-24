---
"@markout-lang/core": minor
---

`hydrate()`: mount a compiled page against a DOM the caller supplies, which
is what testing a component needs.

The two entry points that existed could not be borrowed for it. A browser
reaches the runtime through the bundle and `renderPage` reaches it with the
compiler's own `ServerDocument`; both own the whole arrangement, and the
server document's `addEventListener` is a no-op — correct there, since
nothing on a server clicks anything, and useless for asserting that a handler
does something.

It hands back the page's values by name, live, and the array the runtime
reports failures into, which keeps filling — so a test asserting it is empty
at the end is asserting about the whole interaction rather than about
hydration.

Faithful to what the browser does rather than to what is convenient: it loads
the `:server-` results the render carried into the page, because no test DOM
executes what `document.write` puts in it and a page whose results never
arrived would recompute them against a `fetch` that is not there — reporting
failures no browser would ever see. It takes `origin` because `$origin` is
`location.origin` in a browser and a test document's location is the runner's.
And it takes **no** `globals`, because the browser supplies none: accepting
them would let a test drive a page in a way no browser can, and pass.

The recipe is in [docs/reference/testing.md](../docs/reference/testing.md).
