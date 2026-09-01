# @markout-lang/core

## 0.10.0

### Minor Changes

- ae71663: `$outer("my-tag")`: the nearest enclosing instance of a tag, or nothing.
  
  `$host` answers what a scope is immediately inside; this answers what it is
  inside *of a given kind*, however far up that is. A walk rather than a parent
  hop, because a region, a `:for-each` or an element carrying a value each add a
  scope in between, so the enclosing instance is reliably an ancestor and never
  reliably the parent. It excludes itself, or a definition's own default would
  find the instance it is defaulting.
  
  The tag is written out, and has to be: a call in the source, it is a plain
  dependency segment by the time anything runs, resolved when the scope links.
  A lookup performed per read would emit no dependency, so whatever asked would
  answer once and never again — exactly the case this exists for. `$outer(x)`
  with a computed tag is refused rather than silently doing the weaker thing.
  
  Costs nothing where it is unused: the tag each instance carries is emitted
  only for tags some expression in that page names.

### Patch Changes

- 48599d0: `URLSearchParams` joins the globals an expression can use, beside `URL`.
  
  `$url.searchParams` already hands pages one, so the type was in the language's
  surface and only the constructor was missing — which is what a page needs to
  build a query rather than merely read one.
- d97da3b: A render now settles instead of answering with whatever it happened to see.
  
  A scope's own values are evaluated before its children exist, so anything a
  child wrote to its `$host` while rendering landed after the pass had already
  walked the readers that should have moved. Those readers were marked dirty but
  nothing walked them again, so the write reached its direct readers and nothing
  derived from them — leaving a page that could contradict itself in a single
  render, with two readers of one value disagreeing.
  
  `refresh()` now walks again to carry a mid-render write, and keeps walking
  until a pass changes nothing. Only when something was actually written: a
  render nobody writes to during costs exactly the one walk it always did. A page
  that never settles reports it after 8 passes rather than hanging.
- 9c5c577: A component written inside a component whose slot sits in a region renders,
  instead of silently vanishing.
  
  Filling a slot moves the caller's markup into the element holding it, so a
  slot inside a region — `<div :if>`, or a `<:group>` — puts that markup inside
  the region. The scope did not follow: `enclosingScope` consulted the instance
  a node was slotted into before walking up to see what the markup had actually
  been moved inside of, and returned it on sight. Parented past the region, the
  instance was bound to DOM the region owns and only shows when it chooses to,
  so it rendered nothing and reported nothing.
  
  The slot's host is now the fallback it was documented to be rather than a
  first hit, taken only when nothing between the usage and it has a scope of its
  own. "Nothing in between" became a walk for the same reason: what lies between
  can be the definition's own region, and only a scope belonging to the caller's
  markup ends it.
- Updated dependencies [8d121f7]
- Updated dependencies [46c3cf1]
- Updated dependencies [48599d0]
  - @markout-lang/std-kit@0.4.0

## 0.9.0

### Minor Changes

- 18cb4af: `class!=` and `style!=`: replacing what a component composed, said on
  purpose.
  
  A `class` written at a usage site replaces the one the component derived for
  itself. That is the rule and it is the right one, but from a component that
  derives its own classes it is almost never what was meant, so it warns — and
  the only answers the warning had were `class+=`, which means something else
  entirely, and silence. A warning nobody can answer is a warning people learn
  to scroll past.
  
  This is the answer that agrees with it:
  
  ```html
  <bs-alert ::variant="warning" class!="my-own-alert">Nothing of the kit's</bs-alert>
  ```
  
  It compiles to exactly what `class=` compiles to — the same value under the
  same name, nothing downstream aware the spelling exists. All it adds is the
  statement, which the compiler accepts as its answer and stops asking, and
  which the next reader gets for free: a plain `class` on a component is
  ambiguous between "I meant this" and "I did not know", and this one is not.
  
  **`!` because it is not a set operation.** `+=` and `-=` say what happens to
  the set; this says what the author intends about a collision. CSS spells that
  same idea `!important`.
  
  **It expects something to replace.** On a plain element, or on a component
  that sets no `class` of its own, there is nobody it can be addressing — which
  it says, while going on working, since it is a `class` either way. That is
  what catches the stale one: a component that stops setting a class leaves
  every `class!=` aimed at it saying something no longer true.
  
  The warning it answers now names it:
  
  ```
  warning: <bs-alert> sets "class" itself, and a "class" here replaces it -- did you mean "class+=", or "class!=" if you meant to replace it?
  ```
