This folder contains the reactive core code of Markout.

A reactive application is built out of nested *scopes* rooted in a common
*context*. Reactive expressions, contained in *values*, have visibility on
their own scope and all outer scopes, up to the *global* one.

In the case of Markout, the scope tree is a logic representation of the DOM
tree, where only "active" DOM elements are represented.

## Building blocks

- **`CoreContext`** ([core-context.ts](./core-context.ts)) — the root object
  of an application instance. It owns the `global` scope, the `root` scope,
  and the counters (`cycle`, `refreshLevel`, `pushLevel`) that drive the
  push/pull reactive system described below. It also collects and flushes
  the batch of pending value-change callbacks (see "Change batching").
- **`CoreGlobal`** ([core-global.ts](./core-global.ts)) — a `CoreScope`
  subclass with no parent, sitting above `root`. It hosts globals/built-ins
  (e.g. window-like values) that every scope can see.
- **`CoreScope`** ([core-scope.ts](./core-scope.ts)) — a node in the scope
  tree. Each scope owns a map of `CoreValue`s (`values`), a child list, and a
  `proxy` object used to read/write those values (and any inherited from
  ancestor scopes) using plain property access.
- **`CoreValue`** ([core-value.ts](./core-value.ts)) — a single reactive
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
- an expression (`exp` + `deps`): `exp` is evaluated (with the owning
  scope's `proxy` as `this`) to derive the value, and `deps` is the
  explicit, precompiled list of dependency accessors used to build the
  dependency graph — each `dep` is called (again with the scope's `proxy` as
  `this`) to resolve the `CoreValue` it points at.

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
  changed) immediately walks its `dst` set and re-evaluates every dependent
  value (`propagate()`), advancing `ctx.cycle` so each value only recomputes
  once per propagation. `pushLevel` tracks reentrancy so a chain of
  cascading updates only bumps `cycle` once and flushes pending callbacks
  once, at the outermost call.

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

## The compiler contract

The runtime never discovers dependencies on its own — it trusts that the
compiler has already done so correctly, and only wires up and executes what
it's given. This is a deliberate split of responsibilities: static analysis
owns correctness of the dependency graph, the runtime owns its efficient
execution. Concretely, the compiler is responsible for:

- detecting every reference an expression makes to a non-local (i.e.
  outer-scope or system) variable, and emitting it as an explicit entry in
  that value's `deps`;
- fully qualifying every such reference with `this.`, so it's resolved
  through the owning scope's `proxy`/`lookup()` rather than captured as a
  raw closure variable — this is what lets `exp`/`deps` functions be handed
  a different `this` (the scope's `proxy`) via `.apply()`;
- reserving identifiers starting with `$` (e.g. `$value`, `$parent`) for
  system-level values, and rejecting their use in application code, so they
  can never be shadowed or collide with user-defined values;
- ensuring every function nested inside an expression is an arrow function,
  never a classic `function`, since a classic function rebinds `this` and
  would mask the `.apply(scope.proxy)` binding — the compiler can either
  reject classic functions outright or transparently rewrite them as arrow
  functions.

## Change batching

Rather than invoking value-change callbacks (`cb`, set via `setCB()`)
synchronously as each value updates, every `CoreValue` that changed and has
a callback is added to `context.pending`. Since `pending` is a `Set`, a
value that changes several times within the same batch is still only
notified once. `applyPending()` — invoked once `refreshLevel`/`pushLevel`
drops back to zero — runs every pending callback exactly once and clears
the set, so a single user action or refresh that touches many values still
only notifies observers once per value, after everything has settled.
