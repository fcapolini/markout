# Syntax Reference

The whole language on one page: what interpolation means, every `:` family,
the module and composition tags, and the names the runtime supplies.

## Interpolation

| Syntax | Meaning |
| --- | --- |
| `${expr}` in text | Reactive text content. |
| `${expr}` in CSS | Reactive stylesheet content — the whole sheet is one binding, so see below. |
| `attr=${expr}` | Reactive plain attribute; no `:` needed. `null`/`undefined` removes it. |

### An attribute holds JavaScript

An interpolation's extent is found by parsing it, so HTML's rules for
attribute values stop applying inside one. `>` does not close the tag, a
quote does not end the value, and strings, template literals, object literals
and nested `${...}` end where JavaScript says they end. Attributes may also
span lines, with [comments between them](#comments-inside-a-tag).

So what a tag declares are the properties and methods of a scope — a
JavaScript object — rather than strings in an attribute, and a definition
holding real logic reads as a unit instead of as a long line. The two sections
below give the details.

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

Inside `${...}` the attribute's own quote is ordinary JavaScript, so
`:v="${"x"}"` and `:v='${'x'}'` both parse. HTML would have ended the value at
that second quote, and this does not, for the same reason a `>` inside an
expression does not end the tag: an expression is JavaScript, and the
delimiters around it stop applying until it closes. That leaves nothing to
remember about which quote to reach for — one fewer rule rather than one
more.

### A composite attribute is added to, not replaced

A plain attribute replaces what was there. Two of them hold a **set** rather
than a value, and those two can also be contributed to:

| Written | Meaning |
| --- | --- |
| `class="a b"` | sets the class attribute — replaces |
| `class+="a b"` | adds those classes to whatever is there |
| `class-="a"` | takes them away |
| `class!="a b"` | replaces, and says so — see below |
| `style+="color: red"` | adds those declarations |
| `style-="color"` | takes those properties away |
| `style!="color: red"` | replaces, and says so |

Which is the whole rule, and it has exactly two members because HTML has
exactly two composite attributes. That is the same fact that gives `class`
and `style` a dash-case family and gives `href` none: `class+=` is the
whole-set form of `:class-x`, and `class-=` of `:class-x=${false}`.

|  | one name | a set |
| --- | --- | --- |
| replace | — | `class=`, `class!=` |
| add | `:class-x` | `class+=` |
| remove | `:class-x=${false}` | `class-=` |

They are not `:` attributes, deliberately. `:` names what HTML has no name
for, and `class` has a name — what is new here is the operation, and an
operation is not a name. `+=` on anything else is a compile error, since a
`title` holds a value and there is nothing there to add to.

**The case they exist for** is a usage site arguing with a definition that
sets `class` itself. A `class` written there replaces the one the component
computed, which is the language's rule and the right one; `class+=` is how
to say the other thing:

```html
<bs-alert ::variant="warning" class+="mb-0 shadow-sm">Careful</bs-alert>
<bs-alert ::dismissible class-="fade">No animation, please</bs-alert>
```

Replacing it outright is still legal and still means what it says, but it is
almost never what someone wants from a component that derives its own
classes, so it is said out loud:

```
warning: <bs-alert> sets "class" itself, and a "class" here replaces it -- did you mean "class+=", or "class!=" if you meant to replace it?
```

A warning rather than an error, on the same footing as `nothing reads
"varient"` below: a judgment about the page rather than a fact about whether
it can be built.

**And `class!=` is the answer that agrees with it.** Sometimes replacing is
exactly the intention — a component whose classes are a starting point, a
one-off that has to look nothing like the rest:

```html
<bs-alert ::variant="warning" class!="my-own-alert">Nothing of the kit's, thanks</bs-alert>
```

It compiles to precisely what `class=` compiles to. The whole of what it adds
is the statement, which the compiler takes as its answer and says no more —
and which the next person to read the line gets for free, since a plain
`class` on a component is ambiguous between "I meant this" and "I did not
know". `style!=` is the same for the other one.

`!` because it is not a set operation like the other two: `+=` and `-=`
describe what happens to the set, and this describes intent about a
collision. CSS spells that idea `!important`, for the same reason.

It expects something to replace. On a plain element, or on a component that
sets no `class` of its own, there is nobody it can be addressing, and it says
so — while going on working, since it is a `class` either way:

```
warning: <div> is not a component, so "class!=" replaces nothing -- "class=" is what this is
```

Which is what catches the stale one: a component that stops setting a class
leaves every `class!=` aimed at it saying something that is no longer true.

**A literal is read the way HTML spells that attribute; an expression carries
the value itself.** Three of the four take a set of names, and `style+=` a
map, because addition assigns and removal only names:

| | literal | expression |
| --- | --- | --- |
| `class+=` | `"mb-0 shadow-sm"` | `string[]` |
| `class-=` | `"fade"` | `string[]` |
| `style+=` | `"color: red; gap: 1rem"` | `{ [property]: value }` |
| `style-=` | `"color gap"` | `string[]` |

Which is decided by the compiler rather than guessed from the value: a lone
`${...}` keeps its type, and anything holding literal text beside an
expression is an interpolation and so a string. `class+="mb-0 ${extra}"` is
therefore refused, and written `class+=${['mb-0', ...extra]}`.

### The order is by kind, not by position

Base, then every addition, then every removal — whatever order they appear
in. So `class-="fade"` means the same thing whether it stands before or
after the `class+=` it is arguing with, and a falsy `:class-x` is a removal
like any other.

Nothing writes the attribute whole, which is what makes any of this hold:
each input says what it contributes, the four together say what the set
should be, and only the **difference** is applied. A class this page never
put on — one Bootstrap's own JS added to a modal it was handed — is in
neither set and so is never touched. Before this, a reactive `class=${...}`
re-running turned `box box-red mine` into `box box-green`, silently, and
only once the variant happened to change.

### A form control keeps what the user typed

`value=${v}` on an `<input>` reads as "this is the value" and behaves as
"this was the initial value". HTML gives a handful of attributes a **dirty
flag**: from the user's first keystroke or click, the element's own state is
independent of both the content attribute and the content, and nothing
written to either is consulted again. So `v = ''` after a submit empties the
model and leaves the typed text sitting in the box.

The attribute is still needed — it is what the element is *served* with, and
a page rendered on the server hydrates onto it. What is missing is the other
half:

```html
<input value=${note}
       :prop-value=${note}
       :on-input=${e => note = e.target.value}>
```

`value=` is what it is served with; `:prop-value=` is what it shows from then
on. Both, together. The pairs are:

| Element | Attribute | Written beside it |
| --- | --- | --- |
| `<input>` (a type that is typed in) | `value=${...}` | `:prop-value=${...}` |
| `<input type="checkbox">`, `<input type="radio">` | `:attr-checked=${...}` | `:prop-checked=${...}` |
| `<textarea>` | the content, or `value=${...}` | `:prop-value=${...}` |
| `<option>` | `:attr-selected=${...}` | `:prop-selected=${...}` |

`value` on a submit, a button, a hidden field, a checkbox or a radio is not
on the list, because none of those is the thing being typed: HTML keeps them
reflecting the attribute for as long as the element exists, and there the
attribute alone is exactly right.

**The compiler warns when it sees one without the other**, which is the only
reason this is safe to leave as two spellings rather than one. Making
`value=` quietly write the property when it happens to be on an input would
be the shape-guessing that [two intents, two
spellings](#a-composite-attribute-is-added-to-not-replaced) exists to
prevent — one attribute meaning two different things depending on the
element it sits on. The alternative to magic is not silence: it is being
told, with a file and a line, the moment half the pair is written.

## Values

| Syntax | Meaning |
| --- | --- |
| `:name=${expr}` | Declares a reactive value on the current scope. |
| `::name=${expr}` | On a `<:define>`, declares a **parameter**; on a usage site, passes one. Reserved at every usage of that tag — see [a usage site is a call, and an element](#a-usage-site-is-a-call-and-an-element). |
| `:server-name=${expr}` | Declares value `name`, but the expression runs on the **server only** — the client is handed its result. Server-only. |
| `:const-name=${expr}` | A **compile-time constant**: computed while the page is built and written into every expression that reads it. Nothing of it reaches the runtime. |
| `:aka="name"` | Names the current scope so descendants can reference it. A literal, not an expression. |
| `:attr-name=${expr}` | Toggles whether attribute `name` is PRESENT, as boolean and custom-element attributes need. Bare `:attr-name` implies `true`. `.` and `:` are allowed, for `data-x.y` and `xlink:href`. |
| `:prop-name=${expr}` | Assigns the element's JS property `name`, for what an attribute can't carry. Browser-only: skipped when server rendering. |
| `:class-name` | Toggles the `name` CSS class. |
| `:style-name` | Writes the `name` CSS property. |
| `class+=${expr}` | Adds classes to whatever `class` holds, rather than replacing it. A literal is a list of names, an expression a `string[]` — see [a composite attribute is added to](#a-composite-attribute-is-added-to-not-replaced). |
| `class!=${expr}` | Sets `class`, exactly as `class=` does, and states that replacing a component's own is meant — which is what the warning about it asks. `style!=` likewise. |
| `class-=${expr}` | Takes those classes away, the whole-set form of `:class-name=${false}`. |
| `style+=${expr}` | Adds declarations to whatever `style` holds. A literal is CSS text, an expression a `{ property: value }` map. |
| `style-=${expr}` | Takes those properties away. Names, not declarations: removal names what to drop. |
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

The four callback families take a **function literal, written at that
spot** — an arrow or a classic `function`, either way. What is refused is a
*reference* to one: `${handler}` is an error even where `handler` holds a
function, because a callback's dependencies are read from what stands here,
and a name is not a body:

```html
<button :on-click=${() => count++}>              <!-- yes -->
<button :on-click=${async () => save()}>         <!-- yes -->
<button :on-click=${function () { count++ }}>    <!-- yes -->
<button :on-click=${handler}>                    <!-- error -->
```

There is no rule against classic functions anywhere else either. One may
appear anywhere inside any `${...}`, nested as deeply as you like, and it
sees the scope exactly as an arrow does — an expression reaches its scope
through an argument the compiler passes it, not through `this`, so nothing
about `function` can take it away.

The one name an expression may not declare is **`$`**, which is that
argument. `${items.map($ => $.x)}` is a compile error, and any other name
works.

### Compile-time constants

A design token never changes, and `:const-` says so:

```html
<html :const-accent="#6f42c1" :const-gutter=${16}>
  <head><style>:root { --accent: ${accent}; --gutter: ${gutter}px }</style></head>
```

The value is computed while the page is built and written into every
expression that reads it, so **nothing of it reaches the runtime** — no
scope entry, no dependency edge, no cell that can never fire. It matters
most in a stylesheet, where one interpolation otherwise makes the [whole
sheet a binding](#a-stylesheet-is-one-binding); with `:const-` there is no
binding at all.

`const-` is a **modifier**, like [`:server-`](#server-only-values) and unlike
the `:class-`/`:on-` families: a family names something in another world —
a CSS class, a DOM event — and the dash-case part is that other thing's real
name, while what a modifier marks is an ordinary markout value, declared and
read under its own name. `:const-accent` is read as plain `${accent}`.

Which buys something beyond tidiness. Because the modifier is not part of
what the value is *called*, **an import site can override a constant with an
ordinary reactive value** and nothing that reads it changes:

```html
<head :radius=${dark ? '0' : '1rem'}>     <!-- the kit's :const-radius, live -->
  <:import src="/some-kit/all.htm" />
```

The kit goes on writing `${radius}` in its stylesheet. Every page that
doesn't need this pays nothing, and the one that does pays for a binding
exactly where it asked for one.

**One rule keeps it honest: a `:const-` value may read only literals and
other `:const-` values.** Reading an ordinary value, `$id`, the DOM or a handler is a
compile error — never a quiet fall back to being reactive, which would hand
the page exactly the cost the marker was meant to avoid. The result also has
to be a primitive; substituting an object would give every reader a separate
copy.

And the limit worth knowing before reaching for it: **a `:const-` value cannot
participate in runtime theming.** A light/dark switch changes values while
the page runs, and these are gone by then. `:const-` is for what is fixed when
the page is built — which is why a page that needs one of a kit's tokens to
move declares that name plainly, as above, rather than reaching for `:const-`.

A kit's tokens are `:const-` for exactly this reason, and a page overrides them
where it imports the kit — see [root attributes](#root-attributes-reach-the-call-site):

```html
<head :const-bsRadius="1rem">
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

#### `:server-if` — a branch decided once

The one directive `:server-` may mark, and it means what it says everywhere
else: the condition runs on the server and the answer crosses frozen, so the
browser never decides this branch again.

```html
<div :server-if=${user.isAdmin}>
  <a href="/admin">Danger zone</a>
</div>
```

That matters because of what an ordinary `:if` has to do. Its condition is
live — the browser may turn it — so the markup of the branch that did *not*
show still travels, in the stencil it would be built from. Behind
`${user.isAdmin}` that is the admin panel, its links and its labels, in the
page source of every visitor who is not an admin.

A `:server-if` that did not show can never show, so there is nothing to
build and its markup is not sent at all. One that did show is in the page as
usual and hydrates normally; only the *decision* is frozen.

Markup, precisely: the elements, their attributes and their text. The
*expressions* of values written inside the branch are compiled into the
page's props, which are a function of the source rather than of the request,
so they travel whatever the branch decided. `<a href="/admin">` is gone;
`${budget * 2}` is still there as `$.budget*2`. Where the logic itself is the
secret, keep it in a `:server-` value, whose expression the browser never
receives.

Two things follow, and both are the point rather than limitations:

- **It cannot change afterwards.** Not on a click, not on new data. If the
  branch has to be able to turn, it is an ordinary `:if` and the markup
  travels; that is what the markup is for.
- **A page with no render has no decision.** Served in client mode, or built
  with nothing to evaluate it, the condition is simply absent and the branch
  does not appear.

`:else` and `:else-if` after one are ordinary branches and behave as they
always do — the server decides the first, and the rest answer to it.
`:server-` on any other directive is still refused: `:for-each` and the rest
declare no value for it to mark.

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
[rendering](../concepts/isomorphism.md#what-ahead-of-time-rendering-cannot-carry).

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
<:define tag="my-component:div"

     // parameters
     ::width=${100}

     // private
     :_w="${width}px"

>${_w}</:define>
```

Commenting out a single attribute works the way it does in code — the
comment simply hides it from the parser. One left unterminated runs to the
end of the file, which shows up as the enclosing tag never being closed
(`Unterminated tag DIV`) rather than as anything about comments.

These belong to a tag. In text content they are ordinary text; use
`<!-- … -->` there.

> What makes `_w` private is the missing `::`, not the underscore: only what
> a definition marks is part of its interface, so a plain `:` on that root
> is the component's own and no usage site can set it. The underscore says
> so to a reader at a glance, which is worth keeping — but nothing in the
> language treats `_` specially, and it is the compiler that enforces this.

## Text that isn't markup

`<style>`, `<title>` and `<textarea>` hold text rather than markup: a browser
reads what is between their tags as characters. So an interpolation there is
the element's whole content as one value rather than one binding per
`${...}`, and changing any part of it rewrites the lot. Nothing about writing
it differs:

```html
<textarea :on-input=${(ev) => draft = ev.target.value}>${draft}</textarea>
```

### `<code>` is left alone

`<code>` goes further: its content is not parsed at all. Everything between
the tags is text until the closing `</code>`, so an interpolation stays as the
characters you typed and markup inside it is content rather than elements —
which is what makes a page able to show markout source without escaping every
`${...}` in it:

```html
<pre><code>&lt;div :count=${0}&gt;${count}&lt;/div&gt;</code></pre>
```

That renders as written. `<script>` is treated the same way, for the reason it
always has been.

Three things follow, and the third is the one that surprises:

- The tag's **own attributes are ordinary** — `<code class="lang-${lang}" :if=${shown}>`
  interpolates and binds like any element. It is the content that is skipped,
  not the element.
- `<pre>` is **not** in this set. `<pre>${x}</pre>` interpolates normally, so a
  sample belongs in the `<code>` inside it.
- `<code>` **cannot nest**. The first `</code>` ends the content whatever came
  before it, so `<code>a <code>b</code> c</code>` fails as a tag that never
  closed rather than as anything about nesting.

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

None of them may go on `<html>`, `<head>` or `<body>`, which is also a
compile error. A region's markup moves into a stencil, and those three are
where a compiled page keeps what makes it work — every stencil in the head,
the props and the runtime in the body. Whatever you meant goes on an
element inside.

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
inside itself, and its element is held by its scope rather than rebuilt when
it comes back.

`:if` and `:for-data` differ in the question they ask. `:for-data` is
`!= null`, so `0` and `''` are data — right for an item, wrong for a
condition. `:if` is plain truthiness, so `${count}` and `${name}` mean what
they look like, and it binds no item: `data` inside an `:if` still means
whatever it meant outside.

Neither evaluates its body while it isn't showing, which is what makes
`${user.name}` safe to write inside one.

The host element becomes an inert `<template>` and every visible item is a
clone of it. That `<template>` is in `<head>`, with a comment standing where
the element was written — so a replicated list's children are its replicas
and nothing else, and `:first-child` and `:nth-child` mean what they say. See
[replication](../concepts/directives.md#the-stencil-is-not-where-you-wrote-it).

### `<:group>` — a branch or a replica with no element

Every directive above goes on an element, which makes the element the unit:
one condition, one thing shown. `<:group>` lifts that. It is a tag that
never renders, and the directives it carries apply to **its contents** —
however many nodes those are.

```html
<tbody>
  <:group :for-each=${lines} :for-as="line" :for-key=${line.id}>
    <tr><td>${line.name}</td><td class="num">${line.total}</td></tr>
    <tr class="note"><td colspan="2">${line.blurb}</td></tr>
  </:group>
</tbody>
```

Two rows per item, and no wrapper — which matters here because there is no
element you are allowed to put between `<tbody>` and `<tr>`. The same holds
for `<dt>`/`<dd>` pairs, for `<option>`s, and for a branch that is a
heading and a paragraph rather than a `<div>` around both.

It takes the branch and replication attributes — `:if`, `:else-if`,
`:else`, `:server-if`, `:for-each`, `:for-as`, `:for-key`, `:for-data` —
and behaves exactly as they do on an element, nesting included.

**What it costs depends on what is inside**, and the three cases are worth
knowing because they are what the compiled page contains:

| the group | what it becomes |
| --- | --- |
| no directives on it | nothing: the tag is dropped and its contents stay where they are |
| a directive, and a single element inside | the directive moves onto that element — `<:group :if=${x}><p>…</p></:group>` compiles byte-for-byte as `<p :if=${x}>…</p>` |
| a directive, and anything else inside | a **region**: a marker comment at each end, and the run between them is what shows, hides or repeats |

So the range machinery exists only where there is a range, and adding or
removing a sibling inside a group changes the output without ever changing
the meaning.

**A group carries directives and nothing else.** It has no element, so
there is nothing for `class`, `style`, an event handler or a plain HTML
attribute to land on; and it has no scope, so a value like `:n=${1}` has
nowhere to live. Both are compile errors that name the attribute and say
where to put it instead — on an element inside the group, or on one around
it. A `<:logic>` is the tag for holding values with no element of its own.

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
| `<:include src="page.html" as="pre" escaping />` | The same, escaped: the file is *shown* as source rather than landing as markup. |
| `<:import src="file.htm" />` | Splices a fragment into the page; each file is only imported once per page. |
| `<:define tag="x-y:button">...</:define>` | Declares a reusable custom tag. |
| `<:group :if=${expr}>...</:group>` | Applies a branch or replication directive to its contents rather than to an element. See [`<:group>`](#group--a-branch-or-a-replica-with-no-element). |
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
  ::variant=${'primary'}
  ::dismissible=${false}

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

### A usage site is a call, and an element

`<bs-alert ::variant="danger">` is two things written as one. It is a
**call**, whose attributes are arguments; and it is an **element in your
markup**, which can hold state of its own the way any native element can.
`::` is which:

```html
<:define tag="bs-alert:div"
  ::variant=${'primary'}    // the interface: what a usage may set
  ::heading=${null}
  :_cls=${'alert alert-' + variant}   // private; no usage can reach it
>…</:define>

<bs-alert ::variant="danger"    // an ARGUMENT: `bs-alert` takes a `variant`
          :count=${0}           // a LOCAL: yours, and the component never sees it
          :on-click=${() => count++}>${count}</bs-alert>
```

An **argument** goes to the component. It overrides the default, the
definition's body reads it, and its own expression resolves out at the call
site — which is what makes the pass-through idiom mean what it looks like:

```html
<bs-badge ::variant=${variant} />   <!-- the `variant` from out HERE -->
```

A **local** stays where it was written. It is a value on the usage site, so
the attributes beside it see it, the tag's slotted content sees it, and a
handler can write to it — everything that is true of `:count` on a `<span>`.
It is per **replica**, so `<my-row :for-each=${rows} :draft=${''} />` gives
each row its own with no wrapper element to hold it.

**A definition's interface is what it says, and a tag reserves it.** Only
`::` names are settable, so a plain `:` on a define root — `:_cls` above — is
the component's own, and a usage may declare a local of that very name
without either one knowing. And at a usage site the two spellings are not
interchangeable: `:variant` where the tag takes a `variant` is a compile
error, and so is `::varient` where it takes no such thing. One says the name
is yours and the other says it is the component's, and only one of them is
true.

The reservation is per tag, not global: `<bs-alert :count=${0}>` is fine
while `bs-alert` declares no `count`, whatever some other tag declares.

It also means a component gaining a parameter is a change its callers are
**told** about. A kit that adds `::label` in a later version turns a caller's
existing `:label` local into an error naming the tag and the name, fixed by
renaming that local — rather than quietly taking a name someone was already
using.

One shape the reservation cannot catch is a misspelling, since `:varient`
claims the name for you and so is a perfectly legal local. What notices it
is that nothing reads it:

```
warning: nothing reads "varient": <bs-alert> takes "variant" -- did you mean "::variant"?
```

A **warning**, not an error — the page builds and is served, because unlike
everything else the compiler reports this is a judgment about the page
rather than a fact about whether it can be built. A local a handler writes
and nothing displays is state, not a mistake, and says nothing.

Everything else on a usage site is unchanged, being neither: `:if`,
`:for-each`, `:aka` and `:slot` name no value, and `:class-`, `:style-`,
`:attr-`, `:prop-` and `:on-` apply to the instance's own element.

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

**It takes a condition, and the condition is its lifetime.** `:if`,
`:else-if`, `:else` and `:for-data` are what decide whether the scope exists
at all — so `:did-init` runs when the condition becomes true and
`:will-dispose` when it stops being, once per lifetime as always, with the
lifetimes now able to repeat:

```html
<!-- listening only while dragging, and nowhere else -->
<:logic :if=${dragging}
        :_move=${(e) => track(e)}
        :did-init=${() => window.addEventListener('pointermove', _move)}
        :will-dispose=${() => window.removeEventListener('pointermove', _move)} />
```

A **named** one that may come and go is a name that may not answer, so every
reference to it needs `?.` — `${app?.foo}` — and the compiler says so rather
than letting the read be evaluated once against a name that was not there. See
[a name inside a region is read with `?.`](#a-name-inside-a-region-is-read-with-).

What it refuses, because there is no element:

| | |
| --- | --- |
| `:class-`, `:style-`, `:on-`, plain attributes | nothing to apply them to |
| `:for-each`, `:slot` | nothing to replicate or slot |
| content of any kind | it holds values, not markup |

`:for-each` stays refused where the conditionals are allowed, and the
difference is the point: the objection there was never lifetime but **arity**.
A name that means as many scopes as there are items is not fixed by knowing
when each of them ends.

And where it refuses to go: inside a `:for-each`, a `:for-data`, an `:if`, a
`<:define>`, or a custom tag's content. Each of those turns a declaration
that reads as one-per-page into one per item, one per instance, or one that
comes and goes — a timer started per row is not something to discover at
runtime. A condition written **on** the `<:logic>` is the supported way to
have one that comes and goes, and says so where a reader is looking.

### `:logic` as a base tag — a definition with no element

The same idea as `<:logic>`, one level up: that one is a scope with no
element, this is a tag whose *instances* are.

```html
<:define tag="std-data:logic" ::url="" ::data=${null} … />

<std-data :aka="rows" ::url="/api/rows" />
<p>${rows.data?.length ?? 0} rows</p>
```

A component that is a source rather than a sight — a datasource, a router,
a media query, a socket — otherwise pays for an element per usage and an
attribute to hide it. This is `std-data`'s own definition, and what it used
to be was `tag="std-data:span" hidden`.

It takes the same refusals as `<:logic>`: nothing that needs an element to
apply to, and no content. Its instances take a condition the same way, and
mean the same thing by it — `<std-data :if=${open} />` opens its socket when
the panel opens and closes it when the panel closes. It does **not** take `<:logic>`'s placement
rules — a `<:logic>` is a singleton declaration, so it is refused where it
would silently become many, while an instance is written deliberately and
`<std-data :for-each=${urls} />` means exactly what it says.

The base tag is spelled out rather than left off. `tag="my-panel"` with no
base at all would read as this, and it is much more often a typo — so it
stays the error it has always been.

### `<:mode>` — a scope on its parent's element

**Built**, apart from `:prop-` and static plain attributes, which are refused
for reasons given below. See
[conditional scopes](../design/conditional-scopes.md) for the whole design.

A `<:logic>` has no element and wants none. A **mode** has none of its own and
borrows the nearest one above it, which is what lets it carry the families
that need an element — and take them back when its condition goes false:

```html
<div class="card">
  <:mode :if=${dragging} :on-pointermove=${(e) => track(e)} />
  …the card, which never re-renders…
</div>
```

**The element stays.** That is the whole difference from `:if` on the element,
which takes the markup away and loses focus, scroll position and anything else
the DOM was holding — and from a handler bound once and guarded from inside,
which goes on firing for every `pointermove` in order to decide it has nothing
to do.

A mode is a scope, so it holds values of its own, and they last exactly as
long as the modality does:

```html
<:mode :if=${editing} :_from=${null} :on-pointerup=${() => commit(_from)} />
```

`_from` belongs to the edit rather than to the card, and it is gone when the
edit is. That is the argument for the tag more than the listener is: without
it, a modality's state lives on the element and has to be cleared by hand.

**Its children are built and destroyed, not parked.** That is the one place a
mode departs from the region machinery rather than reusing it: every region
here preserves — `:if` moves markup aside so a hide keeps focus, a scroll
offset, a playing video — and a modality wants the opposite, so the next one
starts clean:

```html
<div class="panel">
  <:mode :if=${editing} :_draft=${text}>
    <button :on-click=${() => save(_draft)}>Save</button>
    <button :on-click=${() => editing = false}>Cancel</button>
  </:mode>
  <p>${text}</p>
</div>
```

The buttons appear where the tag is written, and `_draft` starts from `text`
every time the edit begins rather than resuming the last one.

**Its classes are its own.** A mode's class set starts EMPTY rather than from
what the element is already wearing, so it can neither claim the element's own
classes nor lose them:

```html
<div class="card" :class-selected=${chosen}>
  <:mode :if=${dragging} :class-dragging />
</div>
```

`dragging` arrives and leaves with the modality; `card` and `selected` are the
element's own throughout, and go on changing while the mode is applied.

**An attribute has one owner at a time**, and while a mode is on, the owner is
the mode:

```html
<div title=${label}>
  <:mode :if=${dragging} :attr-aria-grabbed=${true} title=${"Drop me somewhere"} />
</div>
```

Nothing is remembered and nothing is restored from a snapshot. What an
element's `title` is, is whatever the innermost live declaration says — and the
one underneath was live the whole time the mode was over it, evaluating as its
own dependencies changed, simply not the one writing. So handing back is asking
it to say again. Where nobody underneath declares it, the attribute existed
only because the mode did, and goes with it.

Two modes on one element declaring the same attribute **at the same rank** is a
compile error: a class is a set and two modes adding one are no conflict, but
an attribute is one answer to one question. `:priority` is what settles it —
higher owns the attribute while both are on, and hands it back down the stack
rather than to the element when it leaves:

```html
<div title=${label}>
  <:mode :if=${editing} title=${"Editing"} />
  <:mode :if=${dragging} :priority=${1} title=${"Drop me somewhere"} />
</div>
```

Absent is the rank every mode shares, and it has to be a **number written
there**: one worked out while the page runs could tie, and the error this
exists to give would arrive as a silent last-write-wins instead.

A **style property** works the same way and for the same reason — it is one
answer to one question, so it has an owner, and `:style-color` on a mode
overrides the element's while the modality is on and hands it back when it
goes.

What it takes: `:on-`, `:class-`, `:style-`, `:attr-`, plain attributes written
as expressions, children, values of its own, the lifecycle callbacks, a
condition, `:priority`, and `:aka`. What it refuses:

| | |
| --- | --- |
| `:for-each`, `:for-as`, `:for-key` | one delta on one element — nothing to replicate |
| `:slot` | no markup to put in a slot |

`:else` and `:else-if` are refused **with children**, since a branch chain is
resolved by position among siblings and a mode's condition becomes an arity.

| `:prop-` | a DOM property is state on the element itself, so there is nothing underneath to hand it back to |
| a *static* plain attribute | a mode has no markup of its own for one to be written in — `title=${…}` sets it on the element |

A mode's classes and styles both start from **nothing** rather than from what
the element is already wearing, which is what keeps the two apart: a mode can
neither claim the element's own nor lose them.

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

### A component's own stylesheet

A `<style>` written as a direct child of a `<:define>` is that component's,
and nothing has to say so:

```html
<:define tag="x-card:div" class="card">
  <style>.card { border: 1px solid }</style>
  <:slot />
</:define>
```

It is served **once**, immediately before the definition, however many
instances the page has — and it is dropped along with the definition when
no page writes `<x-card>`. Ownership here is a matter of where the
stylesheet is, not of what anyone claims about it, so there is no way to
state it wrongly.

Where it lands is part of the promise: just before the definition, not
appended to the end of `<head>`. Imported fragments therefore cascade in
the order they were imported, and a page's own rules — written later —
still win an equal-specificity tie against a component's.

Two cases are deliberately left where they were written. A `<style>` that
interpolates a value renders once per instance, each with its own text, so
there is no single copy to lift out. And one nested deeper — inside an
[`:if`](#values) or a `:for-each` — is conditional markup, which is the
author having already answered this question differently.

A definition in `<body>` cannot carry one. Lifted out it would be invalid
markup where it stands and would land somewhere else if moved, so it is
refused rather than guessed at; put the definition in `<head>`, or in a
file the page imports.

Class names are global: nothing here is rewritten or hashed, so a page is
free to apply `.card` by hand. If it does, and it never writes `<x-card>`,
the definition is dropped and the rules go with it — and the compiler says
so, naming the classes that lost them:

```
warning: <x-card> is never used, so its <style> went with it -- but "card"
is still applied by markup that stayed, which now renders unstyled.
Write <x-card>, or move those rules out of the definition
```

It is a warning rather than an error because the fix is a judgement: write
the tag, or move those rules back to the page. And it is reported only when
it has actually happened — a page that wears `.card` *and* writes
`<x-card>` has lost nothing and hears nothing.

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

### A literal include lands as markup, or as source

`as` names an element to build and puts the file's text inside it, untouched:
that is what an inlined `<style>`, `<script>` or svg needs, where an escaped
`<` would be a syntax error rather than a character.

A file being *shown* needs the opposite, and `escaping` is how it says so:

```html
<pre><:include src="/examples/counter.html" as="code" escaping /></pre>
```

The file arrives as text — `<html>` reaches the browser as `&lt;html&gt;` and
is read rather than parsed — so a sample and the page it runs in can be the
same file, and cannot drift apart. The flag is written bare or as
`escaping="true"` / `escaping="false"`; anything else is refused, and it needs
an `as` to apply to.

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
| `$outer("my-tag")` | The nearest enclosing instance of that tag, or nothing. Excludes this scope. |
| `$value("key")` | Looks a value up by key. |
| `$set("key", v)` | Assigns to a value by name, and answers whether it landed. For writing where `=` cannot go — see below. |
| `$dom` | This scope's own element, or nothing if it has none. Browser-only. |

### `$outer`

`$host` is the instance immediately enclosing this markup; `$outer` is the
nearest one of a **named tag**, however far up it is:

```html
<:define tag="my-level:div" ::depth=${($outer('my-level')?.depth ?? -1) + 1}>
  <:slot />
</:define>
```

Each instance asks the nearest one above it and adds one, so nesting composes
without any level being told its own ancestry.

A walk rather than a parent, because the enclosing instance is reliably an
ancestor and never reliably the parent: a region, a `:for-each` or a `<div>`
carrying a value each add a scope in between. **It excludes itself**, or the
default above would be defined in terms of the instance it is defaulting.
It answers nothing when there is no such tag above, which is a component
standing on its own rather than a fault.

The tag is written out, and has to be. It resolves when the scope links, so
what it finds is an ordinary dependency and a reader re-runs when that scope
moves — a tag worked out while the page runs could not be depended on, so it
would answer once and never again. `$outer(someName)` is refused for that
reason rather than silently doing the weaker thing.

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
`structuredClone`, `URL`, `undefined`, `$origin` and `$url`.

The timers, `fetch` and `URL` look like browser things and are on the list
for the same reason as everything else: Node has them too, and they mean the
same thing there. That is the whole test. A name available in only one of the
two environments would make a page that worked in the browser and failed on
the server, or the reverse, and it would fail at the point of use rather than
anywhere a reader would think to look.

### `$origin` and `$url`

The odd ones out, and the only names here that aren't JavaScript's: the
page's own address. `$origin` is `https://example.test`; `$url` is the whole
of it, as a `URL`. The server takes them from the request, the browser from
`location`, and they mean the same thing in both — which is the bar
everything on this list has to clear.

It exists because the server has no page to be relative *to*. A `:server-`
value fetching `/data.json` is not asking for a different address, it is not
asking for an address at all, so something has to say where the page is:

```html
<html :server-rows=${fetch($origin + '/data.json').then(r => r.json())}>
```

`$url` is the same fact, unabridged, for a page that wants the part of the
address the visitor asked for:

```html
<a class="here" :class-active=${$url.pathname === '/about'}>About</a>
<p>Searching for ${$url.searchParams.get('q')}</p>
```

It is a `URL` because `URL` was already a name expressions could use, so
`searchParams` comes with it and there is no new shape to learn. `$origin`
is `$url.origin` and stays a name of its own: a page that wants the origin
should not have to reach through an address to say so.

Both are spelled with a `$` because they are the runtime's rather than
JavaScript's, and that also means a page cannot declare a value over them —
`$` is reserved in a declared name. Where there is no server, both are
`undefined` — except in a build told what to be relative to, since
`markout build --origin <url>` is exactly the answer to "where is this page
going to be", and there `$url` is that origin with the page's own path.

`$url` is also the one name here that **changes while the page is up**.
Everything else in this list is fixed for the life of a render, which is
why reading one is not a dependency — there would be nothing to wake. An
address is not fixed: a navigation that keeps the document moves it, and
every expression that read it re-runs.

It is read-only, in whole and in part. `$url` is where the page **is**, so
a page assigning it would be claiming to have arrived somewhere it has not,
and both `$url = '/about'` and `$url.pathname = '/about'` are refused with
a message rather than quietly doing nothing.

Navigating is a side effect with a lifetime — a history entry to decide,
scroll to restore — so it belongs to a component rather than to the
language. It is written where it happens, through the name this list offers
for exactly that:

```html
<button :on-click=${() => globalThis.location.assign('/about')}>About</button>
```

`$url` follows on its own once the address changes — a traversal, a
fragment link, or a navigation a router kept in the document. The one
change it cannot see is `history.pushState`, which announces itself to
nobody by design, so code that calls it says so.

Nothing else about the request is offered, and that is deliberate. Headers,
cookies and the method have no browser counterpart, so a page reading one
would render something it cannot hydrate to — and would publish a session
while doing it.

Because it is the last link, a declared value of the same name shadows it —
`:Math=${...}` means yours from there down.

Apart from `$url`, a global is not a dependency: it can't change, so
nothing re-evaluates because of one.

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
  definition's scope; a usage site's attributes and slotted content see what
  that site declares, and then the call site around it.
- The compiler is responsible for qualification and dependency extraction.
- The runtime executes the generated graph; it does not discover dependencies on
  its own.
