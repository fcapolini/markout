# Editor support, on Volar

Status: **the first version is complete.** All four of what it set out to do
work end to end over LSP: diagnostics against the unsaved buffer, navigation
on `<:import src>`, highlighting, and HTML's own features through
`volar-service-html`. What is deliberately not in it is TypeScript inside
`${…}`, for the reason below. Built in
[packages/vscode/](../../packages/vscode/); the core change it needed
([`readFile`](../../packages/core/src/html/preprocessor.ts)) has landed.

Not yet verified: the extension has never been loaded into a running VS Code
window. The language server is tested over real LSP, but `activate`, the
grammar's injection into `text.html.basic` and the language contribution are
between this and an editor, and only F5 proves them. Press it — the launch
configuration is at [.vscode/launch.json](../../.vscode/launch.json) and it
opens [the fixture](../../packages/vscode/fixture/README.md), which is a
project with no package.json in it at all.

## The problem

Markout's strongest claim against Alpine is in
[POSITIONING.md](../../POSITIONING.md): *mistakes are caught before the page
loads, with a file and a line*. That is true — and today it is only true of a
terminal. In an editor, a markout page is HTML with unfamiliar bits in it:

- `${count * 2}` is text. No highlighting, no completion, no error when
  `count` does not exist.
- `:count=${0}` is an unknown attribute. So is `:on-click`, `:did-attach`,
  `:for-each`.
- `<:import src="lib.htm" />` is an unknown tag with a string in it, rather
  than a link to a file.
- A misspelled value name compiles clean until you serve the page, at which
  point the compiler tells you exactly what is wrong — in the other window.

So the feedback the language is proud of arrives late, in the wrong place,
and only when the file has been saved. The extension's job is to move it into
the editor, against the buffer being typed.

## Why Volar rather than a plain language server

A markout page is not one language. It is HTML, with JavaScript expressions
in attributes and in text, and CSS that has JavaScript in it too. A
hand-written server would have to answer "what does `.filter(` complete to"
by reimplementing TypeScript, and "is `grid-templat` a property" by
reimplementing the CSS service.

Volar exists for exactly this shape. Its model is **virtual code**: a
language plugin turns one source file into embedded documents with mappings
back to it, and the existing services — TypeScript, HTML, CSS — run against
those, with every position translated through the map. What the plugin owns
is the mapping; the language features come from services that already exist.

That is the whole reason to take the dependency, and it is also why the
plugin is the interesting part of this package and the server is boilerplate.

## What the compiler already gives, and the one thing it did not

Most of what a language server needs was already there, because a compiler
that reports well to a terminal reports well to anything:

| Need | Where it comes from |
| --- | --- |
| Errors with a position | `PageError.loc`, an `acorn.SourceLocation` — start and end, so a diagnostic is a range and not a caret |
| Which file an error is in | `loc.source`, so an error inside an imported fragment lands in that fragment |
| What a page depends on | `Source.files`, already used by the dev server's watcher to know what to recompile |
| Where a path resolves | `Resolver`, including kits, so go-to-definition on `<:import src>` is a call the compiler already makes |

The missing piece was that the compiler read the **disk**. An editor's whole
job is the buffer that is not on disk yet, so diagnostics would have lagged
by a save — which for a language whose pitch is "before the page loads" is
the wrong kind of late.

So `readFile` is now a parameter, defaulting to the disk
([preprocessor.ts](../../packages/core/src/html/preprocessor.ts)). The
docroot and the kit table already parameterize *where* a pathname may land;
this parameterizes how the file it landed on is read. Resolution does not
move: a reader is handed a path the resolver already approved, so it cannot
widen what a page may reach — which is asserted rather than asserted-to, in
[read-file.test.ts](../../packages/core/test/read-file.test.ts).

## What the first version does

Ranked by what a markout author actually feels, not by what is easy:

1. **Diagnostics from the real compiler**, on the buffer, as it is typed.
   Not a re-implementation of a subset of the rules: the same `Compiler` the
   server and `build` run, so anything it catches the editor catches, for
   free and forever.
