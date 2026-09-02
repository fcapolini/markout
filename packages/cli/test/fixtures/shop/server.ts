/**
 * A shop: a catalog, a cart, and a purchase that goes through.
 *
 * The fixture `test/server/shop.test.ts` drives, and an application shaped
 * like an application rather than like a demo: it is here because a suite of
 * unit-sized pages cannot show the arrangement `@markout-lang/express` is
 * for. Its routes come FIRST, markout answers what is left, and static files
 * last -- an order that is a requirement rather than a preference, since a
 * path with no extension is a page request and markout will answer it.
 *
 * **One object holds the shop's rules**, and everything here is a way in to
 * it. `Shop` (shop.ts) answers a page's questions with a view it can render
 * and answers a write with what happened; the form routes below turn that
 * into a redirect, the REST routes in api.ts turn it into a status, and a
 * page calls it directly. None of the three holds a rule the others lack,
 * which is what stops a browser without scripting and a client with an HTTP
 * library from being two shops that agree for now.
 *
 * What this is here to prove, page by page:
 *
 * - **`requestGlobals`** hands every render THIS visitor's shop, built per
 *   request. That is the half an application-wide handle cannot be, and it
 *   is why the cart page server-renders instead of shipping a shell.
 * - **`:server-status`** makes `/product?id=nope` a real 404, and
 *   **`:server-redirect`** sends an empty checkout back to the catalog.
 * - **`:server-if`** keeps the not-found markup out of the pages that found
 *   something.
 * - **Every write is an ordinary POST** to a route below, which redirects
 *   back. The pages need no scripting at all: the whole workflow works with
 *   it off, which is the position this project takes rather than a feature
 *   it is missing. The REST routes are for the clients that are not a page.
 */
import express, { type Express } from 'express';
import { markout } from '@markout-lang/express';
import { api } from './api';
import { Carts } from './cart';
import { Catalog } from './catalog';
import { Shop } from './shop';

export interface ShopProps {
  docroot: string;
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
 *
 * The second character is the whole question, and a backslash counts. This
 * read `!to.startsWith('//')`, which is the check everyone writes and is one
 * character short: a browser parsing `http(s):` normalizes `\` to `/` before
 * it looks for an authority, so `/\host` is `//host` by the time it matters
 * and the visitor lands off-site. So: a leading slash followed by anything
 * that is not another separator, or the site root on its own.
 */
function backTo(value: unknown, fallback: string): string {
  const to = `${value ?? ''}`;
  return to === '/' || /^\/[^/\\]/.test(to) ? to : fallback;
}

export function createShop(props: ShopProps): Express {
  const app = express();
  const catalog = new Catalog();
  const carts = new Carts();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // ----------------------------------------------------------------- REST
  //
  // Mounted under its own prefix, and a thin adapter over the same object
  // the pages use. See api.ts for why the pages do not go through it.
  app.use('/api', api(catalog, carts));

  // ------------------------------------------------------- the form writes
  //
  // What a browser can do with no scripting: a POST and a redirect. They
  // answer with a 303 rather than markup so that a reload does not place a
  // second order, and each is three lines because the shop is elsewhere.
  app.post('/cart/add', (req, res) => {
    const shop = Shop.forRequest(catalog, carts, req, res);
    shop.add(`${req.body.id ?? ''}`, Number(req.body.quantity) || 1);
    res.redirect(303, backTo(req.body.back, '/cart.html'));
  });

  app.post('/cart/remove', (req, res) => {
    Shop.forRequest(catalog, carts, req, res).remove(`${req.body.id ?? ''}`);
    res.redirect(303, '/cart.html');
  });

  app.post('/checkout', (req, res) => {
    const order = Shop.forRequest(catalog, carts, req, res).place(`${req.body.name ?? ''}`);
    res.redirect(
      303,
      order ? `/thanks.html?order=${encodeURIComponent(order.id)}` : '/checkout.html'
    );
  });

  // --------------------------------------------------------------- the pages
  //
  // One name, and it is this visitor's shop. A page reads it in a `:server-`
  // value -- the compiler is told the name, so reading it anywhere else is a
  // build error rather than a page that is empty in production -- and asks it
  // for the view it is about to render.
  app.use(
    markout({
      docroot: props.docroot,
      requestGlobals: {
        shop: req => Shop.forRequest(catalog, carts, req),
      },
    })
  );

  // -------------------------------------------------------------- the assets
  app.use(express.static(props.docroot, { index: false }));
  return app;
}
