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

## `:for-key`

Without a key, a replica belongs to a *position*: replica 2 always shows item
2, and reordering the array rewrites every replica in place. That is cheaper,
and for a list that only ever renders it is perfectly correct.

It stops being correct as soon as the DOM holds state of its own. Focus, a
scroll offset, the text typed into an `<input>`, a running transition, an
`<iframe>`'s document, a playing video — the framework never sees any of it,
so rewriting data over a replica leaves that state behind on the wrong item.

`:for-key=${expr}` makes a replica belong to an *item* instead. The expression
is evaluated once per item and may read the per-item binding:

```html
<li :for-each=${rows} :for-key=${data.id}>
  <input> ${data.label}
</li>
```

Now a reorder *moves* replicas rather than rewriting them, and whatever the
DOM was holding moves with them. Only replicas that are actually out of place
are moved: re-inserting a node that already sits where it belongs is still a
remove-and-reinsert, which would destroy the very state the key exists to
protect.

Important rules:

- A replica keeps the id it was created with for as long as it lives, so
  `${$id}` stays pointing at the same item across a reorder. Ids therefore
  reflect creation order, not document order.
- A key must be unique within the list. A duplicate is reported as a runtime
  error and the item still renders, but nothing keys promise holds for it.
- Removing an item disposes its replica; its id is never handed out again.

## Optional rendering

`:for-data` is the planned single-item counterpart to `:for-each`. It is not
yet a live compiler/runtime feature — it is documented as part of the language
design rather than as current syntax.

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
