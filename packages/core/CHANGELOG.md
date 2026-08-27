# @markout-lang/core

## 0.6.1

### Patch Changes

- 88ff5c1: A globally installed kit is now reachable by `/npm/<package>`, not only by its
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

## 0.6.0

### Minor Changes

- c86a69d: `class+=` and `class-=`, and `style+=` and `style-=`: contribute to an
  attribute instead of replacing it.
  
  They are not `:` names, for the reason the rest are — `:` names what HTML has
  no name for, and `class` has a name. What is new is the **operation**. Only
  those two attributes have them, being the two HTML gives a *set* rather than
  a value; a literal is read the way HTML spells that attribute, an expression
  carries the value itself.
  
  Nothing writes the attribute whole, which is what makes it hold: base, then
  every addition, then every removal, whatever order they appear in, and only
  the difference is applied. A class this page never put on — one Bootstrap's
  own JS added to a modal it was handed — is in neither set and so is never
  touched.
  
  A usage site that writes a plain `class` on a component computing its own now
  **warns**, and names `class+=` as what was probably meant.
- a4f641f: A runtime error names the line it was written on.
  
  "Mistakes caught before the page loads, with a file and a line" is the row
  this project is sold on, and it held exactly until the page started running.
  After that a failure said:
  
  ```
  markout [update] s12.text$7: Cannot read properties of undefined
  ```
  
  where `s12` is a scope uid and `text$7` a generated key — neither of them
  anything an author typed. The claim expiring at the moment it matters most.
  
  In dev mode it now says:
  
  ```
  markout [update] /demos/orbit.html:212:34 (text$7): Cannot read properties of undefined
  ```
  
  It names the file the expression was *written* in, so a component that fails
  points at its own fragment rather than at the page that used it. Every
  reporter goes through `formatRuntimeError`, so the console, the dev-mode
  overlay, the dev error page and the server log all gained it at once.
  
  **Dev only, and measured.** The map is compiled only in dev mode and carried
  only by a dev page: a production page's bytes are unchanged and its failures
  say exactly what they said before, which is also what keeps a served page
  from describing its own sources — the same reason the detailed compile-error
  listing is dev's. On this repository's heaviest page the map is 107KB of a
  dev-mode page that was already 715KB, against 284KB served in production
  carrying none of it.
