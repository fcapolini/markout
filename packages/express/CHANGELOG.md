# @markout-lang/express

## 0.8.1

### Patch Changes

- 11ca8f0: Two copies of one kit: the nearer one wins, instead of both being refused.
  
  Every other refusal in kit discovery is `ln -s` failing because the name is
  taken, and holds. This one was different and it took a while to see: there is
  one thing to link and only the question of which copy of it, so the link
  succeeds whichever you pick. The refusal was answering a question nobody had
  asked, and it refused the whole build.
  
  **Nearer** means the walk that already exists — `.markout/kits` then
  `node_modules`, at the docroot and at every directory above it, and after all
  of those the private tree of each kit those rungs yielded. That last clause is
  the part with teeth: a kit's own dependencies are appended to the queue rather
  than descended into as it is accepted, so a hoisted copy beats a nested one
  however the directories happen to sort. Which of the two won used to be
  whichever `readdir` reached first.
  
  **When the two versions differ, it says so** — on a channel of its own,
  `Discovery.shadowed`, printed by the CLI and logged by the middleware at
  startup, failing nothing:
  
  ```
  markout: kit "@markout-lang/std-kit" 0.4.0 at "~/.markout/kits/@markout-lang/std-kit"
    is not used: 0.3.0 at "/app/node_modules/@markout-lang/std-kit" is nearer the docroot
  ```
  
  Two copies at one version pass without a word, that being what an npm tree
  looks like on any ordinary day.
  
  **What sent us here.** `markout add` run in a home directory leaves a
  `~/.markout/kits`, and the walk runs from the docroot to `/` — so that
  directory is a rung for every project on the machine, and every one of them
  that had installed the same kit with npm refused to build. The rung is
  per-project by design; nothing stops one being created above every project at
  once.
  
  Two kits claiming one root is unchanged, and so is the `alsoFrom` gate: a tree
  **above the project** is on the docroot's own walk and falls back per kit,
  while the **compiler's own** install tree stays all-or-nothing. That tree
  belongs to whoever installed the compiler rather than to the project, and
  taking it always would let a docroot built by a CLI inside a monorepo silently
  gain that monorepo's kits.
- Updated dependencies [18cb4af]
- Updated dependencies [f2a480c]
- Updated dependencies [1d1d9ca]
- Updated dependencies [11ca8f0]
- Updated dependencies [19ca252]
  - @markout-lang/core@0.9.0

## 0.8.0

### Minor Changes

- `:server-status` and `:server-redirect`: a page that knows something the
  router does not -- that this id is not a row, that this visitor is not signed
  in -- can say so.
  
  ```html
  <html :server-status=${row ? 200 : 404}>
  <html :server-redirect=${user ? null : '/login'}>
  ```
  
  Ordinary `:server-` values on `<html>`, read off the page's own scope once
  the render has collected them. `:server-` rather than a plain value for two
  reasons: a status means nothing in a browser and must not be re-derived
  there, and a `:server-` value may await -- the row that decides the answer
  usually has to be fetched first.
  
  Read from `<head>`'s scope too when the page itself says nothing, which is
  what lets a **kit** ship this: `<:import>` is only allowed in `<head>`, and a
  fragment's root attributes land on the element the directive sits in, so a
  kit's `:server-status` becomes a value on `<head>` and nowhere else. A
  component it ships can then write `head.status = 404` and a page that
  imported the kit needs no line of its own. The page's own statement wins,
  which is the rule an import default already follows. Those two scopes and no
  deeper: a value of this name further down is that scope's own business, and a
  rule that searched everywhere would turn an ordinary name into a reserved one.
- `requestGlobals`: globals built per request -- a session, the visitor a route
  already authenticated, whatever this request knows that the application as a
  whole does not.
  
  ```js
  markout({ docroot, requestGlobals: { user: (req) => req.user } })
  ```
  
  Named separately from `globals` rather than allowing a function there,
  because the compiler has to be told the names before any request exists -- a
  function cannot say what it will return -- and because a global that *is* a
  function is a perfectly ordinary thing to want. Same rules otherwise:
  readable only from a `:server-` value, and what a page does with the result
  is as public as the page is. A page that renders `${user.email}` has
  published it.
