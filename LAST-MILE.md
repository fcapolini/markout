# The last mile

Status: **living.** What stands between "the language is good" and "someone
else can use it", written down 2026-08-24 after a pass over the language
surface, the compiler stages and the adoption surface.

## Why this file exists, and not TODO.md

[TODO.md](TODO.md) is a record of everything found, in the order it was
found. That is the right shape for a working note and the wrong shape for
this question, because the two are not the same list: most of what is open
there is a flake, a measurement, or a feature that has not earned its place,
and none of those is what a first outside user hits.

The entries below are the ones that are hit by someone who did nothing
wrong. Each is either a promise this project makes that is not kept, or a
question a reader asks in their first week that nothing answers. They are in
the order they should be closed.

## What is NOT on this list

**The language.** `::`, `:const-`, `class+=`/`class-=` closed the two holes
that were load-bearing -- interface-versus-value at a usage site, and
contributing to an attribute rather than replacing it -- and what is left
open in TODO.md is optional by its own argument. `:switch` has to beat a
chain that already exists rather than beat `:if`, and `<:define>` extension
has a motivation but no user. Neither is a gap; both are choices still
available.

That is the finding worth recording, because it changes what the work is.
Nothing below is a language design question except one, and it is a question
about HTML rather than about markout.

## 1. `catch (err)` is an unknown reference -- **closed 2026-08-24**

The pitch is that `${...}` is plain JavaScript. This is the pitch being
false, on code that is simply correct:

```html
<button :on-click=${() => { try { save(); } catch (err) { report(err); } }}>
```

fails to compile with `Unknown reference: "err"`.

**Diagnosed 2026-08-24, and it is four lines.**
[stage3-qualify.ts](packages/core/src/compiler/stages/stage3-qualify.ts)
handles `CatchClause` in `isInDeclaration`, so the *binding* is recognised
and not qualified. `isLocalAccess` -- which decides whether a later *use* of
that name refers to a local -- walks the enclosing stack asking about
`FunctionDeclaration`/`FunctionExpression`/`ArrowFunctionExpression` params,
`BlockStatement` declarations, `ForOfStatement`/`ForInStatement` and
`ForStatement`, and never asks about `CatchClause`. So the name is bound and
then not found.

The neighbouring shapes named in TODO.md were checked at the same time and
are **fine**: `for (const x of xs)`, destructuring in parameters
(`({a, b}) => a + b`) and in declarations all compile clean. Catch is the
last one of that family, which is why this is a fix and not an audit.

Ranked first because it is cheap, bounded, and it is the central claim.

**Closed.** `isLocalAccess` now asks about a catch clause, its parameter read
as the full pattern it is (`catch ({ message })`), and `catch { }` binding
nothing. The neighbouring shapes are asserted alongside it in
`stage3-qualify.test.ts`, together with the case that keeps it honest: a
catch parameter is not a local past its own clause, and `return err` outside
the block is still reported, because it is a reference error in JavaScript
too.

## 2. `value=${v}` reads as "this is the value" -- **closed 2026-08-24**

...and behaves as "this was the initial value". HTML's dirty-value flag makes
an input's value independent of its attribute and its content from the first
keystroke, so `v = ''` empties the model and leaves the typed text sitting in
the box. Confirmed in a browser 2026-08-19; the full note is in TODO.md and
it is listed open in
[silent-failures.md](docs/design/silent-failures.md).

Two halves, and the second is the reason this is not just a kit patch.

**The kit is wrong today.** [`bs-input`](kits/bootstrap-kit/parts/input.htm),
`bs-textarea`, `bs-select` and `bs-check` bind `value`/`checked` the way that
stops reflecting. They are read-write everywhere except the one direction a
form needs after a submit, which is the direction every form needs. The fix
is `:prop-value=${value}` **alongside** the attribute -- the attribute is
what the element is served with, the property is what it shows afterwards --
which is what `demos/desk/index.html` already does and says why.

**The language decision underneath.** Whether markout should quietly write
the property for the attributes HTML gives a dirty flag to (`value`,
`checked`, `selected`) is a real question, and the answer is **no**: that is
exactly the shape-guessing that the two-spellings rule exists to prevent, and
it would make one attribute's meaning depend on which element it is on.

But silence is not the alternative to magic. The rule this project already
has for a case like this is in silent-failures.md: make the failure
impossible to hold quietly. So -- **a compile-time warning when `value`,
`checked` or `selected` carries an expression on an `<input>`, `<textarea>`
or `<select>` and no matching `:prop-` is present.** The correct spelling
exists and is discoverable the moment anyone writes the incorrect one, and no
attribute changes meaning.

