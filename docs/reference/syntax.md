# Syntax Reference

The whole language on one page: what interpolation means, every `:` family,
the module and composition tags, and the names the runtime supplies.

## Interpolation

| Syntax | Meaning |
| --- | --- |
| `${expr}` in text | Reactive text content. |
| `${expr}` in CSS | Reactive stylesheet content — the whole sheet is one binding, so see below. |
| `attr=${expr}` | Reactive plain attribute; no `:` needed. `null`/`undefined` removes it. |

### A stylesheet is one binding

`<style>`, `<title>` and `<textarea>` hold text rather than markup, and an
interpolation inside one cannot be wrapped in the comment markers that
delimit dynamic text elsewhere — a browser would show them. So these hold
their whole content as a single value.

Which means **one `${...}` makes the entire sheet reactive**, and every
change re-serializes all of it. Keep what changes in its own sheet:

```html
<style>
  :root { --accent: ${accent}; }        <!-- reactive: a few tokens -->
</style>
<style>
  .panel { border-color: var(--accent); }   <!-- static: never re-serialized -->
</style>
```

Splitting a 4.6KB stylesheet this way in the Orbit demo left 0.8KB reactive
and the rest inert. Nothing else in the language has this granularity: an
ordinary attribute or text interpolation is its own binding.

### Attribute values and quoting

An attribute value can be unquoted, `"double quoted"` or `'single quoted'`,
and any of them may contain `${...}`. What quoting does *not* do is decide
the type — that depends on whether an expression fills the value on its own:

| Written | Result |
| --- | --- |
| `:x=${expr}` | the expression's value, whatever its type |
| `:x="${expr}"` | identical: quoting changes nothing here |
| `:x='${expr}'` | identical |
| `:x="text ${expr}"` | interpolation — always a string |
| `:x="${a}${b}"` | interpolation — always a string |
| `:x="literal"` | the string `literal` |

So a lone expression is passed through with its type intact — object, array,
number, boolean, function — while anything combining literal text with
expressions, or more than one expression, is assembled into a string.

That distinction matters most for `:prop-`, where a component is expecting
something an attribute could never carry:

```html
<sl-select :prop-options="${items}"      <!-- the array itself -->
           :prop-label="Pick one of ${items.length}">   <!-- a string -->
```

NOTE: "on its own" is literal — whitespace is text like any other, so
`:x=" ${expr}"` interpolates and yields a string.

## Values

| Syntax | Meaning |
| --- | --- |
| `:name=${expr}` | Declares a reactive value on the current scope. |
| `:server-name=${expr}` | Declares value `name`, but the expression runs on the **server only** — the client is handed its result. Server-only. |
| `::name=${expr}` | A **compile-time constant**: computed while the page is built and written into every expression that reads it. Nothing of it reaches the runtime. |
| `:aka="name"` | Names the current scope so descendants can reference it. A literal, not an expression. |
| `:attr-name=${expr}` | Toggles whether attribute `name` is PRESENT, as boolean and custom-element attributes need. Bare `:attr-name` implies `true`. `.` and `:` are allowed, for `data-x.y` and `xlink:href`. |
| `:prop-name=${expr}` | Assigns the element's JS property `name`, for what an attribute can't carry. Browser-only: skipped when server rendering. |
| `:class-name` | Toggles the `name` CSS class. |
| `:style-name` | Writes the `name` CSS property. |
| `:on-click=${() => ...}` | Binds an event handler. The name is the event type verbatim, so `.` and `:` are allowed for the sake of `shown.bs.modal`, `click.mine` and the like. |
| `:handle-name=${(v) => ...}` | Runs when value `name` changes, and once at start, with its value. For driving the view imperatively; browser-only. |
| `:did-init=${() => ...}` | Runs once, when this scope has come up. Browser-only. |
| `:did-attach=${() => ...}` | Runs when this scope's markup enters the page, and again each time it comes back. Browser-only. |
| `:will-detach=${() => ...}` | Runs before that markup leaves. Browser-only. |
| `:will-dispose=${() => ...}` | Runs once, before this scope stops existing. Browser-only. |

### Naming a value

