This folder contains the reactive core code of Markout.

A reactive application is built out of nested *scopes* rooted in a common
*context*. Reactive expressions, contained in *values*, have visibility on
their own scope and all outer scopes, up to the *global* one.

In the case of Markout, the scope tree is a logic representation of the DOM
tree, where only "active" DOM elements are represented.

## Building blocks

- **`CoreContext`** ([core-context.ts](./core/core-context.ts)) — the root object
  of an application instance. It owns the `global` scope, the `root` scope,
  and the counters (`cycle`, `refreshLevel`, `pushLevel`) that drive the
  push/pull reactive system described below. It also collects and flushes
  the batch of pending value-change callbacks (see "Change batching").
- **`CoreGlobal`** ([core-global.ts](./core/core-global.ts)) — a `CoreScope`
  subclass with no parent, sitting above `root`. It hosts globals/built-ins
  (e.g. window-like values) that every scope can see.
- **`CoreScope`** ([core-scope.ts](./core/core-scope.ts)) — a node in the scope
  tree. Each scope owns a map of `CoreValue`s (`values`), a child list, and a
  `proxy` object used to read/write those values (and any inherited from
  ancestor scopes) using plain property access.
- **`CoreValue`** ([core-value.ts](./core/core-value.ts)) — a single reactive
  slot. It either holds a plain value (`val`) or a reactive expression
  (`exp` + `deps`), and tracks the other `CoreValue`s it depends on (`src`)
  and the ones that depend on it (`dst`).

## Scope tree and value lookup

Each `CoreScope` is created from a `CoreScopeProps` tree (`id`, optional
`name`, `values`, `children`) and, when it has a `parent`, is linked into it:

- the scope is appended to `parent.children`;
- if it has a `name`, the parent gets a new value under that name whose
  `val` is the scope's own `proxy` — this is how a named child scope becomes
  visible as a value in its parent (and, by inheritance, in ancestor scopes).

A named child scope and an explicitly declared value share the same
`values` namespace in their common parent — a scope named `foo` and a value
named `foo` on the same parent would overwrite one another. Avoiding that
collision (alongside the `$`-prefix rule) is another constraint the
compiler must enforce.

Reading `scope.proxy.foo` triggers `CoreScope.lookup('foo')`, which walks up
from the current scope through `parent` links until a scope owning a
`values['foo']` entry is found, then calls `.get()` on that `CoreValue`.
Every scope also gets two implicit values when it has any `values` of its
own:

- `$value` (`RT_VALUE_FN_KEY`) — a function to look up any value (by key) in
  scope, bypassing the proxy;
- `$parent` (`RT_PARENT_VALUE_KEY`) — the parent scope's proxy.

Lookups are memoized per scope in `scope.cache` (a `Map`) and the cache is
cleared on every `unlinkValues()` call, i.e. once per refresh.

Disposing a scope (`dispose()`) unlinks its values, removes it from its
parent's `children`, and removes/unlinks the named value the parent was
holding for it.

`CoreContext.newScope()` and `CoreScope.newValue()` are meant to be
overridden by subclasses that need scope/value objects with extra behavior
(e.g. binding a scope to a DOM element), and `CoreContext.init()` is a hook
called after `global` is created but before `root` is, for any setup that
needs to run in between. The core itself doesn't use any of these hooks —
they exist purely as extension points for layers built on top of it.

## Values: static vs. reactive

A `CoreValueProps<T>` is one of:

