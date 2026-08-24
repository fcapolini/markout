# Silent failures

Status: **living.** Every way this project has found for a page to be wrong
without saying so, what makes each one impossible now, and the ones still
open.

## Why this file exists

"Mistakes caught before the page loads, with a file and a line" is the row
that distinguishes markout from Alpine, and it is the reason someone would
accept a build step or a Node process to get it. So a failure that says
nothing is not a bug like other bugs — it is the pitch being wrong, in front
of the reader it was aimed at.

Compile-time safety is also the property that decays fastest as features
multiply, because what fails quietly is almost never a feature: it is two
features disagreeing about the same markup. Every entry below was found that
way, and none of them by the tests written for either feature alone.

The rule for adding one: it belongs here if a correct-looking page produces
wrong output, stale output, or no output, and nothing anywhere says why.
An error the author cannot act on counts — `Cannot read properties of
undefined` names nothing they wrote.

## The shapes they come in

Worth naming, because a new feature can be checked against them before it
ships rather than after:

- **First-wins resolution.** Two things claim one name and one is dropped.
  Whatever was dropped is simply absent afterwards.
- **A copy that enumerates fields.** Anything added to the class later is
  silently not copied, and an object missing a field is a perfectly good
  object that goes wrong somewhere else entirely.
- **A compile-time walk mirroring a runtime walk.** Two implementations of
  one rule, in two languages. When they disagree the page compiles clean and
  fails when it runs.
- **A cache whose invalidation lives elsewhere.** The stale read looks
  exactly like a correct one.
- **Markup that renders but is never reached.** No error is possible, because
  nothing went wrong — the content is just somewhere nobody looks.

## Closed

| What | How it failed | What makes it impossible |
| --- | --- | --- |
| Two `<:slot>`s of one name | First wins; the caller's content went to the branch written first and vanished when the other showed | Compile error naming both, and the alternative (a slot per branch under its own name) |
| A name inside an `:if`/`:for-data` region, read from outside | Compiled clean, then `Cannot read properties of undefined (reading '$value')` in the browser | `?.` required at the crossing; the name answers `undefined` while the region is away |
| A write into a region | Would land nowhere while the region is away | Plain assignment is a compile error naming `$set`, whose call form the `?.` can guard and which answers whether it landed |
| A `$set` with a name the compiler cannot follow | A mistyped or computed name would write nowhere and say nothing | The name must be a literal, and is checked against the scope like any other reference |
| A scope copied for a usage site's stencil | `copyForUsage` enumerated fields; `elseOf` was added later and dropped, so every branch of an adaptive component came out unlinked and an `:else` showed beside its own `:if` | Every key of `Scope` is sorted into carried / fresh / method, and adding one fails to typecheck |
| Format Document on a markout file | VS Code's HTML formatter read `>` inside `${…}` as the end of a tag, turning every later attribute into text | The extension provides formatting and removes HTML's, for these files |
| `:for-data` as a condition | `!= null`, so `''` rendered an empty styled wrapper | Not a language rule: the kit uses `:if`, and the docs say which asks which question |
| CSS written against a replicated or conditional list | The stencil `<template>` sat where the markup was written and counted as a child, so `li:first-child` matched nothing and the style just never appeared | The stencil is in `<head>` and a comment holds its place; structural selectors count what the page wrote. See [stencils out of the way](stencil-placement.md) |
| A branch chain whose next branch is a custom tag | The chain links both ways, and only the backward link was mapped onto the instance a custom tag compiles to -- so the head pointed forward at the id of a scope that had been detached, the runtime found no such sibling, and NO branch rendered. Filed as #25 | Both links name the scope each side is compiled as, and every shape of chain is rendered in a test |
| A definition using one declared after it | An instance takes a copy of its definition's children, so a usage still unexpanded in that body arrived on the copy as a scope about to be spliced out -- and the page served `<!---usNN-->` where a subtree should be, silently. Only the innermost level was lost, which made it read as an ordering rule. Filed as #24 | Usages are expanded depth-first, a definition's body before anything that instantiates it, and the four declaration orders are asserted to render the same |
| A page the server cannot look at | Every filesystem error while resolving a page -- a permission on the docroot, an `EMFILE` under load, a volume gone away -- was caught and answered as an ordinary 404, so a broken deployment reported itself empty in an access log full of them, with the file sitting right there | Only the errnos that mean "no such name" stay silent; anything else is logged naming the path and the code, and says it is serving the page as not found |
| `:if` or `:for-each` on `<html>`, `<head>` or `<body>` | The element moved into a stencil, and `document.body` answers with a direct child of `<html>` and nothing else — so there was no body to append the props and the runtime to, and the page shipped rendered, complete and completely inert, saying nothing at either time | A compile error naming the tag and the attribute: those three are where a page keeps what makes it work, so a region cannot be one of them |
| A region inside inline SVG | Caught in the act while moving stencils to `<head>`: a `<circle>` in a stencil parses into the HTML namespace, so the clone was an `HTMLUnknownElement` that drew nothing and reported nothing — where the arrangement before it had at least thrown | The stencil travels with the `<svg>`/`<math>` that names its namespace, and the test parses the served bytes in a DOM that has namespaces — the compiler's own has none to get wrong |
| A value written back into a field the user has typed in | HTML's dirty-value flag makes an input's value independent of its attribute and its content from the first keystroke, so `v = ''` after a submit emptied the model and left the typed text on screen. It compiled clean, ran clean, and this project SHIPPED it -- `bs-input`, `bs-textarea`, `bs-check`, `bs-range` and `bs-select` all bound it that way, and the durable-state page in the docs taught it | `:prop-value=${...}` beside the attribute, which was already the spelling and was already what `demos/desk/` did. A compile warning when one is written without the other, per element and attribute HTML gives a flag to; the kit and the docs fixed. Not closed by making `value=` write the property on an input, which would be one attribute meaning two things by where it sits |