- f2a480c: A `<:define>` can carry its own `<style>`, served once and dropped with the
  definition — and treeshaking now follows the usage graph rather than a flat
  set of mentions.
  
  **A component's stylesheet.** A `<style>` written as a direct child of a
  `<:define>` is that component's, structurally rather than by an author's
  say-so:
  
  ```html
  <:define tag="x-card:div" class="card">
    <style>.card { border: 1px solid }</style>
    <:slot />
  </:define>
  ```
  
  It is lifted out of the stencil and served **once**, and it goes when the
  definition does. That is the whole difference from `:when-used`, which is an
  assertion an author can get wrong: nobody claims this stylesheet belongs to
  the component, it was *written inside* it.
  
  Left in place it was copied per instance — the definition's stencil held one
  and every usage site given content cloned another, so three instances shipped
  four copies of the same rules and mounted one apiece. That cost is why the
  pattern was unwritable.
  
  **Where it lands is part of the promise:** immediately before the definition,
  not appended to `<head>`. A stencil is inert and a stylesheet cascades, so
  appending would put every component's rules after the page's own and let a
  component win an equal-specificity tie it should lose. In place, cascade order
  is import order, which is the order the fragments were written.
  
  Two cases are deliberately left alone. A `<style>` that interpolates a value
  renders once per instance with its own text, so there is no single copy to
  hoist. One nested deeper — inside an `:if` or a `:for-each` — is conditional
  markup, which is the author having already answered this question differently.
  A definition in `<body>` cannot carry one at all: lifted out it would be
  invalid markup where it stands and would land somewhere else if moved, so it
  is refused rather than guessed at.
  
  **Treeshaking follows the graph.** A definition is kept when the page can
  *reach* it: the tags the page writes itself, then the tags those definitions'
  bodies write, and so on. One reachable only through a definition that is
  itself unused now goes with it.
  
  The flat set was wrong in a way that cost more than it looked. A `dash-stat`
  whose body writes `<dash-chart>` kept the chart's stencil on a page writing
  neither — kept it, in fact, on the strength of a mention inside a definition
  the same pass had just deleted. For a kit whose components compose, which is
  the ordinary kind, that is not a corner case. On a page importing a four-
  component set and writing one of them: 10821 bytes to 10120, and 4093 to 3924
  gzipped. Every page of the site renders identically — body, props and CSS byte
  for byte — and only unreachable stencils went.
  
  **A borrowed class is reported.** Class names stay global: nothing is
  rewritten or hashed, so a page may wear `.card` without ever writing
  `<x-card>`. Do both and the rules are deleted out from under markup that
  stayed. The compiler now says so:
  
  ```
  warning: <x-card> is never used, so its <style> went with it -- but "card"
  is still applied by markup that stayed, which now renders unstyled.
  Write <x-card>, or move those rules out of the definition
  ```
  
  It fires only when it has actually happened — the definition gone *and* a
  surviving element still applying the class — so a page that wears `.card` and
  also writes `<x-card>` hears nothing. Both static `class` and `:class-`
  toggles count as applying it, and only the text before each `{` is read for
  class names, so `url(logo.card)` in a declaration is not mistaken for a
  selector.
