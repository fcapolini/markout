# Markout Documentation

Markout is an HTML-first reactive language for building web applications with a
small set of consistent rules. It is isomorphic: the same runtime model powers
both server rendering and browser hydration, so SSR comes for free. The goal of
this documentation set is to explain the language from the user's point of
view, while staying aligned with the current codebase and tests.

If a feature is only part of the design and not yet implemented, this docs set
calls that out explicitly.

## Start here

- [Scopes](concepts/scopes.md) - how lexical visibility maps onto the DOM tree.
- [Values](concepts/values.md) - reactive slots, expressions, and bindings.
- [Modules and components](concepts/modules-and-components.md) - `<:import>`,
  `<:define>`, and reusable custom tags.
- [Replication](concepts/replication.md) - `:for-each`, aliases, clones, and
  the current status of optional/keyed list behavior.
- [Rendering](concepts/rendering.md) - how the compiler, server renderer, and
  browser runtime fit together.
- [Directive reference](reference/directives.md) - a compact syntax summary.

## Mental model

Markout stays intentionally small:

- HTML is the base syntax.
- `${...}` is the only interpolation syntax.
- `:` marks reactive or compiled behavior.
- Scopes nest lexically, like variables in code.
- The compiler discovers dependencies once; the runtime executes them.

The README in the repository root shows the main language examples, and the
core runtime contract is documented in [src/runtime/core/CORE.md](../src/runtime/core/CORE.md).
