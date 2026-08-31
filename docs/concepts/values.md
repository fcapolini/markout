# Values

Values are the reactive pieces inside a scope. A value can be either static or
computed from an expression.

## Properties and methods, not attributes

A scope is a JavaScript object, and what a tag declares are its members:
`:name=${expr}` is a property, and a property holding a function is a method.
The tag is where they are *written*; it is not what they are limited to.

Worth saying plainly, because the syntax invites the opposite assumption —
that logic written in attributes inherits HTML's rules for attributes, one
line and no comments and quoting by luck. It does not. An interpolation's
extent is found by parsing it as JavaScript, so:

- `>` inside an expression does not close the tag, and `=>` is just an arrow;
- a quote inside an expression does not end the attribute;
- strings, template literals, object literals and nested `${...}` end where
  JavaScript says they end;
- attributes span lines, and `//` and `/* ... */` between them are stripped at
  parse time.

Which is what makes a scope's declarations readable as a unit rather than as a
long line: see [attribute values and
quoting](../reference/syntax.md#attribute-values-and-quoting) and [comments
inside a tag](../reference/syntax.md#comments-inside-a-tag) for the details,
and [a value that holds a function](#a-value-that-holds-a-function) below for
what a method costs in dependency terms.

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

### Values the compiler works out

`:const-name=${expr}` declares a value computed while the page is built and
substituted into every reader, so nothing of it reaches the runtime. It is
for the things that never change — a design token, a pinned version — where
watching them would be pure cost:

```html
<head :const-accent="#6f42c1">
```

The rule that makes it decidable is that such a value may read only literals
and other compile-time values. Anything it cannot work out is a compile
error rather than a quiet fall back to being reactive, and the result has to
be a primitive, since substituting an object would give every reader a copy
of its own.

`const-` is a **modifier**, not a family: it marks an ordinary value rather
than naming something in another world the way `:class-` names a CSS class.
So it is no part of what the value is *called* — `:const-accent` is read as
plain `${accent}` — and a page can take a kit's constant and make it live by
declaring that same name plainly where it imports the kit:

```html
<head :radius=${dark ? '0' : '1rem'}>
  <:import src="/some-kit/all.htm" />
```

The kit goes on writing `${radius}` and nothing in it changes. Every page
that doesn't need this pays nothing, and the one that does pays for a
binding exactly where it asked for one — which is also the answer to the
limit above, since a `:const-` value cannot take part in runtime theming.

## Static vs. reactive

A value is one of two things:

- **static** — set once, and changed only by being assigned;
- **reactive** — an expression re-evaluated whenever something it reads moves.

The compiler discovers those dependencies. The runtime does not infer them
from the expression body.

Which of the two a value is, though, is not settled by how it was written.

### An expression is a starting point, and an assignment ends it

`:n=${start * 2}` follows `start` for as long as nothing assigns `n`. The
first assignment ends that, for good:

```html
<body :start=${5} :n=${start * 2}>
```

`n` reads 10, and reads 200 once `start` becomes 100. Assign `n = 999` in a
handler and it holds 999 — `start` moving afterwards no longer reaches it.

**The rule in one sentence: a value follows its expression until something
assigns it, and is whatever it was assigned from then on.**

That is what makes the commonest thing a component does work at all — private
state seeded from a parameter, which has no other spelling:

```html
<:define tag="my-counter:div" ::start=${0}
  :_count=${start}
  :bump=${() => _count += 1}>${_count}</:define>
```

`_count` begins where the caller said, and is the component's own from the
first click onwards.

The cost is that a declaration does not say which state it is in, and the
assignment that decides can be anywhere — a handler further down, or markup
this element does not contain. Two rules of thumb keep it legible: a value
meant to go on deriving should have nothing assigning it, and a value meant as
a starting point reads better when its expression is a bare parameter than
when it is a calculation. `:_count=${start}` looks like a seed;
`:_invalid=${_empty ? required : !check(value)}` looks like a rule, and is one.

## Expression semantics

An expression is handed the scope it evaluates against, as an argument. That
is why the compiler qualifies non-local references as `$.foo` and records the
matching dependency edges during compilation.

In practice, that means:

- bare references are compiled into explicit scope lookups;
- any function may appear inside an expression, arrow or classic — the scope
  is an ordinary closure variable, so nothing rebinds it;
- `$` is that argument, and is the one name an expression may not declare.
  A local of that name would shadow the scope, so it is a compile error.

This was `this` until the scope became an argument, and the change removed a
rule rather than replacing one: a classic `function` had to be refused
everywhere inside an expression, because it would have rebound `this` and
lost the scope.

`:on-*`, `:did-*` and `:will-*` go further: the expression has to *be* a
function written there. `${handler}` is refused even when `handler` holds
one — see the [syntax reference](../reference/syntax.md#values).

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

## Update model

When a dependency changes, Markout propagates updates through the dependency
graph. Dependencies are updated when needed so that added or
removed scopes and values stay in sync.

### Writes are whole values; reads can be as narrow as you like

A value is written by assigning it, and that means a whole value at a time.
To change one field of an object, you assign a new object:

```html
<div :src=${({ a: 1, b: 2 })}>
  <button :on-click=${() => src = { ...src, b: 3 }}>bump</button>
</div>
```

That looks coarse, and the reading side is where it stops being so. **Every
derived value is a filter**: it re-evaluates when something it reads moves,
and then propagates *only if its own result changed*. So a projection is a
place where a wave stops:

```html
<div :src=${({ a: 1, b: 2 })} :b=${src.b}>
  <p>${b}</p>
</div>
```

Assigning `src` a whole new object whose `b` is still `2` re-evaluates `b`
and goes no further — the paragraph is not touched. Give the new object a
different `b` and it updates. Neither is configuration: the boundary is the
value you declared, and you can see where it is.

The two halves are meant to be used together. A broad write is how you make
several changes and have them land in one cycle, with no `batch()` to
remember. A refinement is how you say which of those changes you actually
care about.

### Two things to know about the filter

**It compares by identity.** For a string, a number or a boolean that is
what anyone would want. For an object it means a *rebuilt* one always
travels, even when its contents are the same:

```html
<div :src=${[1]} :ids=${new Set(src)}>   <!-- a new Set every time -->
```

Deliberately, and not a rough edge to smooth: a page that stores that Set,
or hands it to something that keys off identity, has to see the new one. It
does mean a refinement over a sub-object refines nothing, so project the
primitive you actually depend on when you want the wave to stop.

**Writing into a value notifies nobody.** `src.b = 3` changes the object and
tells no one — Markout sees a value being assigned, not a member of one
being written. `count++` works because `count` is the value; `src.b = 3`
does not because `src` is. Assign the whole thing, as above.

The instance of this that catches people is an array behind a `:for-each`:
`rows.push(row)` renders nothing, and neither does `rows.sort()` or
`rows[0] = x`. It is the same rule — `rows` is the value, and none of those
assign it — so hand back a new one, `rows = [...rows, row]`, and the loop
follows.

### A value that holds a function

A helper can live in a value and be called from anywhere that can see it:

```html
<body :suffix=${'!'} :fmt=${(n) => n + suffix} :count=${1}>
  <p>${fmt(count)}</p>
</body>
```

`${fmt(count)}` depends on `fmt` and `count`. It cannot depend on `suffix` —
it never mentions it — so what makes the text update when `suffix` changes is
that **`fmt` itself depends on `suffix`** and is rebuilt, and the rebuilt
function is a different one. That difference is what reaches the caller.

So the references inside a function you store in a value *are* dependencies
of that value, even though its body doesn't run until called. The rule is
about what can observe the result: anything can call `fmt`, so anything can
observe `suffix` through it.

Callbacks are the exception, and for the same reason read backwards. Nothing
can call `:on-click`, `:did-init`, `:will-dispose` or `:handle-x` from an
expression — the DOM and the runtime invoke them — so no caller can go stale,
and their bodies are deliberately not tracked. That is why a handler observes
only the value it names.

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
