# Kits from npm packages

Status: **built**. Discovery and the mount table are in
[src/kits.ts](../../packages/core/src/kits.ts), resolution in [src/paths.ts](../../packages/core/src/paths.ts), the
publishing rules shared by both consumers in
[src/server/publish.ts](../../packages/core/src/publish.ts). A page imports a kit through
`/npm/`, the middleware serves the kit's resources at its logical root, and
`build` materializes them there.

This file records the decisions and the reasoning behind them; user-facing
documentation will live in
[the syntax reference](../reference/syntax.md) once there is something to
document. Supersedes the one-line sketch at [TODO.md](../../TODO.md) item
"component kits from npm packages", whose parenthetical is wrong — the
preprocessor has exactly one root today and no support for additional
folders.

## The problem

A kit is a directory of `.htm` fragments and, usually, resources —
stylesheets, images, fonts. When this was written, a kit reached a page by
being *inside the docroot*: the bootstrap kit sat next to the pages that
imported it, and the std kit reached them through a symlink. That works for
kits shipped in this repository and for nothing else.

(Both are packages now — see [the monorepo split](monorepo.md) — and the
pages that use them import through `/npm/`, which is this design in use
rather than under test.)

Publishing a kit as `@markout-lang/bootstrap-kit` puts it under `node_modules`,
outside the docroot, which two things currently forbid on purpose:

- the preprocessor confines every load to the docroot
  ([src/html/preprocessor.ts](../../packages/core/src/html/preprocessor.ts));
- `build` skips `node_modules` when walking for assets
  ([src/server/build.ts](../../packages/cli/src/server/build.ts)), so a docroot of `.` in a
  project root does not produce a deliverable measured in gigabytes.

Both are right. The feature is a hole punched through them deliberately, in
one place, rather than a loosening of either.

## The shape of it

The thing to get right first: **importing a fragment and publishing a
resource are not the same operation**, and an early sketch that spelled them
identically (a `$npm` prefix usable in both `<:import src>` and `<img src>`)
hid that rather than solving it.

`<:import src="…">` is resolved by the preprocessor at compile time, against
the filesystem, and its result is *inlined*. The path never survives into
output. That is module resolution.

`<img src="…">` must survive into the served HTML as a URL a browser
fetches. Nothing is read at compile time. It needs a URL space, a route in
the middleware, and a copy step in `build`. That is publishing.

They share a resolver — package name to directory on disk — and nothing
else. So they get one spelling each.

## The standard kit is implicit

`@markout-lang/std-kit` is the one kit a page does not import. It is the
system parts of a page — data sources, the outside world — written with the
language rather than built into it, which makes it *part of* the language;
and a part of the language you have to import is ceremony HTML asks for
nowhere else. `@markout-lang/core` depends on it, and the preprocessor
splices `<:import>` for it into the head of every page it compiles.

Three rules keep that a convenience rather than a claim on the namespace:

- **It goes in first**, ahead of anything the page wrote. `page.customTags`
  is filled in document order, so a page's own `<:define tag="std-data">`, or
  a kit imported after it, silently wins the name back. Nothing implicit can
  take a name away from an author.
- **The explicit import still works.** `<:import>` is once-only *by resolved
  pathname*, so a page that says it out loud gets it once, not twice. Pages
  written before this are unaffected.
- **Absent is absent.** The splice happens only when the kit is actually
  mounted, so a docroot without it compiles exactly as it did, with no error
  and no mention.

The decision lives in the **compiler**, not in the preprocessor. Which
package is special is a question about the language; the preprocessor
processes HTML, and knowing the name of a kit is not its business. So it
takes `autoImports`, a list of pathnames to splice into a page's head, and
asks nothing about them; the compiler is what puts the standard kit on that
list, when — and only when — the mount table it was handed has it.