2. **Navigation, five kinds**, and the point of listing them is that each
   answers a question the text cannot: a custom tag, an attribute of one, a
   name, a scope, and a file. A custom tag goes to the `<:define>` that
   gives it meaning, which is usually in another file and is the thing a
   reader of a page most often wants — the compiler keeps that map because it
   needs it to compile at all, so the editor only has to ask.

   A name in an expression goes to the value that declares it — `${title}` inside a `<:define>` to its `:title=${…}` — which
   is the one an editor cannot approximate. A name belongs to the nearest
   enclosing scope; a usage site resolves from somewhere other than where it
   sits; slotted markup resolves from where it was *written*. Those are the
   language's rules, so core exports
   [`declarationFor`](../../packages/core/src/compiler/stages/stage4-resolve.ts),
   which is the same walk stage4 already did to decide whether a reference
   was known at all — one implementation, two callers, and no chance of the
   editor and the compiler disagreeing about what a name means.

   One line of markup shows why nothing shallower would do:

   ```html
   <li :for-each=${body.items} :for-as="item">${item}</li>
   ```

   Three names, three different questions. `body` is not a value at all but a
   named **scope**, whose declaration site is the element carrying the name.
   `items` is a value *inside that scope*, reachable only by navigating there
   first — it is not a property access, and looking outward from the cursor
   finds nothing. `item` is a loop alias, declared by the `:for-as` beside
   it. A text search answers none of the three.

   And `<:import src>` and `<:include src>` go to the file, using
   the compiler's own `Resolver` rather than a second copy of its rules —
   which is the difference between go-to-definition that works and one that
   works until it matters. Three rules the editor has no business
   reimplementing: `/lib.htm` is docroot-relative and not file-relative,
   `/npm/@markout/bootstrap-kit/all.htm` is inside an installed package, and
   a path leaving the docroot resolves to nothing at all. Only the
   directives' `src` is followed: a `<script src>` names a URL the browser
   fetches, whose place on disk depends on how the site is deployed.

   Two of these needed the compiler to say something it had not been asked
   before, and in both cases it already knew. An attribute of a custom tag
   goes to the *parameter* it sets, which is `customTags` again. And an
   `:aka` on a custom tag has no element to point at — the usage is spliced
   out of the tree once its values are handed over — so the answer is the
   earliest of its `callSiteValues`, a set that exists because a definition
   must not read its caller and happens to be exactly the list of things the
   author typed on that tag.
3. **Syntax highlighting** for `${…}` and `:`-attributes, so the language
   stops looking like malformed HTML.
4. **Completion of names.** `body.` offers what is in `body`; a bare name
   offers everything in scope. The list comes from `visibleFrom`, the
   listing half of the same walk `declarationFor` uses — so what is offered
   and what resolves are the same set, rather than a list of things that
   might work.

   The hard part is not the listing. Completion happens **while typing**, and
   `${body.}` is not valid JavaScript: the compile fails, and a failed
   compile has no scopes to ask, so the moment the list is wanted is the
   moment there is nothing to ask. So the expression under the cursor is
   repaired before compiling — its contents replaced by `0` and spaces, the
   same length, leaving every other offset exactly where it was. Only that
   one: another broken expression elsewhere is a mistake the author has yet
   to fix, and the diagnostics already say so.

5. **Hover**, which is go-to-definition for someone who does not want to
   leave the page — and shows the declaring line itself rather than a
   description of it, because a summary is a second thing to keep true and
   the source cannot go stale.

6. **Completion in markup**: `<x-` offers the tags a page can use, `<x-card :`
   the parameters that tag declares. Both are `customTags` again, so a kit of
   thirty components documents itself and its README stops being something
   anyone has to have open. Two things this needed:

   The compiler **tree-shakes unused definitions**, which is right for a page
   and wrong for an editor: shaken, `customTags` holds only the tags already
   typed, so a kit offers the three someone has got round to using.
   `treeshake` is now a compiler option, and the editor turns it off.

   And a half-written `<x-` is an unterminated tag, which fails the parse
   before any of this — so the partial tag is blanked out first, the same
   trick the expression case uses and for the same reason.

7. **Find all references**, which is go-to-definition run backwards and
   cannot be a text search for the same reason: two `title`s in two
   definitions are different things, and `body.items` is the same thing as
   `items` spelled differently. `referencesTo` in core resolves each recorded
   dependency the way the compiler resolved it and keeps the ones that land
   on the target — every prefix of it, since `body.items` reads a scope and
   a value both, and someone asking where `body` is used means that one too.

   What the compiler has no reason to record is *where inside* an expression
   a name is written, an expression being one thing as far as compiling goes.
   So the expression's source is sliced back out and the name found in it,
   which also answers a question a single range could not: a name read twice
   in one expression is two references.

8. **HTML's own features** — tag completion, attribute completion, folding —
   through `volar-service-html` over the embedded HTML. This is where the
   masking earns its place, and it is checked by asking for folding ranges on
   a page whose `<body :hidden=${a > b}>` would, unmasked, have ended that
   tag at the `>` and left the rest of the document as text.

## What it deliberately does not do yet

**TypeScript inside `${…}`.** This is the big one, and it is a project rather
than a feature. An expression does not resolve against the file's lexical
scope but against *the scope chain the compiler computes* — `${count}` in a
`<div :count=${0}>` means one thing, and the same text one element up means
an error. Giving TypeScript real types would mean generating a `.ts` file
that models the whole scope chain, which is the same shape of work as Vue's
`.vue` → TS transformation, and it wants the mapping infrastructure to be
solid first.

