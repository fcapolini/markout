---
"@markout-lang/core": minor
---

A runtime error names the line it was written on.

"Mistakes caught before the page loads, with a file and a line" is the row
this project is sold on, and it held exactly until the page started running.
After that a failure said:

```
markout [update] s12.text$7: Cannot read properties of undefined
```

where `s12` is a scope uid and `text$7` a generated key — neither of them
anything an author typed. The claim expiring at the moment it matters most.

In dev mode it now says:

```
markout [update] /demos/orbit.html:212:34 (text$7): Cannot read properties of undefined
```

It names the file the expression was *written* in, so a component that fails
points at its own fragment rather than at the page that used it. Every
reporter goes through `formatRuntimeError`, so the console, the dev-mode
overlay, the dev error page and the server log all gained it at once.

**Dev only, and measured.** The map is compiled only in dev mode and carried
only by a dev page: a production page's bytes are unchanged and its failures
say exactly what they said before, which is also what keeps a served page
from describing its own sources — the same reason the detailed compile-error
listing is dev's. On this repository's heaviest page the map is 107KB of a
dev-mode page that was already 715KB, against 284KB served in production
carrying none of it.