- bd33a54: `hydrate()`: mount a compiled page against a DOM the caller supplies, which
  is what testing a component needs.
  
  The two entry points that existed could not be borrowed for it. A browser
  reaches the runtime through the bundle and `renderPage` reaches it with the
  compiler's own `ServerDocument`; both own the whole arrangement, and the
  server document's `addEventListener` is a no-op — correct there, since
  nothing on a server clicks anything, and useless for asserting that a handler
  does something.
  
  It hands back the page's values by name, live, and the array the runtime
  reports failures into, which keeps filling — so a test asserting it is empty
  at the end is asserting about the whole interaction rather than about
  hydration.
  
  Faithful to what the browser does rather than to what is convenient: it loads
  the `:server-` results the render carried into the page, because no test DOM
  executes what `document.write` puts in it and a page whose results never
  arrived would recompute them against a `fetch` that is not there — reporting
  failures no browser would ever see. It takes `origin` because `$origin` is
  `location.origin` in a browser and a test document's location is the runner's.
  And it takes **no** `globals`, because the browser supplies none: accepting
  them would let a test drive a page in a way no browser can, and pass.
  
  The recipe is in [docs/reference/testing.md](https://github.com/fcapolini/markout/blob/main/docs/reference/testing.md).

### Patch Changes

- 523ef5e: An attribute's own quote character can be used inside its `${…}` (#30).
  
  `:v="${"x"}"` and `:v='${'x'}'` both parse now. Before, the attribute-value
  scanner ended at the first matching quote whether or not it was inside an
  expression, so what reached the JS parser was a fragment and the error was a
  `SyntaxError` pointing *inside* the expression, at nothing the author had got
  wrong.
  
  It is HTML's rule, but `${…}` already suppresses the other delimiter — a `>`
  inside an expression does not end the tag — so the quote was the one place a
  delimiter stayed live inside an expression. Now nothing does, which is one
  fewer rule rather than one more.
  
  The scanner asks acorn where each expression ends rather than lexing
  JavaScript a second time, so strings, template literals, object literals and
  nested `${}` all end where the real parse says they do — and it hands those
  nodes to the parse that follows, so nothing is parsed twice. An attribute
  with no expression takes the path it always did.
  
  Measured, interleaved to cancel drift: this repository's homepage 37.8ms →
  39.0ms to compile, and its heaviest page unchanged at ~82ms.
- c86a69d: Bind a catch clause's parameter for its body.
  
  `try { … } catch (err) { report(err) }` inside a handler failed to compile
  with `Unknown reference: "err"`. The clause's parameter was recognised as a
  binding, but the walk deciding whether a later *use* of a name refers to a
  local never asked about a catch clause — so the name was bound and then not
  found, on JavaScript that is simply correct.
  
  `catch ({ message })` binds through the pattern, and `catch { }` binds
  nothing.
- c86a69d: Drop the stencils of instances written inside a definition that was itself
  dropped. Treeshaking removed the `<:define>` and left the `<template>` its
  nested usages had been relocated to, so a page shipped stencils for markup
  that no longer existed anywhere.
- c86a69d: Warn when a page writes a value the user can take away from it.
  
  `value=${v}` on an input reads as "this is the value" and behaves as "this
  was the initial value": HTML's dirty flag makes the element's own state
  independent of both the attribute and the content from the first keystroke,
  so `v = ''` after a submit empties the model and leaves the typed text on
  screen.
  
  The fix is `:prop-value=${v}` **beside** the attribute — the attribute is
  what the element is served with, the property is what it shows afterwards —
  and the compiler now says so when it sees one without the other: `value` on a
  typed-in `<input>` and on a `<textarea>` (its content as well as its
  attribute), `checked` on an `<input>`, `selected` on an `<option>`.
  
  `value=` was deliberately **not** made to write the property when it happens
  to be on an input: that would be one attribute meaning two different things
  depending on the element it sits on.
  
  The warning found five in `bootstrap-kit`, all fixed: `bs-input`,
  `bs-textarea`, `bs-check`, `bs-range` and `bs-select` were read-write
  everywhere except the direction a form needs after a submit.
- 5642d62: Write a text interpolation that can never change into the markup, and drop
  the binding (#33).
  
  After `:const-` substitution a token sheet comes out as `'... ' + '#2C88E7' +
  ' ...'`: no scope references left, no dependencies, and a value that will be
  evaluated once and never again. It shipped in full anyway. A whole stylesheet
  is one text node, so on the site the issue was filed against that was 3,136
  bytes on every page — 30% of everything those pages carried, for a binding
  that cannot produce anything the served markup does not already contain.
  
  The rewrite is safe because it is not a new write: server rendering already
  evaluates that value against that same document and puts the result in that
  same node. Only the *when* changes — once at compile time instead of once per
  render — and the served bytes are what they were, interpolation markers
  included.
  
  Written into the node rather than merely withheld from the client, which
  reaches a case a props-level fix could not: a stencil's markup is never
  rendered, so a constant inside an `:if` region or a `<:define>` body has to be
  in the template for a client-side instantiation to show it.
  
  Text only, and that is what makes it sound: a text value's key is generated,
  no expression can name one, so nothing can be reading it. What counts as
  constant is a whitelist of literal shapes rather than "has no dependencies" —
  `$id`, a global and a call have no dependencies either, and none of them is a
  constant.
  
  Measured on this repository's own site: 371 bytes a page on the two that
  import a token sheet, and nothing on the two that do not.

Entries below 0.6.0 were written after the fact, in 2026-08, when
[Changesets](https://github.com/changesets/changesets) was adopted. From then
on each entry is generated from the changeset files committed with the work,
so the note and the change travel together. Anything older than 0.4.0 is in
the git history rather than here.

## 0.5.0

### Minor Changes

- **`::name` changed meaning, and a page written for 0.4.x will not say so.**
  Read the migration note below before upgrading — this is the one release
  where a page can compile clean and mean something different.

- `::name=${...}` is now a component's **interface**: on a `<:define>` it
  declares a parameter, and at a usage site it passes one. That is what tells
  "this is for the component" from "this is mine" at a glance, and the name is
  reserved at every usage of that tag.

- `:const-name=${...}` is now how a **compile-time constant** is spelled — the
  meaning `::name` used to carry. It is a *modifier* rather than a family,
  like `:server-`, so it is not part of what the value is called:
  `:const-accent` is read as plain `${accent}`. Which is what lets a page take
  a kit's constant and make it live by declaring that name plainly.

- A usage site's own `:name=${...}` declares a local on the usage site, where
  `::name=${...}` passes a parameter to the component. Previously one spelling
  had to serve both.

### Patch Changes

- Warn about a value declared on a usage site that nothing reads — almost
  always a parameter that was meant to be passed with `::`.

## Migrating from 0.4.x

`::name` is the whole of it, and it changed *silently*: it used to declare a
compile-time constant and now declares a parameter, so a page carrying one
still compiles and no longer folds at build time.

```html
<!-- 0.4.x -->
<lib ::accent=${'#c33'}>

<!-- 0.5.x -->
<lib :const-accent=${'#c33'}>
```

Rename every `::name` that declared a constant to `:const-name`. What reads it
does not change — it was `${accent}` before and it is `${accent}` now, which
is why nothing at the read sites needs touching, and why nothing there can
warn you either.

`::` on a `<:define>` and at a usage site is new syntax rather than changed
syntax, so nothing written for 0.4.x is using it that way.

## 0.4.1

### Patch Changes

- Re-evaluate a value when its sources move, rather than once per cycle.
- Stop tracking a function's body, where nothing can consume the dependency.
- Supply a scope's own names when it is asked for them, not before.
- Walk the DOM by index instead of copying it to do so.
- Report which version of Markout built a page.
- Content-hash the runtime's URL, so it can be cached for a year.

## 0.4.0

The extension release: `@markout-lang/core` is the package a Volar language
server can depend on without pulling in Express, compression or commander.
The split, and the reasoning for where each boundary falls, is in
[monorepo.md](https://github.com/fcapolini/markout/blob/main/docs/design/monorepo.md).
