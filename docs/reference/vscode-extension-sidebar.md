# The Markout sidebar: who is this for?

The Markout view in VS Code installs kits with checkboxes, previews your pages
and builds your site, and it does all of that without a terminal and without
npm. This page is what its
**"Who is this for?"** link points at.

The short answer is that Markout has two ways to install a kit, and which one
is yours depends on a single question: **do you have Node?**

If you do, use npm — the sidebar is not for you, though nothing stops you
using it. If you do not, you do not need Node at all, and that is not a
workaround: it is the point.

| | **without-node mode** — the sidebar | **npm mode** |
|---|---|---|
| You have | an editor and a folder of HTML | Node, npm, a `package.json` |
| Install a kit | tick it in the Markout sidebar, or `markout add` | `npm i @markout-lang/bootstrap-kit` |
| Kits live in | `.markout/kits/` | `node_modules/` |
| Versions pinned by | `.markout/kits.json` | `package.json` + the lockfile |
| A clone gets them with | `markout restore` | `npm ci` |
| Preview and build | buttons in the sidebar | the same, or `markout <docroot> -d` |
| Your pages render | in the browser | in the browser, at build time, or per request |

Both produce the same project. The compiler resolves kits from either
directory by the same walk, so a page, a preview, a build, a teammate's
terminal and CI all see the same tree — and a project can move between the
two modes, or use both at once, without anything being converted.

