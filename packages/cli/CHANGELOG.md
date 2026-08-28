# @markout-lang/cli

## 0.7.0

### Minor Changes

- efdc2d6: Find kits in `.markout/kits/` as well as `node_modules/`, at the docroot and
  at every directory above it.
  
  The directory is laid out as a `node_modules` is — a package per directory, a
  scope as a directory of them — so a kit unpacked there by hand is found by the
  same walk as one npm installed and is indistinguishable from it afterwards.
  `/npm/<name>` resolves there too.
  
  This is what makes a bare docroot — HTML in a directory, no `package.json`,
  no npm on the PATH — able to use a kit at all: the files are the whole
  install, and `markout build` reads the same tree the editor does. Kits are
  `.htm` and CSS, so `.markout/kits/` can be committed for a project with no
  install step; `markout build` never publishes it, `.markout` being
  dot-prefixed.
  
  Two copies of one kit, one in each directory, is still a refusal rather than a
  precedence rule, and now says so in its own words: *installed twice — at A and
  at B — remove one*, in place of advice to change a `markout.root` that is the
  same package's both times.
  
  ### `.markout/kits.json`, and the diagnostic it buys
  
  A project may now declare the kits it needs, pinned to exact versions:
  
  ```json
  { "kits": { "@markout-lang/bootstrap-kit": "0.4.0" } }
  ```
  
  A kit that is declared and not installed used to fail silently -- the page
  compiled, the kit's tags rendered as empty elements, and nothing named a
  cause. The COMPILER now says so, which means the editor, `markout build` and
  CI all say the same sentence:
  
      kit "@markout-lang/bootstrap-kit" is declared in ".markout/kits.json" and
      is not installed -- run "markout restore" to fetch what the manifest asks for
  
  A managed copy at a version other than its pin is reported the same way. A
  copy in `node_modules` is left to npm, pin or no pin. A range in place of an
  exact version is refused rather than resolved, naming the rule.
  
  ### `markout add` and `markout restore`
  
  Two new commands, for people who have **no npm** and for CI restoring a
  project built by one of them. `add` fetches a kit from the registry over
  HTTPS, checks it against the published checksum, unpacks it into
  `.markout/kits/` and pins what arrived; `restore` fetches everything the
  manifest pins and is idempotent, so a CI script can run it unconditionally.
  
  No npm is involved and none is bundled: a packument is JSON and a tarball is
  gzip. There is no dependency resolution, no lockfile and no semver range --
  one exact version of one package, unpacked. A package declaring no
  `markout.root` is refused before anything is downloaded. Downloads are cached
  under `~/.markout/cache`, so the same kit in a second project is a file copy.
  
  If you have npm, keep using `npm i` -- see
  `docs/reference/vscode-extension-sidebar.md`, which puts the two workflows
  side by side.
  
  ### The Markout sidebar
  
  A view of its own in the activity bar: the kits this project has, asked for,
  or is offered, each with a checkbox. Ticking one fetches it into
  `.markout/kits/` and pins it; unticking removes it, unless a page still
  imports it -- which is refused, naming the pages, because a kit taken out from
  under a page produces exactly the silent failure the manifest exists to end.
  
  A kit npm installed shows with its checkbox locked on and `npm uninstall` in
  the tooltip: it is genuinely installed and should be findable, and a checkbox
  that edited `node_modules` would be the view reaching outside what it manages.
  
  Updates are **offered, never applied**. A newer version shows as
  `1.0.0 -> 1.1.0` with accept and decline buttons; declining is remembered per
  version, so the next release asks again. The number still pending is a badge
  on the activity bar icon.
  
  This project's own kits are offered first — the same registry query, filtered
  to the `@markout-lang` scope, so a newly published kit appears without an
  extension release. The scope is checked by name and not asked of the registry:
  npm's `scope:` search qualifier does not filter, so a query trusting it would
  answer with everybody's kits. Searching the whole registry is a separate,
  deliberate step. Kits are found by the `markout-kit` keyword, and the real
  gate on installing one is `markout.root` in its own manifest.
  
  `searchKits`, `addKits`, `restoreKits` and `resolveKit` are exported from
  `@markout-lang/cli/kits` — a new subpath carrying the installer and nothing
  else, so the sidebar and `markout add` run the same code without an editor
  process gaining a web server or an argument parser.
  
  ### Preview and Build, and `build` moving to core
  
  `build` is now exported from `@markout-lang/core` rather than
  `@markout-lang/cli`. It is a compile and a render written to disk, with no
  HTTP in it, and the editor's Build button needed it; `@markout-lang/cli` still
  re-exports it, so importing it from there keeps working.
  
  `RUNTIME_BUNDLE_PATH` is replaced by `runtimeBundlePath()`, and the new
  `MARKOUT_RUNTIME_BUNDLE` environment variable overrides where the browser
  runtime is found. Core locates it by walking two levels up from its own
  directory, which is true of an installed package and false of one repackaged
  into something else -- and a const could not be overridden by a host that had
  already loaded the module before its own startup ran.
  
  The extension gains a **Preview** button, which spawns the bundled `markout`
  command as a child process using `process.execPath` -- the node the editor is
  already running on, so there is no PATH lookup and none of the ways a PATH
  lookup fails for an audience with no npm. The editor's own process still runs
  no web server.
  
  ### Compile-time constants are sandboxed
  
  `:const-` values are computed by the compiler, so a `:const-` in a **kit**
  runs inside whatever compiles the page -- `markout build` on a CI machine, and
  the language server on every keystroke. That evaluation used `new Function`,
  which runs in the compiler's own realm, and it was reachable: nine distinct
  expressions, none of which names a global, reached `process` from a kit
  fragment and could read environment variables into the built HTML.
  
  It is not a set of holes that can be patched: `x.constructor.constructor` is
  `Function` for every object in the language, so any allowlist that hands over
  real host objects hands over the host.
  
  Constants now evaluate in a `vm` context of their own, seeded with nothing,
  with `eval` and the `Function` constructor disabled inside it and a 1s
  timeout -- an expression that never finished used to hang the language server
  permanently. Nothing about writing a constant changes; they may still compute
  from literals and other constants, which is all they were ever allowed to do.
  
  **Server-side rendering is not covered and is not claimed to be.**
  `prerender`, the dev server and served mode still run page expressions in the
  host realm, where the allowlist itself (`Object`, `globalThis`, `fetch`) hands
  over what a sandbox would withhold -- and the standard kit's datasource calls
  `fetch` from a page expression, so it cannot simply be withheld. This is what
  every Node framework does when it renders; the asymmetry worth closing was
  that a kit's code ran where nobody asked for a render, in a language server
  and in CI, and that is closed. See `docs/design/code-execution.md`.
  
  ### `markout <docroot> --client`, and `client: true` on the middleware
  
  Serves pages as `markout build` writes them: compiled, never rendered, every
  value resolving in the browser. The third delivery mode, served rather than
  written to a directory.
  
  It exists so a preview can match the delivery -- a project that ships `build`
  output and previews a served render is looking at a page it will not deploy.
  The sidebar's Preview uses it, which means neither of the sidebar's buttons
  evaluates a page expression, and so neither evaluates a kit's.
  
  ### A build writes `.gitignore` into the `dist/` it chose
  
  `markout build` with no outdir, and the sidebar's Build button, now leave a
  `.gitignore` in the output directory covering the whole of it. The output is
  generated and this audience should not have to know to say so to git -- the
  same reasoning as the one inside `.markout/`, and nested for the same reason:
  git honours one at any depth, so no file the project owns is edited.
  
  Written once, so deleting it sticks. **An outdir named on the command line
  gets none**: that is somebody putting the output where they want it, possibly
  to commit it, and a static host serving a committed folder is exactly how this
  audience deploys.

