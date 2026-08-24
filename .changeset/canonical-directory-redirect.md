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

The `Location` is the **resolver's** pathname now, never the request's —
`Resolution.pathname` is the file's one logical identity, arrived at by the
same normalization that decided which file to stat, so there is nothing of
the request left in it to be tricked by. `/demos`, `//demos` and `///demos`
all redirect to `/demos/`.

Built from the request first, with the leading slashes collapsed by hand.
That closed the reported case and not `/\demos`, which some browsers read
the same way — a sanitizer bolted onto user input, answering the example
rather than the class.
