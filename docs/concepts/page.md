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

## Default scopes

The root HTML elements have built-in names:

- `<html>` is `page`
- `<head>` is `head`
- `<body>` is `body`

That makes shared application state easy to place at the top level and read from
any descendant.

## `<:import>`

`<:import>` splices a fragment into the page at compile time.

```html
<html>
  <head>
    <:import src="lib.htm" />
  </head>
</html>
```

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
