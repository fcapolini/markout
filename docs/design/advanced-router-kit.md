# advanced router-kit — design notes

**Status: exploratory.** Nothing here is implemented, and it is the
*advanced* design rather than the only one: `std-kit` ships a basic router
(`std-router` / `std-route`) that routes on the query string — one file, no
server configuration, and the served response is already the right route.
What this document adds beyond it is routes in the path, nesting that
composes layouts, parameters, and a page prerendered per address. The two
are alternatives, not stages: a site wanting none of that wants the basic
one. Routing is a **kit** —
nested components, plus five additions to the language, none of which
mentions routing. This records the design, the reasoning where it is not
obvious, and what is still open; the open questions are as much the point
of the document as the decisions.

Claims marked **(verified)** were run against the compiler at `ce9cd96`
rather than reasoned about, as throwaway suites using the recipe in
`packages/core/test/render/hydrate.test.ts`.

---

## The shape

Routes are nested component instances. Nesting in the markup *is* nesting
in the URL, and *is* layout composition.

```html
<:import src="/npm/@markout-lang/router-kit/all.htm" />

<rt-route :aka="about">
  <:include src="about-top.htm" />

  <rt-index>
    <p>Pick a section.</p>
  </rt-index>

  <rt-route :aka="us">
    <:include src="about-us.htm" />
  </rt-route>

  <rt-route :aka="user">
    <rt-route :aka="id" ::path=":id">
      <rt-index>
        <std-data :aka="d" ::url="/api/user/${$outer('rt-route').param}" />
        ...
      </rt-index>
    </rt-route>
  </rt-route>

  <:include src="about-bottom.htm" />
</rt-route>
```

A route is named once. `:aka` gives it its scope name and, through `$aka`,
its segment; `::path` appears only where the two differ — a param, or a
segment that is not an identifier. Nothing says who its parent is, because
`$outer` finds that.

Content no nested route encloses is layout: it renders wherever its route
does. A route renders its own page's content only where `<rt-index>` says
so. Both are ordinary components, and the difference between them is where
the author put a child.

**A route's match gates its content, never its child routes.** Layout and
`<rt-index>` are inside the gate; nested `<rt-route>` elements are outside
it and always live, rendering nothing until they match themselves. A
requirement rather than a style: **(verified)** a `:server-` value inside
a false `:if` reaches page state as nothing, since a hidden region is a
stencil and state collection skips those — so a route behind its parent's
gate cannot be enumerated and would silently never prerender. The live
skeleton is what in-page navigation needs anyway.