- 1d1d9ca: A scope can have a condition for a lifetime, and `<:mode>` can put one on
  somebody else's element.
  
  Three things arrive together, because the first two turned out not to be
  separable and the third is built on them. The design is in
  `docs/design/conditional-scopes.md`.
  
  **`<:logic>` takes a condition.** `:if`, `:else-if`, `:else` and `:for-data`
  are accepted, and what they decide is whether the scope exists at all — so
  `:did-init` runs when the condition becomes true and `:will-dispose` when it
  stops being, once per lifetime as always, with lifetimes now able to repeat:
  
  ```html
  <:logic :if=${dragging}
          :_move=${(e) => track(e)}
          :did-init=${() => window.addEventListener('pointermove', _move)}
          :will-dispose=${() => window.removeEventListener('pointermove', _move)} />
  ```
  
  `:for-each` stays refused, and the difference is the point: that objection was
  never lifetime but arity. A name meaning as many scopes as there are items is
  not fixed by knowing when each of them ends.
  
  This also closes a silent one. A `tag="x:logic"` instance inside a region
  compiled cleanly and then reported `init` once and nothing ever again — so a
  timer opened there ran on while the region was hidden, with no callback able
  to stop it.
  
  **A conditional scope's readers are checked**, which is the half that cannot
  be left out. `${app.foo}` where `app` may be gone is refused, and `${app?.foo}`
  is the spelling that works. The guard is not only a check: classifying a read
  as guarded is what registers the reader as a *maybe*, and maybes are what get
  re-linked when a region comes back. Called plain, the read is evaluated once
  against a name that is not there yet and never asked again.
  
  **`<:mode>` is a scope on its parent's element**, borrowing the nearest one
  above it so that a modality can arrive and leave without the element moving:
  
  ```html
  <div class="card">
    <:mode :if=${editing} :_draft=${text} :class-editing :attr-contenteditable=${true}>
      <button :on-click=${() => { text = _draft; editing = false }}>Save</button>
    </:mode>
    <p>${text}</p>
  </div>
  ```
  
  **The element stays**, which is the difference from `:if` on it — that takes
  the markup away and loses focus, scroll position and whatever else the DOM was
  holding — and from a handler bound once and guarded from inside, which goes on
  firing for every `pointermove` to decide it has nothing to do.
  
  **And `_draft` belongs to the edit rather than to the card**, so it is gone
  when the edit is. That is the argument for the tag more than the listener is:
  without it a modality's state lives on the element and has to be cleared by
  hand, which is the bug everybody writes once.
  
  A mode carries handlers, classes, styles, attributes, children and values of
  its own, and takes all of them back. Its children are **built and destroyed**
  rather than parked, which is the one place it departs from the region
  machinery instead of reusing it — every region here preserves, so a hide keeps
  focus and a playing video, and a modality wants the opposite.
  
  Nothing is remembered: what an element's `title` is, is whatever the innermost
  live declaration says, and handing it back is asking the one underneath to say
  again. Where two modes want one attribute, `:priority` decides — higher owns
  it while both are on, and hands it down the stack rather than to the element.
  Equal ranks are a compile error, since precedence between siblings is a rule
  nobody could guess.
  
  Two things it refuses on purpose: `:prop-`, a DOM property being state on the
  element instance with no declaration underneath to hand back to, and a
  *static* plain attribute, which a mode has no markup of its own to write.
  
  **A compiler crash went with it.** Reading a name declared inside a region
  whose host is unnamed — `${field.text}`, where every existing case reached
  `panel.field.text` — threw `TypeError: Cannot read properties of undefined`
  instead of reporting anything, and threw for `${field?.text}` too, so the
  crash landed on the one spelling the rule exists to accept.
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

### Patch Changes

- 19ca252: A usage site's `style` replaces a definition's, as the rule has always said
  it does.
  
  `class` and `style` are kept as element PROPERTIES rather than attribute
  nodes. Writing a class went to the property and replaced it; writing a style
  fell through to the generic path, landed in an attribute node BESIDE the
  property, and was merged with it on the way out:
  
  ```html
  <:define tag="my-box:div" style="gap: 1rem"><:slot /></:define>
  <my-box style="color: red">hi</my-box>
  ```
  
  served `style="color: red; gap: 1rem;"` where the same page's `class` would
  have replaced. One rule, two behaviours, decided by which of the two
  composite attributes it was — and the compiler warns about that `style`
  precisely on the grounds that it replaces.
  
  **It was also a difference between the server and the browser.** A real DOM's
  `setAttribute("style", ...)` replaces, so the instance built during a render
  and the instance built on hydration disagreed about what the element wore.
  
  Nothing in the demos or the kits writes a literal `style` at a usage site, so
  no built page changes. `style+=` and `style-=` are unaffected: those compose,
  and always went through the property.

