---
"@markout-lang/cli": patch
"@markout-lang/express": patch
---

Carry the `/npm/<package>` fix for globally installed kits.

Both build a `Resolver` of their own -- `build.ts` for the compiled artifact,
the middleware for a served request -- so both refused
`<:import src="/npm/@markout-lang/bootstrap-kit/all.htm" />` against a kit
that was installed globally and mounted correctly. The fix is core's; these
are versioned so that the range they declare on it moves too, and a project
that bumps only the CLI actually receives the fix rather than resolving a
locked 0.6.0 that still has the bug.
