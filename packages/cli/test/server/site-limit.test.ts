import path from 'path';
import type { Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createSite } from '../../../../sites/site/server';

/**
 * The site bounds what a script can make it render.
 *
 * A page here is a compile and a render, and the heaviest of them fetches a
 * directory of JSON while rendering -- so an unbounded page route is real
 * amplification on a public host, which is what CodeQL's
 * `js/missing-rate-limiting` was pointing at.
 *
 * What is worth pinning is not the number but the SHAPE: that the budget
 * covers what costs a render and nothing else, and that the routes mounted
 * before it are outside it. A limiter counting the wrong requests is the
 * failure that looks like success -- the headers are there, the numbers go
 * up, and either the renders are uncounted or the images are charged for.
 *
 * Every path below is one that does NOT exist, deliberately. The limiter
 * runs before markout and decides on the shape of the path alone, so a
 * missing page is counted exactly as a real one is and costs a 404 instead
 * of a render.
 *
 * And every test drives ONE listening server rather than `request(app)`,
 * which is the part that took two goes. supertest stands a server up and
 * tears it down per call; a budget of 300 means 300 of those per test, and
 * under a full-suite run the sockets give out -- `Error: socket hang up`,
 * about one run in three, on whichever of these reached it first. The first
 * attempt read that as slowness and raised the timeout, which is why it came
 * back. One listen and 300 keep-alive requests is both the honest shape and
 * much the faster one.
 */

const docroot = path.resolve(__dirname, '../../../../sites/site');

/** the real budget, which is not tunable from out here on purpose */
const BUDGET = 300;

/** the site as it ships, listening; a fresh one has a fresh budget */
async function site() {
  const server: Server = createSite({ docroot }).listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const { port } = server.address() as { port: number };
  return {
    get: async (pathname: string) => {
      const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
      // drained rather than abandoned: an unread body holds the socket, and
      // the next request then waits on a connection that is never finished
      await res.arrayBuffer();
      return res.status;
    },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

/**
 * Spends the whole page budget, and returns once it is gone.
 *
 * Every test that asks "is this outside the budget" asks it of a site whose
 * budget is already spent, which is the stronger claim: it still answers
 * when a page would not.
 */
async function exhaust(s: { get: (p: string) => Promise<number> }) {
  for (let i = 0; i < BUDGET + 5; i++) {
    if ((await s.get('/no-such-page.html')) === 429) return;
  }
  throw new Error(`the budget was not spent after ${BUDGET + 5} page requests`);
}

describe('the site under a page budget', () => {
  it('counts page requests, and answers 429 past the budget', async () => {
    const s = await site();
    try {
      await exhaust(s);
    } finally {
      await s.close();
    }
  });

  it('counts an extensionless path, which is a page request too', async () => {
    // markout's rule, and the reason the limiter imports `isPageRequest`
    // rather than restating it: no extension means a page
    const s = await site();
    try {
      let last = 404;
      for (let i = 0; i < BUDGET + 5 && last !== 429; i++) {
        last = await s.get('/no-such-page');
      }
      expect(last).toBe(429);
    } finally {
      await s.close();
    }
  });

  it('does not count what it does not render', async () => {
    // anything with an extension that is not `.html` is served past the
    // middleware and costs no render, so it neither spends the budget nor
    // notices that the budget is gone
    const s = await site();
    try {
      await exhaust(s);
      expect(await s.get('/no-such-asset.svg')).not.toBe(429);
      expect(await s.get('/favicon.svg')).toBe(200);
    } finally {
      await s.close();
    }
  });

  it('leaves the health check outside the budget', async () => {
    // mounted BEFORE the limiter on purpose: a container asking every few
    // seconds whether the process is alive must not be able to exhaust the
    // budget a visitor shares. `/healthz` has no extension, so left to the
    // limiter's rule alone it WOULD be counted -- the mount order is what
    // keeps it out, and that is the thing being pinned
    const s = await site();
    try {
      await exhaust(s);
      expect(await s.get('/healthz')).toBe(200);
    } finally {
      await s.close();
    }
  });

  it("leaves the desk demo's own API outside it", async () => {
    // A route that ANSWERS, and the distinction is the point rather than a
    // detail of the fixture: mounting before the limiter puts a request
    // outside the budget only when the application actually handles it. One
    // the desk router declines falls through, and is then a page request
    // like any other -- which is right, because markout is about to render
    // it. `/me` is the cheap one of the four
    const s = await site();
    try {
      await exhaust(s);
      expect(await s.get('/demos/desk/api/me')).toBe(200);
    } finally {
      await s.close();
    }
  });
});
