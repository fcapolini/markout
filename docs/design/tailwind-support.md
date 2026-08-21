# Tailwind, and utility CSS generally

Status: **built.** The class manifest is `Page.classNames()` in
[ir/Page.ts](../../packages/core/src/compiler/ir/Page.ts), emitted by
`injectClassManifest` in
[stage7-generate.ts](../../packages/core/src/compiler/stages/stage7-generate.ts),
and reached through `markout build --class-manifest` / `--classes-only`. The
user-facing half is in
[running a page](../reference/cli.md#a-css-build-step-beside-it); the worked
example is [the Tailwind demo](../../sites/site/demos/tailwind/), whose
stylesheet is checked complete by
[demo-tailwind.test.ts](../../packages/cli/test/server/demo-tailwind.test.ts).

Measured against Tailwind 4.3.3. The numbers here are from runs, not
recollection, and re-running them is the way to check this file has not gone
stale.

## Why this file exists

"Does markout work with Tailwind" is a question the audience
[POSITIONING.md](../../POSITIONING.md) names will ask, because Rails ships
Tailwind by default and Laravel's starter kits are built on it. It deserves an
answer that is a measurement rather than an opinion, because the honest answer
turned out to be **yes, with exactly one exception** — and the exception is
narrow, specific, and fails silently.

It also settles a design question that kept coming back in a different costume:
whether the compiler should grow a hook for third-party tooling. It should not,
and the reasons are recorded under [what was rejected](#what-was-rejected) so
the next version of the question can be checked against them.

## What a scanner actually sees

Tailwind builds its stylesheet by reading source files for candidate strings.
It is looking at **raw text**, not parsing HTML — which is why the answer is
better than it first appears. A utility written in quotes inside `${...}` is
found exactly as readily as one written in an attribute:

| written | found |
| --- | --- |
| `class="underline"` | yes |
| `class=${'italic'}` | yes |
| `class=${x ? 'lowercase' : 'capitalize'}` | yes, both branches |
| `class="block ${x ? 'truncate' : ''}"` | yes |
| a literal in a value, read into `class` elsewhere | yes |
| `:class-uppercase=${x}` | **no** |
| `` class=${`line-through-${n}`} `` | no |
| `class=${'ring-' + '4'}` | no |

The last two rows are Tailwind's own rule about assembling class names from
pieces, and they apply here unchanged — a name that does not exist until the
page runs cannot have had CSS generated for it, in any framework. They are not
markout's problem and there is nothing to fix.

The row that **is** markout's is the toggle.

## The one gap

`:class-x` puts the utility in the attribute *name*, so what a scanner reads is
`class-uppercase`, which is not a utility. Nothing is generated. The page then
compiles clean, runs clean, puts the class on the element, and looks unchanged.

It survives compilation in the same shape. In a built page the name appears as
the props key `'class$overline'` — glued to a prefix again, and equally
unextractable. Measured on a page whose toggles were false at every instance,
so the name reached the output only through the props: **not found**. So
"scan the compiled output instead" does not rescue it either.

**And it is not stable, which is the sharp end.** A toggled `ring-1` is
generated anyway if some *other* element on the page happens to write `ring-1`
in a plain `class`, and stops being generated the day that element changes.
Both were true of the demo in a single build: `ring-1` and `ring-slate-200`
survived on the coattails of an unrelated element, while `ring-2`,
`ring-brand-500` and `shadow-lg` vanished. So the failure can arrive on an edit
to markup that has nothing to do with the toggle.

This is on the [silent failures](silent-failures.md) list, filed as one that
**nothing in this compiler can close** — the two features disagreeing are
markout's and somebody else's.

## What closes it today

Two things, and the first is better wherever you have the choice.

**Write the ternary.** On a page whose CSS is generated, prefer

```html
<button class="rounded-full px-5 py-2 ${yearly ? 'bg-brand-600 text-white' : 'text-slate-600'}">
```

over a `:class-` toggle. It needs nothing added to the stylesheet, composes
with static classes in the same attribute, and is found natively. The demo was
rewritten onto this shape and its safelist shrank to five names.

**Name the rest out loud.** Where the toggle is wanted anyway — and you cannot
rewrite a toggle inside a kit somebody else published — Tailwind spells the
safelist `@source inline(...)`, with brace expansion:

```css
@source inline("ring-{1,2}");
@source inline("ring-{brand-500,slate-200}");
```

The rule to carry away: **a literal class string anywhere in the file is found;
a class named only in a `:class-` toggle, or assembled from pieces, is not.**

## Why "just generate every utility" is not an option

Worth recording, because it is the first thing anyone asks and it *used* to be
true. Tailwind v1 and v2 shipped a full build and people deployed it. Since v3's
JIT and throughout v4, generation **is** the mechanism, and the class space is
unbounded rather than merely large. Measured:

- `p-73` and `p-9999` both generate — `padding: calc(var(--spacing) * 9999)`.
  The numeric scales have no upper bound.
- `w-[137px]`, `grid-cols-[1fr_500px_2fr]`, `top-[calc(100%-3rem)]` — arbitrary
  values.
- `[mask-type:luminance]` — an arbitrary *property*.
- `sm:hover:focus:dark:motion-safe:underline` — variants stack arbitrarily.

Tailwind v4 is not a catalogue that gets trimmed; it is a function from class
name to CSS, invoked for names it finds. There is no finite set to declare, so
scanning is not an optimization that can be switched off — it is the input.

## The class manifest

The compiler knows every `:class-` name on a page, after `<:import>` has been
resolved and treeshaking has dropped what the page does not use. The proposal
is to let it say so, in a form any scanner already reads: a `<template>` of
literal class names.

```html
<template data-markout-classes><div class="ring-1 ring-2 ring-brand-500 shadow-lg"></div></template>
```

Verified end to end: a `<template>` passes through the compile untouched, and
Tailwind extracts from it — including names that never reached a rendered
`class` attribute.

Both flags read the same set. Which one a project wants follows from what it
deploys:

| you deploy | manifest lives | Tailwind config |
| --- | --- | --- |
| the built static output | in each page, `--class-manifest` | scan `dist/**/*.html` — stock |
| Node serving the sources | `_classes.html`, `--classes-only` | one extra `@source`, re-run on demand |

`--classes-only` skips rendering entirely, because the answer does not depend
on it — which is the same fact that makes serving per request need nothing
further. No settle loop and no datasource to wait for, so it is much faster
than a build.

**Emit toggles only.** Everything else is already in the output verbatim, by
construction, so including it would be bytes buying nothing.

**The weight is small.** Every distinct `:class-` toggle in the whole Bootstrap
kit is 35 names, 444 bytes as a class attribute before gzip — and it compresses
well, since most of those strings appear elsewhere in the same document. That
is the worst case for a kit-heavy page.

**Default off.** A project not generating its CSS pays nothing.

**Name it for the page, not for the vendor.** A page declaring the class names
it can wear is a fact about the page — self-description that happens to be what
scanners need. A `--tailwind` flag in the compiler would be a precedent worth
regretting; this framing is not one, and it serves UnoCSS or Panda with no
per-tool knowledge.

### Why a per-page manifest is sound where a site-wide one is not

This is the detail that makes the feature small, and it is why earlier sketches
of the same idea were rejected.

A **site-scoped** artifact — one list for all pages — cannot be produced by
this compiler, because the compiler is **page-scoped** and its three hosts
compile different subsets. The dev server compiles per request, in arbitrary
order, and never compiles a page nobody visited. The VS Code extension compiles
the file being typed with `treeshake: false`, deliberately, so its set is wrong
by design. Only `build` walks the whole docroot. A hook accumulating across
compiles would therefore be silently incomplete in two hosts out of three.

A per-page `<template>` has no such problem: it is exactly the scope the
compiler operates at, nothing accumulates, and every host is trivially correct.
The `--classes-only` file is site-scoped, but it is produced by `build` — the
one host for which "every page" is a meaningful phrase.

## Both delivery modes, and why SSR needs nothing extra

The set of class names a page can wear is a **compile-time property**, and one
compile serves both delivery modes. A request supplies data; data must never
produce class names, because no scanner-based tool in any framework can generate
CSS for a string that does not exist until runtime. So rendering per request
cannot introduce a class the build did not already know, and there is nothing
for a CSS tool to do in the request path.

Note also that ahead-of-time compilation is **not** client-side rendering: the
same `renderPage` runs at build time, so the markup is in the file. See
[isomorphism](../concepts/isomorphism.md#two-ways-to-deliver-a-page). The
difference between the modes is request-time data, not rendering — and it is
orthogonal to CSS.

Which gives the server-rendered workflow its shape. The build is a **throwaway**
used only as a scan target:

```sh
markout build ./site ./.scan          # discarded; exists for Tailwind to read
tailwindcss -i app.css -o ./site/app.css
markout ./site                         # serves the SOURCES, per request, plus that CSS
```

The generated CSS lands inside the docroot, so the server serves it as an
ordinary static asset. `.scan/` is a build artifact to ignore. This is the same
arrangement Rails uses — the CSS tool runs at deploy time and the app serves the
result.

Scanning the full build covers everything in one `@source`, because a built page
carries the rendered markup *and* the props, and the props hold expression
source — so both branches of a ternary are literal strings in there. Measured:
the demo's built page, scanned alone with the theme present and no safelist,
yielded every one of its ten classes. `--classes-only` is faster but narrower,
and needs the sources scanned alongside it.

## What was rejected

Recorded because each of these came back more than once, in different clothes.

**A `stage8-postproc` in the compiler.** A stage in this pipeline is defined as
something that mutates the `Page` and can fail the compile — the whole sequence
is `page.errors.length || stageN(page)`. A CSS extractor is neither, and must
never fail a compile. And it would want to be site-scoped, which is the
mismatch described [above](#why-a-per-page-manifest-is-sound-where-a-site-wide-one-is-not).

**A plugin hook receiving the IR.** The cost is not the hook, it is the
contract: exposing `Page`/`Scope`/`Value` freezes the IR under semver, and adds
ordering rules, error attribution when a plugin throws, and a cache-invalidation
story for the dev server. The IR is still changing — see "shrink the app props"
in [TODO.md](../../TODO.md) — and this would be trading that freedom away to
solve something an accessor solves.

**A postprocess script option on the server, middleware or compiler.** In build
mode it is `&&`; there is nothing a post-build hook does that the next line of
an npm script does not, with worse error handling. In served mode it would run
in the request path, where spawning a CSS build costs hundreds of milliseconds
against a ~2ms page compile — so it would have to be debounced and cached, at
which point it is a file watcher, and `tailwindcss --watch` already is one.
That composition works today with no markout code: the dev server's watcher is
recursive over the whole docroot ([watcher.ts](../../packages/express/src/watcher.ts)),
so a CSS file written into the docroot already trips livereload.

**A server or middleware option writing compiled pages to disk**, to give a
served-mode project something to scan. It writes only the pages someone
*requested*, so the scan set becomes a function of browsing history:
non-deterministic, incomplete, and the failure appears when somebody did *not*
click something. `markout build` into a scratch directory does the same job
completely and in one pass.

**A regex script over sources, shipped in the docs.** Works, and was the
recommendation for a while. Superseded because it makes every user's setup
custom where the manifest makes it stock, and it cannot treeshake or follow
imports into `node_modules` without each kit root being named by hand.

**A regex script over compiled output.** Complete and kit-agnostic — a page's
props hold `class$NAME` for every toggle regardless of render state. Rejected
because `class$` is stage7's encoding rather than language syntax, and
"shrink the app props" proposes changing exactly that. Publishing it would put a
compiler internal into other people's build pipelines, where changing it breaks
them silently. If the answer wants to come from the compiled form, the compiler
should be what emits it — which is the manifest.

## The failure is now detectable

Worth recording, because it is worth more than the CSS plumbing that motivated
it. Nothing here can *close* the silent failure — the tool that generates the
stylesheet is somebody else's — but the manifest makes it **checkable**, by
anyone, in two lines of CI:

```sh
markout build ./site ./.scan --classes-only
# then assert every name in .scan/_classes.html has a rule in your stylesheet
```

That is what [demo-tailwind.test.ts](../../packages/cli/test/server/demo-tailwind.test.ts)
does for this repository, with no Tailwind in the test path: it reads the
committed `build.css` and checks the bytes that ship. Mutation-tested — adding
a toggle without regenerating the CSS fails it, naming the class.

The test asks the **compiler** for the toggle set rather than regexing the
source, deliberately. A regex would be a second implementation of "what counts
as a class toggle", in a different language from the one that decides — two
implementations of one rule, and a test that can disagree with the compiler
about what a toggle is fails in the same direction as the bug it guards.

One incident from writing it is worth keeping, because it is the instability
described [above](#the-one-gap) caught in the act. The first mutation used
`tracking-widest` and the test passed — because an unrelated element on the
page writes `tracking-widest` in a plain `class` attribute, so a rule existed
for reasons having nothing to do with the toggle. Change that element and the
toggle breaks.

The check has one part that is load-bearing and easy to leave out: **assert the
manifest is non-empty**. An empty one passes every other assertion, so a run
pointed at the wrong docroot goes green while testing nothing — a guard that
looks defended and is not, which is this file's own subject one level up. Which
is why `--classes-only` warns when it finds no toggles.

The copy-pasteable version of the check is in
[running a page](../reference/cli.md#checking-it-in-ci).

## Two things it deliberately does not do

Recorded so they are not mistaken for oversights.

**The manifest does not list literals**, only toggles. A scanner finds a literal
natively wherever it sits, so emitting them would be bytes buying nothing — the
same rule that decided the manifest's contents in the first place. And at the
boundary case, a name assembled from pieces, an IR walk has no advantage over
the scanner: both are hunting string literals, and neither can evaluate
`` `bg-brand-${n}` ``. So the demo test proves the toggles complete and *samples*
the literals off the rendered page, which is enough for what that half guards —
whether the page is still being scanned at all.

**The compiler does not check the stylesheet**, and should not. It cannot see
it; the stylesheet belongs to another tool, arrives after the compile, and may
not exist yet. What the compiler can do is state what it knows, which is the
manifest, and say so when what it knows is nothing.

## What is still open

- `--class-manifest` has no vacuity warning, and cannot have the one
  `--classes-only` has. Most pages in a site legitimately toggle no class, so a
  build where *nothing* does is indistinguishable from a normal one. A project
  can therefore ask for per-page manifests, never point a scanner at the output,
  and hear nothing — the one remaining way to hold this wrong in silence.
