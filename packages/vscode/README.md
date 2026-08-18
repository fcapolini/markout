# Markout for VS Code

[Markout](https://github.com/fcapolini/markout) is an HTML extension: it adds
modularity, reactivity and isomorphism to plain HTML, and stops there. Not an
application framework — you write pages rather than components, and the same
scope-and-value model runs on the server and in the browser, so rendering
server-side comes for free.

Modularity is where that goes furthest. A `<:define>` makes a custom tag, and
a directory of them is a **kit** — an npm package of plain `.htm` fragments a
page pulls in with one import. Kits are how capability gets added without the
language growing to hold it: `@markout/std-kit` supplies the system parts of
a page, data sources and the outside world, written with the language rather
than built into it, and `@markout/bootstrap-kit` puts Bootstrap's components
behind tags of their own. A kit is ordinary markout, so there is no component
API to learn beyond the language itself.

This VS Code extension is its editor support: the compiler's answers, where
you are typing. What is wrong with this page, where this name is declared,
what is in scope here — from the same compiler that will serve the page, and
over the buffer rather than the file on disk.

Markout claims no file suffix of its own. A page is a `.html` file like any
other, and this extension **adds to** VS Code's HTML support rather than
replacing it: Emmet, tag completion, auto-closing and every other
HTML extension keep working exactly as they did.

## What it does

- **Diagnostics** — the compiler's own errors, on the right line, without
  saving. A page that imports a broken fragment says so, and the fault is
  reported in the file it was written in.
- **The whole project, not only what is open.** The Problems panel is
  answered for every page in the workspace from the moment the window opens.
- **Go to definition** on a name in `${…}`, on a custom tag — including one a
  kit defines, which lands on its `<:define>` inside the installed package —
  and on the path in an `<:import>`, whether that is docroot-relative
  (`/lib.htm`) or a kit (`/npm/@markout/bootstrap-kit/all.htm`). Neither is
  somewhere an editor could find by guessing; both come from the compiler's
  own resolver.
- **Completion** of names in scope: `body.` offers what is in `body`, a bare
  `${` offers everything visible from there, `<x-` offers the tags every
  imported kit defines, and `:` inside such a tag offers the parameters that
  one takes.
- **Hover, rename and find-references** across the pages and fragments a
  name actually reaches.
- **Syntax highlighting** for `${…}`, `:`-attributes, `<:…>` directives and
  the `//` and `/* … */` comments a tag may carry between its attributes.

## When it speaks up

A `.html` file holding `${…}` is JSP EL, Thymeleaf or Underscore at least as
often as it is a markout page, so the extension looks for evidence before
reporting anything. Either kind will do:

- **the page's own syntax** — a `<:…>` directive, or an attribute whose value
  is an expression (`:count=${…}`). It is the `=${` that is markout's: Alpine
  and Vue write `:class="…"` quoted, and Thymeleaf's `th:text` does not begin
  with a colon.
- **the project** — a `package.json` depending on `markout` or `@markout/*`.

`markout.enable: always` is the escape hatch for a project that uses markout
without depending on it — a vendored copy, or a page opened on its own.

## Settings

| Setting | Default | What it is |
| --- | --- | --- |
| `markout.docroot` | *empty* | The directory absolute paths are resolved against, so that `/lib.htm` means in the editor what it will mean when served. Empty guesses: the nearest ancestor named `markout`, then the nearest with a `package.json`, then the workspace folder. |
| `markout.enable` | `auto` | `auto` looks for the evidence above. `always` diagnoses every HTML file. `never` says nothing. |

Both take effect where you change them — no window reload.

## Requirements

None. The compiler is bundled, so the extension works on a project that has
installed nothing — which is markout's delivery story: write the pages, run
`npx markout ./markout`, done.

---

MIT. Source, issues and the design notes are at
[github.com/fcapolini/markout](https://github.com/fcapolini/markout) — the
extension in
[packages/vscode](https://github.com/fcapolini/markout/tree/main/packages/vscode),
and why it is shaped this way in
[docs/design/editor-support.md](https://github.com/fcapolini/markout/blob/main/docs/design/editor-support.md).