## 0.8.0

### Minor Changes

- `<:group>` -- a branch or a replica with no element of its own.
  
  Every other directive goes on an element, which makes the element the unit:
  one condition, one thing shown. `<:group>` lifts that. It is a tag that never
  renders, and the branch and replication attributes it carries -- `:if`,
  `:else-if`, `:else`, `:server-if`, `:for-each`, `:for-as`, `:for-key`,
  `:for-data` -- apply to its contents, however many nodes those are.
  
  ```html
  <tbody>
    <:group :for-each=${lines} :for-as="line" :for-key=${line.id}>
      <tr><td>${line.name}</td><td class="num">${line.total}</td></tr>
      <tr class="note"><td colspan="2">${line.blurb}</td></tr>
    </:group>
  </tbody>
  ```
  
  Two rows per item and no wrapper, which matters here because there is no
  element you are allowed to put between `<tbody>` and `<tr>`. The same holds
  for `<dt>`/`<dd>` pairs, for `<option>`s, and for a branch that is a heading
  and a paragraph rather than a `<div>` around both.
  
  Attributes on `<:slot>` and `<:group>` are now refused rather than silently
  dropped: neither tag renders, so an attribute on one had nowhere to go.
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
- `:server-if` -- a branch decided once, on the server.
  
  The one directive `:server-` may mark. An ordinary `:if` has a live
  condition, so the markup of the branch that did *not* show still travels, in
  the stencil it would be built from -- which behind `${user.isAdmin}` is the
  admin panel, its links and its labels, in the page source of every visitor
  who is not an admin. A `:server-if` that did not show can never show, so
  there is nothing to build and its markup is not sent at all. One that did
  show hydrates as usual; only the decision is frozen.
  
  Precisely: the elements, their attributes and their text. Expressions inside
  the branch are compiled into the page's props, which are a function of the
  source rather than of the request, so they travel whatever the branch
  decided. Where the logic itself is the secret, keep it in a `:server-` value,
  whose expression the browser never receives.
- `$url` in page scope: the page's whole address, as a `URL`.
  
  `$origin` already answered "where is this page", and answered it for the one
  case that forced the question -- a `:server-` value fetching `/data.json` on
  a server that has no page to be relative to. `$url` is the same fact
  unabridged, for a page that wants the part the visitor asked for:
  `$url.pathname`, `$url.searchParams.get('q')`. It is a `URL` because `URL`
  was already a name expressions could use, so there is no new shape to learn,
  and `$origin` stays a name of its own rather than something reached through
  an address.
  
  Two things it does that nothing else on the globals list does:
  
  - **It changes while the page is up.** Everything else there is fixed for the
    life of a render, which is why reading one is not a dependency. An address
    is not fixed: a traversal, a fragment link, or a navigation a router kept
    in the document moves it, and every expression that read it re-runs.
  - **It is read-only, in whole and in part.** `$url = '/about'` and
    `$url.pathname = '/about'` are both refused with a message rather than
    quietly doing nothing -- a page assigning its own address would be claiming
    to have arrived somewhere it has not. Navigating is a side effect with a
    lifetime, so it belongs to a component; `globalThis.location.assign` is the
    name the language offers for it, and `$url` follows on its own.
  
  `markout build` now warns when a page reads `$url` and no `--origin` was
  passed, because there `$url` is undefined and whatever the page derived from
  it renders as though the address were empty.

### Patch Changes