It is spliced through the kit's **mounted root** (`/std-kit/all.htm`), not
through `/npm/@markout-lang/std-kit/all.htm`. Both land on the same pathname —
which is what lets the once-rule dedupe them — but the mount table is the one
this compiler was handed and has already validated, while `/npm/` resolves a
second way, by walking `node_modules` up from the docroot. A host that
arranged the tree differently would fail on the second and not the first, and
did: the kit suites mount the real kits into a temp docroot with no
`node_modules` under it at all.

Measured, on a trivial page: 0.2ms to compile without it, 1.3ms with. Nothing
reaches the output, because treeshaking drops what the page never mentions —
a page that ignores the kit ships exactly what it shipped before.

## The contract

> **`<:import src="/npm/<package>/<file>" />` loads a fragment from an
> installed package. The package declares a logical root; everything it
> publishes is addressed under that root, as though the package sat there
> in the docroot.**

For the Bootstrap kit, declaring `/bootstrap-kit`:

```html
<html>
  <head>
    <:import src="/npm/@markout-lang/bootstrap-kit/all.htm" />
  </head>
  <body>
    <img src="/bootstrap-kit/res/logo.png">
  </body>
</html>
```

Two spellings, one job each. The import names *where the code came from*,
which is the one place provenance is worth stating. Every other reference
names *where the kit lives*, which is the only thing a URL can mean.

### The declaration

In the kit's own `package.json`:

```json
{
  "name": "@markout-lang/bootstrap-kit",
  "markout": {
    "root": "/bootstrap-kit"
  }
}
```

One key, and it is **mandatory**. An optional root implies a fallback
(`/npm/<pkg>`, say), and a fallback means two URL spaces for the same files,
which is the thing this design exists to avoid. A package without it is
refused at the point of import, with a message naming the package and the
key.

#### Why it is not derived from the package name

`@markout-lang/bootstrap-kit` → `/bootstrap-kit` is a rule the compiler could
apply on its own, and it is the obvious way to spare kit authors a
declaration. It is not taken, for three reasons of increasing weight.

**It does not inherit npm's uniqueness.** The registry guarantees the *full*
name is unique; scopes exist so that the unscoped part need not be.
`@markout-lang/bootstrap-kit` and `@acme/bootstrap-kit` install side by side
quite legally, and both derive `/bootstrap-kit` — so refusal 2 fires on a
collision the derivation rule manufactured, between two packages the
application author chose correctly and cannot edit. Deriving the full name
avoids that and lands on `/@markout-lang/bootstrap-kit/res/logo.png`, which is the
`/npm/` URL space rejected below wearing a different prefix.

**It couples the URL space to the package name.** A scope change, a
transfer, a fork then rewrites every URL in every consuming page — and every
URL the kit's own files hold, since those hard-code the root. Hard-coding is
only safe because `root` is a thing the kit declares and therefore owns.

**A vendored kit has no package name.** This is the one that settles it. The
equivalence above says everything behaves as though the kit were symlinked
into the docroot *under its logical name*, and an explicit `root` is what
tells an author which name that is. Derived, the rule degrades to "name the
directory after the unscoped part of the package it used to be" — folklore
rather than a declaration, and one that breaks the kit's own internals
silently when guessed wrong. The declaration is the kit's identity in a
docroot's namespace, and it has to outlive the kit being a package at all.

Note what separates this from the `public` key rejected below, because the
two questions look alike and are not: **npm already owns what a package
ships, so a second answer duplicated it. npm does not own a site's URL
space.** That is the test for whether a key earns its place here.

What the derivation *is* good for is the ergonomics, without the coupling.
The cost being avoided is real but is paid once, by the kit author, at
authoring time — so the compiler should suggest rather than decide:

- a missing `root` is refused with the derived name in the message —
  `@markout-lang/bootstrap-kit declares no markout.root — add "markout": { "root":
  "/bootstrap-kit" }` — so nobody has to invent a name, they paste the line;
- the same derivation validates, warning when `root` and the package name
  have diverged, which is usually a rename somebody left half-finished.

