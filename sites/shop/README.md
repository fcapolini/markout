# The Bench — a shop, as evidence

A catalog, a cart and a purchase that goes through, written in Markout and
served by `@markout-lang/express`.

```sh
npm run dev -w @markout-lang/shop     # http://localhost:3001
```

It exists because every design note in this repository ends the same way:
*nothing real has been built on this yet.* This is the something. It is
driven end to end by
[`packages/cli/test/server/shop.test.ts`](../../packages/cli/test/server/shop.test.ts)
— catalog, filter, product, 404, cart across requests, checkout, order,
and one visitor not seeing another's cart.

## What each page is evidence for

| | |
| --- | --- |
| `index.html` | `globals` — the catalog is handed to every render, and the rows are in the markup rather than fetched into it |
| `product.html` | `:server-status` — `?id=nope` is a real 404, said by the page that knows; `:server-if` keeps the not-found markup out of the pages that found something |
| `cart.html` | `requestGlobals` — this visitor's cart, built per render, server-rendered; and `<:group :for-each>` over a pair of `<tr>`s, which no wrapper element could hold |
| `checkout.html` | `:server-redirect` — an empty cart has no checkout, so the page says where to go instead |
| `thanks.html` | the same shape as the product page, for an order |
| `parts/values.htm` | an `<:include>` directly in `<html>`, so its root attributes become values on the **page** scope and every part of the page reads them |
| `parts/shell.htm` | the same in `<head>`, where design tokens belong |

## What it deliberately does not do

**No client-side state, no fetch, no JSON API.** Every write is an ordinary
`POST` to a route in [`server.ts`](server.ts), answered with a redirect. The
whole workflow works with scripting off — which is the position this project
takes rather than a feature it is missing.

**No router.** Products are `?id=…` rather than `/product/plane`, because
routing over a path is
[level 3](../../docs/concepts/navigation.md#level-3--a-router-kit) and is not
built. A shop is exactly the application that would want it, so this is the
honest shape of what markout does today rather than a demonstration that the
gap does not matter.

**No database.** [`catalog.ts`](catalog.ts) is a dozen products in memory,
and [`cart.ts`](cart.ts) is a Map keyed by a cookie. What is under test is
the seam between a page and the application it belongs to; a real store would
answer none of those questions differently.

## What building it found

Two things, both in code written the same week and neither visible from the
design side:

- **`<:group :server-if>` was refused.** A group's attributes are classified
  before anything else sees them, and the marked spelling of a branch was
  not on the list — so the shape the docs recommend for an error page did not
  compile. The docs' own example used a `<div>`, which is why nobody noticed.
- **A page cannot declare a value named after a server global.** `cart` is
  supplied to the render, so `:server-cart=${cart}` is refused rather than
  quietly reading itself. Correct, unguessable, and the reason the pages say
  `basket`.
