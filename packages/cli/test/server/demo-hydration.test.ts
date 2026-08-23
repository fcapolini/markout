import path from 'path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser } from 'happy-dom';
import { createSite } from '../../../../sites/site/server';

/**
 * The two demos that carry the argument, hydrated in a DOM.
 *
 * Their own suites check what the server produces -- the markup, the API
 * routes, what a `:client` source keeps out of the page. This one checks the
 * other half: that the props a page ships load, and that running them over
 * the served markup leaves it alone.
 *
 * **Hydration must not change the page.** The runtime finds what SSR
 * rendered and binds to it; if it were to stamp a replica twice, lose a
 * region, or fail to find a marker, the element count would move. Comparing
 * the same page with scripts off and on is the cheapest way to ask, and it
 * needs nothing demo-specific to hold.
 *
 * Worth having on these two in particular: Orbit is the heaviest exercise of
 * the runtime in the repository -- 428 scopes and 718 expressions -- and had
 * no end-to-end coverage of the page itself at all.
 */
describe('the demos hydrate without disturbing what was served', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createSite({
      docroot: path.resolve(__dirname, '../../../../sites/site'),
    }).listen(0);
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  /** the page as a browser holds it, with the runtime run or not */
  async function load(url: string, javascript: boolean) {
    const errors: string[] = [];
    const browser = new Browser({
      settings: { enableJavaScriptEvaluation: javascript },
      console: {
        ...console,
        error: (...args: unknown[]) => errors.push(args.join(' ')),
      } as unknown as Console,
    });
    try {
      const page = browser.newPage();
      await page.goto(base + url);
      const win = page.mainFrame.window as unknown as Record<string, unknown>;
      // NOT waitUntilComplete(): Orbit runs a `setInterval`, so "every task
      // has finished" is never true and the wait never returns. What this is
      // waiting for is the runtime having run, which the props global says
      if (javascript) {
        for (let i = 0; i < 400 && !win.__MARKOUT_PROPS; i++) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      const doc = page.mainFrame.document;
      return {
        elements: doc.querySelectorAll('*').length,
        rows: doc.querySelectorAll('[data-markout]').length,
        props: win.__MARKOUT_PROPS as { e: unknown[]; p: unknown } | undefined,
        // a third-party script happy-dom cannot parse is not this project's
        // business -- Bootstrap's minified CDN bundle is one
        errors: errors.filter(e => !/cdn\.jsdelivr\.net/.test(e)),
      };
    } finally {
      await browser.close();
    }
  }

  for (const [name, url] of [
    ['orbit', '/demos/orbit.html'],
    ['desk', '/demos/desk/'],
  ]) {
    it(`${name} hydrates onto exactly what the server rendered`, async () => {
      const served = await load(url, false);
      const live = await load(url, true);

      // the props arrived in both halves and were loaded
      expect(live.props?.e.length).toBeGreaterThan(0);
      expect(live.props?.p).toBeTruthy();
      expect(live.errors).toStrictEqual([]);

      // and running them changed nothing: same elements, same bound ones
      expect(live.elements).toBe(served.elements);
      expect(live.rows).toBe(served.rows);
      expect(served.elements).toBeGreaterThan(50);
    }, 60000);
  }
});
