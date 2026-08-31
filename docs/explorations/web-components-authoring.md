# Authoring web components

Status: **exploratory.** Nothing here is committed to, and no code has been
written for it. This is a conversation that changed its own mind twice,
recorded so the next person to have it starts where this one ended rather than
where it began.

## The question

Markout consumes custom elements well: `:prop-`, `:attr-` and `:on-` are the
three verbs a page needs to drive one, with no wrapper package and no
registration step, which is the [web components section of the
README](../../README.md). It does not *produce* them. A `<:define>` is
expanded into the page that uses it and exists nowhere afterwards.

So: should a `<:define>` be able to compile into a registered custom element —
a thing shipped on npm and used from a React page, a Vue page, or a page with
no framework at all? And would that help adoption?

Two answers, and they point in different directions. The language objection
mostly dissolves on inspection. The strategic one does not.

## Scope, which turned out not to be the obstacle

The first objection was that markout's scoping model cannot survive the
boundary. A definition's body reads names lexically — `${bsRadius}` in a
Bootstrap kit component, `$host` in `bs-accordion-item` reaching the accordion
that encloses it — and a custom element instantiated from a page markout never
compiled has no lexical chain to walk.

That objection is weaker than it looks, and the reason is worth writing down
because it is a fact about the implementation rather than an opinion.

A definition's body resolves outward through `lexical()` in
[stage4-resolve.ts](../../packages/core/src/compiler/stages/stage4-resolve.ts),
from where the markup was *written*. A kit is a lib whose `<head>` merges into
the page's, so that walk terminates at a single root scope. It is not
arbitrary nesting: it is "the component body, and then one global". Which
means binding that outer end to a **library** global — one holding the kit's
design tokens instead of the page's head — is a re-binding, not a redesign.

`$host` survives too, by a different route. An element walking up the composed
tree to find its enclosing instance is ordinary custom-element practice —
`<sl-tab-group>`/`<sl-tab>` work exactly that way — so the accordion's one
coupling, an id the item asks its host for, is implementable at runtime rather
than lost.

What does not survive unchanged is the *direction* of theming. Today a page
overrides a kit's token by declaring the name plainly at the import site, and
the kit goes on writing `${bsRadius}` with nothing changed on its side; see
[compile-time constants in the syntax
reference](../reference/syntax.md). That is outside-in and needs no API. A
library global is inside-out, and a consumer needs some way to reach it.

## Configuration: where a library's tokens live

Three shapes were considered.

**The current one — a name declared at the import site.** Zero API, and the
compiler resolves it, so a misspelled token is a file and a line. But the only
scope enclosing every definition is the head, so it is one theme per document.

**A provider element**, the library represented as its own tag whose
attributes and properties are its settings, found by descendants walking up.
This has the most precedent: FAST's `fluent-design-system-provider`,
Spectrum's `sp-theme`, `ion-app`. It is also close to a transliteration of
what [base.htm](../../kits/bootstrap-kit/parts/base.htm) already is — a lib
whose head carries the tokens and emits the stylesheet link. It is *more*
expressive than what exists now, because it scopes to a subtree: two themed
regions on one page come free. And it is the natural place to translate tokens
into CSS custom properties, which are the only thing that crosses a shadow
boundary by inheritance, so one element handles both the JS-visible and
CSS-visible halves.

Its trap is upgrade order. Attributes are in the served HTML at parse time;
properties assigned by script are not, and a property set before upgrade can
be swallowed by the class's own accessor — which markout's own
[directives](../concepts/directives.md) documentation already warns consumers
about. Configuration that fits in a string wants to be an attribute, or
dependent components mount with defaults and visibly flip.

**A global object**, the library global made literal — `setBasePath()`,
`Chart.defaults`, Bootstrap's `Default`. Cheapest by far, no upgrade timing,
and since markout already has a reactive value system the global could simply
be a markout scope, so live retheming falls out with nothing new invented.

