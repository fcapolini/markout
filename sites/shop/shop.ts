/**
 * The shop's logic, as one object a page can talk to.
 *
 * A page used to assemble its own view out of four `:server-` values on the
 * root tag -- one reaching into the catalog, one reading the cart, one
 * working out the filter, one deciding the status -- which put the shop's
 * rules in its markup and spread them over five files. Here they are in one
 * place, and a page declares a single value: the view it is about to render.
 *
 * Everything below is display-ready. A page should not be doing arithmetic
 * or formatting money, and once it isn't, what a template contains is the
 * structure of the document and nothing else: `:if`, `:for-each`, and names.
 *
 * One instance per request, bound to one visitor, because that is the shape
 * of every question asked of it -- "the catalog, for this visitor, whose
 * basket is in the header" is one answer and not two. The application-wide
 * halves it is built from, `Catalog` and `Carts`, live for the process.
 *
 * The same object backs the REST routes in api.ts and the form routes in
 * server.ts. Neither of those holds any rule of its own: they are two ways
 * in to this, which is what keeps a browser without scripting and a client
 * with an HTTP library from being two implementations of one shop.
 */
import type { Request, Response } from 'express';
import { Carts } from './cart';
import { Catalog, money, type Order, type Product } from './catalog';

/** the header's cart, on every page */
export interface Basket {
  count: number;
  total: string;
}

/** one product as the catalog grid shows it */
export interface Card {
  id: string;
  name: string;
  blurb: string;
  price: string;
  href: string;
  inStock: boolean;
}

/** one link in the filter bar */
export interface Filter {
  label: string;
  href: string;
  active: boolean;
}

export interface CatalogView {
  title: string;
  heading: string;
  filters: Filter[];
  products: Card[];
  basket: Basket;
  /** where a write from this page sends the browser back to */
  back: string;
}

export interface Detail extends Card {
  stock: number;
  tag: string;
  /** the specifications table, as rows, so the page only lays them out */
  specs: { label: string; value: string }[];
}

export interface ProductView {
  title: string;
  product?: Detail;
  /** 404 for a product that is not one of ours, which the page declares */
  status: number;
  basket: Basket;
  back: string;
}

export interface CartLine extends Card {
  quantity: number;
  total: string;
}

export interface CartPageView {
  title: string;
  lines: CartLine[];
  total: string;
  basket: Basket;
}

export interface CheckoutView {
  title: string;
  basket: Basket;
  /** a checkout with an empty cart is a form that cannot be submitted */
  redirect: string | null;
}

export interface OrderView {
  title: string;
  order?: { id: string; placedBy: string; lines: CartLine[]; total: string };
  status: number;
  basket: Basket;
}

/** what the tags are called in a sentence, since 'material' is not a label */
const LABELS: Record<string, string> = {
  tool: 'Tools',
  material: 'Materials',
  book: 'Books',
};

/**
 * The shop, for one visitor, for one request.
 *
 * Built by `Shop.forRequest`, which is what server.ts hands to `markout` as
 * the page's single injected name and what both routers build for themselves.
 */
export class Shop {
  constructor(
    private readonly catalog: Catalog,
    private readonly carts: Carts,
    /** the cookie id this request arrived with, or was just given */
    readonly visitor: string
  ) {}

  /**
   * One per request.
   *
   * `res` is passed where there is one to write a cookie on: a render has
   * none, and a visitor without one simply has an empty basket to look at.
   */
  static forRequest(catalog: Catalog, carts: Carts, req: Request, res?: Response): Shop {
    return new Shop(catalog, carts, carts.visitor(req, res));
  }

  // ------------------------------------------------------------ the pages

  /**
   * The readings the pages are made of, and what the REST adapter answers
   * with. Kept separate from the page views because a client asking for
   * products wants products, not a page title and a filter bar.
   */
  products(tag?: string | null): Card[] {
    return this.catalog.list(tag ?? undefined).map(p => card(p));
  }

