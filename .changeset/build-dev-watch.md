---
"@markout-lang/cli": minor
---

`-d`/`--dev` on `markout build` and `markout prerender`, keeping the process
running and rebuilding (debounced) whenever a file under the docroot changes,
instead of compiling once and exiting.

```sh
markout build ./site ./dist --dev
```

It is the served mode's own blunt invalidation, aimed at an output directory
instead of a live page: any change anywhere under the docroot triggers a full
rebuild rather than one scoped to the file that moved, and several fs events
from one save coalesce into a single rebuild. Useful beside a CSS tool's own
`--watch`, or whatever is serving `./dist` for a preview — neither command
reloads a browser on your own behalf, since that is the served mode's job and
a build has no open page to tell.