Two costs, both specific to this project. It is the one shape that puts
configuration in **script** rather than markup, so it is absent from the
served HTML and from a server render — awkward for the project whose pitch is
that the values are already in the page that arrived. And a property on a
plain object is not a name the compiler resolves, so a typo is `undefined` at
runtime rather than an error with a line. [Silent
failures](../design/silent-failures.md) opens by saying that a failure which
says nothing is not an ordinary bug but the pitch being wrong in front of the
reader it was aimed at, and a config global is a small permanent hole of
exactly that kind.

These are not exclusive, and the line between them is natural: a global for
document-wide defaults set once, a provider element where a subtree needs to
differ. If only one gets built, the global is the cheaper first move — but it
should not become the only way in, or compile-time safety quietly stops
covering configuration.

One question this raises independently of the library target: whether the
provider element should arrive **now**, page-compiled. If it does not, and the
library target ever happens, the kit documents two theming idioms. If it does,
tokens stop being `:const-` and a stylesheet reading one goes from no binding
at all to one binding for the whole sheet. There is a tempting way out — fold
the provider's parameters at compile time when the page writes them literally,
keep them live when it cannot be known — but that is one declaration meaning
two things depending on the target, which is the kind of inference the
language otherwise refuses to make.

## What the target would be

A second emitter, forking late. Stages 1 through 6 are indifferent; stage 7 is
the page-shaped one.

Today [stage7-generate.ts](../../packages/core/src/compiler/stages/stage7-generate.ts)
emits a props object — JSON plus an array of expression functions — injects it
as a script setting a window global, relocates the stencils into the document
as `<template>`, and adds the script tag that loads the runtime, which then
initializes itself from that global. A library target emits the same props
structure per definition and wraps it in `customElements.define` instead:
observed attributes mapped to the `::` parameters, the stencil inlined as a
module string rather than relocated into a page, and the mount pointed at the
element or its shadow root instead of the document.

Four things change shape past the emitter.

**The runtime stops being a page singleton.** It is currently fetched from a
fixed URL and initializes autonomously off one global. A library needs it as
an importable module with an explicit "instantiate these props against this
root" entry — and two markout-authored libraries on one page should share one
runtime, which makes it a peer dependency with a version-skew question rather
than a file that gets served.

**Treeshaking loses its input.** Stage 6's reachability graph needs a page to
be reachable from. A library ships everything and hands the shaking to the
consumer's bundler, which constrains the emit: ESM, one module per component,
and `customElements.define` behind an explicit call rather than an import side
effect, or nothing downstream can drop anything.

**The stylesheet mechanism inverts.** A definition's `<style>` is currently
hoisted, served once, and placed immediately before the definition so that
cascade order is import order. In a library it becomes a constructed
stylesheet adopted per shadow root: the payload win survives, that cascade
reasoning does not apply.

**Tokens stop being constants.** `:const-` is folded and dropped at compile
time. Bound to a library global they have to be live values, or the library
ships one build per theme.

## The element's public surface

A first pass at this file said markout had no way to declare a public method.
That was wrong, and the counter-example is in the standard kit: `std-data`
declares [`::reload=${() => {…}}`](../../kits/std-kit/parts/data.htm) and
callers invoke it on the instance's name — `threadSrc.reload()` in the desk
demo, `people.reload()` in the std one. A value holding a function, reachable
by name, already *is* a method, and it is the idiom the kits use.

What that leaves is a question of which marker means public, because the
language already has two and they differ in the right way:

- `::name` is a **parameter**, passed in, so a usage site can replace it —
  `<std-data ::reload=${mine}>` substitutes the implementation. That is
  strategy injection as much as it is a method.
- `:name` on the definition's root is the component's own and no usage can set
  it, but it is still readable by navigating in, which is what `calc.sum(…)`
  does in the Orbit demo. Callable and not replaceable is the closer match for
  a public method.

