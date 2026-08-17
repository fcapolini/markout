# Extension fixture

The folder the Extension Development Host opens when you press F5. Four pages,
each there to show one thing.

Note what is *not* here: a `package.json`, a config file, an install of any
kind. The extension finds the docroot because the folder is called `markout`,
which is the same convention the CLI uses — `markout` serves this directory
and `markout build` compiles it into a sibling `dist/`.

## What to try

**`markout/index.html`** — a page with nothing wrong with it. Ctrl-click
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

## What to check while you are in there

- HTML still behaves like HTML: Emmet, tag completion, auto-closing tags.
  The extension contributes an *injection* grammar rather than a language of
  its own, so none of that is displaced.
- `${…}` and `:`-attributes are highlighted rather than reading as plain
  text or as broken markup.
- Folding works around `<body :hidden=${a > b}>`. That `>` would end the tag
  for an HTML parser, and does not here — see the masking in `src/plugin.ts`.

See [the design note](../../../docs/design/editor-support.md) for why any of
this is shaped the way it is.
