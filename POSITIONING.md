# Positioning

How Markout is presented, who it is presented to, and why. This is about the
pitch and the order things get built in — the design rationale itself lives in
[README.md](README.md) and [docs/](docs/).

## The pitch

**Markout is an HTML extension that adds modularity, reactivity and
isomorphism to plain HTML.** Not an application framework.

Everything below follows from that sentence.

## Why not "a reactive web framework"

Adoption cost in the framework market is dominated by ecosystem, hiring and
tooling — not by language design. A better framework does not win on being
better; it has to be dramatically better on an axis people already feel, and
it still has to out-ecosystem the incumbent. That contest is unwinnable, so
the correct move is not to enter it.

The extension framing changes what the reader is being asked for. A framework
asks them to start over. An extension asks them to add an attribute to a page
they already have, and lets them stop at any point. It is additive,
low-commitment and reversible.

The framing has to stay honest about one thing: Markout is an extension in
*adoption cost*, not in *conceptual surface*. There is a model to learn —
scopes, lexical resolution, `<:define>`. It is small, and the "handful of
rules" section of the homepage states it plainly rather than implying there is
nothing to learn.

## Which of the three -isms to lead with

Only **modularity** and **reactivity** are felt pains. Nobody writing a
Bootstrap page wakes up wanting isomorphism — it is a benefit they do not yet
know to want, and leading with three -isms when two are felt dilutes the two.

Isomorphism still earns a place mid-page rather than in the headline, because
it lands unusually well with *this* audience: Bootstrap skews toward
server-rendered Rails / Django / Laravel / PHP shops that already produce HTML
on the server and want sprinkles of interactivity on top. SSR-native is a
better fit there than it would be for a general audience.

## Why Bootstrap users are the beachhead

Bootstrap users have **already demonstrated they will refuse a framework in
order to keep their component choice**. That is the "two decisions, not one"
argument from the README in its most concrete form: picking Ant Design means
picking React, picking Vuetify means picking Vue — and these users declined
that trade. They chose a CSS component library precisely so the framework
question would stay open.

They are therefore pre-qualified for the pitch, and they arrive with the exact
problem Markout solves: having chosen components that are just markup, they
now have to add presentation logic to them by hand.

The risk of leading with one CSS framework is being typecast as "a Bootstrap
thing" when `shoelace-kit` and `webawesome-kit` exist too. Mitigated by
keeping the decoupling argument visible on the page: Bootstrap is *the first
kit*, not the point.

## The competitor is Alpine, not React

**This is the most common way to get the pitch wrong.** A Bootstrap user
asking "how do I add logic to this page" is not choosing between Markout and
React. They are choosing between Markout and **Alpine.js**, and secondarily
**htmx**. Arguing against React/Vue/Angular persuades people already inside
framework-land — which is not this audience.

Alpine is attribute-based, needs no build step, drops into plain HTML, and
pairs with Bootstrap constantly. Every informed visitor makes that comparison
silently, so the page should make it explicitly rather than leave the answer
uncontrolled.

The honest differences:

| | Alpine.js | htmx | Markout |
| --- | --- | --- | --- |
| Behavior written in HTML attributes | yes | yes | yes |
| What it needs to run | a `<script>` tag | a `<script>` tag | Node serving the page, or a build step |
| Mistakes caught before the page loads | no, silent at runtime | n/a | yes, with a file and a line |
| Content present in the served HTML | no, `x-cloak` hides the gap | yes, the server wrote it | yes, in both delivery modes |
| Same source renders on the server | no, client only | server owns the HTML | yes |
| Reusable components in markup | `x-data` + `<template>` | server-side partials | `<:define>` + `<:slot>` |
| Parametric CSS | inline styles, or CSS variables set inline | whatever the server renders | `${…}` inside `<style>` |
| Interaction without a server round-trip | yes | no, by design | yes |

And the honest costs: Alpine's ecosystem, community and documentation are far
larger, and it is a mature project. Alpine also asks for strictly less to get
started — one `<script>` tag, on any host, behind any backend — where Markout
asks for Node in the request path or a build step (see below). htmx is solving a
different problem — server-driven UI — and composes fine with either. Where the
React/Vue/Angular comparison still belongs is in explaining *why the reader is
on Bootstrap in the first place*, not in explaining what to use for logic.

## Delivery decides how big the beachhead actually is

This is the one place where the audience above and the product could come apart,
so it is worth stating plainly rather than discovering it in a launch thread.

The section on isomorphism says Bootstrap skews toward server-rendered Rails /
Django / Laravel / PHP shops. That is right, and it is exactly the audience that
**cannot put a Node process in front of their app**. For them, "add an attribute
to a page you already have" is not what serving Markout from Node asks; that is
a stack change, which is the framework-sized commitment the extension framing
exists to avoid.

Two delivery modes are what keep the pitch true for both halves:

- **Node hosts get isomorphism.** The render runs per request, `:server-` values
  and served datasources work, SSR comes for free.
