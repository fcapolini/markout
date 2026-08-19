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
| A write into a region | Would land nowhere while the region is away | Compile error — there is no guarded form of an assignment target |
| A scope copied for a usage site's stencil | `copyForUsage` enumerated fields; `elseOf` was added later and dropped, so every branch of an adaptive component came out unlinked and an `:else` showed beside its own `:if` | Every key of `Scope` is sorted into carried / fresh / method, and adding one fails to typecheck |
| Format Document on a markout file | VS Code's HTML formatter read `>` inside `${…}` as the end of a tag, turning every later attribute into text | The extension provides formatting and removes HTML's, for these files |
| `:for-data` as a condition | `!= null`, so `''` rendered an empty styled wrapper | Not a language rule: the kit uses `:if`, and the docs say which asks which question |

## Open

- **A component parameter shadowed by a caller value of the same name.**
  `<mk-pager :pages=${pages}>` where `pages` is both the caller's value and
  the component's parameter self-references, and fails at runtime with
  `unresolved dependency`. No compile-time diagnostic names the collision.
  See TODO.md.
- **A value written back does not clear a field the user has typed in.**
  HTML's dirty-value flag makes an input's value independent of its attribute
  from the first keystroke, so `v = ''` empties the model and leaves the text
  on screen. Nothing reports the divergence. See TODO.md.
- **A definition based on another definition.** Accepted with no error and
  then broken: with caller content it reports a missing `<:slot>` that is
  there, and without it renders nothing at all. See TODO.md.
- **A built page whose data source was down.** Every page says so, with a
  green build behind it. Partly addressed — a relative url now rejects — but
  an absolute one that answers badly still builds clean. See TODO.md.

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
