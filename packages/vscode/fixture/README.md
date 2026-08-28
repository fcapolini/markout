# Extension fixture

The folder the Extension Development Host opens when you press F5. A handful
of pages, each there to show one thing.

Note what is *not* here: a `package.json`, a config file, an install of any
kind. The extension finds the docroot because the folder is called `markout`,
which is the same convention the CLI uses — `markout` serves this directory
and `markout build` compiles it into a sibling `dist/`. The sidebar's Preview
and Build do the same two things without a terminal.

## What to try

**`markout/index.html`** — a page with nothing wrong with it. Ctrl-click
`<x-card>` and you land on the `<:define>` in the fragment next door, which
is the tag's meaning and nowhere near the page you were reading. Ctrl-click
`"/lib.htm"` in the `<:import>`: it opens the fragment. That path is
*docroot*-relative rather than relative to this file, which is why an editor
cannot follow it by guessing — the answer comes from the compiler's own
resolver.

**`markout/broken.html`** — two mistakes, both underlined. Change `totl` to
`total` and the squiggle goes **without saving**: the compiler is being run
over the buffer, not the file. That is the whole point of the extension.

**`markout/missing.html`** — a `<:include>` naming a file that is not there.
It gets a page of its own because a failed include stops the compile: nothing
after it is reached, so no other mistake in that page would be found.

**`markout/plain.html`** — ordinary HTML, with a `$5`, a `50%` and a
JavaScript template literal in a `<script>`. Nothing is reported and nothing
should be: plain HTML is a subset of markout, and the extension has no
opinion about a file that is not using it.

**`markout/tags.html`** — a custom tag and the directions that live a few
characters apart. Ctrl-click `x-card` for its `<:define>`; `:title` for the
*parameter* it sets, in the other file; and inside that attribute's **value**
for what the value reads, back in this page — because an expression written
at a usage site is evaluated there. `:aka` and `class` go nowhere, being the
language's and HTML's rather than the tag's. It also holds `$parent`, which
navigates, and `$host`, which deliberately does not: that is whichever
instance encloses this one, a property of each usage rather than of the
definition.

**`markout/data.html`** — `<std-data>`, from a kit this page never imports.
The standard kit ships with the compiler and is spliced into every page, so
there is nothing here to install and nothing to write. Then ctrl-click the
tag: it opens `@markout-lang/std-kit/parts/data.htm` in `node_modules`, which
is the point of having done it as a real kit rather than as something the
compiler conjures — the definition is a file, and you can read it. `::url`
goes to the same place, and typing `<std-` or a `:` inside the tag offers
what the kit defines. `people.json` beside it is what the page fetches if you
ever serve this folder.

**`markout/scopes.html`** — four names on one line, each a different
question. `body` is a named *scope* and goes to the `<body>` tag; `items` is
a value *inside* it, reached by navigating there first; `item` is the loop
alias and goes to the `:for-as` beside it. `page` and `head` are there too.

**`markout/kitchen-sink.html`** — imports `/bootstrap-kit/all.htm`, which is
a kit's *mounted root* rather than a path in this folder. Nothing named
`bootstrap-kit` is here: the kit is installed, it declares that root, and
everything it publishes is addressed under it as though it sat there. That
one import is the whole of what a kit costs a page.

This folder used to carry a symlink of the same name, from before kits were
packages, and it shadowed the installed copy — deliberately, to show that two
things claiming one root is refused rather than resolved. That refusal is
asserted in `packages/core/test/kits.test.ts`, where it does not also have to
be the first thing anyone opening this fixture sees.

## The Markout sidebar

The mark in the activity bar opens it. Everything below is what this fixture
shows, and it is worth pressing F5 with the sidebar open rather than reading
about it.

**"Who is this for?"**, the first row, opens a page shipped inside the
extension — not a link to github.com, so it describes the sidebar you are
running and works with no network.

**The kits are both listed as `— npm`, with their checkboxes locked on.** The
development host runs from this repository, so `@markout-lang/std-kit` and
`@markout-lang/bootstrap-kit` are found in its `node_modules`. That is the
distinction the view is drawing: a kit npm installed shows because it *is*
installed and you should be able to find it, and its checkbox cannot remove it
because `package.json` and a lockfile own that one. A kit the sidebar
installed would be removable, and would say a version rather than `— npm`.