`:name` and `:aka` are read back as `${name}`, so the name has to be
something an expression can say: a JS identifier, no dash (reserved for the
dash-case families above) and no `$` (reserved for the runtime's own). A
reserved word or a leading digit is refused for the same reason — `${if}`
and `${9lives}` don't parse, so the value could be declared but never read:

```html
<div :while=${ready}>       <!-- error: "while" is a reserved word -->
<div :ready=${ready}>       <!-- fine -->
```

That rejection is what makes the reserved words available for something
else. A name no page can declare is a name a **directive** can take with no
prefix and no possibility of collision, which is where `:if` comes from —
and the reason `${if}` not parsing is a feature rather than an awkwardness.

The names in the dash-case families are element-facing — CSS properties,
attribute names, event types — so they keep their dashes and this rule
doesn't apply to them. Each takes what its own world uses: dash-case for
class names, CSS properties and JS properties, and additionally `.` and `:`
for `:attr-` and `:on-`, whose names reach `setAttribute` and
`addEventListener` exactly as written. `$` stays out everywhere, being the
runtime's own prefix.

### Lifecycle

Two pairs, answering two different questions.

`:did-init` and `:will-dispose` bracket the **scope**: what it set up when it
came into being, and has to let go of when it stops existing. A timer, a
subscription, anything whose lifetime is the component's.

`:did-attach` and `:will-detach` bracket its **markup**: what has to exist
while the element is in the page, and be taken apart when it leaves. A
third-party plugin holding your element, an observer, a measurement.

They are not the same thing, which is why there are four rather than two. A
`:for-data` region's markup leaves the page and comes back without its scope
ever going away, so it detaches and attaches repeatedly and never disposes.
A `:for-each` replica that is dropped does both, in that order — its markup
goes, then it does.

```html
<span :did-attach=${() => globalThis.bootstrap.Tooltip.getOrCreateInstance($dom)}
      :will-detach=${() => globalThis.bootstrap.Tooltip.getInstance($dom)?.dispose()}>
```

Order within a pass: parents before children on the way in, children before
parents on the way out — things are taken apart in the order they were built,
reversed.

All four are browser-only, like `:handle-`, and all four take a literal arrow
like every other callback family. The suffixes are a closed set: `:did-mount`
is a compile error rather than a callback that never runs.

A stencil announces nothing. A `:for-each` host and a `:for-data` region with
nothing to show evaluate none of their values, and for the same reason they
report none of these — what a stencil is, is a prototype.

### Handlers, and the imperative corner

Almost everything is declarative: state what a thing should be, and the
runtime keeps it that way. Some of the DOM isn't reachable that way, because
it is a verb rather than a value — `focus()`, `showModal()`, `play()`.

`:handle-name` is the door. It runs when `name` changes, and once at start,
receiving the value; `$dom` is the element it belongs to:

```html
<dialog :open=${false} :handle-open=${(v) => v ? $dom.showModal() : $dom.close()}>
  ...
</dialog>
```

Both are browser-only. A served page has no element to drive, so `$dom` is
absent and handlers do not run while server rendering. Anything that *should*
show up in the served markup therefore belongs in a value rather than in a
handler — a handler is for the part of the view that markup can't express.

A handler depends on the value it names, and only that. References inside
its body are not dependencies, so it does not re-run because something it
happens to touch changed. They still have to *resolve*, though — a name that
is nowhere is a compile error wherever it is written, handler bodies
included, rather than a failure waiting for the first click.

The four callback families take a **literal arrow function**, written at
that spot. A classic `function` is refused because it would rebind `this`,
which is how the surrounding scope is reached; and for now a reference to
one is refused too, so `${handler}` is an error even where `handler` holds a
function:

```html
<button :on-click=${() => count++}>          <!-- yes -->
<button :on-click=${async () => save()}>     <!-- yes: still an arrow -->
<button :on-click=${handler}>                <!-- error -->
<button :on-click=${function () { ... }}>    <!-- error -->
```

The ban on classic functions is wider than these three: one may not appear
anywhere inside any `${...}`, for the same reason.

### Compile-time constants

A design token never changes, and `::` says so:

```html
<html ::accent="#6f42c1" ::gutter=${16}>
  <head><style>:root { --accent: ${accent}; --gutter: ${gutter}px }</style></head>
```

The value is computed while the page is built and written into every
expression that reads it, so **nothing of it reaches the runtime** — no
scope entry, no dependency edge, no cell that can never fire. It matters
most in a stylesheet, where one interpolation otherwise makes the [whole
sheet a binding](#a-stylesheet-is-one-binding); with `::` there is no
binding at all.

The mark is on the name rather than a `:const-` family, because a family
prefix marks only the declaration: a `:const-color` would still be read as
`${color}`, indistinguishable from a reactive value everywhere the
difference costs something. `${accent}` says it at every use.

**One rule keeps it honest: a `::` value may read only literals and other
`::` values.** Reading an ordinary value, `$id`, the DOM or a handler is a
compile error — never a quiet fall back to being reactive, which would hand
the page exactly the cost the marker was meant to avoid. The result also has
to be a primitive; substituting an object would give every reader a separate
copy.

And the limit worth knowing before reaching for it: **a `::` value cannot
participate in runtime theming.** A light/dark switch changes values while
the page runs, and these are gone by then. `::` is for what is fixed when
the page is built.

A kit's tokens are `::` for exactly this reason, and a page overrides them
where it imports the kit — see [root attributes](#root-attributes-reach-the-call-site):

```html
<head ::bsRadius="1rem">
  <:import src="/bootstrap-kit/all.htm" />
```

### Server-only values

Hydration re-derives every value by running its expression again in the
browser. `:server-name=${expr}` says that this one can't be run there:

```html
<html :server-startedAt=${Date.now()}>
  <body>Started at ${startedAt}</body>
</html>
```

The server evaluates it once, sends the result alongside the page, and the
client uses that result — so `startedAt` is the same number in both, instead
of the server's value being replaced by the browser's the moment the page
comes alive.

It is for expressions that **cannot** be re-run, not for ones that are merely
slow. Three kinds qualify: a value only the server can produce (a file, an
environment variable, a session), one that isn't deterministic (`Date.now()`,
`Math.random()`), and one assigned imperatively later, which has no expression
to re-run at all.

The value is **frozen** in the browser: it arrives with a result and no
expression, so nothing re-derives it. Values that *read* it are ordinary and
keep updating as usual — which gives the one rule worth remembering:

> Mark the source, never the derivation.

```html
<html :server-user=${{ name: 'Ada' }} :greeting=${'Hi ' + user.name}>
```

`user` is marked because the browser can't produce it; `greeting` is left alone
so it still tracks `user`. Marking `greeting` instead would pin it, and a
later change to `user` would silently never reach it.

### Async on the server

A `:server-` expression may produce a promise. The server waits for it and
sends what it resolved to, so the page is served complete:

```html
<html :server-rows=${fetch(url).then(r => r.json())}>
  <body><div :for-each=${rows ?? []}>${data.name}</div></body>
</html>
```

Async is allowed **exactly where the result can be sent**. An unmarked value's
promise would have to resolve in the browser too, and hydration is
synchronous — there is nothing there to wait with — so only `:server-` values
are settled.

One result may feed the next. The server keeps going until nothing is left in
flight, so a value that needs another's result to build its request works:

```html
<html :server-user=${fetch('/me').then(r => r.json())}
      :server-orders=${user ? fetch(`/orders/${user.id}`).then(r => r.json()) : null}>
```

Two limits bound the wait, and they mean different things. A **deadline**
(5s) bounds how long a visitor waits for a slow network. A **depth cap** (5
links) bounds how long a chain may get; a page past it has a bug, and saying
so beats stalling until the deadline on every request.

A value that rejects, times out, or is still waiting at the cap becomes
`undefined` and is reported — the same rule an expression that throws already
follows. The page is still served: the rest of it is what the visitor came
for.

A promise never reaches the page. While one is in flight the value reads as
`undefined` — the runtime holds the promise aside rather than letting it into
the reactive system — so everything downstream is written against data and
nothing else. That is what makes the guard above do what it looks like it
does: `user` is not "a promise that is truthy", it is simply not there yet.

Two things to know before using it:

- **The result is published.** It travels in the page source as plain text, so
  never mark anything derived from a credential, a session, or another user's
  data.
- **It has to be sendable.** Numbers, strings, plain objects and arrays,
  `undefined`, `Date`, `Map`, `Set`, `RegExp`, `BigInt`. Not functions, not
  class instances, not a structure that refers to itself — those are reported
  as errors, and the value is `undefined` in the browser.

And one thing to know about delivery: a page compiled ahead of time into static
assets has no request behind its render, so a `:server-` value that needed one
cannot produce anything — and because such a value crosses frozen, nothing in
the browser can make up for it. `markout build` therefore **fails** on one that
throws, rather than shipping a page permanently missing what it was for. A value
that reads nothing of the request is fine there, and its answer is baked into
the markup. See
[rendering](../concepts/isomorphism.md#what-ahead-of-time-compilation-cannot-carry).

`:server-` marks declared values only. It is an error on `:attr-`, `:class-`,
`:style-`, `:prop-` (which re-derive for free once the value they read is
marked), on the callback families (which hold functions), and on `:aka`,
`:slot` and the `:for-` attributes, which name no value.

## Comments inside a tag

Between the attributes of an opening tag, `//` comments to end of line and
`/* … */` block comments are both allowed. They are stripped at parse time
and never reach the served markup.

That matters more than it sounds, because attributes may also span lines. A
tag declaring a handful of values stops being a long line to scan and
becomes something closer to a declaration, with its parts grouped and
labelled:

```html
<div class="my-component"

     // parameters
     :width=${100}

     // private
     :_w="${width}px"

>${_w}</div>
```

Commenting out a single attribute works the way it does in code — the
comment simply hides it from the parser. One left unterminated runs to the
end of the file, which shows up as the enclosing tag never being closed
(`Unterminated tag DIV`) rather than as anything about comments.

These belong to a tag. In text content they are ordinary text; use
`<!-- … -->` there.

> The leading underscore is a convention meaning "private" — a value the
> component uses but no caller should set. Nothing in the language treats
> `_` specially; it reads as private to a person, not to the compiler.

## Text that isn't markup

`<style>`, `<title>` and `<textarea>` hold text rather than markup: a browser
reads what is between their tags as characters. So an interpolation there is
the element's whole content as one value rather than one binding per
`${...}`, and changing any part of it rewrites the lot. Nothing about writing
it differs:

```html
<textarea :on-input=${(ev) => draft = ev.target.value}>${draft}</textarea>
```

## Replication

| Syntax | Meaning |
| --- | --- |
| `:if=${expr}` | Render this element when the expression is truthy, not at all otherwise. Binds nothing. |
| `:else-if=${expr}` | Another condition for the position, tried only if every branch before it failed. Goes on the element immediately after an `:if` or another `:else-if`. |
| `:else` | The branch for when none of the conditions before it held. Takes no expression, and ends the chain. |
| `:for-each=${expr}` | Repeat once per item in an iterable. `null`/`undefined` means zero items. |
| `:for-as="name"` | Rename the per-item binding from the default `data`. |
| `:for-key=${expr}` | Give each item an identity, so reordering moves replicas instead of rewriting them. Evaluated per item, and may read the per-item binding. Refused on `:for-data`, which has only ever one. |
| `:for-data=${expr}` | Render once if `expr` is neither `null` nor `undefined`, not at all otherwise. Binds the item like `:for-each`. |

`:if`, `:for-each` and `:for-data` all answer "how many times does this
render", so an element may answer once: any two together is a compile error.
`:else-if` and `:else` are the same answer under other spellings, and so
count as `:if` here — an element is one branch, not the choice between two.

A chain shows the first branch whose condition holds and no other:

```html
<p :if=${n === 0}>nothing yet</p>
<p :else-if=${n === 1}>one thing</p>
<p :else>${n} things</p>
```

Which branch an `:else` belongs to is said by position and by nothing else,
so it has to be the very next element after the branch before it.
Whitespace and comments in between are fine — neither renders — but
anything that does render is a compile error, since it would appear between
two alternatives at most one of which is showing. Everything true of `:if`
stays true of the others: a branch that isn't showing evaluates nothing
inside itself, and its element is parked in a `<template>` rather than
rebuilt when it comes back.

`:if` and `:for-data` differ in the question they ask. `:for-data` is
`!= null`, so `0` and `''` are data — right for an item, wrong for a
condition. `:if` is plain truthiness, so `${count}` and `${name}` mean what
they look like, and it binds no item: `data` inside an `:if` still means
whatever it meant outside.

Neither evaluates its body while it isn't showing, which is what makes
`${user.name}` safe to write inside one.

The host element becomes an inert `<template>` and every visible item is a
clone of it. That `<template>` is still an element in the DOM, and the first
one — so CSS written against a replicated list has to use `:first-of-type`
rather than `:first-child`, and `:nth-of-type` rather than `:nth-child`. See
[replication](../concepts/directives.md#the-stencil-is-a-real-element-and-css-can-see-it).

### A name inside a region is read with `?.`

A region is not built while it isn't showing — that is what "evaluates
nothing" means — so the scopes inside one exist only while it does. A name
declared in there is therefore a name that may not be there, and the language
asks for it to be read the way JavaScript reads anything that may not be
there:

```html
<div :aka="panel" :if=${open}>
  <input :aka="field" :text=${''}>
</div>
<p>${panel.field?.text ?? 'nothing yet'}</p>
```

The `?.` is required, not merely permitted — without it the reference used to
compile clean and fail when the page ran, with a message about `undefined`
that named nothing the author had written. With it, the reference reads
`undefined` while the region is away and the real value while it is showing,
and a change inside the region reaches the reader outside it.

**A write needs `$set`**, because `a?.b = c` isn't JavaScript. `a?.b(c)` is,
so a write spelled as a call inherits the guard:

```html
<button :on-click=${() => panel.field?.$set('text', '')}>clear</button>
```

It answers whether it landed — `true` when the write went through, and the
whole expression is `undefined` when the region was away — so a caller that
needs to know can ask, and one that doesn't can ignore it. Plain assignment
into a region stays a compile error, since there is no way to write `?.` on
the left of an `=`.

The name has to be a literal, so the compiler can check it. A name it cannot
follow would be a write that quietly lands nowhere, which is the thing `$set`
exists to have a spelling for.

**`:for-each` is refused outright**, guarded or not. `?.` says "this may be
absent", and a loop's difficulty is different: the name means as many scopes
as there are items, and none of them in particular.

Two things need no guard. A value **on** the region host — `${panel.open}` —
since that scope exists whether or not it is showing, which is how a region's
own condition is read. And anything read from **inside** the same region,
where everything is built together and stops existing together.

## Modules and components

| Syntax | Meaning |
| --- | --- |
| `<:include src="file.htm" />` | Splices another file into the current document. |
| `<:include src="file.txt" as="pre" />` | Includes a file as a literal element named `pre` containing its text. |
| `<:import src="file.htm" />` | Splices a fragment into the page; each file is only imported once per page. |
| `<:define tag="x-y:button">...</:define>` | Declares a reusable custom tag. |
| `<:logic :aka="x" :n=${1} />` | Declares a scope with no element of its own. |
| `<:define tag="x-y:logic">` | A custom tag whose instances are scopes with no element. |
| `:when-used="tag-a tag-b"` | Keep this element only while one of those tags survives treeshaking. Build-time; nothing of it reaches the runtime. |
| `<:slot />` | In a definition: where a usage site's content goes. Its own content is the fallback. |
| `<:slot name="x" />` | A named slot. |
| `:slot="x"` | On a usage site's child: which slot it fills. Unaddressed content fills the unnamed one. A literal, not an expression. |

### How a fragment is indented

Two conventions, and the file extension picks between them.

A page (`.html`) is indented like HTML: attributes that wrap line up under
the first one. Someone opening it should see the page they already had, with
some attributes added — which is what adopting markout is supposed to feel
like, and it is worth more than the tidiness the other shape buys.

A fragment (`.htm`) is indented like code: attributes sit one step in from
their tag, and the closing `>` goes back at the tag's own indent.

```html
<:define tag="bs-alert:div"
  role="alert"

  // parameters
  :variant=${'primary'}
  :dismissible=${false}

  class=${_class}
  :class-fade=${dismissible}
>
```

This is what a fragment already is. A `<:define>` header is a parameter
list, its body holds arrow functions and template literals, and the closing
`>` on its own line was already a block delimiter — only the column the
attributes sat in disagreed.

Aligning has two costs a fragment feels and a page mostly doesn't. The
column is derived from the tag's name, so renaming a tag re-indents every
attribute under it and a one-word change lands in `git blame` as a rewrite.
And the column moves, so how deep an attribute sits — and therefore whether
a line is short enough to keep — depends on how long the tag happens to be,
which is why two adjacent components in the same file used to break
differently.

The [VS Code extension](../../packages/vscode/) formats to this — both
shapes, chosen by the file's extension — so it is something to run rather
than something to remember. It only ever changes indentation, and only inside
an open tag: where an attribute list *wraps* is a judgment about how a
component reads, and stays yours.

### `<:logic>` — a scope with no element

Everything else that declares values is markup that happens to carry them.
State that belongs to the page, rather than to anything on it, had nowhere
to live but an element invented to hold it — and that element is then real:
in the document, in the accessibility tree, and counted by every
`:first-child` and `* + *` around it.

```html
<:logic :aka="app"
        :services=${[]}
        :span=${24}
        :_healthy=${services.filter(s => s.state === 'ok').length} />

<p>${app._healthy} of ${app.services.length} healthy</p>
```

It is a scope like any other — named with `:aka`, read as `app.something`,
reactive, and bracketed by `:did-init` / `:will-dispose` — and it leaves
nothing in the served page.

The name is optional. Values on an unnamed one are reachable from nowhere,
which is the point when what it declares is behaviour rather than data:

```html
<!-- a timer, and the value it writes; nothing needs to refer to this -->
<:logic :_timer=${null}
        :did-init=${() => _timer = setInterval(tick, 1000)}
        :will-dispose=${() => clearInterval(_timer)} />
```

What it refuses, in both cases because there is no element:

| | |
| --- | --- |
| `:class-`, `:style-`, `:on-`, plain attributes | nothing to apply them to |
| `:for-each`, `:for-data`, `:if`, `:else-if`, `:else`, `:slot` | nothing to replicate, show, or slot |
| content of any kind | it holds values, not markup |

And where it refuses to go: inside a `:for-each`, a `:for-data`, an `:if`, a
`<:define>`, or a custom tag's content. Each of those turns a declaration
that reads as one-per-page into one per item, one per instance, or one that
comes and goes — a timer started per row is not something to discover at
runtime. Every one of them is a coherent feature on its own; none of them is
this one.

### `:logic` as a base tag — a definition with no element

The same idea as `<:logic>`, one level up: that one is a scope with no
element, this is a tag whose *instances* are.

```html
<:define tag="std-data:logic" :url="" :data=${null} … />

<std-data :aka="rows" :url="/api/rows" />
<p>${rows.data?.length ?? 0} rows</p>
```

A component that is a source rather than a sight — a datasource, a router,
a media query, a socket — otherwise pays for an element per usage and an
attribute to hide it. This is `std-data`'s own definition, and what it used
to be was `tag="std-data:span" hidden`.

It takes the same refusals as `<:logic>`: nothing that needs an element to
apply to, and no content. It does **not** take `<:logic>`'s placement
rules — a `<:logic>` is a singleton declaration, so it is refused where it
would silently become many, while an instance is written deliberately and
`<std-data :for-each=${urls} />` means exactly what it says.

The base tag is spelled out rather than left off. `tag="my-panel"` with no
base at all would read as this, and it is much more often a typo — so it
stays the error it has always been.

### A base tag is a real element

The part after the colon in `tag="x-y:button"` is the element the
definition becomes, and it has to be one HTML already has — or `logic`,
for a definition that becomes no element at all (above). A definition
cannot be based on another definition:

```html
<:define tag="my-box:div" class="box"><:slot /></:define>

<!-- compile error: <my-box> is itself a definition -->
<:define tag="my-card:my-box">…</:define>
```

Composing is the ordinary case and is unaffected — a definition's body may
use any other definition, including its own base-to-be:

```html
<:define tag="my-card:section">
  <my-box><p>the body</p></my-box>
</:define>
```

The difference is that the second one wraps rather than specializes, so
`<my-card>` is a `<section>` containing a `<div class="box">` rather than
a `<div class="box">` with different defaults. Where that extra element
matters — a `position: sticky` child can only stick within its parent's
box — the region has to stay where it is.

### One name, one slot

A usage's content goes to one place, so a name may be slotted once per
definition. A second `<:slot>` of the same name could never be filled — it
would render whatever it holds itself, and never the caller's markup — so it
is a compile error rather than a silent first-wins.

It is worth knowing because of the shape that invites it. A component that
renders one of two ways wants the caller's content in whichever is showing,
and a slot in each branch is the obvious way to ask:

```html
<:define tag="my-box:div">
  <div class="wide" :if=${wide}><:slot /></div>     <!-- error: two unnamed slots -->
  <div class="narrow" :else><:slot /></div>
</:define>
```

Give each branch a slot of its own instead, and the component adapts —
each branch takes its own markup from the call site, and switching swaps
the markup along with the wrapper:

```html
<:define tag="my-box:div">
  <div class="wide" :if=${wide}><:slot name="wide" /></div>
  <div class="narrow" :else><:slot name="narrow" /></div>
</:define>

<my-box><b :slot="wide">…</b><i :slot="narrow">…</i></my-box>
```

Where the two branches want the *same* markup, the way to have it is one
slot and a wrapper whose class is conditional, rather than two branches —
which is what the Bootstrap kit's toast does between its two layouts.

### `:aka` and `:slot` are literals

Both name something while the page is being compiled — a scope's name is
resolved by the compiler, and which slot content fills is decided as the
tree is assembled — so neither has anything to evaluate an expression
against. `:aka=${x}` and `:slot=${x}` are compile errors.

They are also the only two system attributes spelled as ordinary
identifiers rather than [reserved words](#values), which is a deliberate
trade: no reserved word reads as well as either. The price is that a page
cannot declare values named `aka` or `slot`, and the error above is what
keeps that price visible rather than silent.

### Shipping a component's assets

An unused `<:define>` is dropped, but a `<style>` next to it is not — and
should not be, since a stylesheet beside some definitions is not
necessarily *their* stylesheet. `:when-used` is how an asset says it is:

```html
<lib>
  <style :when-used="x-chart">.x-chart { … }</style>
  <:define tag="x-chart:div">…</:define>
</lib>
```

A page that never writes `<x-chart>` gets neither the definition nor its
CSS. One that does gets both. Naming more than one tag keeps the element
while any of them survives, which is what a stylesheet shared by a family
of components wants.

This is decided when the page is built, so unlike [`:if`](#values) it costs
nothing at runtime — the element is there or it is not, and the attribute
never reaches the browser. It gives the element no scope either.

A name no `<:define>` declares is a compile error. That is the point: a
renamed component would otherwise leave its stylesheet waiting on a name
nothing will ever use, and every page would silently lose the styling.

### A fragment has one root

An included or imported file is unwrapped: its root element disappears and
its **children** are spliced in. So a fragment needs exactly one root element
holding everything, conventionally `<lib>`:

```html
<lib>
  <:define tag="app-panel:div">…</:define>
  <:define tag="app-chart:div">…</:define>
</lib>
```

Without it the parser supplies the missing structure the way it does for any
loose markup — which means an implicit `<body>`, and splicing that into a
page that already has one is an error rather than a merge.

### Root attributes reach the call site

The root element's own attributes are copied onto whatever contains the
`<:import>` or `<:include>` — **unless that element already declares them.**
So a fragment states its defaults on its root, and the page overrides them
where it brings the fragment in:

```html
<!-- app/sources.htm -->
<lib :apiBase="/api">
  <app-data :aka="people" :url=${apiBase + '/people'} />
</lib>
```

```html
<body :apiBase="https://staging.example.test/api">
  <:include src="/app/sources.htm" />
```

This is how the Bootstrap kit's URL and theme tokens work, and it is not
something kits get and applications don't: it is the same mechanism wherever
a fragment is brought in, and worth reaching for whenever a fragment has a
setting its callers might want to move.

Note which element receives them — the one the directive sits *in*. An
`<:import>` is only allowed directly in `<head>`, so its root attributes land
on `<head>`; an `<:include>` written in `<body>` puts them on `<body>`.

## Default scope names

`<html>`, `<head>` and `<body>` always have scopes of their own, named
`page`, `head` and `body`, so shared state has an obvious home that any
descendant can read.

## Runtime-supplied values

Available on every scope; not declared, and reserved from user code.

| Name | Meaning |
| --- | --- |
| `$id` | This scope's identifier, unique in the page. For building HTML ids. |
| `$parent` | The enclosing scope — where this markup was WRITTEN. |
| `$host` | The custom-tag instance this markup ended up INSIDE, or nothing outside any. |
| `$value("key")` | Looks a value up by key. |
| `$set("key", v)` | Assigns to a value by name, and answers whether it landed. For writing where `=` cannot go — see below. |
| `$dom` | This scope's own element, or nothing if it has none. Browser-only. |

### `$parent` and `$host`

The same thing until slotting separates them, and then they answer the two
questions markup slotted into a component actually has: what did I come
from, and what am I part of.

```html
<:define tag="my-item:li"
  // the list I was slotted into, whichever one that is
  :_group=${$host ? $host.$id : null}>
```

`$parent` is lexical, so for slotted markup it is the call site — which is
what keeps a definition from reading whatever its caller happened to
declare. `$host` is structural: the nearest enclosing instance, whether or
not the markup was written there. It is what a component reads to coordinate
with the one containing it, and reading it takes writing it, so the
isolation still holds by default.

A component outside any instance has no `$host` at all, which is what lets
it stand on its own rather than requiring a container.

Which instance `$host` lands on is a property of each *usage*, so the
compiler doesn't resolve through it: `$host.x` records that it read `x` —
so a change still propagates — and doesn't check that `x` is there, in the
same way `$dom.whatever` isn't checked.

## Globals

A name an expression uses is looked up on the scope chain, and the JS
standard library is its last link. So an expression is plain JavaScript in
the way it looks:

```html
<p :n=${Math.max(1, 2)}>${JSON.stringify({ n })}</p>
```

Available: `Array`, `BigInt`, `Boolean`, `Date`, `Error`, `Infinity`, `Intl`,
`JSON`, `Map`, `Math`, `NaN`, `Number`, `Object`, `Promise`, `RegExp`, `Set`,
`String`, `Symbol`, `WeakMap`, `WeakSet`, `clearInterval`, `clearTimeout`,
`console`, `decodeURI`, `decodeURIComponent`, `encodeURI`,
`encodeURIComponent`, `fetch`, `globalThis`, `isFinite`, `isNaN`,
`parseFloat`, `parseInt`, `queueMicrotask`, `setInterval`, `setTimeout`,
`structuredClone`, `URL`, `undefined`, and `$origin`.

The timers, `fetch` and `URL` are on the list for the same reason as the
rest: they exist in both environments, and the places that call them — `:on-`
and `:handle-` bodies — only run in one.

### `$origin`

The odd one out, and the only name here that isn't JavaScript's: the page's
own origin, `https://example.test`. The server takes it from the request, the
browser from `location.origin`, and it means the same thing in both — which
is the bar everything on this list has to clear.

It exists because the server has no page to be relative *to*. A `:server-`
value fetching `/data.json` is not asking for a different address, it is not
asking for an address at all, so something has to say where the page is:

```html
<html :server-rows=${fetch($origin + '/data.json').then(r => r.json())}>
```

It is spelled with a `$` because it is the runtime's rather than
JavaScript's, and that also means a page cannot declare a value over it —
`$` is reserved in a declared name. Where there is no server, it is
`undefined` — except in a build told what to be relative to, since
`markout build --origin <url>` is exactly the answer to "where is this page
going to be".

Nothing else about the request is offered, and that is deliberate. Headers,
cookies and the method have no browser counterpart, so a page reading one
would render something it cannot hydrate to — and would publish a session
while doing it.

Because it is the last link, a declared value of the same name shadows it —
`:Math=${...}` means yours from there down.

A global is not a dependency: it can't change, so nothing re-evaluates
because of one.

### What is deliberately not on the list

`document`, `localStorage`, and whatever libraries the
page loads exist in the browser and not on the server. Naming one directly
would give a page an expression that works in one half of an isomorphic
render and throws in the other, with nothing in the source to say which.

They are reached through `globalThis`, which is on the list, so that the
environment a line depends on is visible in the line itself:

```html
<div :open=${false}
     :handle-open=${(v) => globalThis.bootstrap.Modal
       .getOrCreateInstance($dom)[v ? 'show' : 'hide']()}>
```

The same rule as `$dom`, which is browser-only for the same reason: anything
that has to show up in the served markup belongs in a value, and anything
that needs a browser belongs in a handler.

## Notes

- `${...}` is the only expression syntax, and anything containing one is
  reactive — `:` names things HTML has no name for, rather than marking
  reactivity by itself.
- An expression resolves where it was WRITTEN. A definition's body sees the
  definition's scope; a usage site's attributes and slotted content see the
  call site.
- The compiler is responsible for qualification and dependency extraction.
- The runtime executes the generated graph; it does not discover dependencies on
  its own.
