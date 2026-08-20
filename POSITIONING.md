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
thing". That used to be answered by pointing at `shoelace-kit` and
`webawesome-kit`, which overstates two twenty-line demo stubs. The real second
kit is [`@markout-lang/std-kit`](kits/std-kit/) — the system parts of a page, not a
design system — and it is better evidence anyway, because it shows the mechanism is
not "wrap a CSS framework", it is "define tags". Bootstrap is *the first kit*,
not the point, and the page has to keep saying so.

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

## There is one Bootstrap kit, and it is a package

[`kits/bootstrap-kit/`](kits/bootstrap-kit/) is the kit: every component on
[Bootstrap's 5.3
cheatsheet](https://getbootstrap.com/docs/5.3/examples/cheatsheet/), one file
per component, landed 2026-08-15. It ships two pages of its own — a showcase
that puts every component on screen at once, and
[Orbit](sites/site/demos/orbit.html), an operations console built out of them
over a directory of JSON files.

For a while there were two, and the second one did real damage to the pitch:
`demo/bootstrap-kit/` was five hand-written definitions predating the kit,
and it was what the homepage and the README linked to — so the most traffic
was aimed at the weakest artifact. It was deleted on 2026-08-17 and the
before/after page rebuilt on the real kit, which is also the first page in
the repository to install the kit rather than keep a copy of it:

```html
<:import src="/npm/@markout-lang/bootstrap-kit/all.htm" />
```

That spelling is worth the churn on its own. A reader who wants what the demo
has now types `npm install @markout-lang/bootstrap-kit`, and the page they are
looking at is the proof it works.

## The kit has to prove reactivity, not boilerplate removal

The before/after demo — 28 lines of hand-wired navbar against a
`<:import>` and a list of links — is the strongest asset on the homepage. But
everything it demonstrates is achievable with server includes, Jinja, Eleventy
or a PHP function. Nothing in it *needs* reactivity, so on its own it argues
for a template engine.

That is not a defect of the demo; it is what the *first* tier of the real kit
does too. A component earns its place there by removing something a person
would otherwise keep right by hand — the id that ties `aria-controls`,
`for`, `data-bs-target` and `data-bs-parent` to the element they name, the
`role`/`aria-*` text written once instead of per use, the one shape repeated
over a list. All of that is templating, and the kit's own test asserts it
mechanically: every generated id reference has to name an element that
exists.

So the proof has to come from the two tiers above it, and now does:

- **Values that are read *and* written.** `bs-input`, `bs-select`, `bs-check`,
  `bs-range`, `bs-modal`, `bs-offcanvas` and `bs-toast` keep `:value` or
  `:open` in step with the screen, so `<bs-input :aka="email" />` and
  `<bs-button :disabled=${!email.value}>` is the whole wiring. Validity is the
  sharpest case, because Bootstrap ships the *styles* for it (`.is-invalid`,
  `.invalid-feedback`) and leaves the toggling to you: `bs-input`'s `:_invalid`
  is one expression over its own `:value`, which is why the homepage's
  reactivity section shows a form driving Bootstrap's classes rather than a
  counter.
- **A whole application.** Orbit is the argument the component gallery cannot
  make on its own: filters, charts, KPI rows and tables over one page's data,
  with no store, no reducer, no event bus and no effect copying one value into
  another — and server-rendered complete, because its `std-data` sources
  resolve while the page renders and the browser asks for nothing. It is also
  where the two kits meet, which is worth showing rather than asserting.
  What those sources read is a directory of JSON files, on purpose: the
  console has no back end, so nothing in the demo asks a reader to run Node
  or to believe that a page's data has to come from it. Pointing `:apiBase`
  at a service written in anything else is one attribute, which is the note
  the demo carries — and [Desk](sites/site/demos/desk/index.html) is the same
  architecture with that swap made, small and plain, for the three things a
  file cannot do: answer a question, answer one that depends on another
  answer, and be written to.

## One prefix: everything is `bs-`

Every component in the kit is a `bs-` tag, in one flat `parts/` directory of
around thirty files, one per Bootstrap component. `all.htm` pulls in
everything, and each part imports `base.htm` itself, so importing parts by
hand can never leave Bootstrap out. The noun after the prefix is always the
thing Bootstrap calls it — `bs-input`, not `bs-field`, because Bootstrap's
docs have inputs and "field" is vocabulary borrowed from other component
libraries.

Reaching for `bs-input` should feel like reaching for the markup it replaces.
When a component does more than the plain version — `bs-navbar` taking an
`:items` array, `bs-input` deciding when a value counts as invalid — that is
discoverable where it should be: in the docs, or in the fragment itself, which
is a click away and readable. The kit holds itself to that: every part carries
a comment saying up front what it decides on the caller's behalf.

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
  concepts, but not Bootstrap spellings — and `bs-navbar` takes an `:items`
  shape that Bootstrap has no equivalent for. Any promise about the prefix
  would have been overstated on contact.

The completed kit added one more thing to be honest about: **`:extra`**. A
`class` written at a usage site *replaces* the one a definition sets — the
language's rule, deliberately, and not something a kit should override — so
every component takes `:extra` for the utility classes a caller wants on top.
It is a small tax that a Bootstrap user pays on their most reflexive habit,
and the docs should show it in the first example rather than let it be
discovered. There is a language-level answer queued in
[TODO.md](TODO.md) for cumulative classes; until it lands, `:extra` is the
kit's own convention and reads as one.

A related idea also parked: having the extended component build on a plain one
(`<:define tag="bsx-input:bs-input">`) so the pair could not drift. That needs
component extension, which the compiler does not support — see TODO.

## The gating work landed, and it was the other pair

This section used to say the beachhead depended on `:did-init` /
`:will-dispose`: modal, dropdown, tabs and accordion are Bootstrap's
**JavaScript** components, the compiler recognised those two attributes but
nothing in `src/runtime/` ever called them, so any component driving
Bootstrap's own JS was blocked. The callbacks were implemented on 2026-08-15
and the kit was completed the same day. Two things about how that turned out
are worth keeping, because the prediction was wrong in both:

**The blocked list was much shorter than "the JavaScript components".**
Dropdown, tabs, accordion, collapse, carousel and scrollspy need no hook at
all — Bootstrap starts each of them itself from `data-bs-` attributes, and the
component's entire job is writing the ids that connect the two elements.
What actually needed a hook was a different five: `bs-modal`, `bs-offcanvas`,
`bs-toast`, `bs-tooltip` and `bs-popover`. The first three because their
`:open` is a value the page owns and `show()`/`hide()` are verbs no markup
expresses; the last two because they are the only components Bootstrap does
not start on its own, and the usual answer — a page-level loop over
`[data-bs-toggle="tooltip"]` — misses anything added later.

**The pair that mattered was `:did-attach` / `:will-detach`.** They were
implemented as two pairs, and it is the attach pair the kit uses. A
`:for-data` region takes its markup out of the page without its scope going
anywhere, and a Bootstrap plugin left holding a removed element keeps its
backdrop, its popper and the page's scroll lock behind. So the lifetime a kit
component needs is the element's presence in the document, not the scope's
existence — a distinction that only shows up once something real is built on
it.

The general rule survived intact and is the one to repeat: anything expressible
as *derived state* needs no lifecycle hook. `bs-input`'s `:_invalid` is an
expression over its `:value`, and `:on-` handlers already worked. The
imperative half of the DOM is reached through `:handle-` — a value changed, run
this — and out of thirty components only those five and the colour-mode toggle
reach for it.

## Open questions

The two questions this section used to hold have both moved, and left smaller
ones behind.

**The homepage no longer overstates the kit, and no longer points at the
wrong one.** Modal, dropdown, tabs, accordion and the form components all
exist, and then some; the five-definition stub the README and the homepage
used to link to is gone, and the before/after page is built on the real kit.
What is left of this question is only the homepage's own copy, which still
describes a kit it was written against months ago and wants a read-through
against [the kit's README](kits/bootstrap-kit/README.md).

**The install line has a spelling that works now.** npm kits landed 2026-08-17:
a kit is an installed package, imported once by provenance and served at the
logical root it declares —

```html
<:import src="/npm/@markout-lang/bootstrap-kit/all.htm" />
```

— so the line to publish is `npm install @markout-lang/bootstrap-kit`, per project,
not the `-g` the page currently shows, which installed a set of importable
fragments globally. Both kits became real npm packages on 2026-08-17, so what
remains is only that neither has been pushed to the registry: the copy is
ahead of npm rather than ahead of the code.

**And one new one: two kits mean the page has to say what a kit is.** The
Bootstrap kit wraps a design system; the std kit does not wrap anything. Both
are "a directory of `<:define>`s you import, installed like anything else",
which is the honest and useful answer, but the homepage currently only shows
the first shape and a reader would reasonably conclude kits are for CSS
frameworks.