Which means this fixture does not demonstrate the interesting half of the
checkbox. To see that, open a folder with a `markout/` directory in it and
nothing else — the sidebar will offer this project's kits, tick one, and it
lands in `.markout/kits/` with a pin in `.markout/kits.json`.

**Preview** serves the pages and opens a browser. Note what did not happen:
nothing looked for node on your PATH. It runs a bundled copy of the `markout`
command on the copy of node the editor is already running, which is the whole
reason this works for somebody who has neither node nor npm.

It serves in `--client` mode, which is the delivery this mode is for: pages
that render in the browser. So a `:server-` value or a datasource resolves on
arrival rather than before the page is sent, exactly as it will once the
output is deployed to a static host.

**Build** writes `dist/` beside the docroot, with a `.gitignore` in it. That
is a build markout chose the location of, so it tidies up after itself.

**Where a tick would write.** This fixture has no `package.json`, so
`.markout/` would go in `markout/` itself — the bare-docroot case, where the
folder of pages is the project. The walk is bounded by the folder you opened;
without that it would find this repository's `packages/vscode/package.json`
and install kits into the extension's own package.

## The Problems panel

Open the fixture and look at Problems before opening anything: `broken.html`
and `missing.html` are listed already. The whole project is compiled, not
only what is on screen — and a fault inside a fragment is listed against the
fragment, at its line, because the page that imports it is what found it.

## Completion

Type `${body.` anywhere in `markout/scopes.html` and the list is `body`'s
values first, then what is visible from there — because `body.appName` really
does resolve, and a list that hid it would be shorter than the truth. A bare
`${` offers everything in scope, scopes included.

Worth noticing while you do it: the page does not compile at that moment, and
the list appears anyway.

## When the editor disagrees with all of that

Run the same questions past the built server, with no VS Code in between:

```sh
npm run probe -w markout-vscode
```

It prints what `dist/server.js` actually answers. If those answers are right
and the editor's are not, the editor is holding a language server from before
the last build — **stop the debug session and start it again** rather than
reloading the window, since only a fresh launch runs the build task.

## What to check while you are in there

- HTML still behaves like HTML: Emmet, tag completion, auto-closing tags.
  The extension contributes an *injection* grammar rather than a language of
  its own, so none of that is displaced.
- `${…}`, `:`-attributes and the `//` and `/* … */` comments between a tag's
  attributes are highlighted rather than reading as plain text or as broken
  markup. What the grammars actually do is a question with an answer:

  ```sh
  npm run tokens -w markout-vscode                 # every page in the repo
  npm run tokens -w markout-vscode -- <file>       # one file, token by token
  ```

  It runs VS Code's own installed grammars over the pages here, with ours
  injected the way the extension injects them, and reports every character
  HTML is painting as an error.
- Folding works around `<body :hidden=${a > b}>`. That `>` would end the tag
  for an HTML parser, and does not here — see the masking in `src/plugin.ts`.

## Trying the packaged extension

None of the above exercises packaging, and packaging is where an extension
that works breaks: the development host runs from this repository, where
`@markout-lang/core` resolves through a workspace symlink that no `.vsix`
carries. So before publishing, install the archive and use that:

```sh
npm run package -w markout-vscode
code --install-extension packages/vscode/markout-vscode-*.vsix --force
```

It prints what went into the archive as it builds it — three bundles, the
browser runtime, the grammars, the icons, the "Who is this for?" page, the
README, the licence, and nothing else. The third bundle is the `markout`
command itself, which the sidebar's Preview spawns as a child process; it
carries a web server, and that is exactly why it is a separate file run in a
separate process rather than something the editor loads. Reload the
window afterwards. To go back to the development host alone:

```sh
code --uninstall-extension markout.markout-vscode
```

Running both at once means two language servers answering about the same
page, which looks like the extension reporting everything twice.

See [the design note](../../../docs/design/editor-support.md) for why any of
this is shaped the way it is.
