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