### Everything else in the kit is public

There is deliberately no second key listing what may be served. A kit
publishes its whole directory, exactly as a kit sitting in the docroot does
today, minus the three things the docroot already excludes:

- **`.htm`** — the middleware refuses the extension and `walk` declines to
  copy it, so a kit's fragments reach the browser inlined into the pages
  that imported them and never as files.
- **`node_modules` at any depth** — the rule `walk` already applies, for the
  reason it already gives: a deliverable should not be measured in gigabytes.
- **dot-prefixed names**, minus `SERVABLE_DOTFILES`
  ([src/server/publish.ts](../../packages/core/src/publish.ts)) — same walk, same
  allow-list.

Same walk, same refusals, a different root. That is what makes "as if
physically there" true rather than approximately true, and it is the reason
vendoring a kit does not change how it behaves.

### The one exception: pages need permission

A kit's `.html` files would follow from all of the above too — a symlinked
directory of the same name gives pages, so this should give pages. It does
not, unless the importing page says so:

```html
<:import src="/npm/@markout-lang/showy-kit/all.htm" allow-pages />
```

The reason is measured rather than supposed. A kit shipping a broken
showcase page turns the CONSUMER's build red over a file they did not write
and cannot edit — their own pages compile and are written, and the exit code
is 1 regardless. Publishing a dependency's pages by default puts that failure
one careless kit away from anyone.

`allow-` rather than `with-`, because this is a permission and not a
packaging option — the same sense as an iframe's `sandbox="allow-scripts"`,
where a host grants embedded third-party content a capability it does not
otherwise have. What is granted here is space in the site's own URL
namespace, which is what every refusal above exists to protect.

Counted only from a **docroot page's own `<head>`**, never from inside a
kit's fragment: a kit could otherwise opt itself in, which is exactly the
squatting refused everywhere else. And derived by scanning the whole docroot
rather than accumulating as pages are compiled, so the server answers
`/showy-kit/index.html` the same way whether or not anything has been visited
— a set that grew with traffic would make the answer depend on what somebody
looked at first. One function, `allowedPageKits`, serves the middleware and
`build` alike, for the same reason the publishing rules are shared.

This is the design's second deliberate departure from the symlink
equivalence, and unlike the first — the import spelling — it is about URLs.
Stated here rather than left to be discovered, since the sentence "a kit
behaves as though symlinked into the docroot" now has two footnotes and both
are load-bearing.

What a kit ships remains npm's question — `files` and `.npmignore` — and the
build's habit of reporting the extensions it copied rather than a count is
what gives anyone the chance to notice a kit shipping sources.

An earlier draft of this file had the kit declare a published subtree
instead. It was wrong twice over. A **published package's tarball is already
public** — anyone can fetch it from the registry — so serving
`/bootstrap-kit/package.json` discloses nothing that `npm view` does not,
and the nested `node_modules` that a tarball does *not* contain are
themselves published packages, where the cost is weight rather than secrecy.
And a kit that published only what it declared, while a vendored copy of the
same kit published everything, would make vendoring a change in behaviour —
breaking the equivalence the rest of this design is built on.

What a kit author controls is what they *ship*, and npm already owns that
question: `files` and `.npmignore`, enforced at publish time by a mechanism
every npm author already knows. A markout-specific second answer would
duplicate it and disagree with it.

The consequence is one the docroot already carries, and the build already
handles the same way: a kit shipping `.ts` sources or test fixtures lands
them in the output. `build` reports the extensions it copied rather than a
count, precisely so somebody notices before the output is uploaded
somewhere — see [TODO.md](../../TODO.md) on the same footgun in a docroot. That
report becomes more useful here, not less, because these are somebody else's
files.

One case does deserve a warning in the docs rather than a mechanism: a kit
under `npm link` resolves to its author's working tree, which holds tests,
scratch files and whatever else. Dotfiles and `node_modules` are already
excluded, so `.git` and `.env` are not the exposure — but building against a
linked kit will copy more than the published one would.

