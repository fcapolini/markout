/**
 * The shop over HTTP, for a client that is not a browser rendering a page.
 *
 * A thin adapter and nothing else: every route below turns a request into a
 * call on `Shop` and that call's answer into a status. No route decides
 * anything -- what a missing product means, when an order may be placed,
 * what a basket costs -- because all of that is in shop.ts, and a rule that
 * lived here would be a rule the pages did not have.
 *
 * Which is the whole reason to have it. The pages do NOT go through these
 * routes: a page rendering on the server calls the same object directly, and
 * asking itself over HTTP would buy a loopback request and a round of JSON
 * for an answer it already holds. What REST is for is the clients that are
 * not this server -- a script, a till, a phone -- and they get the same shop
 * rather than a second one that agrees with it for now.
 */
import { Router, type Request, type Response } from 'express';
import type { Carts } from './cart';
import type { Catalog } from './catalog';
import { Shop } from './shop';

export function api(catalog: Catalog, carts: Carts): Router {
  const router = Router();
  // a cart belongs to a visitor, and a visitor is a cookie -- the same one
  // the pages use, so a client that keeps cookies keeps its cart
  const shop = (req: Request, res: Response): Shop =>
    Shop.forRequest(catalog, carts, req, res);

  router.get('/products', (req, res) => {
    res.json(shop(req, res).products(typeof req.query.tag === 'string' ? req.query.tag : null));
  });

  router.get('/products/:id', (req, res) => {
    const product = shop(req, res).product(req.params.id);
    product ? res.json(product) : res.status(404).json({ error: 'no such product' });
  });

  router.get('/cart', (req, res) => {
    res.json(shop(req, res).cartPage());
  });

  router.post('/cart', (req, res) => {
    const it = shop(req, res);
    it.add(`${req.body?.id ?? ''}`, Number(req.body?.quantity) || 1)
      ? res.status(201).json(it.cartPage())
      : res.status(404).json({ error: 'no such product' });
  });

  router.delete('/cart/:id', (req, res) => {
    const it = shop(req, res);
    it.remove(req.params.id);
    res.json(it.cartPage());
  });

  router.post('/orders', (req, res) => {
    const order = shop(req, res).place(`${req.body?.name ?? ''}`);
    // the same refusal the form route makes, for the same reason: an empty
    // cart or a missing name is a request that skipped the page
    order
      ? res.status(201).json(order)
      : res.status(422).json({ error: 'an order needs a name and something in the cart' });
  });

  return router;
}
