# Rendering

Markout uses the same language model for server rendering and browser runtime.
The compiler produces a runnable props object, the server can execute it once to
render HTML, and the browser runtime can hydrate the same result.

## The pipeline

The broad flow is:

1. Parse HTML into the compiler's internal representation.
2. Collect scopes, values, bindings, and dependencies.
3. Generate a runtime-ready props object.
4. On the server, execute that props object against the server DOM.
5. In the browser, load the runtime bundle and hydrate the same tree.

The important point is that the runtime is not a separate semantic model. The
server and browser both execute the same scope/value logic.

## Two ways to deliver a page

The compiled props object is the same artifact wherever it runs, which is what
lets a page be delivered two ways. The difference is not what the page is, it
is *when the render happens* — and therefore whether the page may read
anything only a server has.

**Served by Node** — `markout <docroot>` (or bare `markout`, which serves
`./markout`; see the README on that convention), or the Express middleware.
The render
runs per request, so a value may reach the request's environment: `:server-`
values run there, `$origin` comes from the request, and a datasource fetches
before the page is serialized. The browser receives finished markup and
hydrates it.

**Compiled ahead of time** — one build, then plain static files on any host.
The same render pass runs at build time instead of per request, so the output
still carries its markup, not an empty page waiting for JavaScript: everything
derivable from the page's own values is already there, and the runtime picks it
up exactly as it picks up a served page. What is missing is only what a request
would have supplied. This is the mode for a project whose pages are served by
Rails, Django, Laravel, PHP or a CDN — the backend stays as it is, and Markout
is a build step rather than something in the request path.

`markout build <docroot> <outdir>` is what produces this — see the CLI section
of the repository README for what it writes, what it refuses, and why a built
page looks for the runtime at a different path than a served one.

### What ahead-of-time compilation cannot carry

The render still happens — that is what puts the markup in the file — but there
is no request behind it, so no `$origin` (unless `markout build --origin` says
what it is, below) and none of the host's globals. Where that shows is a
`:server-` value, and the rule is short:

> **A `:server-` value that fails fails the build.**

Not a warning, and not a compile-time ban on `:server-` values either. The
reasoning is what the browser can and cannot repair. An ordinary value that
throws while rendering is re-derived there, where it may well succeed —
`${user.name}` asked before its datasource answered is the everyday case, and
the page is fine — so a build only warns. A `:server-` value crosses **frozen**,
with a result and no expression, so nothing re-runs it: whatever it failed to
produce, the page is without for as long as it exists. Such a page is not
written at all, on the same grounds as one that would not compile.

The reason it is not a compile-time refusal is that plenty of `:server-` values
work perfectly well here. One that reads nothing of the request runs at build
time and its answer is baked into the markup — which is what static site
generation *is*. And whether a given value needs a request is decided while it
runs, not while it compiles: `std-data` holds the same `:server-` value whether
it is inert or a fetch, depending on `:client`, so no static check could tell
those apart. The render can.

For a datasource that means:

| `:url` | `served` (default) | `:client` |
| --- | --- | --- |
| relative (`/api/rows`) | **fails the build** — nothing to resolve it against, and it says so | fetched by the browser on arrival |
| relative, with `--origin` | resolved against it and fetched while building | fetched by the browser on arrival |
| absolute (`https://…`) | fetched while building, answer baked into the page | fetched by the browser on arrival |

`markout build --origin <url>` is the middle row: it supplies the `$origin`
there is no request to take one from. It is what a docroot carrying its own
data wants — Orbit, the largest demo in the repository, reads a directory of
JSON files that sit beside its pages, so anything serving that directory makes
the whole console buildable:

```sh
npx markout ./site                                   # in one terminal
npx markout build ./site ./dist -o http://127.0.0.1:3000
```

What ships is the answer rather than the question, which is the point: the
built pages carry their rows, and the data files travel along with them for
whatever asks again later.

## Dynamic text and DOM markers

The browser layer needs to find the DOM nodes for dynamic text values. The
compiler therefore marks text positions with HTML comments, and the runtime uses
those markers to map each `text$N` value back to the correct node.

This is an implementation detail, but it explains why Markout can update text
nodes without a second parse pass in the browser.

## SSR and hydration

Server rendering happens in `src/server/render.ts`. The server evaluates the
generated props, builds a `WebContext` around the server DOM, and runs the same
refresh logic that the browser runtime uses later.

That shared execution model is what makes hydration straightforward: the browser
looks for already-rendered nodes by id instead of needing a separate hydration
language.