## The equivalence

The test this design is held to, and the one to re-run against any change:

> **Everything behaves as though, having installed the kit, you had made a
> symlink to it from the docroot under its logical name.**
>
>     ln -s node_modules/@markout-lang/bootstrap-kit docroot/bootstrap-kit

Not an analogy. That arrangement *existed in this repository* when this was
written — the std kit was reached through exactly such a symlink, and
[build.ts](../../packages/cli/src/server/build.ts) still carries the comment
explaining that `walk` follows one deliberately. So the model was never a
thought experiment about how a kit ought to behave; it was a kit that already
behaved that way, and the feature is the same behaviour reached without the
manual step. The symlink is gone because the feature replaced it.

It holds throughout, and in the two places where the reasoning was least
obvious it is what confirms them:

- **The mount table deriving from installation rather than from imports.**
  The symlink exists whether or not any page imports the kit, so its
  resources are servable and buildable regardless. A table built from
  imports would be a table the symlink model does not have.
- **The refusals being refusals.** `ln -s` fails when the name is taken.
  That is refusal 1 exactly, and refusals 2 and 3 are the same failure
  reached by a second and third link. The list is not a set of rules chosen
  for this feature; it is what the model already does.

Confirmed too, at less cost: `.htm` fragments, `node_modules` and dotfiles
are excluded because that is what happens to a symlinked directory today,
and a transitively installed kit gets a mount of its own because that is a
second symlink — which is, again, literally what the std kit's link was.

### Where it deliberately does not hold

The import spelling, and only that. Under the model a page would write
`<:import src="/bootstrap-kit/all.htm" />`; here it writes
`/npm/@markout-lang/bootstrap-kit/all.htm`.

Decided, and worth being clear that refusal 6 forbids something that would
otherwise work: with the mount table derived from installation, the logical
root resolves perfectly well at compile time, so refusing it there is a
choice rather than a limitation. What the choice buys is an import line that
says whether it means a directory in this docroot or a package in
`node_modules`. What it costs is that vendoring a kit is no longer a change
of nothing — see below.

The equivalence is therefore exact for every *URL* a page contains, and
deliberately inexact for the one line that is not a URL at all.

## What the server and the build each do

The server **simulates**. A request for `/bootstrap-kit/res/logo.png`
resolves through a mount table to the package directory and is served from
there; nothing is copied.

The build **materializes**. Each kit's published subtree is written into the
output at its logical root, so the deliverable is an ordinary directory tree
with `/bootstrap-kit/res/logo.png` physically in it. A static host needs to
know nothing.

> **Both tables derive from what is installed, never from what was
> imported.**

This is the rule most easily got wrong, and the consequence is the failure
mode every other decision here is trying to avoid. The server has no choice:
a request for a resource must resolve before any page is compiled, so its
table comes from scanning installed packages at startup. If the build
instead materialized only the kits some page imported — which
`Source.files` ([src/html/parser.ts](../../packages/core/src/html/parser.ts)) makes easy and
precise, since it holds the whole transitive closure of what a page read —
then a page referencing a kit's resource *without* importing it would work
in dev and 404 in the deliverable.

Deriving both the same way makes dev and built agree by construction rather
than by discipline, which is the same standard the `:server-` work was held
to. Pruning mounts no page references is a later optimization behind a flag,
not the default.

## Globally installed kits

Discovery walks `node_modules` up from the docroot, and a docroot with no
project around it has none to walk. That is the audience the language is
pitched at, and it is exactly the audience that cannot install a kit anywhere
the walk would look.

So there is a fallback: a caller may offer its own install tree as a last
resort. A globally installed CLI *sits inside* the global `node_modules`, so
walking up from its own location arrives there without anyone having to find
the prefix — the same code path serves a local install, where it arrives at
the project's `node_modules` that the main walk already covered. The extension
cannot use that trick, since it lives under the editor's extensions directory
and `process.execPath` is the editor rather than the user's node, so it asks
`npm root -g` once per language server and passes the answer in.

