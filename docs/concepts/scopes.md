# Scopes

Scopes are the basic structure behind Markout's reactivity model. A scope is a
node in a tree that mirrors the DOM tree, but only for the elements that are
actually active in the language.

## What a scope contains

A scope owns reactive values, a parent link, and child scopes. When a value is
referenced, Markout searches upward through the scope tree until it finds the
nearest matching value.

That gives Markout lexical visibility:

- a value declared on the current element is visible on that element and all of
  its descendants;
- a value declared on an outer element is visible to inner elements;
- a closer value with the same name shadows an outer one.

This is why Markout does not need a separate `provide`/`inject` system. The DOM
tree already defines the scope chain.

## Default scopes

The root HTML elements have built-in names:

- `<html>` is `page`
- `<head>` is `head`
- `<body>` is `body`

That makes shared application state easy to place at the top level and read from
any descendant.

## Named child scopes

An element can declare a name with `:aka` and become visible as a value on its
parent and ancestors.

```html
<html>
  <body>
    <section :aka="box" :count=${0} />
    <p>${box.count}</p>
  </body>
</html>
```

In this example, `box` is not a special runtime object. It is just a named
scope, so siblings and descendants can refer to it like any other scoped value.

## System values

Three names are supplied by the runtime on every scope:

- `$value()` looks up a value by key inside a scope.
- `$parent` exposes the parent scope.
- `$id` is the scope's own identifier, unique within the page.

User code should avoid declaring `$`-prefixed identifiers. The compiler treats
those names as reserved because the runtime uses them as part of its internal
lookup model.

### `$id`

`$id` exists to build HTML ids for markup a component owns — `id` paired with
`aria-controls`, a `<label for>`, a `data-bs-target`. It is assigned by the
compiler and shipped with the page, so the server and the browser can never
disagree on it, and no later update renumbers it.

Every scope gets its own, including each replica of a `:for-each` and each
instance of a custom tag, so ids built from it don't collide.

It names *the scope it is written in*. Since an element with an interpolated
attribute gets a scope of its own, a bare `${$id}` on two different elements
gives two different ids. A component wanting one id across several elements
anchors it on its root and refers to that:

```html
<:define tag="bs-nav:nav" :_id=${$id}>
  <button data-bs-target="#nav-${_id}" aria-controls="nav-${_id}">...</button>
  <div class="collapse" id="nav-${_id}">...</div>
</:define>
```
