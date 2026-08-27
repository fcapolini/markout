---
"@markout-lang/core": patch
---

A globally installed kit is now reachable by `/npm/<package>`, not only by its
own root.

The two spellings of one file are resolved by two different mechanisms, and
only one of them could see a global install. `discoverKits` is handed the
global tree as the last resort a bare docroot has, so the kit was found and
mounted, and `/bootstrap-kit/all.htm` worked. `/npm/@markout-lang/bootstrap-kit/all.htm`
goes through `findPackage`, which walks `node_modules` upward from the
importing file and arrives nowhere near a global tree -- so the same kit, in
the same session, reported `Cannot find package "..." -- is it installed?`
while sitting mounted in the resolver that said so.

`Resolver` already receives the discovered kits; it now indexes them by
package name as well as by directory, and `/npm/` consults that when the walk
comes up empty. The walk still runs FIRST, because it is the one that gets
nested installs right: where two copies of a kit exist, the importing file's
own is the answer, and a name lookup cannot tell them apart. The name lookup
is only for what no walk can reach.

This is the case the `markout` docroot with no `package.json` around it is
for -- installing a kit globally so as not to have to `npm init` first -- and
it was the spelling the documentation uses.
