import path from 'path';
import type { Server } from 'node:http';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { DOM_ERRORS_ID } from '@markout-lang/core';
import { createSite } from '../../../../sites/site/server';

/**
 * The site's own pages render, which nothing was checking.
 *
 * `site-limit.test.ts` stands the real site up and then asks it for paths
 * that deliberately do NOT exist, because it is about the rate limiter. The
 * demo suites cover `/demos/*`. Between them the two most-visited pages here
 * -- the homepage and the demos index -- were never once rendered by a test,
 * so a broken kit import or an expression that stopped resolving on either
 * of them would have reached a deploy with a green suite behind it.
 *
 * In **dev** mode on purpose. A production page keeps a failed expression to
 * itself -- `dev-mode.test.ts` pins exactly that -- so asserting the absence
 * of the error block against a production render would assert nothing. Dev
 * is the mode that puts the failures in the page, which is what makes them
 * assertable from out here.
 *
 * Content anchors rather than counts of anything: one phrase per page that
 * says the page is the page and not an error document, and the links between
 * them, since a page nothing reaches is the failure a sitemap entry hides.
 */

const docroot = path.resolve(__dirname, '../../../../sites/site');

let server: Server;
let port: number;

beforeAll(async () => {
  server = createSite({ docroot, dev: true }).listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function get(pathname: string) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
  return { status: res.status, html: await res.text() };
}

describe('the site renders its own pages', () => {
  it('serves the homepage with nothing failing in it', async () => {
    const res = await get('/index.html');
    expect(res.status).toBe(200);
    expect(res.html).toContain('Markout');
    expect(res.html).not.toContain(DOM_ERRORS_ID);
  });

  it('serves the demos index', async () => {
    const res = await get('/demos/index.html');
    expect(res.status).toBe(200);
    expect(res.html).toContain('Demos');
    expect(res.html).not.toContain(DOM_ERRORS_ID);
  });

  it('serves the page that says why any of this exists', async () => {
    const res = await get('/about.html');
    expect(res.status).toBe(200);
    expect(res.html).toContain('Why Markout exists');
    expect(res.html).toContain('the DOM is the scope chain');
    expect(res.html).not.toContain(DOM_ERRORS_ID);
  });

  it('reaches that page from the two indexes', async () => {
    // a page linked from nowhere is the failure a sitemap entry hides
    expect((await get('/index.html')).html).toContain('/about.html');
    expect((await get('/demos/index.html')).html).toContain('/about.html');
  });
});
