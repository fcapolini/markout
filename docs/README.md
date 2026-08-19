# Markout Documentation

Markout is an HTML-first reactive language for building web applications with a
small set of consistent rules. Its core objective is frictionless reactive
logic in web pages, easy reuse through parametric markup blocks, minimal
ceremony, and easy understanding. It is isomorphic: the same runtime model
powers both server rendering and browser hydration, so SSR comes for free.

That model is also what lets one page be delivered two ways — rendered per
request by Node, or compiled ahead of time into static assets for a host that
runs something else. [Rendering](concepts/rendering.md#two-ways-to-deliver-a-page)
covers both, and what the second one cannot carry.

It is also deliberately not an application framework. Markout covers
presentation logic — turning values into markup — and leaves the components
themselves to CSS frameworks and web component libraries, which are
framework-neutral by construction. Picking one of those and picking Markout
stay independent decisions; see "Two decisions, not one" in the repository
README.

The goal of this documentation set is to explain the language from the user's
point of view, while staying aligned with the current codebase and tests.

If a feature is only part of the design and not yet implemented, this docs set
calls that out explicitly.

## Start here

- [Scopes](concepts/scopes.md) - how lexical visibility maps onto the DOM tree.
- [Values](concepts/values.md) - reactive slots, expressions, and bindings.
- [State](concepts/state.md) - what belongs in data, what belongs to the DOM,
  and how long each needs to last.
- [Modules and components](concepts/modules-and-components.md) - `<:import>`,
  `<:define>`, and reusable custom tags.
- [Replication](concepts/replication.md) - `:for-each`, aliases, clones, and
  `:for-key` for lists whose DOM holds state of its own.
- [Rendering](concepts/rendering.md) - how the compiler, server renderer, and
  browser runtime fit together.
- [Syntax reference](reference/syntax.md) - the whole language on one page.
- [Running a page](reference/cli.md) - the CLI, building ahead of time, the
  Express middleware for an application with its own routes, and the error
  pages both delivery modes serve.

## Design notes

Reasoning and decisions behind features, kept separate from the user-facing
pages above — what was chosen, what was rejected, and why.

- [Server-only values](design/value-transfer.md) - `:server-`, and what
  hydration cannot re-derive.
- [Kits from npm packages](design/npm-kits.md) - `/npm/` imports, a kit's
  logical root, and the rule that an installed kit behaves as though it were
  symlinked into the docroot.
- [Five deliverables, one repository](design/monorepo.md) - the split into npm
  workspaces, which package each layer lands in, and the order the move
  happens in.
- [Editor support, on Volar](design/editor-support.md) - moving the compiler's
  diagnostics into the editor, and why a markout page needs virtual code
  rather than a language server of its own.
- [Silent failures](design/silent-failures.md) - every way found so far for a
  page to be wrong without saying so, what closed each one, and what is still
  open. The compile-time-safety claim, audited rather than asserted.
- [What the platform actually does](design/platform-notes.md) - facts about
  Node, Bootstrap and Volar that each cost a debugging session to establish,
  kept together because a comment reaches the line it sits on and not the next
  package to hit the same thing.

## Mental model

Markout is the presentation layer: the DOM is the view, the application's
data is the model, and markout is the logic between — the presenter, written
declaratively. [State](concepts/state.md) says which of the three each piece
of a page belongs to.

It stays intentionally small:

- HTML is the base syntax.
- `${...}` is the only interpolation syntax, and anything holding one is
  reactive — text, CSS, and plain attributes alike.
- `:` names the things HTML has no name for: scope values, class and style
  toggles, events, lifecycle, replication.
- Scopes nest lexically, like variables in code.
- The compiler discovers dependencies once; the runtime executes them.

The README in the repository root shows the main language examples, and the
core runtime contract is documented in [src/runtime/RUNTIME.md](../packages/core/src/runtime/RUNTIME.md).