That last row is the one real difference, and it follows from the premise
rather than being a limitation of the sidebar. Rendering a page ahead of time
or per request means Node executing it, and without-node mode is for people
who have not got Node. So the sidebar builds pages that render in the browser,
which is the delivery that needs no server — see
[what the sidebar does not do](#what-the-sidebar-does-not-do).

## Why without-node mode exists

The language is pitched at people who write HTML: designers who code, backend
developers with a templating layer they would rather not have, anyone
maintaining a server-rendered application in a language that is not
JavaScript. Almost none of them have Node, and none of them want it.

Asking that audience to install Node in order to use a kit would be asking
them to adopt the toolchain the language exists to avoid. So the editor does
not ask. The compiler already runs inside the extension — there is no
toolchain to hide, only one that never has to be installed — and installing a
kit is the extension fetching a small archive of `.htm` and CSS into a folder
in your project.

There is no terminal in that, and no npm.

## What the sidebar does

- **A list of kits, with checkboxes.** Ticking one installs it into this
  project; unticking removes it. Unticking a kit your pages still use is
  refused, and the refusal names the pages.
- **Pinned versions, with offered bumps.** A new version does not arrive on
  its own. It is offered, one click, and you accept or decline it; the number
  still waiting shows as a badge on the Markout icon. Two clones of your
  project therefore build the same thing, which is the property a moving
  version quietly costs you.
- **Restore** — fetch every kit `.markout/kits.json` pins, for a clone that
  arrived without them.
- **Search the npm registry** — Markout's own kits are offered first;
  searching the whole registry is a separate step, because a kit's code
  becomes part of the pages you ship.

- **Preview** — serves your pages and opens them in a browser, reloading as
  you save.
- **Build** — writes the finished site to `dist/`.

Both work the way `markout build` does: the page is compiled and every value
resolves in your browser, which is how a built site behaves once deployed. So
the preview shows the page you are going to ship, and no kit's code runs on
your machine — it runs in your browser, like any other script on a page.

A kit npm installed shows too, with its checkbox locked on: it is genuinely
installed and you should be able to find it, but `package.json` and your
lockfile own that one, so `npm uninstall` removes it rather than the checkbox.

None of those buttons needs Node on your PATH. Preview runs the server on the
copy of Node your editor is already running on, so there is nothing to find
and nothing to install.

## What the sidebar does not do

**It does not render your pages ahead of time, or on a server.** Build writes
pages that fill themselves in when someone opens them, and Preview shows you
exactly that. Markout can also render a page [at build time or per
request](../concepts/isomorphism.md) — but both of those are Node executing
your page, and this mode is for people who have not got Node.

You want one of them if:

- **a crawler that will not run JavaScript has to see your content.** Search
  engines mostly do run it now; some other things that read pages do not.
- **your pages read something only a server has** — a database, a private API,
  the visitor's request.

Either needs Node somewhere. It does not have to be your machine: a colleague
or a CI job can run `markout prerender` on the same project, unchanged, and
publish the result. Nothing has to be converted, and your kits and pages stay
exactly as they are.

## The same thing from a terminal

Everything the sidebar does has a command, because a project the sidebar
produced has to be buildable by somebody who has only a terminal — otherwise
it is a project only the sidebar can build, and CI cannot build it at all:

```sh
markout add @markout-lang/bootstrap-kit    # a checkbox: fetch a kit and pin it
markout restore                            # fetch everything kits.json pins
markout ./site -d --client                  # Preview: serve the pages, live
markout build ./site                       # Build: write the deliverable
```

`markout ./site` is the **server**, and with `-d` it is what the Preview
button runs. It serves your docroot on <http://localhost:3000> and compiles
each page as it is asked for, rather than ahead of time — so a page is never
stale and nothing has to be rebuilt before you look at it. `-p 8080` moves the
port.

`--client` serves pages as `markout build` writes them — no server-side
render, every value resolving in the browser. It is what the sidebar's Preview
uses, and what makes a preview match a static deployment. Leave it off and the
server renders each page before sending it, which is what you want if Node is
what serves your site.

`-d` is **dev mode**, and it is the half that makes this a preview rather than
a deployment. It does two things: the browser reloads itself when a file in
the docroot changes, and an expression that throws shows its error *in the
page*, naming the value that failed, instead of being swallowed and leaving a
blank element behind. Both are off by default, and should be — a deployed
page should not carry a reload socket or show its errors to visitors.

`markout restore` is the one a fresh clone runs, and the one to put in CI.
`.markout/kits/` is not committed by default — `.markout/kits.json` is, and it
is enough to reproduce the tree exactly.

> Kits are `.htm` and CSS: a few hundred kilobytes of text that diffs, with no
> native binaries and no build step. If you would rather commit them and have
> a project that needs no install at all, delete the `kits/` line from
> `.markout/.gitignore` and commit the directory. Nothing else changes.

## Why npm mode is still the right default if you have npm

`npm i` has a dependency resolver, a lockfile, an audit trail and an ecosystem
of tooling that understands it. None of that is worth reimplementing, and
`markout add` does not try: it resolves one exact version of one package and
unpacks it.

So if there is a `package.json` in your project, install kits with npm. The
compiler looks in `node_modules/` first-class — that is where kits were found
before `.markout/kits/` existed, and nothing about it has been demoted.

`markout add` and `markout restore` are documented, supported and narrow. They
exist for people who have no npm, and for CI restoring a project built by
someone who has none.

## What a kit is, either way

Unchanged by any of this: a kit is a package that declares a logical root, and
everything it publishes is addressed under that root as though the package sat
there in your docroot.

```json
{ "markout": { "root": "/bootstrap-kit" } }
```

```html
<:import src="/npm/@markout-lang/bootstrap-kit/all.htm"/>
```

The full contract is in [kits](../concepts/kits.md), the commands are in
[running a page](cli.md), and the reasoning behind both install paths is in
[Working without Node](../design/without-node.md).

## If a kit seems to be missing

A page using a kit you have not got used to fail *silently* — the kit's tags
rendered as empty elements and nothing said why. With a manifest it does not:

```
kit "@markout-lang/bootstrap-kit" is declared in ".markout/kits.json" and is
not installed -- run "markout restore" to fetch what the manifest asks for
```

That message comes from the compiler, so the editor, `markout build` and CI
all say it.