Asking is two questions, though, because the obvious one frequently has no
one to answer it. The language server is a child of the extension host, and
an editor started from the Dock or the Finder on macOS is a child of launchd,
whose PATH is `/usr/bin:/bin:/usr/sbin:/sbin` — no Homebrew, no nvm, no fnm,
no volta, and so no npm. VS Code resolves the login shell's environment to
paper over exactly this, but it is best-effort: skipped when the editor was
started from a terminal that already had a good PATH, able to time out, and
turned off by `terminal.integrated.inheritEnv: false`. When it does not
happen the spawn fails with ENOENT, the answer is "no global kits", and it is
silent — for precisely the audience the fallback was built for, whose pages
then report every tag their kit defines as an unknown one.

So the second question goes to the login shell (`$SHELL -ilc 'npm root -g'`),
which is where a version manager put npm on the PATH to begin with —
*interactive* as well as login, since nvm, fnm and asdf define themselves in
`.zshrc`/`.bashrc`, which a non-interactive login shell never reads. It is
second and not first because it is slow: an interactive zsh with a prompt
framework in it can take seconds, and `kitsFor` is synchronous, so a compile
would wait on it. It therefore runs in the BACKGROUND — the lookup answers
"none yet" and the real answer lands in time for the next scan a few seconds
later, which is a kit appearing shortly after the window opens. That is the
same thing the scan's TTL already does for a kit installed while the window
is open, so it needs no new behaviour to be understood by.

The fallback is taken only when the docroot walk found **no kits at all**.
Appending it unconditionally would be worse than useless: a project with its
own copy of a kit, on a machine that also has a global copy, would find both —
and two kits claiming one root is a refusal, not a choice. A build would break
because of an install that had nothing to do with it. Gating on an empty
result makes that unreachable rather than unlikely.

What it costs is a rule that has to be read rather than deduced: a docroot
with one kit of its own sees none of the global ones. The alternative, merging
the two, would make what a docroot builds depend on the machine that built it
— which is the property walking up from the docroot, and not from the working
directory, exists to protect.

## Refusals

A kit picks a path in somebody else's URL space. That is the price of the
kit declaring its own root, and it is paid with refusals rather than with a
precedence rule. In every case below, both orders of precedence are wrong
and silently so — the same argument `build` already makes about a docroot
file colliding with the runtime's filename, which refuses rather than
resolving.

The shorter justification is the equivalence above: **`ln -s` fails when the
name is taken.** Every refusal here is that failure, reached by a different
route.

1. **A real `/bootstrap-kit/` in the docroot.** Preferring the docroot
   shadows the kit; preferring the kit shadows the author's own files. Refuse
   at startup and at build, naming both paths.
2. **Two kits claiming one root.** Refuse.
3. **Two versions of one kit.** npm's nested installs make this a legal tree,
   and both copies declare the same root. A site cannot serve two versions of
   a kit's assets at one URL, so refuse rather than pick.
4. **A root that is not a single absolute path**, `/` most of all.
5. **`/npm/…` requested over HTTP.** It is a compile-time spelling that
   reaches the filesystem and dies there. Serving it would give the same
   bytes two URLs with no reason to prefer either — and, unlike the logical
   root, one that no rule above governs.
6. **An installed kit's logical root used in `<:import src>`.** The reverse
   of the above: one spelling per job, so an npm kit is imported as
   `/npm/<package>/…` and never as `/bootstrap-kit/…`.

   Scoped to *mounts*, and the scope matters. A kit that is genuinely a
   directory in the docroot — vendored, or copied in by a test that has no
   `node_modules` above it — is imported through its docroot path as it
   always has been, because there is no package to name. The two
   cannot be confused for one another: refusal 1 means any given path is a
   mount or a real directory, never both.

## The resolver