- A page's document is rendered into again and again -- that is what makes a
  second visitor cost a render rather than a compile -- and three things the
  last render left behind were being served to the next one.
  
  - **A `:for-each`'s rows.** Almost everything in the document is put back or
    written over between renders; replication was the exception, so filtering
    the shop's catalog to books answered with the correct state, the correct
    heading, and the eight rows of whoever asked before.
  - **A `<:group>` replica.** The sweep that removes them looked each one up by
    its `data-markout` id, and a group replica is a run of siblings between two
    markers with no element to carry one. The lookup found nothing, the loop
    read that as "none left", and it stopped on the first replica it was there
    to remove -- a cart with a line removed served the survivor twice.
  - **A region the last render showed.** `acquireRegionDom` decides a region is
    showing by finding its element next to its marker, which is exactly where
    the last render left one, so this render adopted it. The condition does not
    correct that: a region toggles on *change*, and a fresh scope tree starts at
    `undefined`, so a condition that is falsy again never moves. `/product?id=nope`
    answered 404 with the previous visitor's product inside it.

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

## 0.6.1

### Patch Changes

- 88ff5c1: A globally installed kit is now reachable by `/npm/<package>`, not only by its
  own root.
  
  The two spellings of one file are resolved by two different mechanisms, and
  only one of them could see a global install. `discoverKits` is handed the
  global tree as the last resort a bare docroot has, so the kit was found and
  mounted, and `/bootstrap-kit/all.htm` worked. `/npm/@markout-lang/bootstrap-kit/all.htm`
  goes through `findPackage`, which walks `node_modules` upward from the
  importing file and arrives nowhere near a global tree -- so the same kit, in
  the same session, reported `Cannot find package "..." -- is it installed?`
  while sitting mounted in the resolver that said so.
  
  `Resolver` already receives the discovered kits; it now indexes them by
  package name as well as by directory, and `/npm/` consults that when the walk
  comes up empty. The walk still runs FIRST, because it is the one that gets
  nested installs right: where two copies of a kit exist, the importing file's
  own is the answer, and a name lookup cannot tell them apart. The name lookup
  is only for what no walk can reach.
  
  This is the case the `markout` docroot with no `package.json` around it is
  for -- installing a kit globally so as not to have to `npm init` first -- and
  it was the spelling the documentation uses.

## 0.6.0

### Minor Changes

- c86a69d: `class+=` and `class-=`, and `style+=` and `style-=`: contribute to an
  attribute instead of replacing it.
  
  They are not `:` names, for the reason the rest are — `:` names what HTML has
  no name for, and `class` has a name. What is new is the **operation**. Only
  those two attributes have them, being the two HTML gives a *set* rather than
  a value; a literal is read the way HTML spells that attribute, an expression
  carries the value itself.
  
  Nothing writes the attribute whole, which is what makes it hold: base, then
  every addition, then every removal, whatever order they appear in, and only
  the difference is applied. A class this page never put on — one Bootstrap's
  own JS added to a modal it was handed — is in neither set and so is never
  touched.
  
  A usage site that writes a plain `class` on a component computing its own now
  **warns**, and names `class+=` as what was probably meant.
- a4f641f: A runtime error names the line it was written on.
  
  "Mistakes caught before the page loads, with a file and a line" is the row
  this project is sold on, and it held exactly until the page started running.
  After that a failure said:
  
  ```
  markout [update] s12.text$7: Cannot read properties of undefined
  ```
  
  where `s12` is a scope uid and `text$7` a generated key — neither of them
  anything an author typed. The claim expiring at the moment it matters most.
  
  In dev mode it now says:
  
  ```
  markout [update] /demos/orbit.html:212:34 (text$7): Cannot read properties of undefined
  ```
  
  It names the file the expression was *written* in, so a component that fails
  points at its own fragment rather than at the page that used it. Every
  reporter goes through `formatRuntimeError`, so the console, the dev-mode
  overlay, the dev error page and the server log all gained it at once.
  
  **Dev only, and measured.** The map is compiled only in dev mode and carried
  only by a dev page: a production page's bytes are unchanged and its failures
  say exactly what they said before, which is also what keeps a served page
  from describing its own sources — the same reason the detailed compile-error
  listing is dev's. On this repository's heaviest page the map is 107KB of a
  dev-mode page that was already 715KB, against 284KB served in production
  carrying none of it.