The `_` prefix in `:_cls` is convention and nothing enforces it, so the
read-only affordance exists without a name. Whether `::reload` is deliberately
replaceable or incidentally so is worth settling before an export target
projects either shape onto a class.

Given that, the export step is mechanical: walk the declared values, find the
function-valued ones, define forwarding methods on the element class, and emit
them into a custom-elements manifest — which is what puts them in editor
completion and in generated documentation.

The gap that remains is **form association**, and custom states with it: both
come through `ElementInternals`, which is acquired at construction, before any
markup exists, and a `<:define>` has no place for something that precedes its
scope. It is not a small omission for this target — form controls are a large
share of what design systems ship — though it is one the export target
*creates* rather than inherits, as the section on authoring below sets out.

## Attributes are properties and methods

Worth stating separately, because this file assumed the opposite twice before
checking, and the assumption is the most expensive misreading markout invites:
that expressing logic in attributes means inheriting HTML's attribute syntax —
one line, no comments, quoting by luck.

It does not, and the reason is in
[parser.ts](../../packages/core/src/html/parser.ts): an interpolation's end is
found by asking acorn, the same parser that reads the expression a moment
later, rather than by a lexer approximating one. Four limits go at once.

- `>` inside an expression does not end the tag, so `a > b` and `=>` are code.
- A quote inside an expression does not end the attribute — issue #30, whose
  old failure was a `SyntaxError` pointing inside the expression at nothing the
  author had got wrong.
- Strings, template literals, object literals and nested `${…}` end where
  JavaScript says they end.
- Attributes span lines, and `//` and `/* … */` between them are stripped at
  parse time.

So a scope's declarations are properties and methods of a JavaScript object
that happens to be written in a tag, not strings in an attribute. That is why
[`bs-input`](../../kits/bootstrap-kit/parts/input.htm) can group its
parameters, its private derived state and its public value under comment
headings and read as a class body, and why `std-data` can hold a fetch
lifecycle inline.

For this exploration it settles one thing: nothing about the *syntax* limits
what an exported element's implementation could contain. What is left to
discuss is the element protocol and the market, which is what the rest of this
file is about.

## What stays expensive

**Server rendering.** None of the above touches it. A registered element
renders nothing on the server unless a declarative-shadow-DOM path is built,
and that is a second renderer with its own hydration story. It is most of the
remaining cost, and it is aimed squarely at the one claim — the content is in
the HTML that arrived — that markout is least willing to weaken.

**Kits built on an external CSS framework cannot be exported at all.**
bootstrap-kit's components are made of Bootstrap classes served by a
page-level `<link>`. Put them in shadow roots and that stylesheet stops
reaching them. A library authored for this target ships its own CSS, which
means the flagship kit is not the thing that gets exported.

**A bundler-shaped maintenance surface, which the project currently does not
have.** No output module format, no consumer build step, no dual-package
question. The target imports the whole category, and there is already one
unresolved instance of it parked in [TODO.md](../../TODO.md).

**The audience**, which is the objection that survived the whole discussion
untouched, and is large enough to have a section of its own below.

## Would it be an appealing language to author in

Two answers, and the distance between them is the finding: it would be
pleasant to write and weak to adopt.

The slot is genuinely open. HTML-first custom-element authoring exists — WebC,
Enhance — but neither carries fine-grained reactivity; one is compile-time, the
other SSR-first. Lit is JS-first, Stencil JSX-first. "Write an element as HTML,
with reactivity in the markup, no class and no decorators" is unoccupied, and
markout already has the parts: the lifecycle family is
`connectedCallback`/`disconnectedCallback` under other names, `$dom` with
`:handle-` is a working imperative door, and methods are the idiom above.

Three things stop that from being a product.

**The commitment inverts.** Markout's adoption argument is that it is additive
and reversible — add an attribute, stop whenever. A published component library
is the opposite: consumers inherit markout's runtime, its bug surface and its
longevity risk, and they never chose it. Authoring for distribution is the
highest-commitment thing a young project can ask for, asked in the market least
willing to grant it.

