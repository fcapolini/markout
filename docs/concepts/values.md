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

The failure is still reported, naming the scope and value at fault:

```
markout [update] s3.text$0: Cannot read properties of null (reading 'name')
```

Run the server with `--dev` and you see it. If the failure happened while
server rendering, the page is replaced by one listing the errors — it carries
no content and no runtime, because a page whose expressions already failed on
the server would only fail the same way again in the browser. If it happened
after the page loaded, it appears in a panel at the bottom of the page.

Without `--dev` the page is served as rendered and errors go only to the server
log: a failing expression never costs a production page its runtime.
