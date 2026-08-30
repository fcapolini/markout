/**
 * A shop: a catalog, a cart, and a purchase that goes through.
 *
 * The worked example of the arrangement `@markout-lang/express` is for, with
 * an application shaped like an application rather than like a demo. Its
 * routes come FIRST, markout answers what is left, and static files last --
 * an order that is a requirement rather than a preference, since a path with
 * no extension is a page request and markout will answer it.
 *
 *     npm run dev -w @markout-lang/shop
 *
 * What it is here to prove, page by page:
 *
 * - **`globals`** hands every render the catalog, built once. A page reads it
 *   in a `:server-` value and the rows are in the markup, not fetched into it.
 * - **`requestGlobals`** hands every render THIS visitor's cart, built per
 *   request. That is the half an application-wide handle cannot be, and it is
 *   why the cart page server-renders instead of shipping a shell.
 * - **`:server-status`** makes `/product?id=nope` a real 404, and
 *   **`:server-redirect`** sends an empty checkout back to the catalog.
 * - **`:server-if`** keeps the not-found markup out of the pages that found
 *   something.
 * - **Every write is an ordinary POST** to a route below, which redirects
 *   back. There is no client-side state, no fetch, and no JSON API: the whole
 *   workflow works with scripting off, which is the position this project
 *   takes rather than a feature it is missing.
 */
import express, { type Express } from 'express';
import { markout } from '@markout-lang/express';
import { Carts } from './cart';
import { Catalog } from './catalog';

export interface ShopProps {
  docroot: string;
  dev?: boolean;
}

/**
 * Where a write sends the browser next.
 *
 * The page puts its own address in a hidden field so that adding to the cart
 * from the books shelf leaves you on the books shelf. That field arrives in a
 * POST body, though, which means it arrives from whoever posted -- so it is
 * taken only when it is a path on this site. Anything else, a `//host` or a
 * `https://` among them, is somebody else's page wearing our redirect, and
 * gets the fallback instead.
 */
function backTo(value: unknown, fallback: string): string {
  const to = `${value ?? ''}`;
  return to.startsWith('/') && !to.startsWith('//') ? to : fallback;
}

export function createShop(props: ShopProps): Express {
  const app = express();
  const shop = new Catalog();
  const carts = new Carts();
  app.use(express.urlencoded({ extended: false }));

  // --------------------------------------------------------------- the writes
  //
  // First, because they are the application's own and because a POST is not a
  // page. Each answers with a redirect rather than markup: the browser then
  // GETs the page it was going to get anyway, which is what keeps a reload
  // from placing a second order.
  app.post('/cart/add', (req, res) => {
    const visitor = carts.visitor(req, res);
    const id = `${req.body.id ?? ''}`;
    shop.find(id) && carts.add(visitor, id, Number(req.body.quantity) || 1);
    res.redirect(303, backTo(req.body.back, '/cart.html'));
  });

  app.post('/cart/remove', (req, res) => {
    carts.remove(carts.visitor(req, res), `${req.body.id ?? ''}`);
    res.redirect(303, '/cart.html');
  });

  app.post('/checkout', (req, res) => {
    const visitor = carts.visitor(req, res);
    const cart = carts.view(visitor, shop);
    const name = `${req.body.name ?? ''}`.trim();
    // the page's own form asks for both; a request that arrives without them
    // is not a visitor who made a mistake, it is one who skipped the page
    if (!cart.lines.length || !name) {
      return res.redirect(303, '/checkout.html');
    }
    const order = shop.place(name, cart.lines);
    carts.empty(visitor);
    res.redirect(303, `/thanks.html?order=${encodeURIComponent(order.id)}`);
  });

  // --------------------------------------------------------------- the pages
  //
  // `globals` is what every page may reach; `requestGlobals` is what THIS
  // request adds. Both are readable only from a `:server-` value, and the
  // compiler is told their names so that reading one anywhere else is a
  // build error rather than a page that is empty in production.
  app.use(
    markout({
      docroot: props.docroot,
      dev: props.dev,
      globals: { shop },
      requestGlobals: {
        cart: req => carts.view(carts.visitor(req), shop),
      },
    })
  );

  // -------------------------------------------------------------- the assets
  app.use(express.static(props.docroot, { index: false }));
  return app;
}

if (process.argv[1]?.endsWith('server.ts')) {
  const port = Number(process.env.PORT) || 3001;
  const server = createShop({ docroot: import.meta.dirname, dev: true }).listen(
    port,
    () => {
      console.log(`the bench     http://127.0.0.1:${port}/`);
      console.log(`a product     http://127.0.0.1:${port}/product.html?id=saw`);
      console.log(`the cart      http://127.0.0.1:${port}/cart.html`);
    }
  );

  // Ctrl-C is a SIGINT, and node's own answer to it is to die at once with
  // 130 -- mid-response for whoever was mid-request, and a failed script as
  // far as npm is concerned, which prints a page of error for an ordinary
  // stop. Closing the server refuses new connections and lets the answers
  // in flight finish, then exits 0.
  //
  // The idle keep-alive connections have to be closed by hand: they hold
  // nothing, but `close` waits for them, so without this the process sits
  // there until the last browser loses interest. The timer is the backstop
  // for a request that never ends, unref'd so it is not itself a reason to
  // stay up. The same block sites/site/server.ts carries, for the same
  // reasons.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
      server.closeIdleConnections();
      setTimeout(() => process.exit(0), 10_000).unref();
    });
  }
}
