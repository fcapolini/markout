---
"@markout-lang/express": patch
---

A directory redirect names a path on this origin, whatever was asked for.

`GET //demos` reaches the same directory — the resolver joins it to the same
place — and the `301` echoed the requested path back into `Location`, making
it protocol-relative: a browser reads `//demos/` as `http://demos/` and
leaves the site.

Only reachable for a name that IS a directory in the docroot, so it is not an
open redirect to anywhere an attacker chooses. It is still a redirect off the
origin that this server had no reason to issue, and CodeQL was right to flag
it (`js/server-side-unvalidated-url-redirection`).

The `Location` is now built from the canonical path, so `//demos`,
`///demos` and `/demos` all redirect to `/demos/`.
