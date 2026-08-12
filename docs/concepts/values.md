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

## Reference chains

A reference can walk through as many named scopes as you like. Each segment is
resolved against the scope the previous one landed in, exactly the way a lookup
happens at runtime:

```html
<div :aka="outer">
  <span :aka="inner" :count=${1}></span>
</div>
<p>${outer.inner.count}</p>
```

The chain stops at the first name that isn't a scope. Anything after that is
ordinary property access on whatever the value holds, so `${user.profile.name}`
depends on `user` — not on `profile` or `name`, which are plain object
properties the compiler can't and shouldn't track.

One restriction follows from this: a *computed* property access on a scope,
like `${outer[key]}`, is a compile error. It works at runtime, but the compiler
can't tell statically which value it lands on, and recording a dependency on
the scope instead would give you a binding that renders once and then never
updates. An error you see at build time is better than a page that quietly goes
stale, so the compiler refuses rather than guesses.

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

## When an expression fails

An expression that throws — `${user.name}` before `user` has loaded, say — does
not break the page. The value becomes `undefined`, and evaluation of everything
else continues.

It becomes `undefined` *always*, never the value it held before. Keeping the
old one would make a binding's contents depend on which earlier evaluations
happened to succeed, and would show stale data as though it were current. One
fixed rule beats a result you have to reconstruct from history.

The failure is still reported. Run the server with `--dev` and it appears in
the page itself, naming the scope and value at fault:

```
markout [update] s3.text$0: Cannot read properties of null (reading 'name')
```

The same panel is produced during server rendering and in the browser after
hydration, so an error shows up in the same place wherever it happened. Without
`--dev`, errors are logged server-side and never reach the served markup.