- `runtimeBundle`, a parameter, for a host that repackages this code and so
  breaks the relative walk to the bundle. `runtimeBundlePath()` and
  `loadClientCode()` take the override; the middleware and the server take it
  as a prop.
  
  `MARKOUT_RUNTIME_BUNDLE` stays, for the case a parameter cannot reach -- a
  separate process, such as the CLI spawned as a sidecar -- but it is now the
  fallback rather than the first answer. An environment variable goes where it
  is not wanted: an editor extension setting one on its own process leaks it
  into every terminal that editor opens, and a dev server started there then
  served the *extension's* runtime to pages compiled by the checkout. Nothing
  threw, every page rendered, and the browser quietly ran a different version
  -- the one mismatch this design exists to prevent.

### Patch Changes

- A dev page closes its reload stream on the way out.
  
  The injected `EventSource` was opened and never closed. That stream is a
  connection, a browser allows about six per origin, and a page that leaves one
  behind spends one of the six per navigation -- so the sixth click waited for
  the server to notice a client that was already gone, which it does on its
  next heartbeat write. `HEARTBEAT_MS` is thirty seconds, which is what a shop
  in dev mode paused for on its sixth category.
  
  Closed on `pagehide`, and opened again on a `pageshow` that came from the
  back/forward cache: such a document was never unloaded and would otherwise be
  watching a stream it had closed on its way out.
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @markout-lang/core@0.8.0

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
  - @markout-lang/core@0.6.1

## 0.6.0

### Minor Changes

- f325592: Export `isPageRequest` — markout's own rule for what a page request is, so a
  rate limiter in front of the pages can agree with the middleware behind them.
  
  The rule (an extensionless path, or a `.html` one) was spelled twice: inline
  in the middleware, and again in the CLI's `Server` for its `pageLimit`, whose
  comment named the hazard — "the two disagreeing would mean a request that
  costs a render and is not counted, or an image that is". A third copy was
  about to be written for the site.
  
  It is one definition now, in the module that owns the rule, and both callers
  import it.

### Patch Changes

- caabb94: A directory redirect names a path on this origin, whatever was asked for.
  
  `GET //demos` reaches the same directory — the resolver joins it to the same
  place — and the `301` echoed the requested path back into `Location`, making
  it protocol-relative: a browser reads `//demos/` as `http://demos/` and
  leaves the site.
  
  Only reachable for a name that IS a directory in the docroot, so it is not an
  open redirect to anywhere an attacker chooses. It is still a redirect off the
  origin that this server had no reason to issue, and CodeQL was right to flag
  it (`js/server-side-unvalidated-url-redirection`).
  
  The `Location` is the **resolver's** pathname now, never the request's —
  `Resolution.pathname` is the file's one logical identity, arrived at by the
  same normalization that decided which file to stat, so there is nothing of
  the request left in it to be tricked by. `/demos`, `//demos` and `///demos`
  all redirect to `/demos/`.
  
  Built from the request first, with the leading slashes collapsed by hand.
  That closed the reported case and not `/\demos`, which some browsers read
  the same way — a sanitizer bolted onto user input, answering the example
  rather than the class.
- Updated dependencies [523ef5e]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [c86a69d]
- Updated dependencies [5642d62]
- Updated dependencies [a4f641f]
- Updated dependencies [bd33a54]
  - @markout-lang/core@0.6.0

Entries below are the released history, written after the fact in 2026-08
when [Changesets](https://github.com/changesets/changesets) was adopted. From
then on each entry is generated from the changeset files committed with the
work. Anything older than 0.4.0 is in the git history rather than here.

## 0.5.0

### Patch Changes

- Follows [`@markout-lang/core@0.5.0`](https://github.com/fcapolini/markout/blob/main/packages/core/CHANGELOG.md), where `::` and
  `:const-` changed. Nothing in the middleware's own surface moved.

## 0.4.1

### Patch Changes

- Give served assets a cache lifetime, bounded by what they are not.
- Serve the runtime at a content-hashed URL, cacheable for a year.

## 0.4.0

Extracted from the CLI as a package of its own, so an Express application can
mount `markout()` without installing a command line. `express` is a **peer**
dependency: an application that mounts middleware already has one, and two
copies in a tree is its own kind of bug.

Note the ordering rule this release documented: a path with no extension is a
page request, so the middleware answers it — with a 404 when no page resolves
— rather than passing it on. An application's own API routes therefore have to
be registered **before** `markout()` is mounted.