  product(id: string | null | undefined): Detail | undefined {
    const p = this.catalog.find(id);
    return (
      p && {
        ...card(p),
        stock: p.stock,
        tag: p.tag,
        specs: [
          { label: 'Catalogue number', value: p.id },
          { label: 'Category', value: p.tag },
          { label: 'In stock', value: `${p.stock}` },
        ],
      }
    );
  }

  cart(): CartLine[] {
    return this.carts.view(this.visitor, this.catalog).lines.map(l => ({
      ...card(l.product),
      quantity: l.quantity,
      total: money(l.total),
    }));
  }

  catalogPage(url?: URL): CatalogView {
    const tag = url?.searchParams.get('tag') ?? null;
    const named = tag ? LABELS[tag] : undefined;
    return {
      title: `${named ?? 'Everything'} — The Bench`,
      heading: named ?? 'Everything we sell',
      filters: [
        { label: 'All', href: '/', active: !tag },
        ...this.catalog.tags().map(t => ({
          label: LABELS[t] ?? t,
          href: `/?tag=${t}`,
          active: tag === t,
        })),
      ],
      products: this.products(tag),
      basket: this.basket(),
      // back to this shelf, filter and all, rather than to the bare catalog
      back: `${url?.pathname ?? '/'}${url?.search ?? ''}`,
    };
  }

  productPage(url?: URL): ProductView {
    const product = this.product(url?.searchParams.get('id'));
    return {
      title: `${product ? product.name : 'Not found'} — The Bench`,
      product,
      status: product ? 200 : 404,
      basket: this.basket(),
      back: '/cart.html',
    };
  }

  cartPage(): CartPageView {
    const view = this.carts.view(this.visitor, this.catalog);
    return {
      title: 'Your cart — The Bench',
      lines: this.cart(),
      total: money(view.total),
      basket: this.basket(),
    };
  }

  checkoutPage(): CheckoutView {
    const basket = this.basket();
    return {
      title: 'Checkout — The Bench',
      basket,
      redirect: basket.count === 0 ? '/cart.html' : null,
    };
  }

  orderPage(url?: URL): OrderView {
    const order = this.catalog.order(url?.searchParams.get('order'));
    return {
      title: order ? `Order ${order.id} — The Bench` : 'No such order — The Bench',
      order: order && {
        id: order.id,
        placedBy: order.placedBy,
        lines: order.lines.map(l => ({
          ...card(l.product),
          quantity: l.quantity,
          total: money(l.total),
        })),
        total: money(order.total),
      },
      status: order ? 200 : 404,
      basket: this.basket(),
    };
  }

  // ----------------------------------------------------------- the writes
  //
  // Each says what happened rather than how to answer: a form route turns
  // that into a redirect and the REST adapter turns it into a status, and
  // neither decides anything this does not already know.

  /** false when there is no such product, which is a 404 and not a no-op */
  add(id: string, quantity = 1): boolean {
    if (!this.catalog.find(id)) return false;
    this.carts.add(this.visitor, id, quantity);
    return true;
  }

  remove(id: string): void {
    this.carts.remove(this.visitor, id);
  }

  /**
   * The order, or nothing when this request had no business placing one.
   *
   * An empty cart or a missing name is not a visitor who made a mistake --
   * the form asks for both -- it is one who skipped the page, and the answer
   * is the same whichever door they came in by.
   */
  place(name: string): Order | undefined {
    const cart = this.carts.view(this.visitor, this.catalog);
    if (!cart.lines.length || !name.trim()) return undefined;
    const order = this.catalog.place(name.trim(), cart.lines);
    this.carts.empty(this.visitor);
    return order;
  }

  // ------------------------------------------------------------ the parts

  basket(): Basket {
    const view = this.carts.view(this.visitor, this.catalog);
    return { count: view.count, total: money(view.total) };
  }
}

function card(p: Product): Card {
  return {
    id: p.id,
    name: p.name,
    blurb: p.blurb,
    price: money(p.price),
    href: `/product.html?id=${p.id}`,
    inStock: p.stock > 0,
  };
}
