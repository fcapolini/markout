import path from 'path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { Catalog } from '../../../../sites/shop/catalog';
import { createShop } from '../../../../sites/shop/server';
import { Compiler, hydrate, renderPage } from '@markout-lang/core';

/**
 * The shop, driven the way a visitor drives one: catalog, product, cart,
 * checkout, order.
 *
 * This is the application the design notes kept saying nothing had been
 * built against. It is here to be evidence rather than a demo, so every
 * assertion is about the RESPONSE -- what the server sent, before any
 * script ran -- because that is the claim: a page's data is in its markup.
 *
 * Driven over HTTP for the reason the desk demo is: half of what is under
 * test is the arrangement itself. The writes are ordinary POSTs to the
 * application's own routes, mounted before markout, each answering with a
 * redirect; the reads are pages that server-render what this visitor's
 * request knows.
 */
function shop() {
  return createShop({ docroot: path.resolve(__dirname, '../../../../sites/shop') });
}

/** the served markup with the runtime's own comments out of the way */
function shown(html: string): string {
  return html.replace(/<!---[^>]*-->/g, '');
}

/**
 * How many product cards the page actually shows.
 *
 * The body alone, because the stencil the replicas are stamped from lives
 * in `<head>` and counting it would say one more than anyone can see.
 */
function cards(html: string): number {
  const body = /<body[\s\S]*?<script type="application\/json"/.exec(html)?.[0] ?? '';
  return (body.match(/class="card"/g) ?? []).length;
}

/** everything a response set, to carry a session from one request to the next */
function jar(res: { headers: Record<string, unknown> }): string {
  const set = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  return set.map(c => c.split(';')[0]).join('; ');
}

