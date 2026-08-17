# Five deliverables, one repository

Status: **in progress**. Steps 1 to 4 below are done: the code is split into
[`@markout/core`](../../packages/core/),
[`@markout/express`](../../packages/express/) and
[`markout`](../../packages/cli/), each depending on the ones under it by name.
What is left is the kits, the site and the extension. This file records the
decisions and the order, so the migration can be paused between steps without
the reasoning being lost with it.

## The problem

The repository has to produce five things:

| Deliverable | Published as |
| --- | --- |
| the CLI | `markout` on npm |
| the middleware, for Express applications | `@markout/express` on npm |
| the Bootstrap kit | `@markout/bootstrap-kit` on npm |
| the homepage, with a demos section | a site |
| the VS Code extension, on Volar | the marketplace |

It used to produce one: a single `package.json` whose only entry point was
`bin`, with no `main` and no `exports` — so
[middleware.ts](../../packages/express/src/middleware.ts), the thing an Express
developer would install, was not importable by anyone at all.

**The forcing case is the extension.** A Volar language server needs the
parser and the compiler, and must not carry Express, compression or
commander into an editor process. Every other deliverable could limp along
inside one package; that one cannot. So the split is not tidiness, it is what
makes the fifth deliverable possible.

## Why npm workspaces, and not pnpm

Switching package manager is a change every contributor pays for, so it wants
a reason better than convention. npm has had workspaces since 7, and on the
version in use here (npm 11.6.0, node 24.4.0) they do everything this
repository needs. Three differences from pnpm are real, and each was measured
rather than remembered:

| | Result |
| --- | --- |
| `"@markout/core": "workspace:*"` | **rejected** — `EUNSUPPORTEDPROTOCOL` |
| `"^0.4.0"`, local package at `0.4.0` | symlinked to the local package |
| `"^0.4.0"`, local package bumped to `0.5.0` | **silently resolved from the registry** |
| `npm version patch --workspaces` | bumps each package, leaves sibling ranges untouched |
| `npm pack` | publishes the range verbatim; nothing is rewritten |

The second and third rows are the ones to design around, and together they
rule out the obvious shortcut. `"*"` always links locally — and is published
verbatim, so a consumer of the CLI would resolve `@markout/core@*` to
whatever is newest, including the next major. Real ranges are therefore
mandatory, and since npm will not keep them in step on a version bump, and
resolves a stale one from the registry *without saying so*, the failure mode
is a green build against code nobody in the repository wrote.