The param above is read inside `<rt-index>` for a reason: a route's bare
content lives on the route's own scope, so `$outer` there is the
*enclosing* route, and only content one instance deeper gets its own. See
[open question 1](#1-reading-a-param-from-bare-content).

---

## What the language has to grow

Five additions. None of them mentions routing, and each is wanted for
other reasons. Nothing works at all without the first; prerendering needs
the second and third; the last two are what make the markup read as
nesting rather than as bookkeeping.

### 1. `$url`, and a build that can bind it per output

**Built**, as [TODO.md](../../TODO.md)'s `$url` entry: the whole address as
a `URL`, from the request on the server and from `location.href` in the
browser, with `$origin` taken from it. Every route is a match against it.

**And live**, which was the half that mattered here. A navigation keeping
the document moves it and everything reading it re-runs — `$url` is the
one global the compiler emits a dependency for, since the rest cannot
change — so a route's condition is an ordinary value over `$url`, and a
region shows or hides on nothing but the address changing.

It is read-only: `$url` is where the page is, and navigating is a side
effect with a lifetime that belongs to the kit (settled 5, and
[TODO.md](../../TODO.md)'s second layer). Core learns only that a URL can
change without a new document, which is a fact about browsers rather than
about routers — and the listener that needs is the same one an intercepted
navigation fires, so the kit's half needs nothing more from here.

One thing still has to come with it.

**The build must render one source page at many URLs.** Today it walks the
docroot and renders each `.html` once
([build.ts](../../packages/core/src/build.ts)), and the express middleware
compiles strictly by pathname
([middleware.ts](../../packages/express/src/middleware.ts)). Neither is
language; both have to learn that a page can answer an address that is not
its filename.

### 2. A render handing a value back to the build

`renderPage` returns errors and nothing else; the state it collected from
`:server-` values is serialized into the page and otherwise dropped. It
should be returned.

An address set is a fact about a render, not about the source:
[value-transfer.md](value-transfer.md) draws that line for `:server-`
values — *"the props are a function of the source and could be cached,
while this is a function of the request and never can be"* — which is also
why comptime cannot hold it, `:const-` reading only literals and other
constants.

The enumerating pass is: render the page once with no address bound, read
the state, union every route's address out of it. **(verified)** State is
keyed by scope uid, so nothing aggregates up the tree — which matters,
since names resolve downward only and a router root cannot see its
descendants. Two nested live routes report
`{"s4":{"addr":"/about"},"s6":{"addr":"/about/us"}}`; a `:for-each` over
three ids reports `s4-0`, `s4-1`, `s4-2` separately, replica path in the
uid, so generated route sets enumerate for free. The uid is also
provenance: it resolves through the props and the dev `locs` map to the
file and line the route was written on.

Any other fact a build step wants out of a render — sitemap, feeds, cache
keys — comes through the same door.

### 3. Folding a comptime `:if`, and dropping the dead branch

**(verified)** A `:const-` condition already folds: with
`:const-here=${"/about"}`, the value `:if=${here === "/about"}` compiles to
`$=>'/about'==='/about'`. But the losing branch still ships — its stencil
stays in the markup and its expression stays in the props.

Without this, prerendering is dishonest: a page prerendered at forty
addresses ships all forty routes' markup forty times, since `:if` is what
hides an unmatched route. With it, compiling once per URL leaves that
URL's chain and nothing else.

[`foldConstantText`](../../packages/core/src/compiler/stages/stage5-comptime.ts)
is the precedent, in the stage that would host it — *"all that changes is
WHEN"*. The limit: an `:if` region's stencil is what a client-side
instantiation renders from, so folding is sound only where the condition
is constant for the life of the page, which a build-bound `$url` is and a
runtime one is not.

### 4. `$outer(tag)` — the nearest enclosing instance of a tag

A route composes its path onto its parent's, and a definition cannot see
the instance enclosing it. Without this the author restates the nesting in
an argument at every level.

**The link exists; only the name for it is missing.** The runtime tree
nests a child instance under the enclosing one, and `$parent` navigation
already exists inside compiled dependency paths — it is author expressions
that refuse it (**(verified)**: `$parent.n` is *"Unknown reference"*).

**The parent alone is not enough**, which decides the shape.
**(verified)** Two routes written directly inside one another, or with a
plain `<div>` between them, give the child as a direct child scope; a
`<div>` carrying a value, an `:if` region or a `:for-each` each add a
link. The enclosing route is always an ancestor and never reliably the
parent, so the primitive is a walk: `$outer('rt-route')` is the nearest
ancestor instance of that tag, or `undefined`.

Three constraints follow:

- **It resolves at link time, not at read time.** A dependency is the path
  it names and `resolveDep` walks it, so a lookup performed per read emits
  no dependency and the route would never recompute when the outer one
  changes — which is the case interception exists for. Resolved when the
  scope links, it records a concrete path, and re-resolves on relink,
  which is what a replica or a returning `:if` region needs anyway.
- **It excludes itself**, or a definition's own default would find the
  instance it is defaulting. Hence bare content reading the enclosing
  route and `<rt-index>` content reading its own.
- **The tag needs a token.** The compiler has it — `Scope.usesTag` is
  *"the tag it is an instance OF"* — and the props do not: the `template`
  id they carry is per usage site, not per definition (**(verified)**: two
  instances of one tag carry `s7t` and `s8t`). One interned field per
  instance. The alternative, looking up by a declared value name, needs
  nothing new and turns a name collision into a silently wrong answer.

It reads no names, so the rule that a definition cannot read its caller's
names is untouched: this navigates structure, which is what `$parent`
already does. And it is wanted well outside routing — a field finding its
form, a cell finding its table, a control finding its theme.

### 5. `$aka` — the name this scope was given

`<rt-route :aka="us">` says "us" twice if the path has to be written as
well. `$aka` is the scope's own `:aka`, so a definition can default
`::path=${$aka}` and the author names a route once.

Cheaper than anything else here: a named scope already carries `"name"` in
its props, and it is fixed for the life of the scope, so no dependency
edge and no walk. Generic, too — a field defaulting its `name` attribute,
an anchor its id.

It never guesses. A name is a JS identifier and a URL segment need not be,
so `about-us` writes `::path`; a param says so with `::path=":id"` (or a
kit-level `::param` presence, meaning "a param named by `$aka`"). And a
route with neither a name nor a path consumes no segment — a layout route,
what React Router spells as a `<Route>` with no `path`.

---

## Settled

### 1. Components, not a directive

Directive tags are compiler built-ins — `DEFINE`, `SLOT`, `LOGIC`,
`INCLUDE`, `IMPORT`, `GROUP`, and nothing lets a package add one. So a
`<:route>` would make routing part of the language's surface in a project
positioned as not an application framework, and make one routing opinion
*the* opinion. That is the argument [TODO.md](../../TODO.md) settles as
*the router: a kit of its own*.

A component buys what the directive would have, for nothing:

- **nesting is structural.** A dangling parent cannot be expressed: the
  instance is where it sits.
- **params fall into descendant scope.** **(verified)** Content written
  inside a usage site reads the instance's values through its `:aka` name.
  This is `std-data`'s documented idiom (`:aka="d"`, then `${d.data}`)
  applied to a route.
- **a route hides its own subtree.** **(verified)** A definition can wrap
  `<:slot>` in an element carrying `:if` and render its content or not.
- **layout and route are one concept.** No `<Outlet>`, no `layout` file.

What it costs: the component's own base tag per route level, since a
`:logic` base tag cannot hold content (*"holds values, not markup"* —
**(verified)**). The *second* element it used to cost — a wrapper around
the `<:slot>` to carry the `:if` — is gone:
`<:group :if=${matched}><:slot /></:group>` is a region with no element of
its own, built in [group-regions.md](group-regions.md).

Rejected: **file-system convention** (Next, SvelteKit, Astro), and **a
route table as data**, which is a config file wearing HTML syntax and
turns "this route is inside that layout" into a reference to maintain.

### 2. The route set is sealed by the enumerating render

One render answers *what addresses exist*, and the set is final before any
address is rendered for output. This is Astro's `getStaticPaths` bargain:
arbitrary code, sealed result.

- The set may come from data, since a `:server-` value may fetch, which
  makes `/blog/:slug` an ordinary `:for-each`.
- That puts reproducibility where the fetch is rather than in the
  language: a build is as repeatable as what it read. Comptime stays
  hermetic and stays the default for anything that can be.
- The set must not depend on `$url`, or enumeration is self-referential.
  See [open question 3](#3-the-enumerating-render).

**That set is the interface.** Matching, prerendering, rewrite config and
dead-link checking all read it and never the route markup, which keeps a
second front end possible later and keeps the compiler ignorant of
routing. Being derived rather than written makes this stricter than a
framework's route table: a route no address reaches cannot exist. Call it
anything but "the manifest" —
[manifest.ts](../../packages/core/src/manifest.ts) is already what a
project asked for in `.markout/`.

### 3. Three delivery targets from one declaration

| target | route set | rendering |
|---|---|---|
| static prerender | enumerated, bound per output | a document per URL, folded to its chain |
| SSR | matched per request | a document per request, whole tree in the props |
| client-routed | the tree is already in the page | `:if` swaps the region, on an intercepted navigation (settled 5) |

Each enumerated URL is a separate render with `$url` bound to it, folded
by primitive 3 to that URL's chain; shared layout markup is duplicated
across outputs, which is normal for SSG and compresses away. The third row
needs no swap mechanism, wire format or partial props, since the routes
are in the document already and hydrated — at the cost of a payload
bounded by how much of the site one page's tree covers, which is the
author's choice (settled 4).

### 4. The split boundary is a file

A kit cannot split its own output, and does not have to: the docroot
already splits it. A page is a file, and a route subtree that should not
travel with the rest is a second page with its own route tree.

That gets what an `embed` / `separate` attribute would have, without the
attribute: whether a subtree can be swapped in place is a fact about the
destination, and a separate file *is* that fact. Inheritance comes free,
an `<a href>` across one is an ordinary link with nothing to remember, and
it is a no-op in the static build.

Crossing one costs a full navigation, and the parent chain restated at the
top of the second page — `<rt-route :aka="admin">` again, with its layout
pulled in by `<:include>`. The route tree does not span files, so what is
shared is shared as a fragment.

### 5. MPA by default; navigation is the Navigation API or a round trip

Static hosting, no runtime routing, and the router is not a dependency for
most sites. Cross-document view transitions are supported in Chromium and
Safari (check Firefox), so even the MPA build gets transition polish
without a client router.

On top of that, `if (window.navigation)` decides whether a navigation
stays in the document. Where it is absent a link is a link and the server
renders the next page, so the fallback is the browser rather than a
polyfill and a bug in the router degrades to *slow* rather than to a dead
link. A `preventDefault` and `pushState` router has no such floor.

It is the right event rather than a convenient one: the match is a value
derived from the URL, so traversals, form GETs and `location.assign` all
have to reach it, and a click handler on `<a>` sees none of them.
`intercept({ scroll, focusReset })` supplies the scroll and focus
behaviour a hand-rolled router gets wrong.

**The handler writes the URL and waits.** The new address goes into
`$url`, the match values recompute, `:if` swaps the regions. No swap
mechanism, no diff, no registry of routes to components.

**What to intercept follows from settled 4:** a file is the delivery
boundary, so a link to another page must not be intercepted — another
document, other props, another route tree. *Intercept when this page's own
live route skeleton matches the destination, and not otherwise*, so the
structure that enumerates at build time decides interception at runtime.
The ordinary guards apply too: `canIntercept`, download requests, non-GET
submissions, cross-origin.

Transitions stay one story: `document.startViewTransition` inside the
handler, the cross-document transition outside it. Where the API is
missing, `<script type="speculationrules">` prerenders likely destinations
and needs no router at all.

Support is Chromium since 2022, Firefox since 2025 and Safari most
recently — check before naming versions. And confirm that more than one
listener may intercept a single `navigate` event, which is what lets
router-kit and std-kit's address-bar state ([TODO.md](../../TODO.md)'s
layer 2) coexist without either owning the listener.

### 6. Params

Whole-segment, one route per segment. A route's segment is its `:aka` by
default (primitive 5), so `::path` is written only where the URL and the
name differ: `::path=":id"` for a param, or a segment that is not a JS
identifier. A route with neither is a layout route and consumes nothing.

A param is a value on the route's scope, read through its name.

**No `as` attribute.** The URL spelling of a whole-segment param is never
seen by anyone, so `::path=":id"` on a route named `:aka="id"` already
names it once; a second spelling would be a third meaning of `as` in the
language, after `<:include as="pre">` (wrap this file's text in a tag) and
`:for-as` (name this loop item). Shadowing — `/orgs/:id/users/:id` — is
not expressible either: the two routes are two named scopes.

**Matching is ranked, not source-order.** Static segments beat dynamic
ones regardless of document position; React Router moved to ranking in v6
for this reason. The parent is what ranks — a route matches on its own and
cannot see a peer — and how it reaches its children is
[open question 2](#2-sibling-ranking-and-reading-a-collection).

Multi-segment paths (`::path="user/:id"`) are sugar for the nested form,
not a second matching mechanism. Mid-segment params are out; if they are
ever wanted, use `URLPattern` braces so the matcher can lean on the
platform.

### 7. Enumerated or not, rather than `render="static" | "dynamic"`

A parameterized route either has its params in the enumerated address set
or it does not. The tree is sealed either way — this axis must never be
read as "routes may appear at runtime".

- Directionally constrained: an unenumerated route under an enumerated
  parent is fine, the reverse is not — a file cannot contain an ancestor
  that only resolves per request. A build error, not a site with holes.
- An unenumerated route makes the all-static target conditional, and the
  build must fail loudly rather than quietly skip an address.
- **Resist letting this grow revalidation semantics.** A staleness window
  here is the first step toward Next's caching model.

### 8. Runtime resolution is one page with the param bound from `$url`

A single artifact serves every `/user/*`. Where it is *resolved* —
server-rendered per request, or matched in the browser — is a deployment
property, not an authoring one: both run the same reactive graph from the
same starting state, and CSR is what SSR degrades to with no server.

Router-kit should emit host rewrite config (`_redirects`, `vercel.json`,
`_routes.json`, nginx `try_files`, the GitHub Pages `404.html` fallback)
from the enumerated set, since it knows which prefixes are unenumerated —
without it the setup fails silently on deploy. markout's own two servers
need the same and are covered by none of those files: see primitive 1.

### 9. Data via `<std-data>`

No router-specific loader concept. `:handle-_url` keys on the URL
*changing* rather than on mount, so a route param flowing into `::url`
gives navigation-triggered refetch for free.

Two things about it under a router, both **(verified)**:

- **`::client=${!$origin}` does not work and must not be recommended.** On
  a page built with no origin it fetches nothing in the browser and
  reports nothing: `client` is recomputed there, `$origin` is
  `location.origin`, so `client` is false, and the first `handle-_url`
  call is refused by `v && (client || _started)`. The datasource sits
  empty with `loading` false. (The SSR half works — with an origin at
  render the data is in the served markup.) The underlying problem is the
  one [TODO.md](../../TODO.md) names: *"is this render final?" is not
  something a page can ask*. Until it can, a route's datasource is written
  `::client` or not, deliberately.
- **The refetch is free; the transition is not.** `::data` is
  `_fetched ?? _served?.body`, so a failed refetch after a param change
  leaves the previous route's rows on screen beside an error, and nothing
  carries request identity, so two fast navigations resolve in whatever
  order the network returns. That is the kit's to solve, most likely by
  clearing on a param change rather than by changing `std-data`.

### 10. Per-page metadata needs no separate API

Prerendering a page is evaluating the reactive graph with that URL bound,
so `<title>`, canonical, OG tags and nav active-state are computed per
page from the same source. Next needs a metadata API for this; we do not.

The exception: an unenumerated route served as a shell ships the same head
for every URL under it, and anything reading it without executing JS sees
the shell. That belongs in what the mode costs, not in a link preview.

### 11. Explicitly excluded

- **Parallel routes and intercepting routes.** They exist to serve layout
  state surviving navigation, which we decline to guarantee.
- **Layout persistence as a semantic.** In-page navigation happens to keep
  a layout scope alive, because it is one document. Nothing may depend on
  it: the static build re-renders every page from nothing.
- **Multi-layer caching with implicit interactions.**
- **Non-HTML responses through a route.** Endpoints get a sibling
  mechanism (see open questions).

---

## What it cannot do

**A client-side subtree swap** — replacing part of a document with markup
from the server, without a navigation. The kit has in-page navigation
within a page's own tree and a full navigation across a file, nothing in
between. In exchange, everything a swap would have needed does not exist
here: no scope created fresh in the browser, no wire format, no partial
props.

**The cost that replaces it:** in SSR and in-page delivery a document
carries every route in *its own* tree, since `:if` decides at runtime what
shows. Splitting by file bounds that (settled 4) and the static target
avoids it entirely (primitive 3).

So the one thing that would want the compiler instead of a kit is a
subtree swap with layout state surviving it — the SPA question
[TODO.md](../../TODO.md) says markout has no mechanism for and may not
want.

## Invariants

These hold the delivery targets together, and will not survive as
documentation: the kit's own suite should assert them, or the static and
in-page builds diverge quietly and it surfaces as a bug report.

1. **Layout persistence is never semantic.** In-page navigation keeps a
   layout scope alive and the static build does not; no route may depend
   on which it got.
2. **Every route is enumerable.** A route sits outside its parent's match
   gate, or it is a stencil at enumeration time and prerenders for nobody.
   Exact test: the addresses a page reports must not change when a
   different one is bound.
3. **Binding mode never changes what is in scope.** A param resolves
   identically bound at build, at request, or from `location`. It does not
   say they behave alike — a build-bound param is constant, a runtime one
   reactive, and a route needing its param to change without a remount
   works in one target only.
4. **Folding never changes meaning.** Primitive 3 may only remove what the
   render would have removed anyway.
5. **No `:server-` value may depend on the route match.** It crosses
   frozen, so after an intercepted navigation it still holds the value it
   had when the document was served, where MPA re-derives it every time.
   `std-data` is safe by construction — `:handle-_url` refetches and the
   browser's result wins — a hand-written one is not.

---

## Open questions

Ordered by how much each could still move the design.

### 1. Reading a param from bare content

Content written directly inside a route lives on the route's own scope,
and `$outer` excludes itself — deliberately, or a definition's default
would find the instance it is defaulting. So bare layout content reads the
enclosing route, and only content one instance deeper (inside
`<rt-index>`, or any other component) reads its own.

The fallback is the name chain, `about.user.id.param`, which
**(verified)** is how nested named scopes address each other — the
compiler says *"`b` belongs to `<a>`; read it as `a.b`"* — and three
levels sharing one `:aka` all resolve to the outermost, so a shared name
is no way out.

Three ways to close it, in increasing order of language surface: accept
it, and let `<rt-index>` be where params are read, which is where page
content belongs anyway; hold params in one bag at the router root
(`${rt.params.id}`, flat, at the cost of a descendant writing into an
ancestor, which [question 2](#2-sibling-ranking-and-reading-a-collection)
keeps as its fallback); or a component binding a flat name into its
slotted content the
way `:for-as` binds a loop item — the only one that yields a bare `${id}`,
and a name-resolution feature that wants its own design note. The first is
a reasonable place to stop.

### 2. Sibling ranking, and reading a collection

Static beats dynamic (settled 6), but a route matches on its own and
nothing can see a peer: **(verified)** a definition cannot read its
slotted children, and `$outer` only navigates upward.

The answer that fits is that **the parent ranks**, through a downward
counterpart to `$outer` — `$inner('rt-route')`, the route-children of a
route, stopping at each rather than descending through it. Ranking is then
a pure function of what the children declare, with no writes anywhere.

Downward rather than sideways on purpose. A `$siblings` would be
structurally shaky: **(verified)** a `<div>` carrying a value, an `:if`
region or a `:for-each` between two routes each add a scope, so wrapping
one route in a condition makes it a cousin and it silently leaves the set.
"The route-children of this route" survives that refactoring; "my
siblings" does not.

Two things have to be answered before this is a primitive rather than a
question:

- **A collection is not a path.** `$outer` resolves at link time and
  records the concrete path it found, because a scope's ancestors are
  complete when it links. Its children are not — the first route links
  before its peers exist — and the set keeps changing as `:if` regions
  return and `:for-each` gains replicas. So a value over `$inner` depends
  on a *collection*, where a dependency is the path it names. The runtime
  knows when membership changes, since scopes link and unlink; the edge
  that would carry it does not exist.
- **Declarations, never conclusions.** A route may read a peer's segment
  and whether it is a param; it may not read whether that peer *matched*,
  or ranking is mutually recursive — A matches iff B does not, B matches
  iff A does not — and the graph has a cycle rather than an answer. The
  kit has to keep that rule; nothing in the language would enforce it.

The fallback, if the collection edge proves too costly: children
**register with the parent** through `$outer` as they link, and the parent
ranks the registry. Same ranking, but it reintroduces a descendant writing
into an ancestor during link or render — an ordering the descendant does
not control, where under an intercepted navigation only part of the graph
recomputes.

### 3. The enumerating render

Deriving the set costs a render per page that emits nothing, and three
things about it are unsettled.

**It must be stable.** An address set that reads `$url` is
self-referential and nothing prevents writing one. Cheap check: enumerate
twice with different addresses bound and compare. Whether that runs
always, in dev only, or never is open.

**It fetches.** The pass runs the same `:server-` values the address
renders will, so a data-driven route set pays for its data N+1 times
unless something caches between renders — a different cache from the
middleware's compiled pages, and possibly the kit's rather than the
build's.

**Nothing matches during it.** With no address bound every route misses
and the not-found branch renders, which must not read as a failed build.
So the kit needs a mode flag it would rather not have, or the build binds
a sentinel address and ignores the output — the same thing said less
honestly.

### 4. Authenticated routes

A served `std-data` fetch goes over HTTP to an absolute URL, carries no
headers, and lands in the markup as readable text. At SSR time the server
calls its own origin anonymously — a loopback hop per render — so anything
per-user must be `::client`, and authenticated routes are always
shell-plus-fetch.

SvelteKit's `load` and Remix's loaders resolve against a local handler
with the request's credentials in scope. Whether that gap is a deliberate
boundary or something a server-side resolution path later closes decides
whether router-kit serves content sites or also apps. Not a routing
question, but it arrives with the first application.

### 5. Not-found, errors, and status codes

Errors and not-found are routing concerns, need to nest, and must behave
the same across targets. `<rt-not-found>` is the obvious shape and costs
nothing.

The status code has no mechanism. `std-data` carries a failed fetch as a
*value*, not a rejection — correct for rendering — so `/user/999` renders
an error state with a 200 status and crawlers index it.

The static half answers itself: an address exists only because a route
produced it, so a page is written for `/user/999` only if the data said
999. The per-request half needs a page to be able to say what status it
is, which nothing in the language allows — one more candidate primitive,
and one more fact about a page.

A third case arrives with settled 5: an intercepted navigation has no
status at all, so the same address is a real 404 on a cold load and a soft
one after interception. Nothing in the kit fixes that; it belongs beside
the shell's head in settled 10, in what the mode costs.

### 6. Three smaller points

**Param constraints and typed links.** `/user/abc` must fail at *match*
time, not render time; as a kit that is a prop (`::match=${/^\d+$/}`) and
needs no design. The other end does: a link helper that knows a route's
params cannot be typed by the compiler, so a build step reading the
enumerated set checks the links in the output instead — weaker, since it
runs after the fact, and it needs nothing new.

**Endpoints.** API handlers, `sitemap.xml`, RSS, redirects. A markup tree
is an awkward home for "this URL returns JSON" and a component cannot be
one at all, so this is a build and CLI feature reading the same enumerated
set. The kit must not grow a non-HTML mode to reach it.

**Subtree file references.** One routes document does not survive 200
pages, and the two ways to break one up must not be confused: a second
**page** is a delivery boundary (settled 4); an `<:include>` is
organisation and changes nothing about what ships. The second is nearly
free — `<:include src>` already splices a fragment at preprocess time,
resolved relative to the including file, with `MAX_NESTING` guarding
cycles. Unspecified: whether a route's `::path` resolves relatively too,
and how provenance survives the splice.

### 7. Comptime enumeration, and whether it is wanted

Locales, content collections, pagination and docs versioning are all "map
over a list, emit addresses", which a `:for-each` over a `:server-` fetch
already does — so the motivating cases belong to the enumerating render
rather than to comptime. What is left for comptime is the hermetic half: a
build with nothing to fetch from, where the list is local files with
frontmatter. Worth having eventually, load-bearing for nothing here.

Watch the cross product either way: locales × versions × pages goes from
40 addresses to 40,000 without anything looking wrong, and every address
is a separate render. A route-count budget with a build warning is cheap
insurance.

### 8. Build-time scale

Two numbers: **renders**, N+1 per page rather than one per file, and
**document size**, since a page ships its whole tree — the second the
author's to control by splitting into pages, which makes it a question of
what the kit warns about and when.

Both want a synthetic test before this is load-bearing. An ordinary page
renders in ~2ms today, making 20,000 addresses a minute of build rather
than a wall, but that number is for a page and each of these renders
carries a whole route tree. Nothing here has been measured.

---

## What the two markers refuse

Probing this design turned up three failures for one mistake — an
attribute on a tag that is not an element — and they are now one message,
in `checkSlotAttributes` (stage1) and in the preprocessor's group
flattening:

- **`<:slot>` takes only `name`.** `:if` and `:else` used to crash the
  compiler (`owner.getAttribute is not a function` in
  `adoptSlottedScopes`, walking up from the slot's host into a
  `<template>`'s content fragment), `:for-each` crashed elsewhere on the
  same shape, and `:aka`, `:class-`, `:on-` and plain values compiled
  clean and did nothing.
- **`<:group>` carried anything at all in silence.** An active group now
  survives the preprocessor and stage1 answers it: a control attribute
  transfers onto the group's content where that content is a single
  element, and everything else says which of the two things a group has
  not got — an element to apply to, or a scope to live in.

The case a router wants — several nodes under one condition, with no
element of their own — is built, so a route gates its content with a
`<:group :if>` and no wrapper. See [group-regions.md](group-regions.md).

---

## Next step

None of this has met a real application. The pattern in framework history
is that routing designs survive the whiteboard and get reshaped by
whatever the first serious app needs — usually auth, usually pagination,
usually some layout that wants to persist.

The kit form makes that cheap to find out: `$url` and a wrapper `:if` are
enough to build the in-page half and port a site to it, with primitives 2
and 3 arriving when prerendering does and 4 and 5 buying ergonomics a
prototype can do without. **Porting an existing site to a prototype
router-kit will teach more than another round of design**, and it can
start before anything in the compiler changes.

Three things it settles that no further reading will: what a value costs
when it depends on a *collection* of scopes rather than on a path
(question 2); whether a descendant may write into an ancestor during a
render, where question 1's bag and question 2's fallback both end; and
whether `$outer` resolved at link time keeps a param reactive across an
intercepted navigation.
