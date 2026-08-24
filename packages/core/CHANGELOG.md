# @markout-lang/core

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
[monorepo.md](../../docs/design/monorepo.md).
