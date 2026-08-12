# Modules and Components

Markout's module model is HTML-native. Instead of importing JavaScript modules
to assemble a component tree, you import fragments and define reusable tags in
the markup itself.

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

## `<:define>`

`<:define>` declares a reusable custom tag inside a fragment.

```html
<lib :light=${true}>
  <style>
    body {
      color: ${light ? 'black' : 'white'};
    }
  </style>

  <:define tag="theme-switcher:button"
           :class-theme-switcher
           :on-click=${() => head.light = !head.light}>
    Switch theme
  </:define>
</lib>
```

At the usage site, the custom tag becomes the concrete element it defines:

```html
<body>
  <theme-switcher />
</body>
```

This gives you component-like reuse without inventing a separate component
syntax.

## Parameters and defaults

A definition's own values are its parameters, and what it declares is the
default. A usage site overrides them the same way it would set any value:

```html
<:define tag="my-card:div" class="card" :title="Untitled">
  <h5>${title}</h5>
</:define>

<my-card :title="Hello" />
<my-card :title=${post.name} />
```

Plain attributes work the same way — `<my-card class="card wide" />` replaces
the definition's `class`.

## Content

`<:slot>` marks where a definition takes the children written at a usage site.
Its own content, if any, is the fallback used when a usage supplies none.

```html
<:define tag="my-card:div" class="card">
  <div class="body"><:slot>Nothing here yet.</:slot></div>
</:define>

<my-card><p>Anything you like.</p></my-card>
```

A definition can take several, named:

```html
<:define tag="my-panel:section">
  <header><:slot name="header">${title}</:slot></header>
  <div class="body"><:slot /></div>
</:define>

<my-panel>
  <h2 :slot="header">Custom heading</h2>
  Everything else fills the unnamed slot.
</my-panel>
```

A child picks its slot with `:slot="name"`. Anything not addressed to one — and
all text, which has no attribute to carry — fills the unnamed slot. Each slot
falls back independently.

Content with no slot to go to, or addressed to a slot the definition hasn't
got, is a compile error rather than markup that quietly disappears.

## Composing

Custom tags nest the way ordinary tags do. A definition can use other custom
tags, a usage can appear inside a `:for-each`, and slotted content can name
custom tags of its own:

```html
<:define tag="my-badge:span" class="badge" :label="">${label}</:define>
<:define tag="my-card:div" class="card" :title="Untitled">
  <h5>${title}</h5>
  <div class="body"><:slot /></div>
</:define>

<ul>
  <li :for-each=${posts}>
    <my-card :title=${data.title}><my-badge :label=${data.tag} /></my-card>
  </li>
</ul>
```

Each replica gets an instance of its own, with its own `$id`.

## Scope behavior in modules

Custom tags obey the same scope rules as the rest of the language, with one
addition that makes them reusable: **an expression resolves where it was
written.**

A definition's body resolves where the definition was written, so it sees its
own values, its fragment's root values (`head.light`), and the page — never
whatever the call site happens to declare. Dropping a component into a new
context can't silently change what it means.

Anything written at the usage site resolves there: the value of
`:title=${data.title}` above, and slotted content, both read the loop's `data`
even though they end up inside the instance.

```html
<html :label=${'page'}>
  <:define tag="my-box:div" :label=${'definition'}><:slot /></:define>
  ...
  <my-box>${label}</my-box>   <!-- 'page': written in the page -->
</html>
```

That is the reason modules remain understandable: they are just scopes plus
reusable markup, with one rule saying which scope applies.

## Practical notes

`<:import>` is the implemented module primitive, and each file is only loaded
once per page. `<:define>`, custom-tag instantiation, and slots are implemented
and covered by tests. If you are looking for JavaScript-module-style behavior,
Markout does not try to model that directly.

Two limits are worth knowing:

- A `<:slot>` sitting inside the definition's *own* `:for-each` can't be filled
  by a usage site yet; leaving it to its fallback works, and trying to fill it
  is a compile error that says so.
- Slots are resolved when the page is compiled, so which content fills a slot
  is fixed. Slotted markup also can't read the definition's internals — there
  is no scoped-slot mechanism.