The implementation cost is not the mount table. It is that path containment
stops being a test against a constant.

Four places currently do their own `path.resolve` and their own containment
check: the preprocessor's `loadText`, the middleware's `resolvePath` and
`handleNonPageRequests`, and `build`'s `walk`/`copy`. Two of them already
carry near-identical comments about the same sibling-prefix hazard. They
become callers of one resolver — logical path in, `{ root, realPath }` out
or a refusal — and `express.static(docroot)`, which knows nothing about any
of this, needs a mount-aware sibling.

The existing test survives intact, with the root as a parameter rather than
a constant. Three things ride along with it:

- **Normalize the logical path before matching the mount prefix.** Today's
  join-then-normalize order catches `/bootstrap-kit/../secret` either way.
  What it misses is the other spelling — `/foo/../bootstrap-kit/res/x.png`
  fails to match the mount, falls to the docroot branch, and 404s, so the
  same file resolves or not depending on how it was typed. Express normalizes
  `req.path` before the middleware sees it, so the server side is already
  consistent; import paths come from source text and are not.
- **The sibling-prefix guard gets more load-bearing, not less.** It was
  written against a hypothetical `/a/site` versus `/a/site-other`. In
  `node_modules`, `@markout-lang/bootstrap-kit` and a
  `@markout-lang/bootstrap-kit-extras` are literal directory siblings.
- **Containment must stay lexical, and that is now a decision rather than an
  accident.** Under pnpm every dependency directory is a symlink into a store
  outside the project, so a `realpath`-based check would refuse every
  legitimate install. It answers "did the logical path escape its logical
  root", not "these bytes came from inside the package". Worth a comment
  where it is written, because `walk` does call `realpath` — correctly, for
  cycle detection — and the next reader will wonder why containment does not.

Containment answers escape, not precedence. The refusals above are separate
checks and need their own code.

**Transitive imports resolve relative to the importing file.** The Bootstrap
kit imports the std kit; that must resolve from *its* `node_modules`, not the
application's, or nested and pnpm installs find the wrong copy or none.

## What this costs

**Vendoring is no longer free.** An earlier variant — importing through the
logical root, `<:import src="/bootstrap-kit/all.htm" />`, with no `/npm/`
spelling at all — made removing the package and copying the folder into the
docroot a change of exactly nothing. Here the import lines have to be
repointed: one per page, in `<head>`, while every resource reference stays
identical because those already speak in logical paths.

Accepted, on the grounds that where the code comes from genuinely changed,
so the one line that names its origin genuinely should. What was bought for
it: an import site that says whether it means a directory in this docroot or
a package in `node_modules`, which the overlay-only spelling could not.

And the line it is repointed *to* is not a special case — it is the ordinary
docroot spelling, `<:import src="/bootstrap-kit/all.htm" />`, which works
because after vendoring the kit really is there. The edit tracks a fact that
changed rather than working around a rule.

**The file watcher will not see kit edits** — but this one is not a cost of
the feature, it is a bug the repository already has. `fs.watch` with
`recursive: true` does not follow symlinks (measured, not assumed: a write
through a symlinked directory produces no event, a direct write does), so
editing `kits/std-kit` today does not invalidate the compiled pages
under `kits/bootstrap` that imported it. An npm kit under `npm link` is the
same gap by the same mechanism.

So the equivalence holds here too, unhappily. Worth fixing on its own
merits, and worth fixing before kits are developed against a live server
rather than after — it is the kind of thing that is debugged for an hour
before the watcher is suspected, which is the reason
[src/server/middleware.ts](../../packages/express/src/middleware.ts) declines to cache at
all when it cannot establish a watcher.

### Installed kits are not watched, and should not be

A fix for the symlink gap must not turn into watching `node_modules`.

An installed package does not change except through `npm install`, which is
not a per-file edit but a restart-shaped event. The mount table settles the
matter on its own: it is built at startup from what is installed, so a kit
installed while the server runs has no mount and is not servable regardless
— watching its files would be watching something the server cannot answer
for. Startup-scanned table, startup-fixed contents, both refreshed by the
same restart.