### Patch Changes

- Updated dependencies [efdc2d6]
  - @markout-lang/core@0.7.0
  - @markout-lang/express@0.7.0

## 0.6.1

### Patch Changes

- 88ff5c1: Carry the `/npm/<package>` fix for globally installed kits.
  
  Both build a `Resolver` of their own -- `build.ts` for the compiled artifact,
  the middleware for a served request -- so both refused
  `<:import src="/npm/@markout-lang/bootstrap-kit/all.htm" />` against a kit
  that was installed globally and mounted correctly. The fix is core's; these
  are versioned so that the range they declare on it moves too, and a project
  that bumps only the CLI actually receives the fix rather than resolving a
  locked 0.6.0 that still has the bug.
- Updated dependencies [88ff5c1]
- Updated dependencies [88ff5c1]
  - @markout-lang/express@0.6.1
  - @markout-lang/core@0.6.1

## 0.6.0

### Minor Changes

- 085ede4: `markout build --prune-kits` drops an installed kit's files when no built
  page mentions its root (#27).
  
  A build materializes every *installed* kit, whether or not a page imported
  it — the same rule the dev server mounts by, so the two cannot disagree about
  whether a kit's resource exists. Correct, and it leaves the deliverable
  holding directories the author never named.
  
  **Mentions, not imports**, which is the whole point: a page writing
  `<img src="/some-kit/res/logo.png">` and importing nothing still needs those
  files, and import-derived pruning would work in dev and 404 once built — the
  trap the installed-not-imported rule exists to close. What is read is the
  rendered output of every page, so a root the page computed counts too.
  
  Opt-in, and staying opt-in: it can only see what a page rendered, so a URL
  built in the browser is invisible to it. Nothing is pruned when the evidence
  is incomplete either — a page that failed to compile, or a build restricted
  with `--page`, means the unseen pages might have mentioned anything.
  
  The build says which kits it dropped, and says so when it dropped none.

### Patch Changes

- Updated dependencies [523ef5e]
- Updated dependencies [caabb94]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [5642d62]
- Updated dependencies [f325592]
- Updated dependencies [a4f641f]
- Updated dependencies [bd33a54]
  - @markout-lang/core@0.6.0
  - @markout-lang/express@0.6.0

Entries below are the released history, written after the fact in 2026-08
when [Changesets](https://github.com/changesets/changesets) was adopted. From
then on each entry is generated from the changeset files committed with the
work. Anything older than 0.4.0 is in the git history rather than here.

## 0.5.0

### Patch Changes

- Follows [`@markout-lang/core@0.5.0`](https://github.com/fcapolini/markout/blob/main/packages/core/CHANGELOG.md), where `::` and
  `:const-` changed. Read its migration note before upgrading a page.

## 0.4.1

### Patch Changes

- Say which version of Markout built the page.
- Check that the demos hydrate onto exactly what was served.

## 0.4.0

The package keeps the `markout` bin and gains an importable surface: `Server`
and `build` are available to a program that wants a server without the command
line.
