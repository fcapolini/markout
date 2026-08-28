# Markout for VS Code

[Markout](https://github.com/fcapolini/markout) is an HTML extension: it adds
modularity, reactivity and isomorphism to plain HTML, and stops there. Not an
application framework — you write pages rather than components, and the same
scope-and-value model runs on the server and in the browser, so rendering
server-side comes for free.

Modularity is where that goes furthest. A `<:define>` makes a custom tag, and
a directory of them is a **kit** — an npm package of plain `.htm` fragments a
page pulls in with one import. Kits are how capability gets added without the
language growing to hold it: `@markout-lang/std-kit` supplies the system parts of
a page, data sources and the outside world, written with the language rather
than built into it, and `@markout-lang/bootstrap-kit` puts Bootstrap's components
behind tags of their own. A kit is ordinary markout, so there is no component
API to learn beyond the language itself.

This VS Code extension is two things. It is the compiler's answers where you
are typing — what is wrong with this page, where this name is declared, what
is in scope here, from the same compiler that will serve the page and over the
buffer rather than the file on disk. And it is a **Markout view** that
installs kits, previews the site and builds it, with no terminal and no npm
anywhere in it.

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
  (`/lib.htm`) or a kit (`/npm/@markout-lang/bootstrap-kit/all.htm`). Neither is
  somewhere an editor could find by guessing; both come from the compiler's
  own resolver.
- **Completion** of names in scope: `body.` offers what is in `body`, a bare
  `${` offers everything visible from there, `<x-` offers the tags every
  imported kit defines, and `:` inside such a tag offers the parameters that
  one takes — spelled `::name`, which is how a component's interface is both
  declared and passed. The values every scope supplies — `$id`, `$parent`, `$host`,
  `$value`, `$set`, `$dom` — come last, after what the page declares.
- **Hover, rename and find-references** across the pages and fragments a
  name actually reaches.
- **Syntax highlighting** for `${…}`, `:`-attributes, `<:…>` directives and
  the `//` and `/* … */` comments a tag may carry between its attributes.
- **Formatting** that re-indents a wrapped attribute list — and, on these
  files, only markout can. See below.
- **A view of its own** — kits with checkboxes, Preview, and Build. See the
  next section.

## The Markout view

The mark in the activity bar opens it, and everything in it works on a project
that has installed nothing.

**Kits, with checkboxes.** Tick one and it is fetched into `.markout/kits/`
and pinned in `.markout/kits.json`; untick it and it goes. No npm is involved
and none is needed — a kit is `.htm` and CSS, fetched over HTTPS and checked
against the checksum the registry published. Markout's own kits are offered
first; searching the whole registry is a separate step.

A kit npm installed shows too, with its checkbox locked on: it *is* installed
and you should be able to find it, but `package.json` and your lockfile own
that one. And unticking a kit your pages still import is refused, with the
pages named — a kit taken out from under a page that uses it renders nothing,
with no error to say why.

**Updates are offered, never applied.** A newer version shows as
`1.0.0 → 1.1.0` with accept and decline beside it, and declining is remembered
for that version, so the next release asks again. The number waiting is a
badge on the icon. Two clones of your project therefore build the same thing.

**Preview** serves your pages and opens them in a browser, reloading as you
save. **Build** writes the finished site to `dist/`.

Both work the way `markout build` does: the page is compiled and every value
resolves in your browser, which is how a built site behaves once deployed. So
the preview shows the page you are going to ship — and no kit's code runs on
your machine, because nothing here renders one.

Markout can also render a page [at build time or per
request](https://github.com/fcapolini/markout/blob/main/docs/concepts/isomorphism.md).
Both of those are Node executing your page, so they are a terminal's job and
want Node installed. This view is for the delivery that does not.

**Who is this for?**, the first row, opens a page shipped inside the
extension explaining the two ways to install a kit and which is yours: npm if
you have Node, these checkboxes if you do not.

## Formatting

Format Document indents the lines an attribute list wraps onto, and nothing
else. It does not decide where a list should wrap, and it never moves
content: whitespace between two elements is text in this language, so a
formatter that reaches past the `>` changes what the page says rather than
how it looks.

Which shape a file gets comes from its extension.

| | |
| --- | --- |
| `.html` | Indented like HTML — attributes line up under the first one. A page should read like the page it is. |
| `.htm` | Indented like code — attributes one step in from their tag, the closing `>` back at the tag's own column. A fragment is a module: a `<:define>` header is a parameter list, and its body holds arrow functions and comments. |

The extension takes formatting off VS Code's HTML service for these files,
which is not a preference. An HTML formatter reads the raw text, so the `>`
in `:_class=${['a'].filter(s => s)}` ends the tag for it — it closes the tag
there and every attribute after it becomes text. `// parameters` in a
definition's attribute list comes back as two attributes. That is a
different document, not a differently indented one.

**The built-in HTML extension is separate, and still offers to format these
files.** If you have `editor.formatOnSave` on, point HTML at this one:

```json
"[html]": { "editor.defaultFormatter": "markout.markout-vscode" }
```

Not set for you, because these are `html` documents on purpose and this
extension does not displace anything you have not asked it to.

A file indented with tabs is left alone: the page shape aligns to a column
derived from the tag's name, which no number of tabs can express, and
formatting one of the two shapes while quietly skipping the other would be
worse than doing nothing.

## When it speaks up

A `.html` file holding `${…}` is JSP EL, Thymeleaf or Underscore at least as
often as it is a markout page, so the extension looks for evidence before
reporting anything. Either kind will do:

- **the page's own syntax** — a `<:…>` directive, or an attribute whose value
  is an expression (`:count=${…}`). It is the `=${` that is markout's: Alpine
  and Vue write `:class="…"` quoted, and Thymeleaf's `th:text` does not begin
  with a colon.
- **the project** — any of three ways of saying so: a docroot that *is* a
  directory named `markout`, a `package.json` with a `markout` section in it
  (`markout.docroot`, or a kit's `markout.root`), or a `package.json`
  depending on `markout` or `@markout-lang/*`.

The first of those is the one that matters for markout's delivery story:
create a `markout/` folder, write ordinary-looking pages in it, run
`npx markout` — there is nothing installed to depend on markout, and the
folder name is the whole declaration.

`markout.enable: always` is the escape hatch for the rest — a vendored copy
under some other name, or a page opened on its own.

## Settings

| Setting | Default | What it is |
| --- | --- | --- |
| `markout.docroot` | *empty* | The directory absolute paths are resolved against, so that `/lib.htm` means in the editor what it will mean when served. A string, or an array of them for a project that serves more than one. Empty falls back to the project's own answer, below. |
| `markout.enable` | `auto` | `auto` looks for the evidence above. `always` diagnoses every HTML file. `never` says nothing. |

Both take effect where you change them — no window reload.

### More than one docroot

A window is often open on a project that serves several — a site and a demo
beside each other, or a monorepo of them. Name them in the project's own
`package.json`, where the answer is checked in rather than per-person:

```json
{
  "markout": {
    "docroot": ["sites/site/markout", "kits/bootstrap"]
  }
}
```

Paths are relative to the `package.json` that declares them, and a single
string is still a single string. Each file is read against the **innermost**
docroot that contains it; a file under none of them falls through to the
guess — the nearest ancestor named `markout`, then the nearest with a
`package.json`, then the workspace folder.

The `markout.docroot` setting overrides this when it names a docroot the file
is in, which makes it what it should always have been: the local override,
not the only answer.

## Requirements

None, and that is the point rather than a boast.

The compiler and the server are both bundled, so nothing here asks you to
install anything. Diagnostics come from that compiler. Installing a kit needs
no npm: the extension fetches and unpacks it itself. Preview runs that server
on the copy of Node your editor is already running — so nothing looks for
`node` on your PATH, and nothing has to be found there.

Which means the whole of the above works on a machine with no Node, no npm and
no toolchain: write the pages, tick a kit, press Preview.

---

MIT. Source, issues and the design notes are at
[github.com/fcapolini/markout](https://github.com/fcapolini/markout) — the
extension in
[packages/vscode](https://github.com/fcapolini/markout/tree/main/packages/vscode),
and why it is shaped this way in
[docs/design/editor-support.md](https://github.com/fcapolini/markout/blob/main/docs/design/editor-support.md).