There is an active cost too, not merely an absent benefit. A recursive watch
over `node_modules` is the standard way to exhaust inotify watches on Linux,
and because invalidation here is deliberately blunt — any change clears the
whole cache — an `npm install` would clear it repeatedly while it ran.

The carve-out is `npm link`, where the kit is a working tree under active
edit and behaves like a source directory rather than a dependency. That is a
different case and should be opted into explicitly rather than reached by a
heuristic over resolved paths: pnpm makes every dependency a symlink, so
"resolves outside `node_modules`" does not separate a linked kit from an
ordinary one as cleanly as it first appears.

Worth noting it is not the current workflow either. The kits in this
repository reach their docroots by symlink, not by installation, so fixing
the symlink gap covers kit authoring as it is actually done today.

## Rejected along the way

**A `$npm` runtime global.** `$origin` earns its `$` by meaning the same
thing on the server and in the browser
([src/runtime/core/core-global.ts](../../packages/core/src/runtime/core/core-global.ts)), and a
filesystem resolver does not exist in a browser at all. Mechanically it was
worse than wrong: globals are read from `${…}` expressions, so a bare
`$npm/…` in an attribute is a literal string the compiler does not look
inside. Making it work would have meant rewriting attribute values textually,
whose failure mode is a URL built in an expression, or a `url()` in a kit's
stylesheet, silently not being rewritten.

**A `/npm/` URL space for resources.** Coherent, and it removed the global
entirely — but it put a framework-reserved directory in every deliverable,
and it made the kit's own files name their own package in every reference,
which breaks the moment anyone vendors or forks the kit.

**`<:import … to="/bootstrap-kit" />`, the app naming the mount.** Reads
well and keeps the output looking hand-written, but the mount then lives in
the `<head>` of pages the server compiles lazily, so a resource request
cannot be resolved until some page has been rendered — true often enough to
hold until a cached page, a deep link, or a restart. It also left transitive
imports with nobody to name them: a kit importing another kit would be
picking a top-level path in an application it has never seen. And `<:import>`
is once-only, so a second import of the same kit with a different `to` would
have been silently ignored, leaving half of one page's URLs wrong.

**The pure overlay, with no `/npm/` spelling.** Discussed above under what
this costs. Genuinely close; it lost on the import site being unable to say
where the code came from.

## Open

- **`$base`.** A per-file compile-time constant folding to the public URL of
  the directory a file came from, so a kit's internal references need not
  name the kit. With `root` mandatory and collisions fatal, a kit can simply
  hard-code its own declared root, so this is not needed to ship. It becomes
  needed the moment an application wants to *remap* a kit — the escape hatch
  a fatal collision otherwise lacks. Deferred, not dismissed.
- **Whether the loader should be confined to declared entry points.** Today
  the answer is no — `<:import src="/npm/@markout-lang/bootstrap-kit/parts/card.htm" />`
  reaches a single part directly rather than going through `all.htm`, which
  is what a kit sitting in the docroot already allows. Whether a kit should
  be able to say otherwise is open; npm's own `exports` is the obvious place
  for it to say so, which would keep the answer where the last one landed.
- **Cache headers for materialized resources.** A version-qualified root
  would buy immutable caching, at the cost of the logical root no longer
  being a name an author writes.
- **The watcher not following symlinks**, per above. Pre-existing, verified,
  and independent of this feature — a `walk`-driven watch list would close
  it, and must be scoped to the docroot's own tree so that it does not
  extend to installed kits, which are deliberately not watched.
- **Whether `npm link`ed kits get watched at all**, and if so by what opt-in.

## Sequencing

The resolver extraction stands on its own merits and can land first: the two
containment checks are already near-duplicates commenting separately on the
same hazard, and consolidating them is worth doing whether or not any of
this follows.
