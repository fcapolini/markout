# Where code runs

Status: **compile time is contained; server-side rendering is not, and says
so.** The containment is
[comptime-realm.ts](../../packages/core/src/compiler/comptime-realm.ts) with
its suite next door; the rest of this file is the reasoning, the measurements
and the part deliberately left open.

Markout evaluates JavaScript in three places. Which of them matters is decided
by one fact: a kit is somebody else's code, spliced into every page that
imports it, and it is installed by ticking a box in a sidebar
([without-node.md](without-node.md)). A page is its author's own; a kit is
not.

## Three environments, and what holds in each

| | evaluates | contained by | third-party code reaches | reached by |
| --- | --- | --- | --- | --- |
| **Compile time** | `:const-` values | a `vm` realm of its own | nothing of the host's | everything that compiles a page |
| **Server render** | every page expression | nothing | the Node process | `prerender`, and the server without `--client` |
| **Browser** | nothing — the page's own `<script>` already did | the browser | what any script on the page reaches | every visitor |

The last column is the one that decides how much the middle row matters. A
render takes Node and a deliberate choice of delivery mode, so nothing done
through the editor's sidebar reaches it — see *Who this exposes*.

The browser row is the one nobody has to think about, and it is worth saying
why: the runtime never evaluates source. The props were evaluated by the
page's own script tag before the runtime saw them, which is what lets a page
be served under a policy that does not say `unsafe-eval`. See
[props.ts](../../packages/core/src/render/props.ts).

## Compile time

`:const-` values are computed while the page compiles. That means an author's
JavaScript runs inside whatever is compiling — and for a kit's fragment, the
two places that happens are the ones nobody asked for:

- **the language server**, on every keystroke, compiling for diagnostics,
  completions and hovers ([pages.ts](../../packages/vscode/src/pages.ts));
- **`markout build`**, in CI, next to whatever the deploy has.

### What it has to withhold

Evaluating an expression with `new Function(...)()` runs it in the compiler's
own realm. Each of these then reaches `process` from a kit fragment, and the
first will read an environment variable into the built HTML:

```js
''.constructor.constructor('return process')()   // and [], (0), ({}), /x/, __proto__
(()=>1).constructor('return process')()          // and the async form
(function(){ return this })()                    // sloppy mode: `this` IS the global
```

**The scope proxy is not a defence against any of them.** Free identifiers
compile to `$.name`, so an expression that *names* a global fails with `$ is
not defined` — but that is name resolution failing, not a guard, and nothing
above names anything. It is worth being explicit about, because the failure
looks exactly like a sandbox refusing and is the natural thing for a reader to
mistake for one.

### Why it is not a list of holes

`x.constructor.constructor` is `Function` for every object in the language,
and a `Function` body is evaluated in its realm's global scope. So **any
allowlist that hands over real host objects hands over the host.** Closing the
routes one at a time would mean removing `Object`, `Array`, `String`, `RegExp`
and the rest — which is removing JavaScript.

That is the whole argument for changing the realm rather than the list of
names. It is also why the fix is not specific to the routes that were found:
it does not enumerate them.

### The containment

A `vm` context per page, made on the first constant, seeded with **nothing**.
The same expressions resolve to that context's globals, where there is no
`process`, no `require` and nothing else of the host's.

Two limits come free and are worth having on their own merits:

- **`codeGeneration.strings: false`** turns off `eval` and the `Function`
  constructor inside the context. A constant computes a token from literals
  and has no use for either, so it costs nothing and makes the prototype
  routes fail at their last step as well as at the realm.
- **A timeout.** Without one, `:const-x=${(()=>{ for(;;); })()}` hangs
  whatever is compiling — in the editor, a language server that never answers
  again.

None of this narrows what a constant may express. They compute from literals
and other constants, which is all the closure check ever permitted.

### Why `vm` is sound here, given it is not a security boundary

Node says plainly that `vm` is not one, and that is correct: it leaks when
host objects are put **into** a context, because their prototypes lead back
out. Seeding a context with the outer realm's `Object` re-opens it completely.
That is not a footnote — it is asserted as a test, so that a later change
adding one convenience global has to come past it:

```
seeded with the host's Object  ->  'object'    // escaped
a bare context                 ->  'undefined'
```

The conditions that make it hold are all present here, and each is worth
naming because losing any one of them loses the property:

- the context is created from a null-prototype object and **receives nothing**;
- the code that runs in it is generated from the author's own expression;
- **only a primitive crosses back** — stage 5 already refused any other
  result, for an unrelated reason, so this was true before it was needed.

### What it costs

Measured: a fresh context 0.26ms, an evaluation in a warm one 0.05ms, against
`new Function` at 0.0004ms and an ordinary page compile at about 2ms. One
context per page rather than per constant keeps a page with a dozen design
tokens well inside its own compile; a page with no constants pays nothing,
because the context is not created until the first one.

Per page rather than per process so that what one page's constants do to their
sandbox cannot be read by the next page's.

