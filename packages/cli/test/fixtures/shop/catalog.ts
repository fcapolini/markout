/**
 * The shop's data: a dozen products and the orders placed against them.
 *
 * In memory, and deliberately. What this example is testing is the seam
 * between a page and the application it belongs to -- what a page may read,
 * what it may decide, and what has to be an ordinary Express route -- and a
 * real database would answer none of those questions differently while
 * making the example about itself.
 *
 * Built once and handed to every render through `globals`, which is what an
 * application-wide handle is: see `requestGlobals` in server.ts for the half
 * that is per visitor.
 */

export interface Product {
  id: string;
  name: string;
  blurb: string;
  /** in cents, because money in floats is a bug waiting for a rounding */
  price: number;
  stock: number;
  tag: 'tool' | 'material' | 'book';
}

export interface OrderLine {
  product: Product;
  quantity: number;
  total: number;
}

export interface Order {
  id: string;
  placedBy: string;
  lines: OrderLine[];
  total: number;
}

const PRODUCTS: Product[] = [
  { id: 'plane', name: 'Block plane', blurb: 'Low angle, for end grain.', price: 8900, stock: 4, tag: 'tool' },
  { id: 'chisel', name: 'Bench chisel', blurb: 'Bevel edge, 12mm.', price: 3400, stock: 11, tag: 'tool' },
  { id: 'saw', name: 'Dovetail saw', blurb: 'Rip filed, 15 tpi.', price: 12500, stock: 2, tag: 'tool' },
  { id: 'mallet', name: 'Joiner’s mallet', blurb: 'Beech, wedged head.', price: 2600, stock: 0, tag: 'tool' },
  { id: 'oak', name: 'White oak, 1m', blurb: 'Quartersawn, kiln dried.', price: 4200, stock: 30, tag: 'material' },
  { id: 'walnut', name: 'Walnut, 1m', blurb: 'Flat sawn, air dried.', price: 6800, stock: 12, tag: 'material' },
  { id: 'glue', name: 'Hide glue', blurb: '192 gram strength.', price: 1500, stock: 40, tag: 'material' },
  { id: 'oil', name: 'Danish oil', blurb: '500ml, satin.', price: 1900, stock: 25, tag: 'material' },
  { id: 'joinery', name: 'The Joinery Book', blurb: 'Everything cut by hand.', price: 3200, stock: 7, tag: 'book' },
  { id: 'sharpening', name: 'Sharpening', blurb: 'Stones, angles, burrs.', price: 2800, stock: 9, tag: 'book' },
];

/** what a page is handed as `shop`: read-only, and answers questions */
export class Catalog {
  private readonly orders = new Map<string, Order>();
  private nextOrder = 1000;

  list(tag?: string): Product[] {
    return tag ? PRODUCTS.filter(p => p.tag === tag) : [...PRODUCTS];
  }

  /** the tags in the catalog, for the filter bar */
  tags(): string[] {
    return [...new Set(PRODUCTS.map(p => p.tag))].sort();
  }

  /**
   * A product, or nothing.
   *
   * Nothing is a normal answer rather than a failure: `/product?id=nope` is a
   * request for a page that does not exist, and the page says so with a
   * `:server-status` of 404. See product.html.
   */
  find(id: string | null | undefined): Product | undefined {
    return PRODUCTS.find(p => p.id === id);
  }

  place(placedBy: string, lines: OrderLine[]): Order {
    const order: Order = {
      id: `A${this.nextOrder++}`,
      placedBy,
      lines,
      total: lines.reduce((sum, l) => sum + l.total, 0),
    };
    this.orders.set(order.id, order);
    return order;
  }

  order(id: string | null | undefined): Order | undefined {
    return id ? this.orders.get(id) : undefined;
  }
}

/** cents as money, in one place so every page says it the same way */
export function money(cents: number): string {
  return `£${(cents / 100).toFixed(2)}`;
}