The order matters: **the mapping is what makes it possible, so the mapping is
what version one builds.** Highlighting and diagnostics need a fraction of it
and prove it works on real pages.

**A second editor.** The language server is a separate module from the VS
Code plumbing, and speaks LSP, so it can serve Neovim or anything else later.
Nothing in the first version is allowed to assume VS Code except the
extension entry point itself.

## It must not take HTML over

Markout claims no file suffix of its own — a page is a `.html` file like any
other, which is the positioning working as intended and the single hardest
constraint on this extension.

**It contributes no language.** A `contributes.languages` entry claiming
`.html` would not *extend* VS Code's HTML support, it would replace it: a
file gets exactly one language id, so every HTML file on the machine would
open as "Markout" and lose Emmet, the built-in IntelliSense, and every
extension registered against `html`. The grammar is an **injection** into
`text.html.basic` instead, which adds `${…}` and `:`-attribute highlighting
on top of the real HTML grammar rather than in place of it.

**Diagnostics are gated on the project, not the file.** Plain HTML is quiet
under the compiler, because markout is a superset — script contents are not
interpolated, and `{{…}}`, `{%…%}` and `<?php … ?>` mean nothing to it.
Measured, and the exception is exact:

| plain `.html` content | compiler |
| --- | --- |
| ordinary markup, `$5`, `50%` | clean |
| `<script>` with `` `hi ${name}` `` | clean |
| Handlebars, Jinja, PHP | clean |
| `${user}` in text or in `<style>` | reports it |

That last row is not a bug — `${…}` is markout's one interpolation syntax, so
a file containing it is indistinguishable from a markout page. It is also
exactly what JSP EL, Thymeleaf and Underscore templates put in `.html` files,
and reporting per file would put an error on every line of such a project.

So the extension looks for **evidence**, and either kind will do:

- **the page's own syntax** — a `<:…>` directive tag, or an attribute whose
  value is an expression (`:count=${…}`). Neither belongs to anyone else:
  Alpine writes `:class="open ? 'a' : 'b'"` and Vue `:prop="x"`, both quoted;
  Thymeleaf's `th:text` and an `xmlns:th` do not begin with a colon. It is
  the `=${` that is ours. Measured against every page and fragment in this
  repository, and against Alpine, Vue, Thymeleaf, JSP EL and Underscore.
- **the project** — the nearest `package.json` depending on `markout` or
  `@markout/*`.

The first is the one that matters, and a project-only gate was the first
version's mistake. Markout's delivery story is that you install *nothing*:
write the pages, `npx markout ./markout`, done. Such a project has no
`package.json` at all, so a gate that required one would be silent for
exactly the audience the language is pitched at.

`${…}` on its own is deliberately **not** evidence, though it is markout's
one interpolation syntax — because it is also JSP EL's and Underscore's, and
a page holding nothing else cannot be told apart from theirs.

`markout.enable: always` remains the escape hatch.

### The docroot matters more than it looks

Guessing it wrong does not lose a feature, it **invents an error**:
`<:import src="/lib.htm" />` stops resolving, and the extension reports a
missing file that is sitting right there. A false error is worse than
silence, so the guess has to be one an author can predict and correct.

Nearest ancestor wins, and two things count as claiming it: **a directory
named `markout`**, and **a `package.json`**. The first exists for the
no-install mode, where the folder name is the only thing an author can say it
with — and it is that name rather than `public`, `www` or `static` on
purpose, since those belong to every static-site tool there is and claiming
one would mean guessing at a Rails app's docroot. `markout.docroot` overrides
both.

**That convention is the language's, not the editor's**, which is what makes
it usable at all: bare `markout` serves `./markout` and bare `markout build`
compiles it into a sibling `./dist`, so the name means the same thing to the
CLI, to a build and to this extension. An editor-only convention would have
been a second thing to learn that only one tool honoured; see the README.

## A fragment is not a page, and is checked anyway

`.htm` fragments got no diagnostics at all to begin with, on the reasoning
that a fragment has no scope chain of its own. That is half true, and the
half that is false is where kit authors spend their time.

Compiling one on its own does not work, and the way it fails is instructive:
`<:import>` is legal only directly in a `<head>`, and a fragment has no head,
so **37 of the 45 fragments in this repository** would light up with a rule
they do not break. Nor is compiling it optional-but-lenient the answer — an
`<:include>`d fragment is an *instance*, and instances resolve names where
they are written, so on its own every name its host supplies reads as
unknown.