So: real semver ranges, plus [Changesets](https://github.com/changesets/changesets)
to rewrite them on release. That is the whole of what pnpm would have
provided, and it is one devDependency rather than a new tool for everyone.

## The packages are the import graph, not the deliverable list

Five deliverables are not five packages. The layering the code already has,
read off every cross-directory import in `packages/cli/src/`:

| Layer | Files | Lands in |
| --- | --- | --- |
| base | [kits.ts](../../packages/core/src/kits.ts), [paths.ts](../../packages/core/src/paths.ts) | `@markout/core` |
| html | [src/html/](../../packages/core/src/html/) | `@markout/core` |
| publish | [publish.ts](../../packages/core/src/publish.ts) | `@markout/core` |
| runtime | [src/runtime/](../../packages/core/src/runtime/) | `@markout/core` |
| compiler | [src/compiler/](../../packages/core/src/compiler/) | `@markout/core` |
| render | `render.ts`, `serialize.ts`, `runtime-bundle.ts` | `@markout/core` |
| http | `middleware.ts`, `livereload.ts`, `watcher.ts`, `logger.ts` | `@markout/express` |
| cli | `cli.ts`, `server/index.ts`, `build.ts`, `exit-hook.ts` | `markout` |

Nothing in the tree points upward through that table, and there are no
cycles — verified before the plan was written, and asserted ever since: first
by one layering test while everything was still one package, now by
[core's](../../packages/core/test/layering.test.ts),
[the middleware's](../../packages/express/test/layering.test.ts) and
[the CLI's](../../packages/cli/test/layering.test.ts), which between them cover
the layers inside each package and the seams between them. The split was a
sequence of moves, not a refactor — as predicted, and the reason the
prediction held is that the table was read off the imports rather than
imposed on them.

Each boundary exists because some consumer must not see what is above it:

- **`@markout/core`** — compile and render, no HTTP. Dependencies: acorn,
  escodegen, estraverse, entities. This is what the extension imports.
- **`@markout/express`** — the middleware and the machinery it drives: the
  logger, the watcher, the reloader. Depends on core, with express as a
  *peer* dependency, since an application that mounts middleware already has
  one and two copies of express in a tree is its own kind of bug.
- **`markout`** — the bin, the `Server` class, `build`. Depends on both, plus
  commander and compression.

  **`Server` stays in the CLI rather than moving to the middleware package**,
  which is the one placement call step 4 had to make. Listening on a port,
  handling a signal and deciding when to exit belong to whatever owns the
  process, and for an application that is the application. A library that
  installs a `SIGINT` handler on a host that never asked for one is the
  thing to avoid, and `Server` uses
  [exit-hook.ts](../../packages/cli/src/server/exit-hook.ts) to do exactly
  that.
- **`@markout/bootstrap-kit`**, **`@markout/std-kit`** — no TypeScript at
  all: `.htm` files and the mandatory `markout.root` from
  [npm-kits.md](npm-kits.md).
- **the site** and **the extension** — private workspaces, never published.

### Three placement calls worth writing down

**`render.ts` and `serialize.ts` go in core, not in the Express package.**
Server-side rendering is not an Express concern; it is the isomorphism the
language is built on, and [build.ts](../../packages/cli/src/server/build.ts) needs it with
no server present. Putting them in `@markout/express` would make
`markout build` — the ahead-of-time path, whose entire audience is people who
cannot run Node in the request path — depend on an HTTP framework.

**`runtime-bundle.ts` goes wherever the esbuild step goes**, which is core.
[runtime-bundle.ts:7](../../packages/core/src/render/runtime-bundle.ts#L7) finds the browser
bundle at `__dirname/../../dist/markout-runtime.js`; keep the two together and
that line survives the move untouched.

**`publish.ts` goes in core**, because both the middleware and `build` ask it
the same question — what a kit is allowed to serve — and it depends only on
html and paths. It was already written as the shared answer; see
[npm-kits.md](npm-kits.md).

## `tsc -b` is the build orchestrator

Each package gets `composite: true` and a `references` list, and the root
builds with `tsc -b`. That is topological ordering for free, and it makes the
table above enforced rather than agreed: a reference cycle is a build error.

`npm run --workspaces` is then only for order-independent work — tests, lint.
It is not what builds the tree.

No turbo, no nx. Neither earns its configuration until `tsc -b` is the
bottleneck, and with seven workspaces it will not be.

Tests stay one root [vitest](../../vitest.config.cjs) config using `projects`,
one per package, plus a root project for the suites that are about the
repository rather than about any package —
[docs-links.test.ts](../../test/docs-links.test.ts) walks every markdown file in
the tree and has no package to live in.

## The order

Every step keeps the suite green, and every move is `git mv`, so history
follows the files.

1. **Prep; nothing moves.** Rename `src/index.ts` to `src/cli.ts`, so the bin
   stops occupying the name the package entry point will want. Add the
   layering test, so the boundaries are enforced before they are physical and
   no later step can quietly introduce a cycle. **Done.**
2. **The root becomes a workspace root, and the whole current package moves to
   `packages/cli` unchanged.** Still one package. All the path churn happens
   here in isolation — the test suite reaches for `../../kits`, `../../demo`
   and `../README.md` in several places — so a failure in this step means a
   path and nothing else. **Done**, and three things it turned up are worth
   knowing before the next move:
   - **The root keeps the script names CI already calls.** `build`, `test`,
     `test-coverage` and `typecheck` delegate to the workspaces, so all four
     workflows in [.github/workflows/](../../.github/workflows/) needed no edit
     at all. Worth preserving through steps 3 and 4.
   - **Hoisting broke a test that reached into `node_modules` by path.**
     [cli.test.ts](../../packages/cli/test/cli.test.ts) located tsx at
     `<package>/node_modules/tsx/…`, which a workspace no longer guarantees;
     it now walks up the way node does. The first instance of the trap this
     file warns about, and it arrived in step 2.
   - **`npm install` in an existing tree pruned esbuild's platform binary.**
     Optional dependencies do not survive the reshuffle. `rm -rf node_modules`
     and install again; nothing is wrong with the tree.
3. **Extract `@markout/core`.** The largest step, and the one that unblocks
   the extension. **Done**, and four decisions inside it are the ones to
   reuse in step 4:
   - **The barrel is curated, one name at a time.**
     [core's index.ts](../../packages/core/src/index.ts) lists what another
     package may depend on, and nothing else. `export *` over every module
     would be the same thing as no boundary — and would silently drop one of
     the two names `html/dom` and `html/server-dom` deliberately share.
   - **Source in development, `dist` for anything published.** A package's
     `main` is its built output, so a test run or a dev server that resolved
     it that way would be checking the last build rather than the working
     tree. Two mechanisms, one per consumer: vitest gets a `resolve.alias`,
     and tsx gets [tsconfig.dev.json](../../packages/cli/tsconfig.dev.json),
     which is the *only* place `paths` appears — mapping a package name onto
     another project's source is exactly what a composite build must not do.
   - **`tsc -b` made the build order a non-issue.** `npm run build
     --workspaces` visits `cli` before `core` alphabetically, which would be
     the wrong order for any other runner; `tsc -b` follows the reference and
     builds core first regardless. The root script needed no change.
   - **A second layering test now guards the seam rather than the layers.**
     [the CLI's](../../packages/cli/test/layering.test.ts) asserts that core is
     reached by its package name and never by a relative path — a workspace
     makes `../core/src/compiler` resolve perfectly well, and nothing else
     stands between the curated surface and a dependency on an internal.
   - `publish.ts` turned out to sit *above* html rather than beside `paths`,
     which the layering test caught the moment core had its own copy. The
     table above says base; the code says otherwise, and the code was right.
4. **Extract `@markout/express`.** Small, once core is out. **Done** — four
   files, and the machinery from step 3 applied unchanged. Two things it
   added rather than repeated:
   - **The package now has a test of the thing it is for.** Every existing
     test of this middleware reaches it through the CLI's `Server`, which is
     convenient and also the one arrangement an application will never have.
     [standalone.test.ts](../../packages/express/test/standalone.test.ts)
     mounts `markout()` on a bare Express app instead, which is the case that
     would break silently — a dependency that only resolves because the CLI
     installs it, a piece of setup only `Server` performs.
   - **It immediately documented a constraint nothing had written down.** A
     path with no extension is a page request, so the middleware answers it
     — with a 404 when no page resolves — rather than passing it on. An
     application's own API routes therefore have to be registered *before*
     `markout()` is mounted. Orbit already did this; nothing said so, and
     nothing would have caught it changing. The test now asserts both
     directions.
5. **The kits become packages.** No TypeScript: a `package.json`, a `files`
   list, and the `markout.root` each already declares. The showcase and Orbit
   move *out* of the kit and into the site, so the site consumes the kit
   through `/npm/@markout/bootstrap-kit/all.htm` exactly as a stranger would.
   That turns the npm-kit resolution path into something the repository's own
   pages exercise, rather than something the tests assert about.
6. **The site, then the extension.** New work rather than moves.

## Two traps, both npm's

**Hoisting will lie.** Every dependency lands in the root `node_modules`, so a
package that imports something it never declared works locally and breaks for
the consumer. Discipline does not catch this; a check does. In CI: `npm pack`
each package, install the tarball into an empty directory, run a smoke test.
That catches an undeclared dependency and a wrong `files` list in the same
pass, which is also the only way to be sure a kit ships the fragments it
promises.

**Publishing needs the tool.** Given the table above — ranges not rewritten on
bump, stale ranges silently resolved from the registry — releasing by hand is
a matter of time. Changesets from step 2, before there is more than one
package to get wrong.

## Parked, deliberately

**CommonJS or ESM.** The repository is `"type": "commonjs"` with Node16
resolution, and splitting is the moment that question gets answered one way or
the other. It should be answered on purpose: stay CJS through the migration —
compounding it helps nobody — but write real `exports` maps in step 2, so a
later dual build is additive rather than a second migration. The extension is
the consumer that will eventually push back.

**What survives into the site.** [demo/](../../demo/) currently holds the
`setlist`, `shoelace` and `webawesome` stubs beside the real material, and
there are two homepages — [homepage.html](../../homepage.html) and
`demo/homepage/index.html`. Step 6 cannot be done without deciding which of
those are demos and which are leftovers. See
[POSITIONING.md](../../POSITIONING.md) on which artifacts the pitch actually
rests on.
