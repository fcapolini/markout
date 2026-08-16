# Server-only values — `:keep-`

Status: **proposed**, nothing built. Written to be argued with before it is.

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

> **`:keep-x=${expr}` — this expression runs on the server only. The client
> receives its result.**

That is the whole feature. Everything below follows from it, including why
the result appears in the page source, and why dependents of a kept value
still update normally.

The value is **frozen** on the client: it arrives with a value and no
expression, so nothing re-derives it. Freezing is not a compromise, it is
the correct behavior for all three classes above — the placeholder `${null}`
of an imperatively-written value should not re-run, a server-only expression
*cannot* re-run, and a non-deterministic one must not.

The rule that follows, and the one thing to get right when using it:

> **Keep the source, never the derivation.**

`:keep-user=${loadUser()}` with an ordinary `:greeting=${'Hi ' + user.name}`
is correct — `greeting` re-derives on the client and tracks `user` as usual.
Marking `greeting` instead would pin it, and a later change to `user` would
silently never reach it. The marker belongs on the value that cannot be
recomputed, not on anything computed from it.

## Syntax

```html
<html :keep-session=${loadSession()}>
```

`:keep-name=${expr}` declares value `name` exactly as `:name=${expr}` does,
and additionally marks it server-only. Consistent with the existing `:attr-`
/ `:prop-` / `:class-` / `:style-` prefix family, where the prefix names a
behavior and the suffix names the target.

The name is worth a second look before it ships: `:keep-` reads as "keep it
around", when the contract is "runs on the server". `:server-`, `:pin-` and
`:once-` are all closer to the meaning.

### What it may not combine with

Plain named values only. A compile error on:

- `:attr-`, `:prop-`, `:class-`, `:style-` — these are *derived from* values,
  so once the value they read is kept they re-derive correctly for free.
  Marking them too would store the same fact twice.
- `:on-`, `:did-`, `:will-`, `:handle-` — these hold functions, which do not
  serialize, and are browser-only besides.
- `:for-each`, `:for-data`, `:for-key` — replication is driven by the value
  they read; mark that instead.
- text values. Text is already in the served markup; that is what SSR is.

### Interaction with the two name conventions

- `_private` composes fine: `:keep-_raw` is a kept internal value. The
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
tempting — the props are already generated JS, so a kept value could simply
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
the blob is `{ [uid]: { [key]: value } }` and a kept value inside a repeated
row keys correctly with nothing new invented.

Replicas degrade correctly for free: a replica the client builds that the
server never rendered has no entry and falls back to its expression.

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
- **Cycles**, trivially reachable in any object graph a page assembles. These
  need an IIFE rather than a plain literal, and are the only case that does.

A literal costs nothing to gain all of that, so there is no tagged encoding
and no revival pass.

**Deliberate deferral:** `JSON.parse('…')` parses roughly twice as fast as
equivalent object-literal source in V8, which is why bundlers reach for it on
large payloads. It is the wrong trade at the sizes involved here, and taking
it would mean reintroducing a tagged encoding plus a revival pass to get
`undefined` and `Date` back. Revisit only if a real page's state blob reaches
the hundreds of kilobytes.

### What cannot travel

Functions, symbols, DOM nodes, class instances. The compiler cannot catch
these — `:keep-x=${something()}` has no static type — so it is a runtime
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

A kept value is written into the page source in plain text. `:keep-` on
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
| stage1-load | Recognize the `:keep-` prefix where the other prefixes are parsed; strip it; set `Value.keep = true`. |
| stage2-validate | The refusals above: the binding families, text values, `k_` names. |
| stage3-qualify | None. This changes neither scoping nor qualification. |
| stage4-resolve | None. A kept value's dependencies are ordinary dependencies. |
| stage5-comptime | None beyond stage2's `k_` refusal. |
| stage6-treeshake | None. A kept value nothing reads is dead by the existing rule and should still be dropped. |
| stage7-generate | Emit `keep: true` in the value's props. One boolean per kept value. |

### Runtime and server

- `CoreValueProps.keep?: boolean`.
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

1. **`:keep-` end to end, synchronous only.** No fetch, no async, no registry.
   `:keep-t=${Date.now()}` renders once on the server and does not flip on
   hydration. Complete and testable on its own, and it closes the class-3
   mismatches that exist today.
2. **Pending registry + async `renderPage`.** Independent of (1), provable
   against a stub that just resolves a promise.
3. **`std-data` in std-kit**, built on both, with nothing runtime-specific of
   its own.

The sequencing is the argument that this decomposition was right: step 1
ships value before anything about fetching is settled.

## Open questions

- **The name.** `:keep-` describes the plumbing; the contract is "server-only
  expression". Decide before it is documented, since it is unrenameable after.
- **Unknown keys.** In dev, served HTML can outlive a recompile, so the blob
  may name a scope the props no longer have. Ignore silently, or count and
  report in dev? Leaning: ignore, report the count in dev only.
- **Does `uid` hold up through nested custom-tag instances?** It should — a
  usage instance is a child of the root scope with its own `props.id` — but
  it needs a test with an instance inside a `:for-each` before it is asserted.
- **`:keep-` on a `:for-each` replica's per-item binding** — nonsensical, and
  probably a fourth refusal in stage2, but the spelling isn't obvious since
  the binding is named by `:for-as`.