- bd33a54: `hydrate()`: mount a compiled page against a DOM the caller supplies, which
  is what testing a component needs.
  
  The two entry points that existed could not be borrowed for it. A browser
  reaches the runtime through the bundle and `renderPage` reaches it with the
  compiler's own `ServerDocument`; both own the whole arrangement, and the
  server document's `addEventListener` is a no-op — correct there, since
  nothing on a server clicks anything, and useless for asserting that a handler
  does something.
  
  It hands back the page's values by name, live, and the array the runtime
  reports failures into, which keeps filling — so a test asserting it is empty
  at the end is asserting about the whole interaction rather than about
  hydration.
  
  Faithful to what the browser does rather than to what is convenient: it loads
  the `:server-` results the render carried into the page, because no test DOM
  executes what `document.write` puts in it and a page whose results never
  arrived would recompute them against a `fetch` that is not there — reporting
  failures no browser would ever see. It takes `origin` because `$origin` is
  `location.origin` in a browser and a test document's location is the runner's.
  And it takes **no** `globals`, because the browser supplies none: accepting
  them would let a test drive a page in a way no browser can, and pass.
  
  The recipe is in [docs/reference/testing.md](https://github.com/fcapolini/markout/blob/main/docs/reference/testing.md).

### Patch Changes

- 523ef5e: An attribute's own quote character can be used inside its `${…}` (#30).
  
  `:v="${"x"}"` and `:v='${'x'}'` both parse now. Before, the attribute-value
  scanner ended at the first matching quote whether or not it was inside an
  expression, so what reached the JS parser was a fragment and the error was a
  `SyntaxError` pointing *inside* the expression, at nothing the author had got
  wrong.
  
  It is HTML's rule, but `${…}` already suppresses the other delimiter — a `>`
  inside an expression does not end the tag — so the quote was the one place a
  delimiter stayed live inside an expression. Now nothing does, which is one
  fewer rule rather than one more.
  
  The scanner asks acorn where each expression ends rather than lexing
  JavaScript a second time, so strings, template literals, object literals and
  nested `${}` all end where the real parse says they do — and it hands those
  nodes to the parse that follows, so nothing is parsed twice. An attribute
  with no expression takes the path it always did.
  
  Measured, interleaved to cancel drift: this repository's homepage 37.8ms →
  39.0ms to compile, and its heaviest page unchanged at ~82ms.
- c86a69d: Bind a catch clause's parameter for its body.
  
  `try { … } catch (err) { report(err) }` inside a handler failed to compile
  with `Unknown reference: "err"`. The clause's parameter was recognised as a
  binding, but the walk deciding whether a later *use* of a name refers to a
  local never asked about a catch clause — so the name was bound and then not
  found, on JavaScript that is simply correct.
  
  `catch ({ message })` binds through the pattern, and `catch { }` binds
  nothing.
- c86a69d: Drop the stencils of instances written inside a definition that was itself
  dropped. Treeshaking removed the `<:define>` and left the `<template>` its
  nested usages had been relocated to, so a page shipped stencils for markup
  that no longer existed anywhere.
- c86a69d: Warn when a page writes a value the user can take away from it.
  
  `value=${v}` on an input reads as "this is the value" and behaves as "this
  was the initial value": HTML's dirty flag makes the element's own state
  independent of both the attribute and the content from the first keystroke,
  so `v = ''` after a submit empties the model and leaves the typed text on
  screen.
  
  The fix is `:prop-value=${v}` **beside** the attribute — the attribute is
  what the element is served with, the property is what it shows afterwards —
  and the compiler now says so when it sees one without the other: `value` on a
  typed-in `<input>` and on a `<textarea>` (its content as well as its
  attribute), `checked` on an `<input>`, `selected` on an `<option>`.
  
  `value=` was deliberately **not** made to write the property when it happens
  to be on an input: that would be one attribute meaning two different things
  depending on the element it sits on.
  
  The warning found five in `bootstrap-kit`, all fixed: `bs-input`,
  `bs-textarea`, `bs-check`, `bs-range` and `bs-select` were read-write
  everywhere except the direction a form needs after a submit.
- 5642d62: Write a text interpolation that can never change into the markup, and drop
  the binding (#33).
  
  After `:const-` substitution a token sheet comes out as `'... ' + '#2C88E7' +
  ' ...'`: no scope references left, no dependencies, and a value that will be
  evaluated once and never again. It shipped in full anyway. A whole stylesheet
  is one text node, so on the site the issue was filed against that was 3,136
  bytes on every page — 30% of everything those pages carried, for a binding
  that cannot produce anything the served markup does not already contain.
  
  The rewrite is safe because it is not a new write: server rendering already
  evaluates that value against that same document and puts the result in that
  same node. Only the *when* changes — once at compile time instead of once per
  render — and the served bytes are what they were, interpolation markers
  included.
  
  Written into the node rather than merely withheld from the client, which
  reaches a case a props-level fix could not: a stencil's markup is never
  rendered, so a constant inside an `:if` region or a `<:define>` body has to be
  in the template for a client-side instantiation to show it.
  
  Text only, and that is what makes it sound: a text value's key is generated,
  no expression can name one, so nothing can be reading it. What counts as
  constant is a whitelist of literal shapes rather than "has no dependencies" —
  `$id`, a global and a call have no dependencies either, and none of them is a
  constant.
  
  Measured on this repository's own site: 371 bytes a page on the two that
  import a token sheet, and nothing on the two that do not.

Entries below 0.6.0 were written after the fact, in 2026-08, when
[Changesets](https://github.com/changesets/changesets) was adopted. From then
on each entry is generated from the changeset files committed with the work,
so the note and the change travel together. Anything older than 0.4.0 is in
the git history rather than here.

## 0.5.0

### Minor Changes

- **`::name` changed meaning, and a page written for 0.4.x will not say so.**
  Read the migration note below before upgrading — this is the one release
  where a page can compile clean and mean something different.

- `::name=${...}` is now a component's **interface**: on a `<:define>` it
  declares a parameter, and at a usage site it passes one. That is what tells
  "this is for the component" from "this is mine" at a glance, and the name is
  reserved at every usage of that tag.

- `:const-name=${...}` is now how a **compile-time constant** is spelled — the
  meaning `::name` used to carry. It is a *modifier* rather than a family,
  like `:server-`, so it is not part of what the value is called:
  `:const-accent` is read as plain `${accent}`. Which is what lets a page take
  a kit's constant and make it live by declaring that name plainly.

- A usage site's own `:name=${...}` declares a local on the usage site, where
  `::name=${...}` passes a parameter to the component. Previously one spelling
  had to serve both.

### Patch Changes

- Warn about a value declared on a usage site that nothing reads — almost
  always a parameter that was meant to be passed with `::`.

## Migrating from 0.4.x

`::name` is the whole of it, and it changed *silently*: it used to declare a
compile-time constant and now declares a parameter, so a page carrying one
still compiles and no longer folds at build time.

```html
<!-- 0.4.x -->
<lib ::accent=${'#c33'}>

<!-- 0.5.x -->
<lib :const-accent=${'#c33'}>
```

Rename every `::name` that declared a constant to `:const-name`. What reads it
does not change — it was `${accent}` before and it is `${accent}` now, which
is why nothing at the read sites needs touching, and why nothing there can
warn you either.

`::` on a `<:define>` and at a usage site is new syntax rather than changed
syntax, so nothing written for 0.4.x is using it that way.

## 0.4.1

### Patch Changes

- Re-evaluate a value when its sources move, rather than once per cycle.
- Stop tracking a function's body, where nothing can consume the dependency.
- Supply a scope's own names when it is asked for them, not before.
- Walk the DOM by index instead of copying it to do so.
- Report which version of Markout built a page.
- Content-hash the runtime's URL, so it can be cached for a year.

## 0.4.0

The extension release: `@markout-lang/core` is the package a Volar language
server can depend on without pulling in Express, compression or commander.
The split, and the reasoning for where each boundary falls, is in
[monorepo.md](https://github.com/fcapolini/markout/blob/main/docs/design/monorepo.md).
