# Values

Values are the reactive pieces inside a scope. A value can be either static or
computed from an expression.

## Declaring values

Use `:name=${expr}` on an element to declare a value on that element's scope.

```html
<html :count=${0} :light=${true}>
  <body>
    <p>Clicked ${count} times</p>
  </body>
</html>
```

The element's descendants can read `count` and `light` directly through lexical
scope lookup.

## Static vs. reactive

Markout treats a value as either:

- a static value, set once or updated manually; or
- a reactive expression that is re-evaluated when one of its dependencies
  changes.

The compiler is responsible for discovering those dependencies. The runtime does
not infer them from the expression body.

## Expression semantics

Expressions run with the owning scope as `this`. That is why the
compiler qualifies non-local references as `this.foo` and records the matching
dependency edges during compilation.

In practice, that means:

- bare references are compiled into explicit scope lookups;
- nested classic `function` expressions are rejected because they would rebind
  `this`;
- arrow functions are the safe syntax.

## Special binding prefixes

Some prefixes change how a value behaves at runtime:

- `:class-x` toggles a CSS class.
- `:style-x` writes a CSS property.
- `:on-x` binds an event handler.
- `:did-x` and `:will-x` bind lifecycle hooks.

These are still values. They just have side effects instead of being pure logic values.

## Update model

When a dependency changes, Markout propagates updates through the dependency
graph. Dependencies are updated when needed so that added or
removed scopes and values stay in sync.
