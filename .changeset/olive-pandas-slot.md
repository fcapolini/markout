---
'@markout-lang/core': patch
---

A component written inside a component whose slot sits in a region renders,
instead of silently vanishing.

Filling a slot moves the caller's markup into the element holding it, so a
slot inside a region — `<div :if>`, or a `<:group>` — puts that markup inside
the region. The scope did not follow: `enclosingScope` consulted the instance
a node was slotted into before walking up to see what the markup had actually
been moved inside of, and returned it on sight. Parented past the region, the
instance was bound to DOM the region owns and only shows when it chooses to,
so it rendered nothing and reported nothing.

The slot's host is now the fallback it was documented to be rather than a
first hit, taken only when nothing between the usage and it has a scope of its
own. "Nothing in between" became a walk for the same reason: what lies between
can be the definition's own region, and only a scope belonging to the caller's
markup ends it.
