# Directives

Everything HTML has no name for is written `:family-name`, and the families
are the whole of it: what an attribute does, what an element listens to, when
a scope's life begins and ends, and how many times a piece of markup renders.

Two intents always get two spellings rather than one guessing from the shape
of a value. `title=${v}` sets an attribute's value; `:attr-title=${v}` sets
whether it is there at all. `:for-each` renders once per item; `:for-data`
renders once if there is one. A shortcut that saves characters at the call
site and costs every later reader a special case is not a simplification.

A few directives take a reserved word instead of a prefix — `:if`, `:else-if`,
`:else` — and can, because a value has to be something an expression can say.
`${if}` does not parse, so no page could ever have declared one by that name,
which makes it a namespace a directive can occupy with no possibility of
collision.

The [syntax reference](../reference/syntax.md) lists every one of them. This
page is about the ones with something to explain.

## Attributes

A plain HTML attribute holding a `${...}` expression is reactive too. It needs
no `:` prefix, because the attribute already has a name — the interpolation
alone is what makes it live, exactly as in text and CSS:

```html
<a href=${'#' + section.id} aria-label=${'Go to ' + section.title}>...</a>
```

The attribute is written whenever the expression changes. A `null` or
`undefined` result removes the attribute rather than writing the string
`"null"`, which is what makes `title=${count > 0 ? 'yes' : null}` behave the
way it reads.

`class` and `style` follow the same rule and are *overwritten*, not merged. To
change one class or one property without touching the rest, use `:class-x` and
`:style-x` below.

### Presence, not value

Some attributes mean something by being *there at all*: HTML's `disabled`,
`open`, `checked`, and most attributes on custom elements. For those, writing
a value is wrong — `open=${false}` produces `open="false"`, and an attribute
that is present reads as true whatever it says.

`:attr-x` toggles presence, the way `:class-x` toggles a class:

```html
<sl-dialog :attr-open=${isOpen}>...</sl-dialog>
<button :attr-disabled=${!canSubmit}>Send</button>
<input :attr-required>
```

Truthy adds the attribute, falsy removes it, and a bare `:attr-x` means
`true` — the same rule as a bare `:class-x`.

Which of the two you want can't be told from the value, which is why you say
rather than the compiler guessing: `aria-expanded="false"` is a real and
required setting, so `aria-expanded=${...}` has to keep writing the string.

### Properties

An attribute can only carry a string. Custom elements often want an object,
an array or a function instead — a Shoelace-style `<sl-select>` taking its
options, say. `:prop-x` assigns the JS property directly:

```html
<sl-select :prop-options=${choices} :prop-maxLength=${3}>...</sl-select>
```

The name is written exactly as the property is spelled, `maxLength` and all.
Quoting the value changes nothing: `:prop-options="${items}"` passes the
array itself, because a lone expression keeps its type. Only combining it
with literal text makes a string — see the [syntax
reference](../reference/syntax.md#attribute-values-and-quoting).

This one is **browser-only**, and unavoidably so: a property is state on an
element instance, not part of the document, so there is nothing a served page
could carry. Server rendering skips these bindings deliberately — it isn't
treated as a failure — and they apply when the page runs. Prefer an attribute
whenever the component mirrors one, and keep `:prop-` for what an attribute
genuinely can't express, or the affected markup will visibly change on
hydration.

NOTE: a property set on a custom element *before* it upgrades can be shadowed
by the class's own accessor and lost. Components built on Lit (Shoelace among
them) handle this; hand-rolled ones often don't.

## Special binding prefixes

Some prefixes change how a value behaves at runtime:

- `:attr-x` toggles whether an attribute is present.
- `:prop-x` assigns an element property (browser-only).
- `:class-x` toggles a CSS class.
- `:style-x` writes a CSS property.
- `:on-x` binds an event handler.
- `:did-x` and `:will-x` bind lifecycle callbacks — two pairs, one for the
  scope's own lifetime and one for its markup's presence in the page (see
  the [syntax reference](../reference/syntax.md#lifecycle)).
- `:handle-x` runs its arrow whenever value `x` changes. Sugar for an
  expression that calls the arrow with `x`, so the dependency falls out of
  the ordinary extraction and the runtime needs to know nothing about it.
- `:server-x` marks an expression that runs while the page is rendered and
  nowhere else; the browser is handed the result rather than the expression.

These are still values. They just have side effects instead of being pure logic values.

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

### The stencil is not where you wrote it

It is in `<head>`, and what stands where the host was written is a comment.
So the replicas are the only children the container has, and CSS counts
what you wrote:

```css
ul > li:first-child   /* the first replica */
ul > li:nth-child(2)  /* the second */
```

The same holds for `+`, `~`, `:only-child` and `:empty`: a comment is not an
element, so none of them can see the stencil. It is also what lets a region
sit inside `<svg>`, where there is no HTML `<template>` at all.

The reasoning, and what it cost, is in
[stencils out of the way](../design/stencil-placement.md).

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

## Replicating a component

`:for-each` goes on a custom tag like it goes on anything else — no wrapper
element needed:

```html
<my-card :for-each=${rows} :for-key=${data.id} ::title=${data.name} />
```

This works because `:for-each` *declares* a name rather than passing a
value, and it declares it where the instance scope is defined: at the usage
site. `:title=${data.name}` is written in that same place, so it reads that
name like any other call-site expression.

Markup **slotted into** the tag is written at the usage site too, so it
reads that name as well:

```html
<my-card :for-each=${rows} :for-key=${data.id} ::title=${data.name}>
  <button :on-click=${() => remove(data.id)}>Drop</button>
</my-card>
```

Only that one name crosses over. The definition still resolves where it was
defined, so a component whose body says `${data}` reads its own scope's
value rather than the caller's item — and `:title=${title}` at the usage
site still means the *caller's* `title`, never the definition's or itself.

## Conditionals

A condition is not an arity, which is why it has a directive of its own
rather than an idiom built out of the ones above.

`:if=${expr}` renders the element when the expression is truthy. It is the
directive to reach for when the question is "should this be here", and it
binds nothing:

```html
<p :if=${errors.length}>${errors.length} problems</p>
```

`:else-if=${expr}` and `:else` continue it. The chain shows the first branch
whose condition holds and no other, which two `:if`s cannot do — the branch
that has to give up the position is the one whose own condition did not
change:

```html
<p :if=${errors.length}>${errors.length} problems</p>
<p :else-if=${warnings.length}>${warnings.length} warnings</p>
<p :else>all clear</p>
```

Which branch an `:else` belongs to is said by position alone, so it has to
be the very next element after the branch before it; whitespace and comments
in between are fine, and anything that renders is a compile error.

`:for-data` below answers the same arity — zero or one — but by a different
test, and for a different purpose: it is `!= null`, so `0` and `''` remain
data, and it binds the item so the body can read it. Use it when there is
something to show; use `:if` when there is something to decide.

## Optional rendering

`:for-data` is the single-item counterpart to `:for-each`: zero or one where
that one is zero or many.

```html
<p :for-data=${user}>Welcome, ${data.name}</p>
```

The test is `!= null`, the same rule `:for-each` states for an empty list —
`0` and `''` are data and render. A page that means "if this is true" rather
than "if this is here" wants a directive that says so; there isn't one yet.

Three things follow from it being one rather than many:

- **The body doesn't evaluate while there is nothing to show.** That is the
  point of the directive rather than an optimisation: `${data.name}` above
  has to be safe to write, and it wouldn't be if the expression ran with no
  `data`.
- **Nothing is cloned.** The scope owns one element for its whole life, and
  that element is moved between the document and the stencil it arrived in.
  Focus, a scroll offset, a playing video, an `<iframe>`'s document — all of
  it survives a round trip, without needing a key to say so.
- **`:for-key` is refused.** A key tells replicas apart, and there are none.

`:for-as` works as it does on `:for-each`, and the two may not appear on the
same element: they are one question — how many times does this render — and
an element answers it once.

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
