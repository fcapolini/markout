# Server-only values — `:server-`

Status: **`:server-` is built** (step 1 below). The pending-work registry and
async `renderPage` that a datasource component also needs are still proposed.

User-facing documentation lives in
[the syntax reference](../reference/syntax.md#server-only-values); this file
keeps the reasoning and the decisions taken along the way.

## The problem

Hydration re-derives every value by running its expression again in the
browser. That is correct for a pure expression and it is what makes the
served page and the live page agree without a second language.

It is wrong whenever the expression cannot be re-run on the client. Three
classes, and they are not exotic:

1. **Imperatively assigned state.** A value written from a callback — the
   payload of a fetch, most obviously — has no expression to re-run and
   exists nowhere in the served HTML. On hydration it is back to its
   declared initial value, every dependent value re-evaluates against
   nothing, and the server-rendered content is *wiped* and only returns if
   something fetches it again. Worse than not server-rendering at all.
2. **Values derived from server-only inputs.** A file read, an environment
   variable, a database row, request headers, the session. Re-running the
   expression in the browser doesn't merely waste work — it throws.
3. **Values that are not deterministic.** `${Date.now()}`, `${Math.random()}`,
   and `$side` if it lands. These don't break — they render one thing and
   then visibly flip on hydration, which is worse than breaking, because
   nobody notices in dev.

Class 3 is a bug the language has today, independent of any kit. That matters
for sequencing: this feature is worth building even if `std-data` never is.

## The contract

> **`:server-x=${expr}` — this expression runs on the server only. The client
> receives its result.**

That is the whole feature. Everything below follows from it, including why
the result appears in the page source, and why dependents of a server-only value
still update normally.

The value is **frozen** on the client: it arrives with a value and no
expression, so nothing re-derives it. Freezing is not a compromise, it is
the correct behavior for all three classes above — the placeholder `${null}`
of an imperatively-written value should not re-run, a server-only expression
*cannot* re-run, and a non-deterministic one must not.

The rule that follows, and the one thing to get right when using it:

> **Mark the source, never the derivation.**

`:server-user=${loadUser()}` with an ordinary `:greeting=${'Hi ' + user.name}`
is correct — `greeting` re-derives on the client and tracks `user` as usual.
Marking `greeting` instead would pin it, and a later change to `user` would
silently never reach it. The marker belongs on the value that cannot be
recomputed, not on anything computed from it.

## Syntax

```html
<html :server-session=${loadSession()}>
```

`:server-name=${expr}` declares value `name` exactly as `:name=${expr}` does,
and additionally marks it server-only. Consistent with the existing `:attr-`
/ `:prop-` / `:class-` / `:style-` prefix family, where the prefix names a
behavior and the suffix names the target.

### What it may not combine with

Plain named values only. A compile error on:

- `:attr-`, `:prop-`, `:class-`, `:style-` — these are *derived from* values,
  so once the value they read is marked they re-derive correctly for free.
  Marking them too would store the same fact twice.
- `:on-`, `:did-`, `:will-`, `:handle-` — these hold functions, which do not
  serialize, and are browser-only besides.
- `:for-each`, `:for-data`, `:for-key` — replication is driven by the value
  they read; mark that instead.
- text values. Text is already in the served markup; that is what SSR is.

### Interaction with the two name conventions

- `_private` composes fine: `:server-_raw` is a server-only internal value. The
  underscore is a naming convention, not a mechanism.
- `k_comptime` does not, and should be a compile error. A `k_` value is
  substituted into its readers by stage5 and never reaches the runtime as a
  cell, so there is nothing left to send. (Same reasoning as the comptime
  note in TODO.md: unsolvable must be an error, never a silent fallback to
  the behavior the marker was meant to avoid.)

## Two globals, not one

| | produced by | varies with | cacheable |
| --- | --- | --- | --- |
| `__MARKOUT_PROPS` — the app descriptor | stage7 | the source | yes |
| `__MARKOUT_STATE` — this render's state | the server, post-render | the request | **no** |

Folding the state into the props was considered and rejected. It is
tempting — the props are already generated JS, so a server-only value could simply
be emitted as a literal in place of its `exp` — but it costs a **second full
`escodegen` pass per request**, since stage7 has already serialized the tree
by the time the render produces a value. That is per-request CPU
proportional to page complexity, buying a payload change proportional to
state size. Splitting serializes only what actually varies.

Two further reasons, both independent of caching:

- **It confines the untrusted bytes.** A fetched payload is third-party data
  going into a `<script>`. Kept separate, it is one small script with one
  serializer and an auditable escaping path, instead of being mixed into the
  same script as all generated code.
- **It is readable.** The state blob can be inspected in the page source, so
  "what did I just publish?" is a question with an answer.

The cacheability in the table is currently theoretical — `Compiler.compile()`
builds a fresh `Page` per request and the preprocessor holds no cache — but
the split is what keeps that door open, and the table is the constraint any
future page cache has to respect. A cache that memoized the rendered document
would serve one user's session to the next visitor.

### Keying

[`CoreScope.uid`](../../src/runtime/core/core-scope.ts#L102) is `props.id`
plus the replica path, unique across `:for-each` replicas by construction. So
the blob is `{ [uid]: { [key]: value } }` and a server-only value inside a repeated
row keys correctly with nothing new invented. Confirmed by test rather than
assumed: two replicas of one declaration collect and rehydrate separately.

Replicas degrade correctly for free: a replica the client builds that the
server never rendered has no entry and falls back to its expression.

### Stencils are skipped

Found while testing the above, and not anticipated: collecting naively
produced *three* entries for a two-item `:for-each` — one per replica, plus
one for the host.

A `:for-each` host is a stencil ([`isStencil()`](../../src/runtime/core/core-scope.ts#L516)):
its element is only ever cloned, so its values are prototypes for the
replicas rather than bindings of its own and are never evaluated. Collecting
there sends `undefined` standing in for "never ran". The same applies to a
`:for-data` with nothing to show, where it would be worse — the guard exists
precisely so the body doesn't evaluate, so every page not showing the item
would ship a spurious entry.

So collection skips a stencil's own values *and its prototype markup*, but
still descends into its replicas, which are children of the host too and are
live. The clients falls back correctly with no matching rule of its own: a
stencil simply finds no entry.

## Format: a JS literal, not JSON

The state script is a `<script>` like the props script, so the blob is a **JS
object literal**, not a JSON string:

```js
window.__MARKOUT_STATE = { s3: { data: { at: new Date(1e12), n: undefined } } };
```

This matters because JSON loses things this language treats as ordinary:

- **`undefined`.** Load-bearing here: a failed expression yields `undefined`
  *always*, deliberately and never `null` (values.md, "When an expression
  fails"). Landing it as `null` transfers a different fact than the server had.
- **`Date`, `Map`, `Set`, `BigInt`.** `structuredClone` and `BigInt` are both
  on the globals list, so the language already presents these as unremarkable.
- **`NaN`, `-0`.**
A literal costs nothing to gain all of that, so there is no tagged encoding
and no revival pass.

**Cycles are refused, not encoded.** Encoding them means hoisting every
container into a var and filling it afterwards, which changes the shape of
*all* output to serve a case a server-only value is unlikely to reach. A
clear error beats a format nobody can read in a page's source. The same
decision means two references to one object arrive as two objects: structure
survives the trip, identity does not.

**Deliberate deferral:** `JSON.parse('…')` parses roughly twice as fast as
equivalent object-literal source in V8, which is why bundlers reach for it on
large payloads. It is the wrong trade at the sizes involved here, and taking
it would mean reintroducing a tagged encoding plus a revival pass to get
`undefined` and `Date` back. Revisit only if a real page's state blob reaches
the hundreds of kilobytes.

### What cannot travel

Functions, symbols, DOM nodes, class instances. The compiler cannot catch
these — `:server-x=${something()}` has no static type — so it is a runtime
failure at serialize time, reported through
[`CoreContext.onError`](../../src/runtime/core/core-context.ts#L108) like
everything else, most likely under a new `'transfer'` phase in
`RuntimeErrorPhase`.

There is an honest tension. TODO.md's comptime rule says never fall back
silently to the behavior the marker was meant to avoid, but unlike comptime
this cannot be a build error, and a page whose serialization failed still has
to serve. The proposal: report it, let the value fall back to its expression
on the client, and in dev serve the runtime-error page as
[middleware.ts:81](../../src/server/middleware.ts#L81) already does for
expression failures. Dev is loud, production degrades to today's behavior.

### It is public

A server-only value is written into the page source in plain text. `:server-` on
anything derived from a session, a credential, or another user's row
publishes it. This belongs in the docs beside the syntax, in those words.

The mitigation is structural: it is opt-in per value and spelled at the
declaration, so nothing travels by accident. That is a better position than
frameworks that serialize a whole store.

### Escaping

[`escapeScriptClose`](../../src/compiler/stages/stage7-generate.ts#L81)
currently handles `</script` in compiler-generated code, where the only source
of a stray `</script` is a string the page author wrote themselves. The state
blob carries third-party bytes, so that path becomes security-relevant:
`<!--` needs handling too (it flips the browser's script parser), and the
serializer deserves a test with a hostile payload rather than inheriting a
function written for a friendlier threat model.

## Mechanics

The override applies at **value construction**, not by patching generated
source. `CoreScope` computes `this.uid` before it builds its values, so the
lookup is `state[uid]?.[key]`; a hit constructs the value with `val` and no
`exp` and no `deps` — the same inert shape
[core-global.ts:116](../../src/runtime/core/core-global.ts#L116) already uses,
for the same reason. Dropping `deps` matters: otherwise sources keep enqueuing
a value whose `get()` returns immediately, which is edges and propagation for
nothing.

Server and client run the identical rule, which is what keeps the two halves
honest.

### Compiler

| Stage | Change |
| --- | --- |
| stage1-load | Recognizes and strips the `:server-` prefix before the rest of the name is parsed, sets `Value.serverOnly`, and raises the refusals. |
| stage2-validate | None, in the end. The design put the refusals here, but stage1 is where the family prefix is determined, so checking there costs one `if` next to the information instead of re-deriving it from compiled names. |
| stage3-qualify | None. This changes neither scoping nor qualification. |
| stage4-resolve | None. A server-only value's dependencies are ordinary dependencies. |
| stage5-comptime | None. The `k_` refusal is deferred: comptime is still a placeholder, so `k_` means nothing yet and refusing the combination now would refuse something harmless. Noted in TODO.md's comptime entry instead. |
| stage6-treeshake | None. A server-only value nothing reads is dead by the existing rule and should still be dropped. |
| stage7-generate | Emits `serverOnly: true` in the value's props, and reserves the state `<script>` — but only on a page that has one, so every other page's output is byte-for-byte what it was. |

### Runtime and server

- `CoreValueProps.serverOnly?: boolean`.
- `CoreContext.collectKept()` — walk the scope tree, return `{ [uid]: { [key]: value } }`.
  Called server-side once the render has settled.
- `CoreContext.applyState(blob)` — consulted at value construction per above.
- [browser.ts](../../src/runtime/web/browser.ts#L17) reads the second global
  next to `PROPS_GLOBAL` and hands it to the context.
- The server writes the state script after `renderPage` resolves and before
  `doc.toString()` at [middleware.ts:86](../../src/server/middleware.ts#L86).
  It must be inserted **between** the props and runtime scripts stage7
  appends, not after them.

## Order of work

1. ~~**`:server-` end to end, synchronous only.**~~ **Done.** No fetch, no
   async, no registry. `:server-t=${Date.now()}` renders once on the server and
   does not flip on hydration.
2. **Pending registry + async `renderPage`.** Independent of (1), provable
   against a stub that just resolves a promise.
3. **`std-data` in std-kit**, built on both, with nothing runtime-specific of
   its own.

The sequencing was the argument that this decomposition was right, and it
held: step 1 shipped before anything about fetching is settled.

## Settled along the way

- **The name.** Started as `:keep-`, which described the plumbing rather than
  the contract. Renamed to `:server-` before anything depended on it: the
  attribute now says what the doc says, which is that the expression runs on
  the server.

## Open questions

- **Unknown keys.** In dev, served HTML can outlive a recompile, so the blob
  may name a scope the props no longer have. Currently ignored in silence;
  counting and reporting in dev is the likely refinement.
- **Does `uid` hold up through nested custom-tag instances?** Replicas are
  now tested. A custom-tag instance inside a `:for-each` is not, and is the
  case most likely to surprise.
- **`:server-` on a `:for-each` replica's per-item binding.** Still open: the
  binding is named by `:for-as`, so there is no attribute to refuse. Writing
  `:server-` on the alias is not currently expressible, which is why nothing
  was built for it.