**Ergonomics is not the axis this is bought on.** A design-system team
evaluates on the manifest, typed props, framework wrappers, SSR, accessibility,
testing and a browser-support policy. Lit and Stencil have all of it. The class
boilerplate markout would remove is a small fraction of the cost of owning a
design system, which is the [POSITIONING.md](../../POSITIONING.md) argument
about the framework market transposed to a smaller and more conservative one.

**The components that most need to be elements are the ones markout suits
least** — which was overstated when this file first said it, and is worth
correcting rather than deleting.

*Logic volume is not the obstacle.* A scope is a JavaScript object with state
and behaviour; expressions take real multiline code; and `//` and `/* … */`
between the attributes of a tag are a documented part of the syntax
([syntax reference](../reference/syntax.md)), so a definition reads at source
level as one unit rather than as scattered attributes.
[`bs-input`](../../kits/bootstrap-kit/parts/input.htm) is the proof: a
parameters block, a private block of derived state, a value marked as read
from outside, then the template — a class body in all but syntax.
[`std-data`](../../kits/std-kit/parts/data.htm) carries a whole fetch
lifecycle the same way. Complex component logic is writable here much as it is
in Lit.

*On one axis it is better.* Lit asks an author to declare reactive state and
then reason about when the template re-renders and what `willUpdate` and
`updated` should do. Markout's derived values recompute themselves —
`:_invalid` and `:_class` in `bs-input` are not maintained by anyone — so the
internal state management of a widget comes free, with `:handle-` as the one
explicit seam where imperative work hangs off a value changing. That is
closer to what widget code actually wants than re-render-and-diff.

*What is left is not logic but element protocol.* `ElementInternals` — form
association and custom states — has to be acquired at construction, before any
markup exists, and a `<:define>` has no place for something preceding its
scope. Note where that difficulty comes from: `bs-input` participates in a form
perfectly well today, because its `<input>` is a real input inside the page's
form. It is the shadow boundary that takes that away and makes it something to
re-acquire. The gap is created by the export target, not present in the
language.

*And one tooling cost that is real.* There are no source maps anywhere in the
compiler, so a stack trace from inside a generated expression does not point at
the line of `.htm` that produced it. For a page you wrote yourself that is a
nuisance; for a published library, whose consumers debug it without ever having
seen the source language, it is a good deal worse.

Where the original point survives is on the other side: the components markout
expresses most elegantly, markup plus classes in the bootstrap-kit shape, are
exactly the ones that do not need to be custom elements at all, because a
page-compiled kit already serves them with a smaller payload and nothing at the
consumer's end. The strongest technical case for the export target remains the
weakest business case for it, and the reverse.

Which suggests the framing that would work is much smaller than "an authoring
language": not a competitor to Lit, but *your existing kit, exported* — one
command, so a team already on markout can hand a component to the React team
next door. That is worth something to whoever already adopted, and no reason at
all to adopt.

## Where this leaves it

Feasible, and more cheaply than this discussion assumed at its start. It is
one renderer and a configuration API, not a language change. But it points the
docs, the demos and the audience somewhere other than where everything is
currently pointed, and it buys distribution rather than adoption.

The version worth keeping on the table is narrow: an opt-in export target over
definitions that reach nothing outward except the library global, refused at
compile time if they reach further. Additive, at the edge, and it asks the
page-side language for nothing.

The thing genuinely adjacent to it — and the reason the question came up, a
definition now owning its own `<style>` — is **scoped styles**, which is
already open in [TODO.md](../../TODO.md) and wants a compile-time answer,
namespaced or hashed selectors, not shadow DOM. That keeps server rendering,
compile-time constants, treeshaking and lexical scope exactly as they are, and
delivers the "a component owns its CSS" story this question was really
reaching for.
