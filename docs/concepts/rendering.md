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

**Served by Node** — `markout <docroot>`, or the Express middleware. The render
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

A pre-compiled page has no request behind it, so anything that needed one has
no result to travel with:

- **`:server-` values** never ran, so they arrive with no value rather than a
  frozen one. Everything reading them derives from nothing.
- **A datasource in its default `served` mode** is the case worth spelling out,
  because it fails quietly: its fetch is a `:server-` value, so there is no
  data, and it does not fall back to fetching on arrival. Mark it `:client` and
  the browser fetches when the page comes up — a loading state instead of an
  empty one.

Both are reasons to choose the mode deliberately rather than to discover it,
which is why they are stated here rather than left to be found in a page that
renders blank.

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