## Server-side rendering

`prerender`, and the server unless it is given `--client`, run page
expressions in Node, in the host realm. **This is not contained, and the
containment above does not extend to it.**

Everything in the compile-time list works, and shorter routes work too,
because the allowlist itself hands over host objects:

```js
Object.constructor('return process')()   // any of ~15 allowlisted constructors
globalThis.process                       // `globalThis` is on the list, and on
                                         // the server it is Node's own
```

`globalThis` is not client-only: [core-global.ts](../../packages/core/src/runtime/core/core-global.ts)
builds each entry as `globalThis[name]`, so on the server that is Node's global
object. `fetch` is on the list too, so a rendered page has network access by
design.

### Why the same tool does not work here

Three blockers, in the order they close the door. The first is decisive on its
own.

**`fetch` and `URL` are load-bearing and cannot be exposed safely.** The
standard kit's data source is written in markout, and calls them from page
expressions — [data.htm](../../kits/std-kit/parts/data.htm) uses
`fetch(_url)`, `res.ok`, `res.status`, `res.json()` and `new URL(url,
$origin).href`. They are `:server-` datasources; removing them is removing the
server-side data story. And putting the host's `fetch` into a bare context
returns `process` on the first attempt, through `fetch.constructor` and again
through its prototype. A sandbox with one host function in it is not a sandbox.

**Every expression is called with a host object.**
[core-value.ts](../../packages/core/src/runtime/core/core-value.ts) calls
`this.exp!(this.scope.proxy)`. Materialising the expressions inside a context
would fix their literals, their prototypes and their sloppy `this` — and the
proxy handed in would still be the host's, along with any host object
reachable through scope.

**Only eight globals are missing from a bare context**, which sounds
encouraging until you see which. Of the 39 in `GLOBAL_NAMES`, 31 are there
already, including `console` and `Intl`. The timers are easy and there is
already a `//FIXME: server-side timer stuff should be no-ops` saying what they
should become; `queueMicrotask` and `structuredClone` are small shims. `fetch`
and `URL` are the whole problem.

### What full containment would actually take

Not a patch to `props.ts`. The runtime and the server DOM would have to run
**inside** the context, against context-native globals, with the network
marshalled across as data:

- a context-side `fetch` returning a context-side `Response` shim, with the
  real request performed by the host and only JSON crossing back;
- a context-side `URL`, or a primitive-in-primitive-out resolve call;
- timers as context-side no-ops, and shims for `queueMicrotask` and
  `structuredClone`;
- the datasource layer reworked so the fetch happens host-side.

The direction of the bridge is what makes this possible in principle: the host
may safely hold **context** objects, and it is only host objects crossing the
other way that leak. It is a project, not an afternoon.

**A patch to `props.ts` alone would be worse than the gap.** It would leave
all three blockers standing while looking like containment, which is the
failure mode [silent-failures.md](silent-failures.md) is about and the
direction [without-node.md](without-node.md) calls the expensive one.

### Who this exposes

