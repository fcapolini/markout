# Working without Node

Status: **designed, not built**. Nothing in this file exists yet. It records a
decision reached in discussion — where a kit installed by the editor goes, and
why not the two places tried first — together with the sidebar that would install
one. The open questions at the end are open, not rhetorical.

The kit *contract* is unchanged and lives in
[npm-kits.md](npm-kits.md): a kit is an npm package with a declared root, it is
imported through `/npm/`, and it behaves as though symlinked into the docroot.
All of that holds however the files arrived. This file is about how someone
with no Node gets those files, which is a different subject with a different
audience.

## The audience, and why it is not served yet

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

Three things, in a view of its own:

- **A list of kits, with checkboxes.** Ticking one installs it into this
  project; unticking removes it.
- **Preview** — serve the docroot in dev mode.
- **Build** — write the deliverable to `dist/`.

No terminal appears anywhere in that, and neither does npm. The extension
already depends on `@markout-lang/core` and runs it in the language server's
process ([server.ts](../../packages/vscode/src/server.ts)), so the compiler is
*already* inside the editor — there is no toolchain to hide, only one that
never has to be installed. Preview and build drive that same in-process
compiler rather than spawning the CLI, for the PATH reasons above.

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

Whether it should be the default or an offered choice is open, below.

## What `.markout/` holds

Split by lifetime, not by owner. The temptation is to call this the
extension's directory; the manifest is a project fact, and a directory
understood as editor state gets gitignored the way `.vscode/` and `.idea/`
usually are — at which point it stops solving the problem it exists for.

```
.markout/
  kits.json      committed — which kits this project needs
  kits/          the kits themselves; committed or not, see Open
  cache/         generated
  .gitignore     written by the extension, ignoring the generated half
```

The nested `.gitignore` is worth the small trick: git honours one at any
depth, so the directory documents which of its contents are disposable without
the user needing to know and without a root `.gitignore` being edited.

A shared download cache under `~/.markout/cache` makes every project after the
first a file copy — instant, and offline. Copy rather than symlink, so the
project stays self-contained and committable.

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
moderation to staff. Paired with a curated `kits.json` in this repository for
a featured section, that is the sidebar's entire data layer at zero
operational cost. A real service becomes worth building when the registry
query stops being enough — a problem worth having later, not infrastructure
to own now.

**Curated by default, searching the whole registry a deliberate second step.**
A kit is code that runs at compile time inside the user's editor, so a
one-click install of an arbitrary registry package is a supply-chain surface
and should look like one.

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

## Open

- **Whether `kits.json` pins exact versions or ranges.** Pinning makes
  clone-and-run deterministic, which suits an audience that will not debug a
  resolution failure; ranges let a fix arrive without a manual bump. Leaning
  pinned, with the sidebar offering the bump — but this is a real choice.
- **Whether committing `.markout/kits/` is the default.** The zero-install
  property above is strong enough to argue for it; the counter-argument is
  that a repository then carries dependencies, which is a norm people have
  been taught to distrust for good reasons that mostly do not apply here.
- **What `kits.json` looks like**, and whether it holds anything besides
  kits. Once a project has a manifest, everything else the extension knows
  about the project will want to live in it.
- **Restore.** A clone with `kits.json` and no `kits/` needs a way to fill it
  that is not the sidebar, or CI cannot build. Probably `markout restore`,
  which puts a second command in a tool that has been proud of having few.
- **Whether the CLI should write `.markout/` at all**, or only read it. A
  `markout add <kit>` would be the terminal half of the checkbox and would
  keep the two paths honest with each other; it would also be the first time
  the CLI installs anything.
- **Uninstall semantics.** Unticking a kit a page still imports should not
  silently break the page. Refusing, and saying which pages import it, is
  probably right and needs the reference data the extension already has.

## Sequencing

The `.markout/kits/` rung in `discoverKits` stands alone and can land first:
it is a small addition to a walk that exists, it makes hand-installed kits
work for a bare docroot with no editor involved, and everything else here
depends on it. The manifest and its diagnostic come next, because they are
compiler work and the CLI needs them too. The sidebar is last and is the only
part that is editor-specific.
