# @markout-dev/core

The compiler and the isomorphic runtime behind
[Markout](https://markout.dev) — an HTML extension that adds modularity,
reactivity and isomorphism to plain HTML. No HTTP anywhere: this package
turns a page into rendered markup plus the runtime that keeps it live, and
leaves serving it to somebody else.

```js
import { Compiler } from '@markout-dev/core';

const page = await new Compiler({ docroot: './site' }).compile('/index.html');
console.log(page.markup);
```

You probably want one of these instead:

- **[@markout-dev/cli](https://www.npmjs.com/package/@markout-dev/cli)** —
  `markout ./site` to serve a directory, `markout build` to render it out.
- **[@markout-dev/express](https://www.npmjs.com/package/@markout-dev/express)**
  — markout as middleware, after your own routes.

What it exports, and why the model is shaped this way, is in the
[repository](https://github.com/fcapolini/markout) and its
[design notes](https://github.com/fcapolini/markout/tree/main/docs).

MIT.
