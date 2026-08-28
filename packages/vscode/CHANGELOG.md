# markout-vscode

## 0.6.0

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
  - @markout-lang/cli@0.7.0

## 0.5.3

### Patch Changes

- 7e6acb1: Say which tree the kits were read from, and stop swallowing the refusals.
  
  An unresolved tag reads the same whichever way a kit went missing, and the
  ways are not guessable from the page. A project with any kit of its own never
  consults the global tree, deliberately, so that a stray global copy cannot
  break a real project -- which means a globally installed kit is invisible in
  any project that has one of its own, correctly and silently. A machine with
  two npms has two global trees, only one of which holds what was installed.
  Both end in "no such tag", with nothing said anywhere about the directory
  that was actually read.
  
  The kit scan now reports what it did, once per distinct answer, to the
  Markout output channel: how many kits came from the project, or the global
  tree it read and what it found there, or that npm could not be reached and
  the login shell is being asked. It is background rather than a diagnostic --
  it is not a fault in the page being edited, and it is only wanted by someone
  already asking where their kit went.
  
  Kit refusals are the exception. `discoverKits` returns them as complete
  sentences -- a root claimed twice, a root shadowed by a real directory -- and
  the extension was discarding them, so a kit that was found and rejected
  produced a page full of unresolvable tags and no explanation at all. Those
  are now surfaced where they will be read.
- Updated dependencies [88ff5c1]
  - @markout-lang/core@0.6.1

## 0.5.2

### Patch Changes

- Find globally installed kits even when the editor's PATH has no npm on it.
  
  An editor started from the Dock or the Finder on macOS is a child of launchd,
  whose PATH holds no Homebrew, no nvm, no fnm and no volta -- and so no npm to
  ask where global packages are. VS Code resolves the login shell's environment
  to cover this, but it is best-effort and silently absent often enough to
  matter: the answer became "no global kits", and every tag the kit defines was
  reported as unknown, for exactly the author who installed globally so as not
  to have to `npm init` first.
  
  So the login shell is now asked as well, in the background, and the kits
  appear a moment after the window opens rather than not at all.

## 0.5.1

### Patch Changes

- Updated dependencies [523ef5e]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [5642d62]
- Updated dependencies [a4f641f]
- Updated dependencies [bd33a54]
  - @markout-lang/core@0.6.0
