# @markout-lang/cli

The command line for [Markout](https://markout.dev) — an HTML extension that
adds modularity, reactivity and isomorphism to plain HTML.

```sh
npm i -g @markout-lang/cli

markout ./site        # serve it, with live reload
markout build         # render ./markout into a sibling ./dist
```

A project that already has a `package.json` — anything using kits — pins it
instead, and the command is the same:

```sh
npm i -D @markout-lang/cli
npx markout ./site
```

A bare `markout` serves `./markout`, and a bare `markout build` compiles that
directory into a sibling `./dist` — the convention the whole toolchain shares,
so a docroot means the same thing to the server, to a build and to the
[VS Code extension](https://marketplace.visualstudio.com/items?itemName=markout.markout-vscode).

Pages are ordinary `.html` files. Nothing here asks you to adopt a project
layout beyond the docroot.

Full documentation is in the
[repository](https://github.com/fcapolini/markout).

MIT.
