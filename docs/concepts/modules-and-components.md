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

## Scope behavior in modules

Custom tags still obey the same scope rules as the rest of the language. A
fragment can read values from its enclosing scopes, and a definition can refer to
its imported root values such as `head.light`.

That is the reason modules remain understandable: they are just scopes plus
reusable markup.

## Practical note

`<:import>` is the implemented module primitive, and each file is only loaded
once per page. `<:define>` and custom-tag instantiation are also implemented and
covered by tests. If you are looking for JavaScript-module-style behavior,
Markout does not try to model that directly.
