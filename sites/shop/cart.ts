/**
 * A cart per visitor, kept in memory and found by a cookie.
 *
 * This is the half of an application a page cannot be given once: a database
 * handle is the same object for everybody, and a cart is not. It reaches the
 * pages through `requestGlobals`, which builds it per render -- so a cart
 * page renders its lines on the server, in the markup, rather than shipping
 * a shell that fetches them back.
 *
 * The cookie is the whole session mechanism, because a session is not what
 * this example is about. Anything real would sign it.
 */
import type { Request, Response } from 'express';
import { Catalog, type OrderLine } from './catalog';

const COOKIE = 'shopper';

/** one visitor's cart: product id -> quantity */
type Lines = Map<string, number>;

export class Carts {
  private readonly byVisitor = new Map<string, Lines>();

  /** the id in the cookie, minting one when there is none */
  visitor(req: Request, res?: Response): string {
    const already = `${req.headers.cookie ?? ''}`
      .split(';')
      .map(c => c.trim().split('='))
      .find(([name]) => name === COOKIE)?.[1];
    if (already) return already;
    const fresh = `v${Math.random().toString(36).slice(2, 10)}`;
    // only where there is a response to write it on: a render has none, and
    // a visitor with no cookie yet simply has an empty cart to look at
    res?.cookie?.(COOKIE, fresh, { httpOnly: true, sameSite: 'lax' });
    return fresh;
  }

  private lines(visitor: string): Lines {
    let lines = this.byVisitor.get(visitor);
    lines || this.byVisitor.set(visitor, (lines = new Map()));
    return lines;
  }

  add(visitor: string, id: string, quantity = 1): void {
    const lines = this.lines(visitor);
    lines.set(id, Math.max(0, (lines.get(id) ?? 0) + quantity));
    lines.get(id) === 0 && lines.delete(id);
  }

  remove(visitor: string, id: string): void {
    this.lines(visitor).delete(id);
  }

  empty(visitor: string): void {
    this.byVisitor.delete(visitor);
  }

  /**
   * What a page reads: the cart as lines a template can walk, priced.
   *
   * A plain object rather than this class, because what a page needs is an
   * answer and not an API -- and because everything here crosses into the
   * markup as a `:server-` value, where a method would be no use anyway.
   */
  view(visitor: string, shop: Catalog): CartView {
    const lines: OrderLine[] = [];
    for (const [id, quantity] of this.lines(visitor)) {
      const product = shop.find(id);
      product && lines.push({ product, quantity, total: product.price * quantity });
    }
    return {
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      total: lines.reduce((sum, l) => sum + l.total, 0),
    };
  }
}

export interface CartView {
  lines: OrderLine[];
  /** how many items, for the header */
  count: number;
  total: number;
}
