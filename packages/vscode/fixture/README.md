# Extension fixture

The folder the Extension Development Host opens when you press F5. A handful
of pages, each there to show one thing.

Note what is *not* here: a `package.json`, a config file, an install of any
kind. The extension finds the docroot because the folder is called `markout`,
which is the same convention the CLI uses — `markout` serves this directory
and `markout build` compiles it into a sibling `dist/`.

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
compiler conjures — the definition is a file, and you can read it. `:url`
goes to the same place, and typing `<std-` or a `:` inside the tag offers
what the kit defines. `people.json` beside it is what the page fetches if you
ever serve this folder.

**`markout/scopes.html`** — four names on one line, each a different
question. `body` is a named *scope* and goes to the `<body>` tag; `items` is
a value *inside* it, reached by navigating there first; `item` is the loop
alias and goes to the `:for-as` beside it. `page` and `head` are there too.

**`markout/bootstrap-kit/`** — a kit *vendored into the docroot*, which is
why `kitchen-sink.html` imports `/bootstrap-kit/all.htm` and not `/npm/…`.
It also shadows the installed copy of the same kit on purpose: two kits
claiming one root is refused rather than resolved, since preferring either
would hide the other.

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
code --install-extension packages/vscode/markout-vscode-0.2.0.vsix --force
```

It prints what went into the archive as it builds it — two bundles, the
grammars, the icon, the README, the licence, and nothing else. Reload the
window afterwards. To go back to the development host alone:

```sh
code --uninstall-extension fcapolini.markout-vscode
```

Running both at once means two language servers answering about the same
page, which looks like the extension reporting everything twice.

See [the design note](../../../docs/design/editor-support.md) for why any of
this is shaped the way it is.
