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

/** how long a cart outlives the last thing done to it */
const TTL_MS = 2 * 60 * 60 * 1000;

/** one visitor's cart: product id -> quantity */
type Lines = Map<string, number>;

interface Cart {
  lines: Lines;
  /** when it was last added to, removed from, or looked at */
  touched: number;
}

export interface CartsProps {
  /** how long an untouched cart is kept; default two hours */
  ttlMs?: number;
  /** the clock, so a test does not have to wait out a TTL */
  now?: () => number;
}

/**
 * Carts are held in memory, so something has to let them go.
 *
 * A map keyed by cookie only ever grows, and the traffic that grows it
 * fastest is the traffic least likely to buy anything: every request without
 * a cookie is a new visitor id, and a crawler carries no cookies at all. Two
 * rules keep it bounded, and both are needed.
 *
 * **Reading does not create.** A cart page renders for every visitor, cart
 * or no cart, and an empty map stored for each of them is one entry per
 * request that nothing will ever remove. So `view` reads through a shared
 * empty and only a write allocates.
 *
 * **A cart expires** a fixed time after it was last touched -- browsing
 * counts, since a visitor still looking around has not abandoned anything.
 * Swept on write rather than on a timer: the sweep costs the carts that
 * exist, a shop with no writes has nothing arriving to grow it, and a timer
 * would be one more thing to own and shut down. What a real one would do
 * instead is keep this in whatever it already keeps sessions in, and let
 * that expire them.
 */
export class Carts {
  private readonly byVisitor = new Map<string, Cart>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(props?: CartsProps) {
    this.ttlMs = props?.ttlMs ?? TTL_MS;
    this.now = props?.now ?? Date.now;
  }

  /** how many carts are being held, which is the number this is about */
  get size(): number {
    return this.byVisitor.size;
  }

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

  /** the cart to write into, made if there is none -- and the moment every
   *  expired one is dropped, since a write is the only thing that adds */
  private writable(visitor: string): Lines {
    const now = this.now();
    for (const [id, cart] of this.byVisitor) {
      now - cart.touched > this.ttlMs && this.byVisitor.delete(id);
    }
    let cart = this.byVisitor.get(visitor);
    cart || this.byVisitor.set(visitor, (cart = { lines: new Map(), touched: now }));
    cart.touched = now;
    return cart.lines;
  }

  /** the cart to read, WITHOUT making one: a visitor who has added nothing
   *  is not a cart, and a page renders for them just the same */
  private readable(visitor: string): Lines {
    const cart = this.byVisitor.get(visitor);
    if (!cart) return EMPTY;
    cart.touched = this.now();
    return cart.lines;
  }

  add(visitor: string, id: string, quantity = 1): void {
    const lines = this.writable(visitor);
    lines.set(id, Math.max(0, (lines.get(id) ?? 0) + quantity));
    lines.get(id) === 0 && lines.delete(id);
  }

  remove(visitor: string, id: string): void {
    const cart = this.byVisitor.get(visitor);
    if (!cart) return;
    cart.lines.delete(id);
    cart.touched = this.now();
    // the last line out is a cart that no longer exists, rather than an
    // empty one waiting out a TTL
    cart.lines.size || this.byVisitor.delete(visitor);
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
    for (const [id, quantity] of this.readable(visitor)) {
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

/** read through by every visitor who has no cart, and never written to */
const EMPTY: Lines = new Map();

export interface CartView {
  lines: OrderLine[];
  /** how many items, for the header */
  count: number;
  total: number;
}
