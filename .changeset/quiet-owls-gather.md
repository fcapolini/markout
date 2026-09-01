---
'@markout-lang/core': minor
---

`$outer("my-tag")`: the nearest enclosing instance of a tag, or nothing.

`$host` answers what a scope is immediately inside; this answers what it is
inside *of a given kind*, however far up that is. A walk rather than a parent
hop, because a region, a `:for-each` or an element carrying a value each add a
scope in between, so the enclosing instance is reliably an ancestor and never
reliably the parent. It excludes itself, or a definition's own default would
find the instance it is defaulting.

The tag is written out, and has to be: a call in the source, it is a plain
dependency segment by the time anything runs, resolved when the scope links.
A lookup performed per read would emit no dependency, so whatever asked would
answer once and never again — exactly the case this exists for. `$outer(x)`
with a computed tag is refused rather than silently doing the weaker thing.

Costs nothing where it is unused: the tag each instance carries is emitted
only for tags some expression in that page names.