## Open

- **A component parameter shadowed by a caller value of the same name.**
  `<mk-pager :pages=${pages}>` where `pages` is both the caller's value and
  the component's parameter self-references, and fails at runtime with
  `unresolved dependency`. No compile-time diagnostic names the collision.
  See TODO.md.
- **A definition based on another definition.** Accepted with no error and
  then broken: with caller content it reports a missing `<:slot>` that is
  there, and without it renders nothing at all. See TODO.md.
- **A built page whose data source was down.** Every page says so, with a
  green build behind it. Partly addressed — a relative url now rejects — but
  an absolute one that answers badly still builds clean. See TODO.md.
- **A `:class-` toggle whose CSS was never generated.** A utility framework
  writes its stylesheet by reading the markup for class names, and markout
  spells a toggled class in the attribute *name* — `:class-ring-2` — where no
  scanner looks. The page compiles clean, puts the class on, and looks
  unchanged. Found building the Tailwind demo, which lost every one of its
  toggled utilities on the first build.
  - **Not stable, which is the sharp end of it.** A toggled `ring-1` is
    generated anyway if some *other* element on the page writes `ring-1` in a
    plain `class`, and stops being generated the day that element changes.
    Measured: both were true of the demo in one build. So the failure arrives
    on an edit to markup that has nothing to do with it.
  - Narrow, and worth saying so: an interpolation is fine. A scanner reads
    raw text, so `${x ? 'ring-2' : ''}` inside a `class` attribute IS found,
    and so is a literal sitting in a value elsewhere. It is the attribute-name
    spelling alone that hides, which is why the escape is an idiom rather
    than a safelist.
  - **Outside the compiler, and now detectable.** The two features
    disagreeing are markout's and somebody else's, so nothing here can close
    it — but `markout build --classes-only` makes the compiler state the set
    a scanner cannot see, which turns "wrong and silent" into a two-line CI
    check: every name in `_classes.html` must have a rule in your stylesheet.
    [demo-tailwind.test.ts](../../packages/cli/test/server/demo-tailwind.test.ts)
    is that check for this repository, and it is mutation-tested.
    [tailwind-support.md](tailwind-support.md) has the measurements and the
    reasoning; [running a page](../reference/cli.md#a-css-build-step-beside-it)
    has the rule.

## What tests this

Nothing tests "is every failure either impossible or reported", and nothing
can. What exists is coverage aimed at where these have actually lived:

- [`matrix.test.ts`](../../packages/core/test/matrix.test.ts) crosses every
  binding with every container, and each of those with four wrappers — so the
  table is pairs of mechanisms rather than one at a time, which is what every
  entry above turned out to need.
- [`name-resolution.test.ts`](../../packages/core/test/name-resolution.test.ts)
  compiles *and links* every name-resolution shape, because the two walks are
  one rule implemented twice.
- [`deep-nesting.test.ts`](../../packages/core/test/deep-nesting.test.ts)
  takes three constructs deep by hand, where the generated table would
  explode.