describe('a shop, from the catalog to the order', () => {
  it('renders the catalog in the response, with no script needed', async () => {
    const res = await request(shop()).get('/');

    expect(res.status).toBe(200);
    // the products are in the markup the server sent
    expect(shown(res.text)).toContain('Block plane');
    expect(shown(res.text)).toContain('£89.00');
    // including the one that cannot be bought, said as markup rather than
    // as a disabled button nobody can see the reason for
    expect(shown(res.text)).toContain('Out of stock');
  });

  it('filters by tag from the address alone', async () => {
    const res = await request(shop()).get('/?tag=book');

    expect(shown(res.text)).toContain('The Joinery Book');
    expect(shown(res.text)).not.toContain('Block plane');
    // and says so in the title, which is a value over the same address
    expect(res.text).toMatch(/<title>books — The Bench<\/title>/);
  });

  it('answers a product page, and a 404 that is the same page', async () => {
    const found = await request(shop()).get('/product.html?id=saw');
    expect(found.status).toBe(200);
    expect(shown(found.text)).toContain('Dovetail saw');
    expect(shown(found.text)).toContain('2 in stock');
    // the not-found branch is decided by the server, so it is not in the
    // response of a page that found its product
    expect(found.text).not.toContain('No such thing');

    const missing = await request(shop()).get('/product.html?id=nope');
    expect(missing.status).toBe(404);
    expect(shown(missing.text)).toContain('No such thing');
  });

  it('carries a cart from one request to the next, and prices it', async () => {
    const app = shop();
    const added = await request(app)
      .post('/cart/add')
      .type('form')
      .send({ id: 'saw', back: '/cart.html' });
    expect(added.status).toBe(303);
    const cookie = jar(added);

    const twice = await request(app)
      .post('/cart/add')
      .set('Cookie', cookie)
      .type('form')
      .send({ id: 'glue', quantity: '3' });
    expect(twice.status).toBe(303);

    const cart = await request(app).get('/cart.html').set('Cookie', cookie);
    expect(cart.status).toBe(200);
    const html = shown(cart.text);
    expect(html).toContain('Dovetail saw');
    expect(html).toContain('Hide glue');
    // 125.00 + 3 x 15.00
    expect(html).toContain('£170.00');
    // and the header counts what is in it
    expect(html).toMatch(/Cart<span[^>]*> \(4\)<\/span>/);
  });

  it('shortens the cart when a line is removed, first line included', async () => {
    // the same staleness one shape further in: a cart line is a `<:group>`
    // replica, a run between markers rather than an element, so the sweep
    // that drops last render's rows had nothing to look up and stopped at
    // the first one it should have taken. Two lines, remove the first, and
    // the page served two -- the survivor printed twice.
    const app = shop();
    const lines = (html: string) => [
      ...shown(html).matchAll(/<td><a[^>]* href="\/product\.html\?id=([a-z]+)"/g),
    ].map(m => m[1]);

    const added = await request(app).post('/cart/add').type('form').send({ id: 'saw' });
    const cookie = jar(added);
    await request(app).post('/cart/add').set('Cookie', cookie).type('form').send({ id: 'glue' });
    await request(app).post('/cart/add').set('Cookie', cookie).type('form').send({ id: 'oak' });
    expect(lines((await request(app).get('/cart.html').set('Cookie', cookie)).text)).toStrictEqual(
      ['saw', 'glue', 'oak']
    );

    await request(app).post('/cart/remove').set('Cookie', cookie).type('form').send({ id: 'saw' });
    const after = await request(app).get('/cart.html').set('Cookie', cookie);
    expect(lines(after.text)).toStrictEqual(['glue', 'oak']);
    // and the money follows the rows rather than the markup: 15.00 + 42.00
    expect(shown(after.text)).toContain('£57.00');

    // down to one, and then to the empty branch
    await request(app).post('/cart/remove').set('Cookie', cookie).type('form').send({ id: 'oak' });
    expect(lines((await request(app).get('/cart.html').set('Cookie', cookie)).text)).toStrictEqual(
      ['glue']
    );
    await request(app).post('/cart/remove').set('Cookie', cookie).type('form').send({ id: 'glue' });
    const empty = await request(app).get('/cart.html').set('Cookie', cookie);
    expect(lines(empty.text)).toStrictEqual([]);
    expect(shown(empty.text)).toContain('Nothing in it yet');
  });

  it('does not leave one request rows in the next', async () => {
    // the bug this shop found. A page's document is compiled once and
    // rendered into again and again, and the two renders never meet: the
    // second builds a fresh scope tree, stamps `s11-0` and `s11-1`, adopts
    // the two elements already standing -- and the eight the last request
    // left belong to nobody, so nothing visited them. A filter after a full
    // listing showed ten items, two of them right.
    //
    // In a catalog that is a wrong count. Keyed to a person it is one
    // visitor's rows in another's page, and nothing about it is loud.
    const app = shop();
    const all = await request(app).get('/');
    expect(cards(all.text)).toBe(10);

    const books = await request(app).get('/?tag=book');
    expect(cards(books.text)).toBe(2);
    expect(shown(books.text)).not.toContain('Dovetail saw');

    // and back up again, so the sweep is not merely truncating
    const again = await request(app).get('/');
    expect(cards(again.text)).toBe(10);
  });

  it('comes back to the shelf you added from, and only to a shelf here', async () => {
    // the catalog puts its own address in the form, filter and all; without
    // that the redirect lands on the unfiltered catalog and the visitor's
    // category silently resets under them
    const app = shop();
    const shelf = await request(app).get('/?tag=book');
    expect(shelf.status).toBe(200);
    // the hidden field carries this address, not a hard-coded '/'
    expect(shown(shelf.text)).toContain('value="/?tag=book"');

    const added = await request(app)
      .post('/cart/add')
      .type('form')
      .send({ id: 'saw', back: '/?tag=book' });
    expect(added.headers.location).toBe('/?tag=book');

    // that field arrives from whoever posted it, so it is a path here or
    // it is the fallback -- a redirect off-site is not ours to offer
    for (const hostile of ['//evil.example.com', 'https://evil.example.com', 'javascript:alert(1)']) {
      const res = await request(app).post('/cart/add').type('form').send({ id: 'saw', back: hostile });
      expect(res.headers.location).toBe('/cart.html');
    }
  });

  it('sends an empty checkout back to the cart rather than showing a form', async () => {
    const res = await request(shop()).get('/checkout.html');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/cart.html');
  });

  it('places an order, empties the cart and confirms it', async () => {
    const app = shop();
    const added = await request(app).post('/cart/add').type('form').send({ id: 'plane' });
    const cookie = jar(added);

    const placed = await request(app)
      .post('/checkout')
      .set('Cookie', cookie)
      .type('form')
      .send({ name: 'Ada Lovelace' });
    expect(placed.status).toBe(303);
    expect(placed.headers.location).toMatch(/^\/thanks\.html\?order=A\d+$/);

    const thanks = await request(app).get(placed.headers.location).set('Cookie', cookie);
    expect(thanks.status).toBe(200);
    expect(shown(thanks.text)).toContain('Thank you, Ada Lovelace');
    expect(shown(thanks.text)).toContain('Block plane');
    expect(shown(thanks.text)).toContain('£89.00');

    // the cart is empty afterwards, which is what makes a reload harmless
    const cart = await request(app).get('/cart.html').set('Cookie', cookie);
    expect(shown(cart.text)).toContain('Nothing in it yet');
  });

  it('refuses an order it was not asked for through the page', async () => {
    const app = shop();
    const added = await request(app).post('/cart/add').type('form').send({ id: 'oak' });
    const cookie = jar(added);

    // no name: the form requires one, so this request skipped the page
    const res = await request(app).post('/checkout').set('Cookie', cookie).type('form').send({});
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/checkout.html');
  });

  it('answers a made-up order number with a 404', async () => {
    const res = await request(shop()).get('/thanks.html?order=A1');

    expect(res.status).toBe(404);
    expect(shown(res.text)).toContain('No such order');
  });

  it('keeps one visitor out of another visitor cart', async () => {
    const app = shop();
    const mine = jar(await request(app).post('/cart/add').type('form').send({ id: 'chisel' }));
    const theirs = jar(await request(app).post('/cart/add').type('form').send({ id: 'walnut' }));

    const seen = await request(app).get('/cart.html').set('Cookie', mine);
    expect(shown(seen.text)).toContain('Bench chisel');
    expect(shown(seen.text)).not.toContain('Walnut');
    expect(mine).not.toBe(theirs);
  });
});