- **Everyone else compiles ahead of time** and deploys static assets, keeping
  their backend untouched. Logic still runs in the browser, and — unlike Alpine
  — the markup is already in the file, so there is no `x-cloak` gap. What such a
  page gives up is only what a request would have supplied.

So the honest claim is not "no build step". It is *no build step if Node serves
your pages, and no server if you would rather build them* — which covers both
halves of the audience and concedes nothing untrue to either.

`markout build <docroot> <outdir>` exists as of 2026-08-17, which is what makes
the second half of that claim true rather than planned. It was treated as a
positioning blocker rather than a feature request, and built ahead of the
language work queued in [TODO.md](TODO.md), on exactly that basis.

A built page also refuses what it cannot deliver, as of the same day: a
`:server-` value that fails fails the build, and its page is not written, since
such a value crosses frozen and the browser cannot make up for it. So the
claim above is safe to make in public -- "compile ahead of time and deploy
static assets" cannot quietly produce a page with no data in it. A datasource
that needed a server says so, and names the one-word fix (`:client`).

## The kit has to prove reactivity, not boilerplate removal

The `demo/bootstrap` before/after — 28 lines of hand-wired navbar against a
`<:import>` and a list of links — is the strongest asset on the homepage. But
everything it demonstrates is achievable with server includes, Jinja, Eleventy
or a PHP function. Nothing in it *needs* reactivity, so on its own it argues
for a template engine.

At least one kit component therefore has to do something only reactivity can.
Bootstrap ships the *styles* for validation states (`.is-invalid`,
`.invalid-feedback`) and leaves you to toggle them yourself — that gap is
exactly the pitch, which is why the homepage's reactivity section now shows a
form driving Bootstrap's own validation classes rather than a counter.

## One prefix: everything is `bs-`

Every component in the kit is a `bs-` tag, in one flat `parts/` directory. The
noun after the prefix is always the thing Bootstrap calls it — `bs-input`, not
`bs-field`, because Bootstrap's docs have inputs and "field" is vocabulary
borrowed from other component libraries.

Reaching for `bs-input` should feel like reaching for the markup it replaces.
When a component does more than the plain version — `bs-navbar` taking an
`:options` array, `bs-input` deciding when a value counts as invalid — that is
discoverable where it should be: in the docs, or in the fragment itself, which
is a click away and readable.

**A two-tier naming scheme was tried and dropped.** The idea was `bs-` for
mechanical componentization and `bsx-` for components adding behavior, so a
Bootstrap user would know which tags they could use on sight. It sorts cleanly
— the test being whether *using* it requires anything looked up, which lands on
whether content is passed as markup children or as a data shape — but it
charges the wrong person. A user who just wants a navbar now has to know which
tier it lives in before they can type the tag, and the answer is an
implementation history they don't care about. Worse, it invites the question
"is there also a plain one?" for every extended component, when for most there
never will be.

Two things worth keeping from the exercise:

- The distinction is real and belongs *in the component*, not in its name. Each
  fragment says up front what it decides on the caller's behalf.
- "No new concepts, only Bootstrap's own, reached through attributes" was never
  quite true anyway. `bs-button` takes `:variant`/`:outline`/`:size` — Bootstrap
  concepts, but not Bootstrap spellings — and `bs-navbar` takes an `:options`
  shape that Bootstrap has no equivalent for. Any promise about the prefix
  would have been overstated on contact.

A related idea also parked: having the extended component build on a plain one
(`<:define tag="bsx-input:bs-input">`) so the pair could not drift. That needs
component extension, which the compiler does not support — see TODO.

## Gating work: `:did-init` / `:will-dispose`

The components needed to complete the kit — modal, dropdown, tabs, accordion —
are precisely Bootstrap's **JavaScript** components. Wrapping them reactively
means driving an imperative API (`new bootstrap.Modal(el).show()`) in response
to a value change, which requires a mount/dispose hook.

`:did-init` and `:will-dispose` are recognised by
[stage1-load.ts](src/compiler/stages/stage1-load.ts) and compiled into the
page, but nothing in `src/runtime/` ever calls them.

**So the beachhead strategy depends on these hooks landing** for any component
that has to drive Bootstrap's own JavaScript.

The blocker is narrower than it first appears, though. `bs-input` shows that
anything whose behavior is expressible as *derived state* needs no lifecycle
hook at all: `:_invalid` is an expression over `:_value`, and `:on-` handlers
already work. Only components that must call an imperative API — `show()`,
`hide()`, `dispose()` — are actually blocked. That is the modal/dropdown/tabs/
accordion group, and nothing else so far.

## Open question

The homepage advertises a fuller kit (modal, dropdown, tabs, accordion, form)
than `demo/bootstrap-kit/` currently contains, as a deliberate choice about
copy. The install line reads `npm install -g @markout/bootstrap-kit`, which
does not match `package.json` (`"name": "markout"`, bin `markout`) and installs
a kit of importable fragments globally rather than per-project. Both want
settling before the page is published.
