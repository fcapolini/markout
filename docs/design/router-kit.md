# router-kit — design notes

**Status: exploratory.** Nothing here is implemented. This records where the
design currently stands, what has been decided and why, and what is still
open. The open questions are as much the point of the document as the
decisions.

**Revised: the router is a kit, and stays one.** The first draft declared
routes with a `<:route>` directive and expanded them in a new compiler
phase. That is a language change wearing a kit's name, and it quietly
overturned the settled position in [TODO.md](../../TODO.md) — *the router:
a kit of its own* — without arguing it. What follows is the kit form:
nested **components**, three additions to the language that are not about
routing, and one feature given up. What the kit cannot reach is recorded
in [Out of reach as a kit](#out-of-reach-as-a-kit) rather than deleted,
because that is the case for ever revisiting the compiler form.

Claims marked **(verified)** were run against the compiler at `ce9cd96`
rather than reasoned about. The probes were throwaway suites next to
`packages/core/test/render/hydrate.test.ts`, which is the recipe they used.

---

## The shape

Routes are nested component instances. Nesting in the markup *is* nesting in
the URL, and *is* layout composition — the property the first draft wanted,
and it needs no directive to have it.

```html
<:import src="/npm/@markout-lang/router-kit/all.htm" />

<rt-route :aka="about" ::path="about">
  <:include src="about-top.htm" />

  <rt-index>
    <p>Pick a section.</p>
  </rt-index>

  <rt-route :aka="us" ::within=${about} ::path="us">
    <:include src="about-us.htm" />
  </rt-route>

  <rt-route :aka="user" ::within=${about} ::path="user">
    <rt-route :aka="id" ::within=${about.user} ::path=":id">
      <std-data :aka="d" ::url="/api/user/${about.user.id.param}" />
      ...
    </rt-route>
  </rt-route>

  <:include src="about-bottom.htm" />
</rt-route>
```

Content no nested route encloses is layout: it renders wherever its route
does. A route renders its own page's content only where `<rt-index>` says
so. Both are ordinary components, and the difference between them is where
the author put a child.

**A route's match gates its content, never its child routes.** Layout and
`<rt-index>` are inside the gate; the nested `<rt-route>` elements are
outside it and always live, rendering nothing until they match themselves.
This is a requirement rather than a style: **(verified)** a `:server-`
value inside a false `:if` reaches page state as nothing, because a hidden
region is a stencil and state collection skips those — so a route behind
its parent's gate cannot be enumerated, and would silently never
prerender. The skeleton stays live in every render, which is also what
in-page navigation needs to be there.

Two things in that markup are the kit's ceremony rather than its design,
and they are the honest cost of staying a kit: **`::within`**, because a
component cannot see the instance enclosing it, and **`about.user.id.param`**,
because names nest as paths. Both are [open question 1](#1-the-name-tax).

---

## What the language has to grow

Three additions. None of them mentions routing, and each is wanted for
other reasons. Nothing at all works without the first; prerendering needs
the other two, and in-page routing needs neither.

### 1. `$url`, and a build that can bind it per output

Designed already as [TODO.md](../../TODO.md)'s `$url` entry: the path and
the query mean the same thing on both sides of an isomorphic render, which
is the bar `$origin` cleared. Every route in the tree above is a match
against it.

The addition this design makes is on the build side: `markout build` must
be able to render **one source page at many URLs**. Today it walks the
docroot and renders each `.html` once ([build.ts](../../packages/core/src/build.ts)),
and the express middleware compiles strictly by pathname
([middleware.ts](../../packages/express/src/middleware.ts)). Neither is
language; both have to learn that a page can answer an address that is not
its filename.

**And `$url` has to be live rather than supplied.** A global today is
handed to the context once and linked as a fixed source — that is what
`$origin` is, and [render.ts](../../packages/core/src/render/render.ts)
says so: *a supplied object is fixed for the life of the render, so it
links as an inert source the way the built-in globals do*. An intercepted
navigation (settled 7) changes the document's URL without a new document,
so the runtime has to write `$url` when that happens and let its readers
recompute. Note how little core learns from this: that a URL can change
without a new document, which is a fact about browsers rather than about
routers. The server side is untouched — one render sees one address.

### 2. A render handing a value back to the build

`renderPage` returns errors and nothing else; the state it collected from
`:server-` values is serialized into the page and otherwise dropped. It
should be returned. That is the whole of the addition — and it is what
replaces the first draft's compiler-held manifest.

The addresses come out of a render rather than out of the source, and that
is not a workaround. An address set is a fact about a render:
[value-transfer.md](value-transfer.md) draws exactly this line for
`:server-` values — *"the props are a function of the source and could be
cached, while this is a function of the request and never can be"* — which
is also why comptime could not have held it, `:const-` reading only
literals and other constants.

So the enumerating pass is: render the page once with no address bound,
read the state, union every route's address out of it. **(verified)**
State is keyed by scope uid, so nothing has to aggregate up the tree —
which matters, since names resolve downward only and a router root cannot
see its descendants. Two nested live routes report
`{"s4":{"addr":"/about"},"s6":{"addr":"/about/us"}}`, and a `:for-each`
over three ids reports `s4-0`, `s4-1`, `s4-2` separately, with the replica
path in the uid. Generated route sets enumerate for free, and the uid is
provenance: it resolves through the props and the dev `locs` map to the
file and line the route was written on.

A build step wanting any other fact out of a render — sitemap, feeds, cache
keys — comes through the same door. The compiler learns nothing about
routing, and this time neither does the comptime realm.

### 3. Folding a comptime `:if`, and dropping the dead branch

**(verified)** A `:const-` condition already folds: with
`:const-here=${"/about"}`, the value `:if=${here === "/about"}` compiles to
`$=>'/about'==='/about'`. But the losing branch still ships — its stencil
stays in the markup and its expression stays in the props.

Without this, prerendering is dishonest: a page prerendered at forty
addresses ships all forty routes' markup forty times, because `:if` is what
a kit hides an unmatched route with. With it, compiling a page once per URL
leaves that URL's chain and nothing else, which is exactly what the first
draft's route-expansion phase was for.

The precedent is in the stage that would host it.
[`foldConstantText`](../../packages/core/src/compiler/stages/stage5-comptime.ts)
already makes this argument for text — *"all that changes is WHEN"* — and
the soundness reasoning transfers unchanged. Note the one thing it must
not do: an `:if` region's stencil is what a client-side instantiation
renders from, so folding is sound only where the condition is constant
for the whole life of the page, which a build-bound `$url` is and a
runtime one is not.

### And a fourth, only if the name tax is unacceptable

A component binding a flat name into its slotted content, the way
`:for-as` binds a loop item. It is what would turn `about.user.id.param`
into `id`. Deliberately not counted above: the kit works without it, and
it is a name-resolution feature that wants its own design note rather than
a routing one. See [open question 1](#1-the-name-tax).

---

## Settled

### 1. Components, not a directive

`<:route>` was rejected on the second pass, having been chosen on the
first. Directive tags are compiler built-ins — `DEFINE`, `SLOT`, `LOGIC`,
`INCLUDE`, `IMPORT`, `GROUP`, and nothing lets a package add one — so a
`<:route>` makes routing part of the language's surface, in a project
positioned as not an application framework, and makes one routing opinion
*the* opinion. That is the argument TODO.md already settled and this
document briefly forgot.

What the directive was supposed to buy, and what a component turns out to
buy for nothing:

- **nesting is structural.** A dangling parent cannot be expressed either
  way: the instance is where it sits.
- **params fall into descendant scope.** **(verified)** Content written
  inside a usage site reads the instance's values through its `:aka` name.
  This is `std-data`'s documented idiom (`:aka="d"`, then `${d.data}`)
  applied to a route.
- **a route hides its own subtree.** **(verified)** A definition can wrap
  `<:slot>` in an element carrying `:if` and render its content or not.
- **layout and route are one concept.** No `<Outlet>`, no `layout` file.

What a component costs that the directive did not: a wrapper element per
route level (a `:logic` base tag cannot hold content — *"holds values, not
markup"* — **(verified)**), and the two pieces of ceremony named under
[The shape](#the-shape).

Still rejected, and for the original reason: **file-system convention**
(Next, SvelteKit, Astro), and **a route table as data**, which is a config
file wearing HTML syntax and turns "this route is inside that layout" into
a reference to maintain.

### 2. The route set is sealed by the enumerating render

Unchanged in spirit, changed in mechanism. One render answers *what
addresses exist*, and the set is final before any address is rendered for
output. This is Astro's `getStaticPaths` bargain: arbitrary code, sealed
result.

Consequences accepted:

- The set may come from data, since a `:server-` value may fetch. That is
  more than the first draft could offer — a hermetic comptime list cannot
  read a CMS — and it makes `/blog/:slug` an ordinary `:for-each`.
- Which puts the reproducibility question where the fetch is rather than in
  the language: a build is as repeatable as what it read. Comptime stays
  hermetic and stays the default for anything that can be.
- The set must not depend on `$url`, or enumeration is self-referential.
  See [open question 2](#2-the-enumerating-render).

### 3. The enumerated address set is the interface

Matching, prerendering, rewrite config and dead-link checking all read the
enumerated set. Nothing downstream reads the route markup, which is what
keeps a second front end (a data form, a generator) possible later, and
what keeps the compiler ignorant of routing.

It is derived rather than written, which is the one place this design is
stricter than a framework's route table: a route that no address reaches
cannot exist, because the addresses come from the routes.

Note the name: **not** "the manifest". [manifest.ts](../../packages/core/src/manifest.ts)
is already what a project asked for in `.markout/`, and two canonical
manifests in one compiler is a bad week later.

### 4. Three delivery targets from one declaration

| target | route set | rendering |
|---|---|---|
| static prerender | enumerated, bound per output | a document per URL, folded to its chain |
| SSR | matched per request | a document per request, whole tree in the props |
| client-routed | the tree is already in the page | `:if` swaps the region, on an intercepted navigation (settled 7) |

For the static target each enumerated URL is a separate render with `$url`
bound to it, folded by primitive 3 to that URL's chain. Shared layout
markup is duplicated across outputs; that is normal for SSG and compresses
away.

The third row is the one the kit form changes most, and improves: there is
no swap mechanism, no wire format and no partial props, because the routes
are all in the document already and hydrated. The cost is the payload, and
it is bounded by how much of the site one page's tree covers — which is the
author's choice, since the boundary is a file (settled 5).

### 5. The split boundary is a file

The first draft made this an attribute — `embed` / `separate`, inherited,
declared on the route. A kit cannot split its own output, and does not have
to: the docroot already splits it. A page is a file, and a route subtree
that should not travel with the rest is a second page with its own route
tree.

That keeps the property the attribute was for and drops the attribute. The
argument for putting it on the destination rather than on every link was
that *whether a subtree can be swapped in place is a fact about the
destination* — a separate file is that fact, and an `<a href>` across one is
an ordinary link with nothing to remember. Inheritance comes free:
everything under the second page is in the second page. And it is a no-op in
the static build, for the same reason it was before.

What crossing one costs: a full navigation, which is the position this
project already defends with the compile numbers behind it; and the parent
chain restated at the top of the second page — `<rt-route :aka="admin"
::path="admin">` again, with the layout it wraps pulled in by `<:include>`.
The route tree does not span files, so what is shared is shared as a
fragment, which is how everything else in markout is shared.

### 6. MPA by default, in-page routing opt-in

Static hosting, no runtime routing, and the router is not a dependency for
most sites. Cross-document view transitions are supported in Chromium and
Safari (check Firefox before leaning on it), so the MPA build gets
transition polish without a client router — which removes the most common
reason to reach for one.

### 7. Navigation is the Navigation API, or a round trip

`if (window.navigation)` decides whether a navigation stays in the
document. Where it is absent a link is a link and the server renders the
next page — the position settled 6 already defends — so the fallback is the
browser rather than a polyfill, and a bug in the router degrades to *slow*
rather than to a dead link. A `preventDefault` and `pushState` router has
no such floor.

It is the right event rather than a convenient one. The match is a value
derived from the URL, so everything that changes the URL has to reach it —
traversals, form GETs, `location.assign` — and a click handler on `<a>`
sees none of those. `intercept({ scroll, focusReset })` then supplies the
scroll and focus behaviour a hand-rolled router gets wrong.

**The handler writes the URL and waits.** The new address goes into
`$url`, the match values recompute, `:if` swaps the regions. No swap
mechanism, no diff, no registry of routes to components — which is
[Out of reach as a kit](#out-of-reach-as-a-kit) arrived at from the
browser's side.

**What to intercept follows from settled 5.** A file is the delivery
boundary, so a link to another page must not be intercepted: another
document, other props, another route tree. The rule is *intercept when
this page's own live route skeleton matches the destination, and not
otherwise* — so the structure that enumerates at build time decides
interception at runtime. The ordinary guards apply as well: `canIntercept`,
download requests, non-GET submissions, cross-origin.

**Transitions stay one story.** `document.startViewTransition` inside the
handler where the navigation was intercepted, and settled 6's
cross-document transition where it was not.

Support is Chromium since 2022, Firefox since 2025 and Safari most
recently — check before this document names versions, the same caveat
settled 6 carries. Where it is missing,
`<script type="speculationrules">` can prerender the likely destinations,
which makes the round trip a better answer than it sounds and needs no
router at all.

One thing to confirm before relying on it: that more than one listener may
intercept a single `navigate` event. That is what would let router-kit and
std-kit's address-bar state ([TODO.md](../../TODO.md)'s layer 2) coexist
without either one owning the listener.

### 8. Params

Whole-segment: `::path=":id"`, one route per segment. A param is a value on
the route's scope, read through its name.

**No `as` attribute.** The URL spelling of a whole-segment param is never
seen by anyone, so `::path=":id"` on a route named `:aka="id"` already
names it once; a second spelling would be a third meaning of `as` in the
language, after `<:include as="pre">` (wrap this file's text in a tag) and
`:for-as` (name this loop item). The shadowing case the first draft used
to justify it — `/orgs/:id/users/:id` — is not expressible: the two routes
are two named scopes.

**Matching is ranked, not source-order.** Static segments beat dynamic ones
regardless of document position. React Router moved to ranking in v6 for
exactly this reason. In the kit this is the parent's job: it decides which
of its children matched, rather than each child deciding for itself.

Multi-segment paths (`::path="user/:id"`) are sugar for the nested form,
not a second matching mechanism. Mid-segment params are out; if they are
ever wanted, use `URLPattern` braces so the matcher can lean on the
platform.

### 9. Enumerated or not, rather than `render="static" | "dynamic"`

A parameterized route either has its params in the enumerated address set
or it does not. The tree is sealed either way — this axis must never be read
as "routes may appear at runtime".

- Directionally constrained: an unenumerated route under an enumerated
  parent is fine; the reverse is not, because a file cannot contain an
  ancestor that only resolves per request. This should be a build error
  with a clear message rather than a site with holes.
- An unenumerated route makes the all-static target conditional, and the
  build must fail loudly rather than emit a page for an address nothing
  answered.
- **Resist letting this grow revalidation semantics.** A staleness window
  here is the first step toward Next's caching model, which is the part of
  Next most worth not copying.

### 10. Runtime resolution is one page with the param bound from `$url`

A single artifact serves every `/user/*`. Where it is *resolved* —
server-rendered per request, or matched in the browser — is a deployment
property, not an authoring one. Because markout is isomorphic, both run the
same reactive graph with the same starting state; CSR is what SSR degrades
to when there is no server.

Router-kit should emit host rewrite config (`_redirects`, `vercel.json`,
`_routes.json`, nginx `try_files`, the GitHub Pages `404.html` fallback)
from the enumerated set, since it knows which prefixes are unenumerated.
Without it this setup fails silently on deploy. markout's own two servers
need the same thing and are not covered by any of those files: see
primitive 1.

### 11. Data via `<std-data>`

No router-specific loader concept. `:handle-_url` keys on the URL
*changing* rather than on mount, so a route param flowing into `::url`
gives navigation-triggered refetch for free.

Two corrections to what the first draft claimed here, both **(verified)**:

- **`::client=${!$origin}` does not work, and must not be recommended.**
  On a page built with no origin it fetches nothing in the browser and
  reports nothing: `client` is recomputed there, `$origin` is
  `location.origin`, so `client` is false, and the first `handle-_url`
  call is refused by `v && (client || _started)` with `_started` still
  false. The datasource sits empty with `loading` false. The SSR half of
  the idiom does work — with an origin at render, the data is in the
  served markup. [TODO.md](../../TODO.md) already names the underlying
  problem: *"is this render final?" is not something a page can ask, and
  `$origin`'s absence approximates it*. Until that primitive exists, a
  route's datasource is written `::client` or not, deliberately.
- **The refetch is free; the transition is not.** `::data` is
  `_fetched ?? _served?.body`, so a failed refetch after a param change
  leaves the previous route's rows on screen beside an error, and nothing
  carries request identity, so two fast navigations resolve in whatever
  order the network returns. Under a router that is a stale-page bug
  rather than a data-loading detail, and it is the kit's to solve — most
  likely by clearing on a param change rather than by changing
  `std-data`.

### 12. Per-page metadata needs no separate API

Prerendering a page is evaluating the reactive graph with that URL bound,
so `<title>`, canonical, OG tags and nav active-state are computed per page
from the same source. Next needs a metadata API for this; we should not.

The exception is unchanged: an unenumerated route served as a shell ships
the same head for every URL under it, and anything reading it without
executing JS sees the shell. Document it as part of what that mode costs,
rather than letting it be discovered from a link preview.

### 13. Explicitly excluded

- **Parallel routes and intercepting routes.** They exist to serve layout
  state surviving navigation, which we decline to guarantee.
- **Layout persistence as a semantic.** In-page navigation happens to keep
  a layout scope alive, because it is one document. Nothing may depend on
  it: the static build re-renders every page from nothing.
- **Multi-layer caching with implicit interactions.**
- **Non-HTML responses through a route.** Endpoints get a sibling
  mechanism (see open questions).

---

## Out of reach as a kit

One feature from the first draft does not survive the change, and one cost
arrives with it. This section is the whole remaining case for the compiler
form, kept where it can be argued rather than rediscovered.

**A client-side subtree swap**: replacing part of a document with markup
from the server, without a navigation. The kit gets in-page navigation
within a page's own tree and a full navigation across a file, and nothing
in between. This is also what dissolves the first draft's largest open
item — there is no scope created fresh in the browser, so there is no wire
format and no partial props to design.

**The cost:** in SSR and in-page delivery, a document carries every route in
*its own* tree, because `:if` decides at runtime what shows. Splitting by
file bounds it (settled 5), so the ceiling is one page's tree rather than
the whole site's, and the static target does not pay it at all given
primitive 3.

Which leaves the compiler form wanted for one thing only: a subtree swap
with layout state surviving it. That is the SPA question
[TODO.md](../../TODO.md) says markout does not have a mechanism for and may
well not want — so the honest reading is that the first draft's
route-expansion phase, chunk attribute and manifest IR were machinery for a
feature this project has not decided it wants.

## Invariants

These hold the delivery targets together. They will not survive as
documentation — the kit's own suite should assert them, or the static and
in-page builds will diverge quietly and it will surface as a bug report.

1. **Layout persistence is never semantic.** In-page navigation keeps a
   layout scope alive; the static build does not. No route may depend on
   which one it got.
2. **Every route is enumerable.** A route element sits outside its
   parent's match gate, or it is a stencil at enumeration time and
   prerenders for nobody. This is the one invariant with a cheap and exact
   test: the addresses a page reports must not change when a different one
   is bound.
3. **Binding mode never changes what is in scope.** A param resolves
   identically whether it was bound at build, at request, or from
   `location`. Note what this does *not* say: a build-bound param is
   constant and a runtime one is reactive, and a route that depends on its
   param changing without a remount works in one target only.
4. **Folding never changes meaning.** Primitive 3 may only remove what the
   render would have removed anyway.
5. **No `:server-` value may depend on the route match.** It crosses
   frozen, so after an intercepted navigation it still holds the value it
   had for the address the document was served at, while the same page
   under MPA has the server re-derive it every time. `std-data` is safe by
   construction — `:handle-_url` refetches and the browser's result wins —
   and a hand-written one is not.

---

## Open questions

Ordered by how much each could still move the design.

Three questions are gone rather than unanswered, and it is worth saying why
so nobody re-derives them. *Data across a client-side subtree swap* — the
first draft's largest item — dissolved with the swap: there is no scope
created fresh in the browser, so `std-data`'s first-call logic is never
asked a question it cannot answer. *Index content versus layout content*,
which was blocking, is answered by `<rt-index>` being a component: bare
content is layout because it is a sibling, index content is wrapped
because it is a child. And *drift between the route tree and the address
list*, which this document carried for one draft, went with the
declaration: enumerating from a render leaves one source of truth, so
there is no divergence to check for.

### 1. The name tax

Two costs, one cause: a component cannot see the instance enclosing it
(**(verified)**: `$parent` is refused in author expressions), and named
scopes nest as paths rather than flattening (**(verified)**: the compiler
says *"`b` belongs to `<a>`; read it as `a.b`"*, and three levels sharing
one `:aka` all resolve to the outermost).

So every nested route repeats its parent (`::within=${about.user}`) and
every expression inside one spells the chain (`about.user.id.param`).
Moving a route in the tree edits its descendants — in a design whose whole
argument is that nesting is structural.

Three ways out, in increasing order of language surface: accept it and let
the kit's own conventions keep trees shallow; let the kit hold params in
one bag at the router root (`${rt.params.id}`, flat, at the cost of a
descendant writing into an ancestor's value during a render, which wants
its own proof); or the fourth primitive, a component binding a flat name
into its slotted content the way `:for-as` does. The third is the right
answer if the tax is judged unacceptable, and it should be designed as a
name-resolution feature rather than smuggled in as a routing one.

### 2. The enumerating render

Deriving the set costs a render per page that emits nothing, and three
things about it are unsettled.

**It must be stable.** An address set that reads `$url` is
self-referential, and nothing prevents writing one. The cheap check is to
enumerate twice with different addresses bound and compare; whether that
runs always, in dev only, or never is open.

**It fetches.** The enumerating pass runs the same `:server-` values the
address renders will run, so a data-driven route set pays for its data
N+1 times unless something caches between renders. The middleware already
caches compiled pages; this is a different cache, of a render's fetches
within one build, and it may be the kit's rather than the build's.

**Nothing matches during it.** With no address bound, every route misses
and the not-found branch renders. That pass must not be read as a failed
build, which means the kit needs a mode flag it would rather not have —
or the build binds a sentinel address that matches nothing and ignores the
output, which is the same thing said less honestly.

### 3. Authenticated routes

A served `std-data` fetch goes over HTTP to an absolute URL, carries no
headers, and lands in the markup as readable text. So at SSR time the
server calls its own origin anonymously, a loopback hop per render, and
anything per-user must be `::client` — meaning authenticated routes are
always shell-plus-fetch.

SvelteKit's `load` and Remix's loaders resolve against a local handler with
the request's credentials in scope. Whether that gap is a deliberate
boundary or something a future server-side resolution path closes decides
whether router-kit serves content sites or also apps. Unchanged by the
kit form: it was never about routing.

### 4. Not-found, errors, and status codes

Errors and not-found are routing concerns, need to nest, and must behave
the same across targets. `<rt-not-found>` is the obvious shape and costs
nothing.

The status code is the part with no mechanism. `std-data` carries a failed
fetch as a *value*, not a rejection — correct for rendering — so
`/user/999` renders an error state with a 200 status, crawlers index it,
and the prerender step writes a file for a URL that should not exist.

The static half now answers itself: an address exists only because a route
produced it, so a page is written for `/user/999` only if the data said
999. The per-request half needs a page to be able to say what status it
is, and nothing in the language lets it — a fourth candidate primitive,
smaller than it sounds, one more fact about a page.

And a third case arrives with settled 7: an intercepted navigation has no
status at all. The same address is a real 404 on a cold load and a soft
one after interception, in the same browser, on the same page. Nothing in
the kit can fix that; it belongs in what interception costs, beside the
shell's head in settled 12.

### 5. Param constraints and typed links

`/user/abc` must fail at *match* time, not render time. As a kit this is a
prop (`::match=${/^\d+$/}`) and needs no design. What is left is the other
end: a link helper that knows a route's params is what makes the constraint
worth having, and a kit's helper cannot be typed by the compiler. A build
step reading the enumerated set can check every link in the output instead,
which is weaker (it runs after the fact) and cheaper (it needs nothing new).

### 6. Endpoints

API handlers, `sitemap.xml`, RSS, redirects. A markup tree is an awkward
home for "this URL returns JSON", and a component cannot be one at all.
This is a build and CLI feature reading the same enumerated set, and the
kit must not grow a non-HTML mode to reach it.

### 7. Comptime enumeration, and whether it is still wanted

Much smaller than the first draft made it. Locales, content collections,
pagination and docs versioning are all "map over a list, emit addresses",
and a `:for-each` over a `:server-` fetch already does that — so the
motivating cases are served by the enumerating render, not by comptime.

What is left for comptime is the hermetic half: a build with nothing to
fetch from, where the list is local files with frontmatter. Worth having
eventually, no longer load-bearing for anything specified here.

Watch the cross product either way: locales × versions × pages goes from 40
addresses to 40,000 without anything looking wrong. A route-count budget
with a build warning is cheap insurance, and here it protects something
sharper than build time — every address is a separate render.

### 8. Build-time scale

The first draft worried about holding every route in memory. The kit form
replaces that with two different numbers: **renders**, N+1 per page rather
than one per file, and **document size**, since a page ships its whole
tree. The second is the author's to control by splitting into pages, which
makes it a question of what the kit should warn about and when.

Both want a synthetic test before this design is load-bearing. An ordinary
page renders in ~2ms today, which makes 20,000 addresses a minute of build
rather than a wall — but that number is for a page, and every one of those
renders carries a whole route tree. Nothing here has been measured.

### 9. Subtree file references

One routes document does not survive 200 pages, and there are now two ways
to break one up which must not be confused: a second **page** is a delivery
boundary (settled 5), while an `<:include>` is organisation and changes
nothing about what ships.

The organisation half is closer to answered than the first draft thought:
`<:include src>` already splices a fragment at preprocess time, resolved
relative to the including file, with `MAX_NESTING` guarding cycles. What is
unspecified is whether a route's `::path` should resolve relatively too, and
how provenance survives the splice so a diagnostic names the file the author
wrote.

---

## What the probing turned up

Two compiler bugs, found writing the probes above rather than looked for,
and both are what a kit author writing this router hits in week one:

- **`<:slot :if=${...}>` crashes the compiler**:
  `TypeError: owner.getAttribute is not a function` at
  [stage1-load.ts](../../packages/core/src/compiler/stages/stage1-load.ts)
  in `adoptSlottedScopes`. An internal error rather than a diagnostic.
- **`:if` on `<:group>` is silently ignored.** The content renders. It is
  the natural way to write a wrapper-less conditional region — which is
  exactly what a route wants, to avoid a wrapper element per level — and it
  fails the way [silent-failures.md](silent-failures.md) exists to prevent.

---

## Next step

None of this has met a real application. The pattern in framework history
is that routing designs survive the whiteboard and get reshaped by whatever
the first serious app needs — usually auth, usually pagination, usually
some layout that wants to persist.

The kit form makes that cheaper to find out, which is the strongest
argument for it beyond where opinions may live: `$url` and a wrapper `:if`
are enough to build the in-page half and port a site to it, with primitives
2 and 3 arriving only when prerendering does. **Porting an existing site to
a prototype router-kit will teach more than another round of design**, and
it can now start before anything in the compiler changes.
