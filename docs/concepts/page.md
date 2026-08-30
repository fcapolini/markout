# The page

A page is an HTML file. Anything in it without a `${...}` or a `:` is plain
markup and comes out the other side unchanged — which is what makes adopting
markout a matter of adding an attribute rather than rewriting a document.

What the compiler adds is a *scope tree* laid over the markup, and a small
runtime that keeps the markup true to it. This page is about the file itself:
what compiling does to it, what parts of it the language already knows about,
and how a page is split across more than one file.

## The pipeline

The broad flow is:

1. Parse HTML into the compiler's internal representation.
2. Collect scopes, values, bindings, and dependencies.
3. Generate a runtime-ready props object.
4. On the server, execute that props object against the server DOM.
5. In the browser, load the runtime bundle and hydrate the same tree.

The important point is that the runtime is not a separate semantic model. The
server and browser both execute the same scope/value logic.

## What compiling adds to the page

A compiled page carries a little markup its author did not write, and all of
it is at the end of `<head>` or the end of `<body>`, where it displaces
nothing:

- **Marker comments** where interpolated text, a custom-tag usage site, or a
  conditional or replicated element was written. They hold the place; the
  runtime writes around them. See
  [stencils out of the way](../design/stencil-placement.md).
- **Stencils** — a `<template>` per conditional or replicated region, in
  `<head>`, holding the markup that is not currently in the page.
- **Two `<script>`s** at the end of `<body>`: the compiled props, and the
  browser runtime.
- **`<meta name="generator" content="Markout 0.4.0">`** at the end of
  `<head>`, unless the page already names a generator of its own — anywhere
  in the document, however it is spelled, and including one a region renders.
  The version is the compiler's own, so the page says which release built it.
  Turn the whole thing off with `markout build --no-generator`,
  `markout --no-generator`, or `generator: false` on the middleware or the
  compiler — which is the answer for a deployment that would rather say
  nothing.

And one thing it takes away. An `<:import>`, a `<:define>`, a `<:logic>` or
a region's markup leaves the tree, and the whitespace that was indenting it
would otherwise stay behind as a line holding nothing — so where only
whitespace lies between two nodes, at most one line break survives, and the
indentation of the line that follows is kept. Blank lines you wrote go the
same way; your indentation does not.

It cannot change what a page renders: between block elements this is
invisible, and between inline ones a run of whitespace has always collapsed
to a single space and still does, since a break is left. `<pre>`,
`<textarea>`, `<script>` and `<style>` are left exactly as written. The one
case to know about is `white-space: pre` applied by CSS to ordinary markup,
which the compiler cannot see.

## Default scopes

The root HTML elements have built-in names:

- `<html>` is `page`
- `<head>` is `head`
- `<body>` is `body`

That makes shared application state easy to place at the top level and read from
any descendant.

The two named halves are also where a convention lives, and it is worth
saying out loud because the rest of these docs assume it. **`<head>` holds
what the page is — its title, its styling, its design tokens. `<body>` holds
what it does.** That is why a token is written `<head :const-accent="#6f42c1">`
here and in the syntax reference: it belongs with the stylesheet it feeds,
not with the application.

The split works because it is not a wall. `head` and `body` are sibling names
under the page scope, so either side reads the other, and a value declared on
`<head>` can be *written* from below — which is how a page's own markup sets
the document title, with no portal and no metadata API:

```html
<html>
  <head :pageTitle=${'Home'}>
    <title>${pageTitle} — Example</title>
  </head>
  <body>
    <h1>${head.pageTitle}</h1>
    <button :on-click=${() => head.pageTitle = 'About'}>About</button>
  </body>
</html>
```

The write reaches `<title>` because it is the same value the title renders, so
the tab follows on the next cycle like anything else.

This holds inside a `<:define>` as well, which is what lets a *component* set
the title. A definition cannot read its caller's names — that isolation is
deliberate — but `head` is not the caller's name. It is a name on the page
scope, and the page scope is an ancestor of everything in the document,
definitions included.

## `<:import>`

`<:import>` splices a fragment into the page at compile time, and **only
directly in `<head>`** — the compiler refuses it anywhere else.

```html
<html>
  <head>
    <:import src="lib.htm" />
  </head>
</html>
```

That restriction is the convention above, enforced. A kit is what a page is
made *of* — definitions, and the design tokens they ship — rather than what
it does, so `<head>` is where it belongs. And the placement is not only
tidiness: a fragment's root attributes land on the element the directive
sits in, so an imported kit's tokens become values on `<head>`, which is
where the page overrides them and where the stylesheet they feed can read
them.

The imported fragment can provide defaults on its root element. Those defaults
are applied at the import site unless the import site already defines the same
attribute.

The same file is only imported once per page, even if multiple `<:import>`
tags point to it.

In other words, imported fragments behave like HTML modules with overridable
root state, not like opaque text includes.

## Dynamic text and DOM markers

The browser layer needs to find the DOM nodes for dynamic text values. The
compiler therefore marks text positions with HTML comments, and the runtime uses
those markers to map each `text$N` value back to the correct node.

This is an implementation detail, but it explains why Markout can update text
nodes without a second parse pass in the browser.
