# The Bench — a shop, as a fixture

A catalog, a cart and a purchase that goes through, written in Markout and
served by `@markout-lang/express`. It is not a site and is not published:
it exists to be driven by
[`test/server/shop.test.ts`](../../server/shop.test.ts) — catalog, filter,
product, 404, cart across requests, checkout, order, and one visitor not
seeing another's cart.

It stays whole rather than being cut down to per-assertion snippets because
half of what is under test is the *arrangement*: application routes first,
markout next, static files last, with one object holding the rules.

## How it is put together

**One object holds the shop's rules.** [`shop.ts`](shop.ts) answers a page's
question with a view it can render, and answers a write with what happened.
Everything else is a way in to it:

| | |
| --- | --- |
| a page | calls it directly while rendering — `:server-view=${shop.catalogPage($url)}` |
| [`api.ts`](api.ts) | turns a call into a status: `/api/products`, `/api/cart`, `/api/orders` |
| the form routes in [`server.ts`](server.ts) | turn a call into a redirect, so the shop works with scripting off |

None of the three holds a rule the others lack, which is what stops a
browser without scripting and a client with an HTTP library from being two
shops that agree for now. A test asserts exactly that: a cart line written
over REST shows up in a page rendered for the same visitor, and back again.

The pages do **not** go through REST. A page rendering on the server calls
the object directly; asking itself over HTTP would buy a loopback request
and a round of JSON for an answer it already holds.

**A page declares one value: the view it is about to render.** Everything in
it is display-ready — prices formatted, links built, the 404 already decided
— so a template contains the structure of the document and nothing else.

## What each page is evidence for

| | |
| --- | --- |
| `index.html` | `requestGlobals` — one injected name, this visitor's shop, and the rows are in the markup rather than fetched into it |
| `product.html` | `:server-status` — `?id=nope` is a real 404, said by the page that knows; `:server-if` keeps the not-found markup out of the pages that found something |
| `cart.html` | server-rendered from what this request knows, and `<:group :for-each>` over a pair of `<tr>`s, which no wrapper element could hold |
| `checkout.html` | `:server-redirect` — an empty cart has no checkout, so the page says where to go instead |
| `thanks.html` | the same shape as the product page, for an order |
| `product.html` tabs | the one part the browser switches: `$url.hash` over a plain `:if`, so the branches the server did not show still travel and switching asks nothing of the server. The [level 2](../../../../../docs/concepts/navigation.md#level-2--one-page-routed-by-its-query) idea inside a level 1 site |
| `parts/shell.htm` | an `<:include>` in `<head>`, so its root attributes become design tokens on the head scope, where the stylesheet reads them |

**No database.** [`catalog.ts`](catalog.ts) is a dozen products in memory,
and [`cart.ts`](cart.ts) is a Map keyed by a cookie. What is under test is
the seam between a page and the application it belongs to.

## What building it found

The reason it is worth keeping. None of these were visible from the design
side:

- **`<:group :server-if>` was refused.** A group's attributes are classified
  before anything else sees them, and the marked spelling of a branch was
  not on the list — so the shape the docs recommend for an error page did not
  compile. The docs' own example used a `<div>`, which is why nobody noticed.
- **A previous request's rows stayed in the page.** A page is compiled once
  and its document rendered into again and again, and the two renders never
  meet — so a `:for-each` shorter than last time left the difference
  standing. Filtering the catalog to books, after anyone had loaded the full
  listing, showed ten items with two of them right. Here it is a wrong
  count; keyed to a person it is one visitor's rows in another's page.
  Fixed in `render.ts` (`dropStaleReplicas`), with the general case pinned
  in [`rerender.test.ts`](../../../../core/test/render/rerender.test.ts).
- **`hydrate()` did not follow the address.** Only the browser's own boot
  path attached the listeners, so a page mounted any other way answered
  with the address it was handed, forever — the product tabs switched on a
  deep link and not on a click. `followAddress()` is now one method both
  paths call.
- **A page cannot declare a value named after a server global.** A name
  supplied to the render is refused as a page value rather than quietly
  reading itself. Correct, and unguessable until you meet it.
- **The editor cannot see an injected global.** The name reaches the
  compiler as `serverGlobals`, which the express middleware fills in from
  the `globals` it was given — and the VS Code extension has no way to be
  told. So every page here reports `Unknown reference: "shop"` in the
  editor while compiling clean on the server. The injection is not only
  implicit to a reader; it is invisible to the toolchain.
- **happy-dom drops a `<tr>` inside a `<template>`.** Not a markout bug, but
  it shapes what the suite can check: a `:for-each` over table rows in a
  region that was hidden at render time cannot be exercised under happy-dom,
  because the stencil arrives empty. Chromium keeps it. The spec sheet is a
  `<dl>`, which is what a list of name/value pairs should have been anyway.