/**
 * The one part of the shop that is a fragment SPA.
 *
 * Which tab is showing is nobody's business but the browser's -- not a
 * different page, not worth a request, not worth an address of its own to
 * anything that indexes. So it is `$url.hash`, live, over a plain `:if`:
 * the branches the server did not show still travel, which is exactly what
 * lets the browser switch to them without asking.
 *
 * Mounted in a real DOM rather than asserted on the response, because the
 * half worth testing is the half the response cannot show. And on the same
 * page whose product came from a `:server-` value, which is the pairing an
 * application actually has: decided-once and live, in one page.
 */
describe('the product page tabs', () => {
  const docroot = path.resolve(__dirname, '../../../../sites/shop');

  async function product(hash: string) {
    const shop = new Catalog();
    const compiler = new Compiler({ docroot, serverGlobals: ['shop', 'cart'] });
    const page = await compiler.compile('/product.html');
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    const url = 'http://shop.test/product.html?id=saw';
    expect(
      await renderPage(page, {
        url,
        globals: { shop, cart: { lines: [], count: 0, total: 0 } },
      })
    ).toStrictEqual([]);
    const served = page.source.doc.toString();
    const window = new Window({ url: url + hash });
    window.document.write(served);
    const mounted = hydrate(page, { doc: window.document as never, url: url + hash });
    const text = () =>
      (window.document.querySelector('main') as unknown as { textContent: string })
        .textContent.replace(/\s+/g, ' ');
    return { served, text, window, errors: mounted.errors.map(e => e.message) };
  }

  it('serves the first tab, since a server never sees a fragment', async () => {
    const p = await product('');

    expect(p.served).toContain('Made to be used');
    // and carries the others, which is what makes them reachable at all
    expect(p.served).toContain('Catalogue number');
    expect(p.served).toContain('Two working days');
  });

  it('shows the tab a deep link asked for, once the page is alive', async () => {
    const p = await product('#specs');

    expect(p.text()).toContain('Catalogue number');
    expect(p.text()).not.toContain('Made to be used');
    // the product itself came from a `:server-` value and is untouched by
    // any of this
    expect(p.text()).toContain('Dovetail saw');
    expect(p.errors).toStrictEqual([]);
  });

  it('switches on a click, with no request', async () => {
    const p = await product('');
    expect(p.text()).toContain('Made to be used');

    const tab = (label: string) =>
      [...(p.window.document.querySelectorAll('nav.tabs a') as unknown as Iterable<
        { textContent: string; click(): void }
      >)].find(a => a.textContent.trim() === label);

    tab('Delivery')!.click();
    await new Promise(r => setTimeout(r, 20));
    expect(p.text()).toContain('Two working days');
    expect(p.text()).not.toContain('Made to be used');

    tab('Description')!.click();
    await new Promise(r => setTimeout(r, 20));
    expect(p.text()).toContain('Made to be used');
    expect(p.errors).toStrictEqual([]);
  });
});