Errors belonging to that page are then dropped rather than reported, which is
the half that was missing at first: `lib.htm` opened in the fixture was
compiled through `broken.html`, which imports it and is broken on purpose,
and the fragment was blamed for the page's typo. A file is told about its own
faults; what a page thinks of its imports is the page's business, and is
already reported there.

So a fragment is compiled the way it is used: through a page that imports it.
A real one where the docroot has one, found by reading the pages and seeing
which names this file; and otherwise a page whose only job is to import it.
All 29 parts of the Bootstrap kit come back clean, and a typo in one is
reported in the fragment, on its line.

## Answering four times per keystroke

Diagnostics, completion, a definition and a hover can all be asked against
the same buffer, and compiling Orbit costs about 125ms. Compiled pages are
therefore kept for a quarter of a second, keyed on the text they were
compiled from.

A TTL rather than a dependency graph, deliberately. Correct invalidation is
"any file this page read has changed", which the compiler can only report
*after* compiling; 250ms of staleness is imperceptible and needs no
bookkeeping that can itself be wrong. The installed-kit scan is kept longer,
since an `npm install` is rarer than a keystroke.

The text a caller passes is both the content compiled and the cache key, and
that is not a convenience: allowing them to differ allows a cache keyed on
text that was never compiled, which answers about a file nobody has. Two
tests were already making that mistake when the key was introduced, and said
so immediately.

## What the wiring turned out to be

Two things about Volar that the documentation states and that are still
easier to learn from a failing test:

**A service is asked about virtual documents, not about files.** The URI a
service receives is `volar-embedded-content://<code id>/<the encoded source
uri>`, so a check for `scheme === 'file'` rejects everything and the
extension silently reports nothing at all. `context.decodeEmbeddedDocumentUri`
gets the source back — and because every embedded code is asked, exactly one
of them has to answer, or the same compiler error arrives once per embedded
document.

**A document link beats go-to-definition, and the HTML service makes its
own.** `volar-service-html` offers a link for every `src`, `<:import src>`
included, and resolves an absolute one against the *workspace folder*. In any
project whose docroot is a subdirectory that names a file which does not
exist, so ctrl-click answered "Unable to open" — on a link the extension
itself had offered — while the definition provider sat there being correct
and unused. The fix is not to compete: `getDocumentContext` is the supported
hook for telling that service how to resolve a reference, so it is given the
compiler's resolver and its links become right, `/npm/…` included.

**A definition has two ranges, and they are not the same range.** LSP's
`targetRange` is the whole of the thing, for a peek preview; its
`targetSelectionRange` is the point the cursor is put on. Setting both to the
extent works for a value, whose declaration is one attribute, and fails
silently for a scope, whose declaration is an ELEMENT — asking an editor to
reveal a region the cursor is already inside gets the only sensible answer,
which is nothing at all. `head` appeared to work throughout, for the sole
reason that a page's `<head>` does not contain the `<body>` the click was in.
That is what "`head` works, `body` and `page` do not" turned out to mean.

**Completion is a list several services build, and the first to answer
claims it.** Volar visits embedded documents innermost-first, so
`volar-service-html` answers on the embedded HTML before this service is
reached on the root, and every other provider is then skipped — a markout
list that never appears at all, with nothing anywhere reporting a problem.
Declaring the contribution `isAdditionalCompletion` is what merges it
instead of competing, and it has to be offered against the same document the
claim was made on, which is the embedded HTML rather than the root.

**Pull diagnostics are off unless the client asks for them.** A client that
advertises no `textDocument.diagnostic` capability gets silence from
`textDocument/diagnostic`, which reads exactly like a broken server. Volar
also publishes diagnostics the old way, so a real editor sees them either
way; a test harness pretending to be an editor has to say what it supports.

Both were found by [server.test.ts](../../packages/vscode/test/server.test.ts),
which starts the built server over stdio and asks it a question. That test
exists precisely because the failures it catches — a plugin never registered,
a capability never announced, a `main` pointing at nothing — leave every unit
test green and the extension doing nothing.

## Shape

```
packages/vscode/
  src/
    plugin.ts     the Volar language plugin: a page -> its virtual code
    server.ts     the language server (LSP, node)
    client.ts     the VS Code extension entry point
  syntaxes/       the TextMate grammar
  package.json    contributions: languages, grammars, configuration
```

Depends on `@markout/core` and nothing else of ours — which is the constraint
the whole [monorepo split](monorepo.md) existed to satisfy, and the one thing
here worth asserting rather than intending. It is:
[dependencies.test.ts](../../packages/vscode/test/dependencies.test.ts) walks
the declared closure and fails if express, compression, commander or the CLI
appear in it, with a companion assertion against the CLI so a walk that finds
nothing cannot pass for a clean result.

The split did its job.
