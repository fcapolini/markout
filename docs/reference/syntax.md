# Syntax Reference

The whole language on one page: what interpolation means, every `:` family,
the module and composition tags, and the names the runtime supplies.

## Interpolation

| Syntax | Meaning |
| --- | --- |
| `${expr}` in text | Reactive text content. |
| `${expr}` in CSS | Reactive stylesheet content. |
| `attr=${expr}` | Reactive plain attribute; no `:` needed. `null`/`undefined` removes it. |

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
| `:aka="name"` | Names the current scope so descendants can reference it. |
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
<div :if=${ready}>          <!-- error: "if" is a reserved word -->
<div :ready=${ready}>       <!-- fine -->
```

Note what the first line *isn't*: `:if` is not a conditional. There is no
`:if` directive — a bare `:name` always declares a value (see
[replication](../concepts/replication.md) for how conditional rendering is
expressed today).

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

Until the runtime half exists, treat them as reserved. `:on-` handlers are
the working way to run code.

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

Two things to know before using it:

- **The result is published.** It travels in the page source as plain text, so
  never mark anything derived from a credential, a session, or another user's
  data.
- **It has to be sendable.** Numbers, strings, plain objects and arrays,
  `undefined`, `Date`, `Map`, `Set`, `RegExp`, `BigInt`. Not functions, not
  class instances, not a structure that refers to itself — those are reported
  as errors, and the value falls back to being derived in the browser.

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
| `:for-each=${expr}` | Repeat once per item in an iterable. `null`/`undefined` means zero items. |
| `:for-as="name"` | Rename the per-item binding from the default `data`. |
| `:for-key=${expr}` | Give each item an identity, so reordering moves replicas instead of rewriting them. Evaluated per item, and may read the per-item binding. Refused on `:for-data`, which has only ever one. |
| `:for-data=${expr}` | Render once if `expr` is neither `null` nor `undefined`, not at all otherwise. Binds the item like `:for-each`. |

## Modules and components

| Syntax | Meaning |
| --- | --- |
| `<:include src="file.htm" />` | Splices another file into the current document. |
| `<:include src="file.txt" as="pre" />` | Includes a file as a literal element named `pre` containing its text. |
| `<:import src="file.htm" />` | Splices a fragment into the page; each file is only imported once per page. |
| `<:define tag="x-y:button">...</:define>` | Declares a reusable custom tag. |
| `<:slot />` | In a definition: where a usage site's content goes. Its own content is the fallback. |
| `<:slot name="x" />` | A named slot. |
| `:slot="x"` | On a usage site's child: which slot it fills. Unaddressed content fills the unnamed one. |

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
`structuredClone`, `undefined`.

The timers and `fetch` are on the list for the same reason as the rest: they
exist in both environments, and the places that call them — `:on-` and
`:handle-` bodies — only run in one.

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
