# Replication

Replication repeats an element for data-driven lists.

## `:for-each`

`:for-each=${expr}` renders one clone per item in the iterable returned by
`expr`.

```html
<ul :for-each=${[[1, 2, 3], [4, 5]]}>
  <li :for-each=${data}>
    Item ${data}
  </li>
</ul>
```

Important rules:

- `null` and `undefined` mean zero items.
- `:for-each` expects an iterable; it does not silently reinterpret a scalar as
  a one-item list.
- The default per-item name is `data`.
- `:for-as` can rename that per-item binding.

## What happens to the host element

The host element is compiled into an inert `<template>` stencil. Every visible
item is a clone, including the first one. That design keeps the host out of the
rendered tree and makes empty lists behave cleanly.

This also means server rendering and browser hydration can share the same model:
the server can emit real clones, and the browser can reuse them by id when they
already exist.

## Keys and optional rendering

The language design reserves two related ideas:

- `:for-key` is the future keyed-reconciliation hook.
- `:for-data` is the planned single-item counterpart to `:for-each`.

The current codebase does not implement keyed reconciliation, and `:for-data`
is not yet a live compiler/runtime feature. They are documented here because
they belong to the language design, but they should be treated as reserved or
planned behavior rather than current production syntax.

## Nested replication

Replication is lexical, so a nested list can read the outer loop's binding like
any other outer scope value.

That is why examples such as a list of lists work naturally: each inner scope
still sees the values declared by its ancestors.

```html
<html>
  <body>
    <ul :for-each=${[[1, 2, 3], [4, 5]]}>
      <li :for-each=${data}>
        Item ${data}
      </li>
    </ul>
  </body>
</html>
```

The outer `:for-each` binds each sub-array as `data`, and the inner
`:for-each` reads that same name from the surrounding scope.
