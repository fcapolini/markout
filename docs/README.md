# Markout Documentation

Markout is an HTML-first reactive language for building web applications with a
small set of consistent rules. Its core objective is frictionless reactive
logic in web pages, easy reuse through parametric markup blocks, minimal
ceremony, and easy understanding. It is isomorphic: the same runtime model
powers both server rendering and browser hydration, so SSR comes for free.

That model is also what lets one page be delivered three ways — rendered per
request by Node, prerendered once into static assets for a host that runs
something else, or compiled and left to resolve in the browser.
[Isomorphism](concepts/isomorphism.md#three-ways-to-deliver-a-page) covers all
three, and what the ahead-of-time ones cannot carry.

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

- [The page](concepts/page.md) - what compiling an HTML file does to it, the
  scopes it already has, and how a page is split across files.
- [Scopes](concepts/scope.md) - where values live, and how lexical visibility
  maps onto the DOM tree.
- [Values](concepts/values.md) - a scope's properties and methods, why an
  attribute holds JavaScript rather than an HTML value, and what happens when
  one changes.
- [Directives](concepts/directives.md) - the `:family-name` system: what an
  attribute does, what an element listens to, and how many times markup
  renders.
- [Kits](concepts/kits.md) - `<:define>`, `<:slot>`, and why anything
  framework-shaped belongs in a kit rather than in the language.
- [The Markout sidebar](reference/vscode-extension-sidebar.md) - what the VS
  Code view does, and the two ways to install a kit: npm if you have Node, a
  checkbox that needs no toolchain at all if you do not.
- [More than one page](concepts/navigation.md) - links, a page routed by its
  fragment, and why the router is a kit that does not exist yet.
- [Isomorphism](concepts/isomorphism.md) - one model on the server and in the
  browser, and the three ways a page can be delivered.
- [Data](concepts/data.md) - what belongs in values, how long each kind needs
  to last, and where data from outside the page comes in.
- [Syntax reference](reference/syntax.md) - the whole language on one page.
- [Running a page](reference/cli.md) - the CLI, building ahead of time, a CSS
  build step beside it, the Express middleware for an application with its own
  routes, and the error pages both delivery modes serve.
- [Testing a page, and a component](reference/testing.md) - compiling, mounting
  against a DOM of your own, driving a component through its tag, and which
  seams to fake.

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
- [Tailwind, and utility CSS generally](design/tailwind-support.md) - what a
  class scanner can and cannot see in a markout page, measured; the one shape
  that fails silently; and the class manifest designed to close it.
- [Stencils out of the way](design/stencil-placement.md) - a marker comment
  where a conditional or replicated element was written — `:if`, `:else`,
  `:for-data`, `:for-each` alike — and the `<template>` it used to sit in
  moved to `<head>`, so CSS counts what the page wrote, inline SVG can hold
  a region, and a loop stops copying one stencil per row.
- [Working without Node](design/without-node.md) - how someone
  with no Node installs a kit: `.markout/kits/` in the project, resolved by
  the compiler so the editor and the CLI agree, and the sidebar that fills it.
- [Where code runs](design/code-execution.md) - the three places markout
  evaluates JavaScript, why a kit installed by a checkbox changed the
  question, how compile-time evaluation is sandboxed, and why server-side
  rendering deliberately is not.
- [Silent failures](design/silent-failures.md) - every way found so far for a
  page to be wrong without saying so, what closed each one, and what is still
  open. The compile-time-safety claim, audited rather than asserted.
- [What the platform actually does](design/platform-notes.md) - facts about
  Node, Bootstrap and Volar that each cost a debugging session to establish,
  kept together because a comment reaches the line it sits on and not the next
  package to hit the same thing.

## Explorations

Open questions, thought through and not decided. A design note says what was
chosen; these say what was considered and why it is still sitting there.

- [Authoring web components](explorations/web-components-authoring.md) - what
  it would take for a `<:define>` to compile into a registered custom element,
  why the scoping objection dissolves on inspection, where a library's design
  tokens would live, and the costs that are left once it does.
- [Re-initializing a value](explorations/value-reinitialization.md) - putting
  a value back to following an expression, why re-attaching to the same one is
  nearly free and a new dependency list is not, and the one language question
  that decides the rest.

## Mental model

Markout is the presentation layer: the DOM is the view, the application's
data is the model, and markout is the logic between — the presenter, written
declaratively. [Data](concepts/data.md) says which of the three each piece
of a page belongs to.

It stays intentionally small:

- HTML is the base syntax.
- `${...}` is the only interpolation syntax, and anything holding one is
  reactive — text, CSS, and plain attributes alike.
- `:` names the things HTML has no name for: scope values, class and style
  toggles, events, lifecycle, replication.
- Scopes nest lexically, like variables in code, and a scope is a JavaScript
  object: what a tag declares are its properties and methods, written with
  none of HTML's limits on what an attribute may hold.
- The compiler discovers dependencies once; the runtime executes them.

The README in the repository root shows the main language examples, and the
core runtime contract is documented in [src/runtime/RUNTIME.md](../packages/core/src/runtime/RUNTIME.md).
