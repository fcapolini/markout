# Testing a page, and a component

A component is a fragment of HTML given a name, so testing one is not a
special activity with a framework of its own: you compile a page that uses
the tag, mount it against a DOM, and assert on the markup that came out.
Three calls, all of them `@markout-lang/core`'s.

There is no `@markout-lang/testing` package and no custom assertion library.
What a component produces is elements and text, and every test runner already
has opinions about how to assert on those — this page's job is only to get
you a real document with your component standing in it.

## What you need

A test runner, and a DOM. This repository uses [vitest](https://vitest.dev)
and [happy-dom](https://github.com/capricorn86/happy-dom); jsdom works the
same way, and so does a real browser if your runner gives you one.

```sh
npm i -D vitest happy-dom @markout-lang/core
```

`@markout-lang/core` rather than the CLI: testing needs the compiler and the
renderer and nothing that listens on a port.

## The recipe

```ts
import { Window } from 'happy-dom';
import { Compiler, renderPage, hydrate } from '@markout-lang/core';

async function mount(pathname: string) {
  // 1. compile, against your own docroot, the way the server would
  const page = await new Compiler({ docroot: 'src/pages' }).compile(pathname);
  if (page.hasErrors) {
    throw new Error(page.errors.map(e => e.msg).join('\n'));
  }

  // 2. server-render it: values get their initial results, and the markup
  //    that comes out is the markup a browser would have been served
  const failed = await renderPage(page);
  if (failed.length) throw new Error(failed.map(e => e.message).join('\n'));

  // 3. mount it against a real DOM, which is what a browser does next
  const window = new Window();
  window.document.write(page.source.doc.toString());
  const { root, errors } = hydrate(page, { doc: window.document as any });

  return { root, errors, doc: window.document };
}
```

`hydrate` reproduces what the browser's runtime does on load, including the
part that is easy to miss: the `:server-` results the render produced are
carried into the page in a `<script>`, and neither happy-dom nor jsdom
executes what `document.write` puts in them. It reads them from the compiled
page instead, so a value fetched on the server arrives as its **result**
rather than being recomputed against a `fetch` and a host handle that are not
there. Without that, a page that works in a browser would report failures in
a test.

It takes `origin` for the same reason: `$origin` is `location.origin` in a
browser, and a test document's location belongs to the runner rather than to
the page. Pass the origin the page will be served from if anything reads it.

Each step answers a different question, and it is worth knowing which one a
failure came from:

| Step | Fails when | What you get |
| --- | --- | --- |
| `compile` | the page is not valid Markout | `page.errors`, each with a file and a line |
| `renderPage` | an expression throws while rendering | the `RuntimeError[]` it returns |
| `hydrate` | an expression throws while mounting, or later | the `errors` array, which keeps filling |

Stopping at step 1 is a real test on its own — "this page compiles clean" is
what a CI check over a docroot is — and stopping at step 2 tests the markup
you serve. Step 3 is what you need to press a button.

## Asserting on what a component rendered

Give it parameters, use it as a tag, and read the DOM:

```ts
it('marks a warning badge', async () => {
  const { doc } = await mount('/tests/badge.html');

  const badge = doc.querySelector('span.badge')!;
  expect(badge.textContent).toBe('new');
  expect(badge.classList.contains('badge-warn')).toBe(true);
});
```

where `tests/badge.html` in your docroot is an ordinary page:

```html
<html>
  <head><:import src="/lib/badge.htm" /></head>
  <body><my-badge ::label=${'new'} ::tone=${'warn'} /></body>
</html>
```

**Through the tag, rather than into the definition.** A `<:define>` has no
existence apart from a usage site — an instance takes a copy of its body and
resolves it against the scope the usage site is in — so a test that reached
inside one would be testing something the page never runs. The page above is
the component's public surface, and it is the thing worth pinning.

## Driving it

`hydrate` hands back `root`, the page's values by name. Nested scopes are
properties on it, so `<body>`'s values are under `body` and a scope with
`:aka="cart"` is under that name:

```ts
const { root, doc } = await mount('/tests/counter.html');

expect(doc.querySelector('i')!.textContent).toBe('0');
root.body.count = 7;
expect(doc.querySelector('i')!.textContent).toBe('7');
```

No `await`, no flush, no `nextTick`. A write propagates synchronously through
everything reading it and every binding those feed, so the assertion after
the write is about a settled page. That is the same guarantee a browser gets;
there is no queue being drained on a timer for a test to have to wait on.

Events need the real DOM, and are why step 3 exists at all:

```ts
doc.querySelector('button')!.click();
expect(doc.querySelector('i')!.textContent).toBe('1');
```

The compiler's own document is a server DOM whose `addEventListener` is a
no-op — correct there, since nothing on a server clicks anything — so a
handler mounted against it can be bound and never shown to do anything.

## Assert that nothing failed

```ts
expect(errors).toStrictEqual([]);
```

At the **end** of the test, not after the mount. The array is the one the
runtime reports into rather than a copy taken at mount time, so a handler
that throws on the third click lands in it too.

This matters more here than the habit usually does. A failing expression does
not stop a page: it yields `undefined` and the binding reading it renders
empty, which in a test looks exactly like a component that legitimately
rendered nothing. Asserting the array is empty is what tells those apart —
and it is the same array the dev server logs and the dev-mode overlay paints,
so what a test sees is what you would have seen in the browser.

## Data, and the seams worth faking

A page that fetches its own data is a page whose test has a network call in
it. Two places to cut it, and which one depends on what you are testing.

**`fetch`.** A `:server-` value or a `std-data` component asks for a URL, so a
stubbed `globalThis.fetch` is the whole of it — there is no datasource
registry to register a fake with, because a datasource is a component and a
URL. This tests the page including its wiring.

**A supplied global.** A handle the host passes in by name — a database, a
session — is faked at `renderPage(page, { globals: { … } })`, and **not** at
`hydrate`, which takes no such option. That is not an omission: a supplied
name may only be read from a `:server-` value, so the server is the only
place it is ever read, and by mount time its result has already been carried
over. The browser supplies none either, so a `globals` at hydration would let
a test drive a page in a way no browser can — and pass.

Neither is a Markout mechanism. A page's model is whatever values it declares
plus whatever a source fetched, so faking either means faking an ordinary
thing.

## What this cannot tell you

The DOM you mount against is not a browser. happy-dom and jsdom implement
enough for structure, classes, attributes, text and events, and they do not
implement layout, painting, or most of what a CSS-driven component looks like
when a person sees it. `:class-is-invalid` going on is testable here;
whether the invalid state is *visible* is not.

Nor is it the compiled page's own JavaScript: `hydrate` runs the same
generated expressions the browser would, but through this process's module
instances rather than through the served runtime bundle. The bundle is what
[the extension's suite](../design/editor-support.md) and this repository's
hydration tests cover; for a page of your own, a browser-driven test is the
only thing that covers the served artifact end to end.
