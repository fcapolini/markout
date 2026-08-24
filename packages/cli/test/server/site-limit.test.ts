import path from 'path';
import request from 'supertest';
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
 * of a render. Reaching a budget of 300 four times over is then a second of
 * work rather than twenty, and the first version of this file -- which
 * rendered the homepage three hundred times -- was flaky under a full-suite
 * run for exactly that reason.
 */

const docroot = path.resolve(__dirname, '../../../../sites/site');

/** the site as it ships, budget included; a fresh one has a fresh budget */
function site() {
  return createSite({ docroot });
}

/** the real budget, which is not tunable from out here on purpose */
const BUDGET = 300;

/**
 * Spends the whole page budget, and returns once it is gone.
 *
 * Every test below that asks "is this outside the budget" asks it of an app
 * whose budget is already spent, which is both the stronger claim -- it
 * still answers when a page would not -- and the cheaper one: 300 missing
 * pages cost a 404 each, where 320 requests to the route under test cost
 * whatever that route costs, and did not fit in a default timeout under a
 * full-suite run.
 */
async function exhaust(app: ReturnType<typeof site>) {
  for (let i = 0; i < BUDGET + 5; i++) {
    const res = await request(app).get('/no-such-page.html');
    if (res.status === 429) return;
  }
  throw new Error(`the budget was not spent after ${BUDGET + 5} page requests`);
}

// Every test here makes 300+ sequential round trips, because the budget is
// 300 and is not tunable from out here -- the arrangement under test is the
// one that ships. That is a second or two on an idle machine and more than
// vitest's 5s default on a loaded one, which is how the first version of
// this file came to fail once in three full-suite runs while passing alone.
// A real bound, generously set, rather than a default that measures the
// machine.
describe('the site under a page budget', { timeout: 60_000 }, () => {
  it('counts page requests, and answers 429 past the budget', async () => {
    const app = site();
    let last = 404;
    for (let i = 0; i < BUDGET + 5 && last !== 429; i++) {
      last = (await request(app).get('/no-such-page.html')).status;
    }
    expect(last).toBe(429);
  });

  it('counts an extensionless path, which is a page request too', async () => {
    // markout's rule, and the reason the limiter imports `isPageRequest`
    // rather than restating it: no extension means a page
    const app = site();
    let last = 404;
    for (let i = 0; i < BUDGET + 5 && last !== 429; i++) {
      last = (await request(app).get('/no-such-page')).status;
    }
    expect(last).toBe(429);
  });

  it('does not count what it does not render', async () => {
    // anything with an extension that is not `.html` is served past the
    // middleware and costs no render, so it neither spends the budget nor
    // notices that the budget is gone
    const app = site();
    await exhaust(app);
    expect((await request(app).get('/no-such-asset.svg')).status).not.toBe(429);
    expect((await request(app).get('/favicon.svg')).status).toBe(200);
  });

  it('leaves the health check outside the budget', async () => {
    // mounted BEFORE the limiter on purpose: a container asking every few
    // seconds whether the process is alive must not be able to exhaust the
    // budget a visitor shares. `/healthz` has no extension, so left to the
    // limiter's rule alone it WOULD be counted -- the mount order is what
    // keeps it out, and that is the thing being pinned
    const app = site();
    await exhaust(app);
    expect((await request(app).get('/healthz')).status).toBe(200);
  });

  it("leaves the desk demo's own API outside it", async () => {
    // A route that ANSWERS, and the distinction is the point rather than a
    // detail of the fixture: mounting before the limiter puts a request
    // outside the budget only when the application actually handles it. One
    // the desk router declines falls through, and is then a page request
    // like any other -- which is right, because markout is about to render
    // it. `/me` is the cheap one of the four
    const app = site();
    await exhaust(app);
    expect((await request(app).get('/demos/desk/api/me')).status).toBe(200);
  });
});