**Nothing that installs a kit by ticking a box ever renders.** The sidebar's
Preview serves with `--client` and its Build calls `build`, so without-node
mode has no render in it at all — a boundary that follows from the premise,
since rendering is Node executing the page and that mode is for people who
have not got Node. See
[What this mode does not do](without-node.md#what-this-mode-does-not-do).

Reaching an unsandboxed render therefore takes Node on the machine and a
deliberate act: `markout prerender`, or the server without `--client`. That is
somebody who installed Node, chose a delivery mode that renders, and is
working the npm way.

So the population exposed here is not the audience this file was written
around. It is the same population every other Node tool exposes, reached by
the same act and with the same consequence, which is what the next section is
about.

## In context: what is normal, and what is not

The temptation, having written the section above, is to file it under "every
framework has this" and stop. Half of that is true and the half that is not is
the half worth acting on.

### The same as everyone: executing dependencies during a render

Rendering a page runs the code the page depends on. Next.js, Remix, Astro,
Nuxt and SvelteKit all import from `node_modules` into the server process
during SSR, unsandboxed, with full access to the environment, the filesystem
and the network. None of them sandboxes it, and none of them is criticised
for not doing so, because a dependency is understood to be code you decided to
trust.

Markout's server render is that, exactly. Not better, not worse, and not a
thing to apologise for.

### Better than the norm in two respects, both structural

**No install scripts.** `markout add` fetches a tarball, checks it against the
checksum the registry published, unpacks it and stops. There is no
`preinstall`, no `install`, no `postinstall` — the installer contains no
`spawn` and no `exec` at all. npm's lifecycle scripts are arbitrary code
execution *at install time*, before anything has been rendered or even
imported, and they are the most heavily exploited vector in that ecosystem.
Markout does not have it, and the reason is that a kit is `.htm` and CSS with
nothing to build, so there was never a reason to add one.

**Compile time is sandboxed, and has no equivalent elsewhere to be compared
with.** A Babel plugin, a Vite plugin, a component's module body: in every
other tool the compile step is arbitrary JavaScript by design, and sandboxing
it is not a thing anyone attempts. Markout's compile step evaluates only
`:const-` expressions, which is a small enough surface that containing it is
possible — so it is contained.

### The sidebar does not render at all

A checkbox is lighter ceremony than `npm i`. Typing an install command in a
terminal is legibly an act of extending trust; ticking a box in a sidebar
reads like setting a preference, and the people it is offered to are the ones
who wanted no toolchain in the first place.

The answer to that is not a better warning. It is that **the sidebar's two
buttons do not run a kit's code at all**, which narrows what the lighter
ceremony is agreeing to until it is smaller than what `npm i` agrees to
anywhere else.

Both work in the third delivery mode. **Build** calls `build`, which compiles
and stops. **Preview** serves with `client: true` — the same mode served
rather than written out, which is the page a visitor to a built site receives,
produced in their browser on arrival. Neither evaluates a page expression, so
neither evaluates a kit's.

Beside the other two properties, that closes the case for this audience:

| | does a kit's code run? |
| --- | --- |
| Installing it | no — the installer unpacks a tarball and runs no script |
| Compiling it | in a `vm` realm holding nothing of the host's |
| The Build button | no — `build` does not render |
| The Preview button | no — `client` mode does not render |
| In the browser | yes, in the browser's sandbox, like any script on a page |

So for somebody working entirely through the sidebar, a kit's code runs in
their browser and nowhere else. Set against the same question asked of an npm
dependency, markout is ahead at every stage but the last, where the two are
equal:

| | npm dependency | kit via the sidebar |
| --- | --- | --- |
| Install | `postinstall` runs arbitrary code | nothing runs |
| Build | plugins and module bodies execute | compile sandboxed; no render |
| Ship | code reaches visitors' browsers | the same |

That last row is the one that does not improve, and it is the one the lighter
ceremony now gates: **a kit becomes part of the pages you ship.** Real, worth
saying in the quick-pick, and no different from adding any frontend
dependency.

So the honest summary is not that markout is worse placed. Nobody built a
sandbox for this: it falls out of the language having a delivery mode with no
render in it, and of the sidebar's audience being exactly the people who
deploy that way.

Rendering remains for anyone who wants it — `markout prerender`, or the server
without `--client`. It is a thing to reach for from a terminal, by somebody
who has Node and is choosing to run a render, which is the ordinary framework
situation and is priced accordingly.

The controls [without-node.md](without-node.md) chose on other grounds still
matter, and matter most for a project that does render:

- the sidebar offers **this project's own kits first**, taken from the
  registry and filtered to the `@markout-lang` scope, with searching the whole
  registry a separate, deliberate step. The scope is checked by name here
  rather than asked of the registry: npm's `scope:` search qualifier does not
  filter, so a query for our kits answers with everybody's;
- the quick-pick says *a kit's code goes into your pages, and runs here when
  you preview — install ones you trust*, at the moment of choosing rather than
  in a dialog afterwards;
- versions are **pinned**, and an update is offered rather than applied, so a
  kit cannot change under a project that has already vetted it. That last one
  was chosen so two clones build the same thing, and happens to be a security
  property: a kit that was benign when installed cannot silently become
  malicious on the next build, which is the shape of most real supply-chain
  attacks. Somebody has to click.

### What would change this assessment

A kit gaining a build step, or a reason to execute at install, would put
markout back in the same position as everyone else and lose the first
advantage above. It is worth treating that as a decision rather than a drift:
the properties in this section hold because a kit is text, and they end the
day it is not.

## The regression suite

[comptime-realm.test.ts](../../packages/core/test/compiler/comptime-realm.test.ts)
keeps every escape above as a case, plus the demonstration that a seeded
context leaks.

It is **checked to be non-vacuous**, which matters more than usual here:
`expect(text).not.toContain('object')` passes just as happily on a page that
errored out for an unrelated reason, so green is not evidence on its own.
Swapping the realm back for `new Function` turns all ten containment cases
red. Anyone changing this file should do the same before trusting it — a
security test that has never been seen to fail is a comment.

## Open

- **Whether SSR containment is worth the project above.** It is bounded and
  understood, and the argument against is that it buys a property no
  comparable tool offers, at the cost of reimplementing `fetch` and `URL`
  against a marshalling boundary that every future global has to come past.
- **Whether `GLOBAL_NAMES` should shrink on the server.** `fetch` is there for
  the datasource, which is the standard kit rather than the language. If the
  datasource resolved host-side and handed data in, a page expression would
  not need `fetch` at all — which is most of the project above, arriving from
  a different direction and useful on its own.
- **Whether a kit should be able to declare `:const-` at all.** The narrowest
  possible answer to all of this, and it costs kit authors a feature the
  language has. Recorded because it was not considered until the containment
  was already written, and it is not obviously wrong.
