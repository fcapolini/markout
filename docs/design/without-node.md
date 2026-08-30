# Working without Node

Status: **built.** `.markout/kits/` is a rung on the discovery walk;
`.markout/kits.json` is read by the compiler, so a kit the project asked for
and has not got is now a sentence rather than a blank region of a page;
`markout add` / `markout restore` install kits with no npm anywhere; and the
sidebar installs, removes, restores, searches, offers bumps, previews and
builds. [Settled](#settled) holds the questions this file opened with and
their answers.

**This mode delivers one of markout's three ways to deliver a page, and it is
the one that needs no Node to serve it.** See
[what it does not do](#what-this-mode-does-not-do), which is a boundary rather
than an omission.

The kit *contract* is unchanged and lives in
[npm-kits.md](npm-kits.md): a kit is an npm package with a declared root, it is
imported through `/npm/`, and it behaves as though symlinked into the docroot.
All of that holds however the files arrived. This file is about how someone
with no Node gets those files, which is a different subject with a different
audience.

## The audience, and what it could not do

The language is pitched at people who write HTML: designers who code, backend
developers with a templating layer they would rather not have, anyone
maintaining a server-rendered application. Almost none of them have Node, and
none of them want it.

[npm-kits.md](npm-kits.md) already reached for this audience once, in its
*Globally installed kits* section, and said so plainly — a bare docroot has no
`node_modules` to walk, "that is the audience the language is pitched at, and
it is exactly the audience that cannot install a kit anywhere the walk would
look." The answer there was a fallback: ask `npm root -g`, and if the language
server has no npm on its PATH, ask the login shell in the background.

[global-kits.ts](../../packages/vscode/src/global-kits.ts) is the record of
that not working for them. The language server is a child of the extension
host; an editor started from the Dock or the Finder is a child of launchd,
whose PATH is `/usr/bin:/bin:/usr/sbin:/sbin` — no Homebrew, no nvm, no fnm, no
volta, and so no npm. VS Code's login-shell resolution papers over it
best-effort and is skipped, timed out or disabled often enough to matter. A Mac
with Homebrew's npm beside a version manager's has two global roots, and `npm
root -g` answers truthfully about the wrong one. Every one of those failures
produces the same symptom: no kits, silently, and a page reporting every tag
the kit defines as an unknown one.

So the mechanism built for the non-npm audience requires npm, on a PATH they
do not have, in a copy that may not be the one that answers. That is what has
to change, and the sidebar below is what changes it.

## The Markout sidebar

Four things, in a view of its own:

- **"Who is this for?"**, at the top, linking to
  [the Markout sidebar](../reference/vscode-extension-sidebar.md) in this
  repository.
- **A list of kits, with checkboxes.** Ticking one installs it into this
  project; unticking removes it.
- **Preview** — serve the docroot in dev mode, `--client`.
- **Build** — write the deliverable to `dist/`.

The link is first because the sidebar is the first thing a new user sees and
it raises a question it cannot answer in a tooltip: *there are two ways to
install a kit here, which is mine?* The doc answers it in a table — npm mode
for people who have Node, without-node mode for people who do not — and then
says why the second exists at all, which is the part that makes the sidebar
read as a considered path rather than as a beginner's mode.

Pointing at a file in the repository rather than at a website is deliberate:
it versions with the extension, it is readable offline, and it is editable by
the same pull request that changes the behaviour it describes.

No terminal appears anywhere in that, and neither does npm. The extension
already depends on `@markout-lang/core` and runs it in the language server's
process ([server.ts](../../packages/vscode/src/server.ts)), so the compiler is
*already* inside the editor — there is no toolchain to hide, only one that
never has to be installed.

Build drives that in-process compiler. Preview needs a server, so it spawns
the bundled `markout` command with `process.execPath` — the node the editor is
already running on, which answers the PATH objection above without a lookup
of any kind: there is nothing to find, because it is the interpreter already
running the code that spawns it.

## What this mode does not do

**It builds pages that render in the browser, and it does not render on a
server.** Both buttons work in that one delivery mode: `Build` compiles and
stops, and `Preview` serves exactly what `Build` writes. Of markout's
[three ways to deliver a page](../concepts/isomorphism.md), this is the third.

That is a boundary and not a gap, because it follows from the premise. This
mode is for somebody with **no Node** — so *served by Node* is a delivery they
cannot deploy, and *prerendered* is a build they cannot run: both are a render,
and a render is Node executing the page. A sidebar offering either would be
offering something its user cannot use, and would be running a kit's code on
their machine to do it ([code-execution.md](code-execution.md)).

So the line is drawn where the premise draws it:

| | without-node mode | npm mode |
| --- | --- | --- |
| Built — the browser renders | **yes**, both buttons | yes |
| Prerendered — rendered once at build | no | `markout prerender` |
| Served by Node — rendered per request | no | `markout <docroot>`, or the middleware |

**Anyone who needs one of the other two needs Node**, and should install it
the npm way. That is not a downgrade of this mode; it is what the other two
modes are made of. A page that renders on a server needs a server, and this
mode exists for people who have not got one.

It is worth saying plainly rather than leaving to be discovered, because the
loss is real for one case: content in the HTML for a crawler that will not run
JavaScript. `markout prerender` is the answer to that, and it wants Node on
the machine that runs the build — a CI job will do, and does not have to be
the author's own machine.

## Where an installed kit goes

`.markout/kits/`, in the project, resolved by the compiler.

`discoverKits` already walks up from the docroot looking for `node_modules`
directories ([kits.ts](../../packages/core/src/kits.ts)). `.markout/kits` is
one more rung on a walk that exists. That is the whole mechanism, and its two
consequences are the reasons for it:

**The CLI gets it for free**, which is the requirement. A build driven from
the sidebar has to be reproducible by hand with `markout build`, or it becomes
a way to produce projects only the sidebar can build. Because resolution
stays in the compiler and the extension only fetches files into a directory,
the editor, the preview, the build, a teammate's terminal and CI all read the
same tree and agree by construction. There is nothing to keep in sync.

**Per-project scope is the correct scope.** Kits a page imports are a fact
about the project, not about the machine. Two projects wanting two versions is
ordinary, and a global install makes it unrepresentable.

### Two alternatives, and why they lose

**`npm i -g` behind the checkbox.** This is the one that looks obvious and
inverts itself: it builds the no-npm experience on npm. Everything in *The
audience* above applies, and it applies worst to the people the checkbox is
for. It also puts a machine-wide toggle in a sidebar, so unticking a kit in one
project silently changes every other project on the machine.

**A store the extension owns**, under `globalStorageUri`. Tempting, because
that path is absolute and needs no PATH lookup — but it is a directory only
the extension can find. The CLI cannot read it, so the editor resolves kits
the real build cannot: diagnostics green, preview correct, and `markout build`
reporting every tag in that kit as unknown. **Editor more permissive than
build is the expensive direction**, because it is discovered at deploy rather
than while typing. `globalStorageUri` also differs between stable, Insiders,
WSL and remote, so "where are my kits" acquires four answers.

### What it demotes

The global fallback in [npm-kits.md](npm-kits.md) does not go away — someone
who installed the CLI with npm has a global `node_modules`, the walk from the
CLI's own location still arrives there, and nothing about that should break.
It stops being the answer for the bare-docroot case, which is the case it was
written for. That leaves it as the compatibility path for people who have npm,
which is a smaller and more honest job than the one it has now.

## Kits are small enough to commit

This is the part with no equivalent elsewhere, and it falls out of the
decision rather than being designed for.

Measured: `bootstrap-kit` is 164 KB, `std-kit` 28 KB — `.htm` and CSS, text
that diffs, no native binaries, no platform variance, no postinstall. A
project that checks `.markout/kits/` into git therefore has **no install step
at all**: clone, open, works, offline, and it keeps working when a registry
does not. Nobody commits `node_modules`, so this option does not exist for any
of the frameworks [the benchmark](../../packages/cli/bench/README.md) compares
against.

It is the offered choice rather than the default, for the reason in
[Settled](#settled): pinned versions plus `markout restore` already make a
clone deterministic, so committing the directory buys the offline half alone.
One line out of `.markout/.gitignore` is the whole opt-in.

## What `.markout/` holds

Split by lifetime, not by owner. The temptation is to call this the
extension's directory; the manifest is a project fact, and a directory
understood as editor state gets gitignored the way `.vscode/` and `.idea/`
usually are — at which point it stops solving the problem it exists for.

```
.markout/
  kits.json      committed — which kits this project needs
  kits/          the kits themselves; ignored by default, see Settled
  .gitignore     written by whatever creates the directory, ignoring
                 everything a fetch can reproduce
```

The nested `.gitignore` is worth the small trick: git honours one at any
depth, so the directory documents which of its contents are disposable without
the user needing to know and without a root `.gitignore` being edited.

A shared download cache under `~/.markout/cache` makes every project after the
first a file copy — instant, and offline. Copy rather than symlink, so the
project stays self-contained and committable.

**A per-project `cache/` was in this tree and has been taken out.** It was
sketched alongside the shared cache and never given a job; the shared one took
the job, because a download is fetched once per *machine* and not once per
project, which is the whole reason the second project is instant. Nothing else
turned out to want per-project generated state — the build writes `dist/`, and
what the editor caches it caches in memory.

The `.gitignore` still names `cache/`, which is the one place the decision is
not simply "delete it". That file is **written once and never rewritten**, so
that deleting the `kits/` line to commit a project's kits is not undone on the
next install — which also means a line added in a later version never reaches
a project created today. An ignore for a directory that may never exist costs
one line; discovering later that every existing project is committing a
generated directory costs considerably more.

### Publishing needs no change

[`publishableSegment`](../../packages/core/src/publish.ts) already excludes
every dot-prefixed segment, with `.well-known`, `.nojekyll` and `.htaccess`
allowed through. `.markout/` is covered by a rule that predates it.

Worth stating rather than assuming, because the exclusion matters more here
than it did for `node_modules`: kit files are `.htm`, so a docroot of `.`
without it would not merely publish a cache — it would compile and serve every
kit fragment as a page of its own.

## The diagnostic this buys

A missing kit reports **"unknown tag `<x-card>`"** today. For someone who has
never installed a package that is unactionable: nothing in it says a kit is
involved, let alone which one or what to do.

With a manifest the compiler knows the difference between a tag nobody
declared and a tag belonging to a kit the project asked for and has not got.
It can say so — *kit `@markout-lang/bootstrap-kit` is declared in
`.markout/kits.json` and is not installed* — and the sidebar can offer the fix
as a button.

That is the largest single improvement available to the onboarding path, and
it is a consequence of the manifest rather than a feature of the sidebar. It
belongs in the compiler, so the CLI says it too.

## The kit listing

A central listing service is the obvious companion and should not be built
first.

```
https://registry.npmjs.org/-/v1/search?text=keywords:markout-kit
```

already answers the question, with no server to run, no uptime to hold and no
moderation to staff. Paired with a short list in this repository, that is the
sidebar's entire data layer at zero operational cost. A real service becomes
worth building when the registry query stops being enough — a problem worth
having later, not infrastructure to own now.

**This project's own kits first, the registry a separate step.** The offered
list is the same registry query, filtered to the `@markout-lang` scope
([listing.ts](../../packages/cli/src/kits/listing.ts)) — so publishing a kit
makes it appear without an extension release, which a hard-coded list would
not.

**The scope is checked by name, not asked of the registry.** npm's search
accepts a `scope:` qualifier and does not honour it as a filter: measured,
`scope:markout-lang keywords:eslint-plugin` answers with seven thousand eslint
plugins, none in that scope. A query trusting it would answer with everybody's
kits, and the list that means *these are ours* would be joinable by anyone
publishing with the keyword. The scope itself cannot be spoofed — npm
guarantees it, and only its owner may publish under it.

Calling any of this *curation* would be flattering. What it buys is that an
empty project has something to tick rather than a search box and no idea what
to type, and that reaching an arbitrary registry package takes a second,
deliberate action — a kit's code compiles into every page that imports it, so
that ought to look like the decision it is. What such code can and cannot
reach is [Where code runs](code-execution.md).

There is no offline fallback and none is needed: the list exists to install
from, and installing needs the registry anyway.

## What a kit may do

A kit is third-party code installed by ticking a box, which is a different
proposition from a page — a page is its author's own. Where that code runs,
what contains it and what deliberately does not is
[Where code runs](code-execution.md), which exists because the answer turned
out to be long enough to need its own file and to matter beyond this one.

The short version, because it bears on the sidebar directly: compile-time
evaluation is sandboxed, so a kit cannot reach the process compiling it —
which is the language server on every keystroke and `markout build` in CI.
Server-side rendering is not sandboxed, is no different in that respect from
any other Node framework, and is why the listing is curated by default and
why searching the whole registry is a deliberate second step.

## Rejected along the way

**Bundling npm with the extension.** Removes the PATH problem and keeps the
rest: a second npm on the machine, a second global root, and every failure
mode in *The audience* still reachable through the first one. The registry is
an HTTPS API and a tarball is gzip; Node has `zlib` built in. There is nothing
npm is needed for here.

**Symlinking from the shared cache into the project.** Cheaper on disk and
loses the two properties that matter — the project stops being
self-contained, and it stops being committable. 164 KB is not worth either.

**Putting `dist/` under `.markout/`.** `dist/` is the deliverable, it is
conventional at the project root, and burying it would make the build's output
harder to find for no gain.

## Settled

Every question this section opened with has an answer now. They are recorded
here rather than deleted because each one has a live consequence below, and
because the reasoning is the part that will be needed when one of them is
revisited.

**`kits.json` pins exact versions.** A range would let a fix arrive without a
manual bump, and would also let two clones of one repository build two
different things — which is the failure this audience is least equipped to
diagnose. The bump is instead a visible act: the sidebar offers it one click
at a time, and a bump is *accepted or declined* rather than merely available,
so an offer that has been considered stops asking. The count of bumps still
pending shows as a badge on the Markout icon in the activity bar, which is
where an ambient number belongs — a notification for each one would be noise
for a thing nobody has to act on today.

**A range is refused rather than resolved.** `"^0.4.0"` in `kits.json` is an
error naming the rule, not a spec to satisfy. The alternative — accepting it
and pinning silently — would make the file mean something different from what
it says.

**`.markout/kits/` is not committed by default.** This follows from pinning
rather than competing with it: a pin plus `markout restore` already makes a
clone deterministic, which was the property committing the kits was going to
buy. The `.gitignore` the directory carries therefore ignores `kits/` along
with `cache/`.

What that gives up is real and worth naming: a fresh clone on a fresh machine
now needs one network fetch, so *clone, open, works, offline* becomes *clone,
restore, works, offline*. The shared cache under `~/.markout/cache` makes
every project after the first offline again, and a project that wants the
original property back deletes one line from `.markout/.gitignore` and commits
the directory — supported, documented, and nobody's default.

**`kits.json` lists kits and nothing else**, initially. It is an object under
a `kits` key rather than the file's whole content, so that the next thing the
project wants to record does not need the format to change shape.

**`markout restore` exists**, and so does **`markout add <kit>`**. The CLI
does write `.markout/`, then — the alternative was a manifest only the sidebar
could satisfy, which puts CI in the position of being unable to build a clone.

Both are documented as the **without-node** path specifically. Somebody who
has npm should keep using `npm i`, and the reference says so where the
commands are described: two ways to install a kit is a cost, and it is paid
once, in the docs, rather than repeatedly by people choosing between them.

**The sidebar renders nothing.** Both its buttons work in the delivery mode
that has no render in it — Build compiles and stops, Preview serves what Build
writes. That was settled as a fidelity question and holds as a security one:
previewing a served render would show a page this audience cannot deploy, and
would run a kit's code on their machine to do it. See
[What this mode does not do](#what-this-mode-does-not-do) and
[Where code runs](code-execution.md).

**Unticking a kit a page still imports is refused**, and the refusal names
the pages. The reference data is already in the extension, and a kit removed
out from under a page that uses it produces exactly the silent failure the
manifest exists to end.

## Three things worth keeping

**`findPackage` searches `.markout/kits` too.** `/npm/<name>` resolves by
walking, falling back to asking the mount table by name — the fallback that
exists for globally installed kits. Leaving it to that fallback works, and
makes the two spellings of one file resolve by different mechanisms depending
on how the kit arrived, which surfaces later as a diagnostic nobody can read.

**Two copies of one kit is not a refusal.** The clash check used to cover it
as a case of two kits claiming one root, which advised declaring a different
`markout.root` — advice nobody can follow when the two names are the same
name. It then had a message of its own, and now it has a rule of its own: the
copy nearer the docroot is used and the other is not, said out loud only when
the two versions differ. `.markout/kits` is what gave the case an ordinary
route — npm install, then tick the same kit — and one route more ordinary
still, which is what settled it: this directory is per-project by design and
nothing stops one being created in a home directory, where it sits above every
project on the machine. See
[Nearest wins](npm-kits.md#nearest-wins-for-two-copies-of-one-kit).

**Where the installer lives, and why.** The sidebar's checkbox has to install
a kit exactly the way `markout add` does, or one feature has two halves free
to drift. It sits in the CLI, behind
[`@markout-lang/cli/kits`](../../packages/cli/src/kits/index.ts) — a subpath
exporting the installer and nothing else, so the extension gets the fetching
without the `markout` command, its server or its argument parser. Verified
rather than intended: `client.js` contains no occurrence of express, commander
or compression.

The line it sits on is worth stating, because the tempting one is a step too
far: **core owns the file format; the CLI owns going and getting things.**
Reading and writing `.markout/kits.json` is compiler work — the missing-kit
diagnostic needs it, and a format's reader and writer belong together so they
cannot disagree. Fetching a tarball over HTTPS, checking a hash and unpacking
an archive is infrastructure, and nothing about compiling a page involves any
of it. Core already owning the directory does not make it own filling it.

[dependencies.test.ts](../../packages/vscode/test/dependencies.test.ts)
asserts the boundary by walking what the extension's sources and that subpath
can actually reach, rather than by reading declared dependencies — a declared
closure cannot tell a surgical import from a careless one.

## What a kit's code can reach

Compile-time evaluation is sandboxed, and the sidebar's Preview and Build both
work in the delivery mode that never renders, so a kit installed by ticking a
box runs its code in the browser and nowhere else. That is
[Where code runs](code-execution.md), which also says where rendering leaves
it open and why.