**Closed, and the kit was worse than expected.** The warning is in stage2 and
covers `value` on a typed-in `<input>` and on a `<textarea>` (its content as
well as its attribute -- a text interpolation gives its element no scope, so
that case is reached through the node), `checked` on an `<input>` and
`selected` on an `<option>`, in both the value and the presence spelling. It
found five places in `bootstrap-kit` and one in the documentation: the
durable-state example in [data.md](docs/concepts/data.md) taught the broken
pattern, in the middle of a paragraph about elements being projections. All
fixed, and the rule is written down in
[syntax.md](docs/reference/syntax.md#a-form-control-keeps-what-the-user-typed).

One thing the kit settled by refusing it. The first cut also warned when
`type` was an expression, reasoning that an unknown is worth asking about --
and `bs-check` writes `type=${_type}` over checkbox/radio/switch, where
`value` is what the control *submits* and `:prop-value` would have been wrong
advice. It fired twice on correct markup with no way to answer. The rule now
is: warn only where the type is KNOWN to be dirtiable. A warning nobody can
act on is worse than the case it catches, because it teaches people to stop
reading them.

## 3. A runtime error names a scope, not a line

"Mistakes caught before the page loads, with a file and a line" is the row
that distinguishes markout from Alpine, and it holds exactly until the page
is running. After that,
[`formatRuntimeError`](packages/core/src/runtime/core/core-context.ts)
produces:

```
markout [update] s12.total: x is not a function
```

`s12` is a scope uid and `total` is a value key. Neither is anything the
author typed, and the dev overlay shows the same string. An author debugging
a live page is worse off than the compile-time story promises, at the moment
the promise matters most.

Production props are rightly stripped of everything that is not needed -- see
"shrink the app props" in TODO.md -- so this is a **dev-mode** fix and should
not cost a served page a byte: a side-car map from `scope.key` to
`file:line`, shipped only when the server is in dev mode, and read by the
overlay and by `formatRuntimeError`.

## 4. There is no testing story for the people who use it -- **closed 2026-08-24**

This repository has ~1,250 tests. Nothing anywhere tells a reader how to test
a `<:define>` **they** wrote, and no package exports anything for it.

It is a first-week question for any team evaluating this, and today it has no
answer. It is also probably a small piece of work: a scope is already
constructible without a document, `<:logic>` already exists as a scope with
no element, and the internal suite already mounts fragments -- so what is
missing may be an export, a documented shape and a page in
[docs/](docs/) rather than a new mechanism. That should be established
before it is scheduled, and the entry stays open until it is.

Worth more than its size: a testing story is what a reader reads as "this is
maintained", and its absence is read as the opposite regardless of the test
count in CI.

**Closed, and the guess above was right about the size and wrong about the
reason.** It was one export --
[`hydrate()`](packages/core/src/render/hydrate.ts), which mounts a compiled
page against a DOM the caller supplies -- plus
[docs/reference/testing.md](docs/reference/testing.md) and a suite that runs
the documented recipe through the package's public surface only, so it fails
if the recipe stops being writable with what is exported. The suite's other
harnesses all reach for `WebContext`, `loadProps` and the seven stages
directly, which is exactly why 1,250 passing tests were never evidence that
anyone outside could do this.

What the work turned up, and none of it was visible from the outside:

- **A page with no expressions still has props**, because the scope tree is
  there either way. So `!page.props` does not mean "static page", it means
  the page did not compile -- and answering that with an empty root would be
  a test that mounts nothing, asserts nothing and passes. It throws, naming
  the first error.
- **The state a `:server-` value produced is carried in a `<script>`, and no
  test DOM runs it.** happy-dom and jsdom both ignore what `document.write`
  puts in them, so the page mounted with no state and every `:server-` value
  fell back to re-evaluating an expression the browser never re-evaluates --
  against a `fetch` and a host handle that are not there. `hydrate` loads
  them from the compiled page, the way the browser gets them by running the
  script.
- **`globals` was designed in and then removed.** `renderPage` takes one, so
  it looked like symmetry; the browser runtime supplies none, and a supplied
  name may only be read from a `:server-` value in the first place. Accepting
  them would have let a test drive a page in a way no browser can, and pass.
  The whole point of the entry point is to be the browser's arrangement, so
  the option that makes it convenient is the option that breaks it.

## 5. There is no changelog, and the spelling moved twice -- **closed 2026-08-24**

No `CHANGELOG.md` in the repository or in any package, and no `.changeset/`.

In the twenty commits before 0.5.0 the language changed how it is *spelled*
twice -- `::` became a component's interface and `:const-` took over what
`::` used to mean -- plus `class+=`/`class-=` arrived. Someone on 0.4.1 has
nothing to read that says so, and the upgrade is silent in the way that
matters: their page still compiles, and means something else.

This is the other half of the Changesets entry already open in TODO.md, and
[monorepo.md](docs/design/monorepo.md) calls for the tool. The point worth
adding is that the version numbers were never the risk on their own -- the
risk is a language whose spelling moves with no note that it did.

**Closed.** Changesets is installed and configured, five changelogs are
seeded back to 0.4.0, and core's carries the `::` migration note that was
missing. The flow was verified by running a release and reverting it, which
is how the one file that mattered got checked: a bump rewrites the site's
range on the middleware, which is the exact line 0.3.0 missed.

Two decisions the default configuration got wrong, both because this is 0.x,
are in [.changeset/README.md](.changeset/README.md): the kits' peer range on
core has to span 0.x minors, or Changesets answers an out-of-range peer by
bumping both kits to **1.0.0** on a core minor; and private packages are
versioned but not published, so the site's ranges are kept in step while the
extension never goes near npm.

What is still open from the same design note, and is a separate entry in
TODO.md: `npm pack` each package in CI, install the tarball into an empty
directory and run a smoke test. That is what catches an undeclared dependency
and a wrong `files` list, and it is the only way to be sure a kit ships the
fragments it promises. Changesets does not do it.

## 6. Client-side navigation is unanswered

Not "build a router". The multi-page position is defensible and the compile
numbers support it: an ordinary page is ~2ms and the heaviest page on this
site is ~111ms, so a full render per navigation is a real answer.

But nothing in [docs/](docs/) or [POSITIONING.md](POSITIONING.md) says it, so
a reader coming from any SPA framework assumes it is an oversight rather than
a decision. A stated position costs a paragraph. An unstated one costs the
reader's confidence that the question was considered.