- a plain value (`val`): set once, or updated later via `set()`;
- an expression (`exp` + `deps`): `exp` is called with the owning scope's
  `proxy` as its one argument to derive the value, and `deps` is the
  explicit, precompiled list of dependencies used to build the dependency
  graph. Each entry is the **path** to what it names — `[...via, key]`,
  where every segment before the last is a property of the scope proxy
  (`$parent`, `$host`, or a named scope's `:aka`) and the last is the
  value's key there. `CoreValue.resolveDep()` walks it.

  Data rather than an accessor, which is what it used to be: one
  `function () { return this.$value('total'); }` per edge, allocated at
  mount and called once. On a page of any size those were the largest
  single thing the props carried — a fifth of them on this repository's
  biggest page.

`CoreValue.link()`/`unlink()` build/tear down the `src`/`dst` edges between a
value and its declared dependencies. `link()` is called for every value in a
scope subtree at the start of a refresh (`linkValues()`); `unlink()` is
called at the end of the previous refresh (`unlinkValues()`), clearing both
sides of every edge so the graph can be rebuilt from scratch.

Calling `set()` on a value discards any `exp` (the value becomes static) and
detaches it from its old dependencies.

## Push/pull reactive cycle

The system alternates between two modes, tracked by `CoreContext`:

- **Pull mode**, during a `refresh()`: the context walks the whole scope
  subtree three times — `unlinkValues()` (tear down the dependency graph),
  `linkValues()` (rebuild it from each value's declared `deps`), then
  `updateValues()` (call `.get()` on every value, which lazily evaluates
  expressions whose `cycle` is stale). `refreshLevel` is incremented for the
  duration so that individual value updates don't try to eagerly propagate
  (see below) — propagation during a refresh is implicit, driven by the
  traversal itself. Each of these three methods also takes a `recur` flag
  (default `true`) to operate on a single scope only, without descending
  into its children — a building block for a future, more targeted local
  refresh.
- **Push mode**, everywhere else: calling `set()` on a value (or an
  expression re-evaluating to a new result because one of its dependencies
  changed) hands its `dst` set to the context's queue and, if this is the
  outermost push, drains it (`propagate()`), advancing `ctx.cycle` so each
  value only recomputes once per propagation. `pushLevel` tracks reentrancy
  so a chain of cascading updates only bumps `cycle` once, drains once, and
  flushes pending callbacks once, at the outermost call.

  The queue is ordered by `CoreValue.depthNow()` — a value's distance from
  the nearest value that depends on nothing — and always yields the
  shallowest pending value. Since reading something is what makes it a
  source, every source is strictly shallower than what reads it, so a value
  is never evaluated while one of its inputs is still mid-change. Without
  that ordering a diamond glitches: in `a → b → d` and `a → d`, `d` is
  reached down the short arm while `b` is still being evaluated on the long
  one, settles for the cycle against `b`'s previous value, and is then never
  revisited when `b` lands. The result is not stale but *wrong*, and only for
  the cycle in which it changed — no error, nothing to see in the graph
  afterwards.

A `CoreValue.get()` short-circuits: an expression value only re-evaluates if
its `cycle` is behind the context's current `cycle`, and only if it's either
never been evaluated (`cycle === 0`) or has at least one dependency
(`src.size`) that could have changed it — a dependency-free expression is
treated as a one-shot computation.

A refresh is required once at application launch (to link the whole tree for
the first time) and can be re-applied to a local branch whenever its
topology changes (scopes/values added or removed), so that branch's
dependency graph is brought up to date.

Errors thrown while evaluating an expression, linking a dependency, or
propagating a change are caught and logged (`console.error`) rather than
allowed to escape — a single broken expression shouldn't abort a refresh or
a propagation pass affecting unrelated values.

## Replication (`:for-each`)

A scope whose `values` include `for$each` (`RT_FOR_EACH_VALUE`) is a
*for-each host*. `CoreScope.newValue()` wires that key to a static callback
(`foreachCB`, set via `setCB()`), so it runs through the ordinary
push/pull machinery like any other value with a callback — several array
changes within one batch still only reconcile once.

The host scope's own compiled element is turned into an inert `<template>`
stencil at compile time (see below), so it's never itself a visible
instance — in a real browser, `<template>` content isn't part of the
rendered document at all, not just hidden. `foreachCB` reflects that:
*every* item, including the first, is represented by a **clone**
(`CoreScope.clone(index)`), never by the host directly. Concretely:

- `foreachCB` computes the effective `(offset, length)` window (from
  `for$offset`/`for$length`, if present), then creates/updates/removes one
  clone per item in that window, binding each clone's own per-item value
  (named `data` by default, or whatever `:for-as` renamed it to) to its
  item;
- a clone is a full scope reusing the host's own
  `props.values`/`props.children` (so it gets independent `CoreValue`s
  from the exact same declarations), with id `${hostId}#${index}` and
  `cloned: true` set on its props — read into `this.cloned` as the very
  first constructor statement, before `init()` runs, so a subclass can
  already tell it's building a clone while constructing it.
  `foreachCB` returns early for a scope with `this.cloned` set: only the
  host scope drives reconciliation, clones ignore their own `for$each`;
- shrinking the array disposes excess clones (`removeExcessClones`) the
  same way any scope teardown works (`dispose()`); an empty/null/undefined
  array simply means zero clones, with no separate "hide the host" step
  needed, since the host was never visible to begin with.

The DOM-specific half of this — turning a for-each host's own compiled
element into that inert `<template>` stencil, and turning `clone()` into
"reuse an already-present element by id, or `cloneNode(true)` the stencil
and insert it" — lives in `WebScope` (see
[web-scope.ts](./web/web-scope.ts)). Because SSR
(`src/server/render.ts`) runs this exact runtime against a
`ServerDocument`, replication produces real, literal markup during server
rendering too, with no SSR-specific logic at all; hydration is then just
the ordinary "find an existing element by id" path locating an
SSR-rendered node instead of creating a new one.

## The compiler contract

The runtime never discovers dependencies on its own — it trusts that the
compiler has already done so correctly, and only wires up and executes what
it's given. This is a deliberate split of responsibilities: static analysis
owns correctness of the dependency graph, the runtime owns its efficient
execution. Concretely, the compiler is responsible for:

- detecting every reference an expression makes to a non-local (i.e.
  outer-scope or system) variable, and emitting it as an explicit entry in
  that value's `deps`;
- fully qualifying every such reference with `$.`, so it's resolved through
  the owning scope's `proxy`/`lookup()` rather than captured as a raw
  closure variable — `$` is the parameter every compiled expression takes,
  and the runtime calls `exp(scope.proxy)`;
- reserving identifiers starting with `$` (e.g. `$value`, `$parent`) for
  system-level values, and rejecting their use in application code, so they
  can never be shadowed or collide with user-defined values;
- refusing an expression that DECLARES `$` -- a parameter, a variable, a
  destructured name, a catch clause. The qualifier leaves locals alone, so
  one of that name would shadow the scope and read the wrong object without
  anything failing out loud. (This replaced a much wider rule: while the
  scope arrived as `this`, no classic `function` could appear anywhere
  inside an expression, because it would rebind `this` and lose the scope.
  A parameter is captured like any other closure variable, so that rule is
  gone and any kind of function may be written.);
- validating that every reference it qualifies actually resolves to a real
  declared value or named (`:aka`) scope somewhere in the reachable scope
  chain (own scope, ancestors, or a named scope's own values), reporting a
  compile error otherwise — the runtime never has to tolerate a `deps`
  entry pointing at nothing;
- emitting the one class of reference that *can* point at nothing as
  `maybeDeps` rather than `deps`. A reference that walks into a region —
  `:if`, `:else`, `:for-data` — names a scope that exists only while that
  region is showing, and the page had to write `?.` at the crossing to be
  allowed it at all. `link()` makes those edges when it can and leaves them
  unmade when it cannot, and `CoreContext.relinkMaybes()` revisits them
  whenever a region toggles. The rule above is unchanged for everything in
  `deps`: an entry there resolving to nothing is still a compiler bug;
- resolving a reference chain (`outer.inner.count`, `$parent.$parent.n`)
  one segment at a time, each against the scope the previous segment landed
  in — the same walk `lookup()` performs — and stopping at the first
  segment that isn't a scope navigation, since everything after it is plain
  property access on that value's own runtime shape (`items.filter`).

That last point carries more weight than it looks. Because the runtime
trusts `deps` completely, a reference the compiler resolves *wrongly* —
recording a dependency on the scope it navigated through rather than on the
value at the end of the chain — doesn't surface as a runtime error. It
produces a binding that renders correctly once and then silently never
updates again. So the compiler must treat "I don't recognize this shape" as
an error to report, never as a reference to quietly skip: anything it can't
follow statically (a computed property access on a scope, say) has to fail
the build rather than compile into a dead binding.

For the DOM-specific layer (`runtime/web`), the compiler also marks dynamic
text positions with HTML comments, so `WebScope` can find the DOM text node
each `text$N` value should update without needing its own separate parse
pass. Those comments are `-`-prefixed (`DOM_TEXT_MARKER1`/`DOM_TEXT_MARKER2`
in `web-context.ts`, e.g. `<!---t0-->text<!---/-->`), the same convention
`html/preprocessor.ts` uses for triple-dash "private" comments that get
stripped from page/fragment source during preprocessing — since that
stripping happens before the compiler ever inserts its own markers, a
`-`-prefixed marker can never collide with anything a page author wrote.

## Change batching

Rather than invoking value-change callbacks (`cb`, set via `setCB()`)
synchronously as each value updates, every `CoreValue` that changed and has
a callback is added to `context.pending`. Since `pending` is a `Set`, a
value that changes several times within the same batch is still only
notified once. `applyPending()` — invoked once `refreshLevel`/`pushLevel`
drops back to zero — runs every pending callback exactly once and clears
the set, so a single user action or refresh that touches many values still
only notifies observers once per value, after everything has settled.

## Error handling

Every runtime failure funnels through `CoreContext.onError(phase, err, value?)`
— the single place that decides what "an error happened" means. Nothing in the
runtime may catch and ignore instead of calling it. A swallowed failure doesn't
stop a page; it produces a binding that renders once and is wrong forever,
which is far harder to diagnose than a message would have been.

The phases separate three genuinely different things that used to share one
`catch`:

- **`update`** — a user expression threw (`${user.name}` before the data
  arrives). Expected during normal operation, and must never break the page.
  The value becomes `undefined` — *always*, never whatever it held before.
  Keeping the previous value would make a binding's contents depend on which
  earlier evaluations happened to succeed, and would present stale data as if
  it were current.
- **`link`** — a `dep` resolved to nothing. The compiler contract above says
  this can't happen, so reaching it means the *compiler* is broken, not the
  page. Reported unconditionally. A `maybeDep` resolving to nothing is the
  documented exception and is not reported: it means the region it reaches
  into is away, which is what the page's `?.` said it was ready for.
- **`callback`**, **`propagate`**, **`refresh`** — internal phases. Each
  callback in `applyPending()` is guarded individually, so one failing observer
  can't cost the rest of the batch their notification, and the batch is drained
  in a `finally` so it can't leak into the next cycle.

Errors are de-duplicated per `(phase, scope, key, message)`: an expression that
throws on every cycle is reported once, not once per cycle. Each carries the
owning scope's id and the value's key, so a message names the binding at fault
(`markout [update] s3.text$0: ...`) rather than pointing into runtime internals.

`props.onError` replaces the default console reporting. The server passes one
to collect what server rendering hits, and the two halves are then handled
differently — deliberately, because they mean different things:

- **Server rendering failed.** The page it produced is already wrong, and
  shipping it would send the browser off to run the very same expressions
  against the very same initial values and fail identically. In dev the server
  serves a page built *solely* from the errors instead, carrying no content and
  no runtime. Outside dev the page is served as rendered, with the errors going
  only to the server log — a failing expression shouldn't cost a production
  page its runtime.
- **The browser failed after hydration.** There's no server round-trip to
  reuse, so `WebContext` (built with `dev: true`, which the compiler signals
  via `window.__MARKOUT_DEV`) appends to a `<ul id="markout-errors">` panel in
  the page. Since `onError()` has already de-duplicated, each row is distinct
  by construction.
