import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { Compiler, STD_KIT_PACKAGE } from '../src/compiler';
import { discoverKits } from '../src/kits';
import { renderPage } from '../src/render/render';
import { loadProps } from '../src/render/props';
import { WebContext } from '../src/runtime/web/web-context';

/**
 * `std-router`, compiled and mounted as a page would be.
 *
 * The real kit files, not a stand-in: what this part claims is that one
 * piece of markup is a single-page app where the browser can be one and a
 * multi-page app where it cannot, and neither half of that is visible in a
 * definition read on its own.
 *
 * The claim underneath it is that the router does not track the address.
 * `$url` is the only thing `page` reads, and the runtime is what moves
 * `$url` -- so `adoptUrl` here stands in for every way an address changes
 * in a real browser (`navigatesuccess` after an interception, `popstate`,
 * `hashchange`), because in the runtime they are all the same call. A
 * router that kept its own copy would pass the first of these and fail the
 * second.
 */

const KIT_SRC = path.resolve(__dirname, '../../../kits/std-kit');

const temps: string[] = [];
afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()!;
    fs.existsSync(dir) && fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** a docroot with the REAL standard kit installed beside it */
function project(body: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-router-'));
  temps.push(root);
  const docroot = path.join(root, 'site');
  fs.mkdirSync(docroot);
  const dir = path.join(root, 'node_modules', ...STD_KIT_PACKAGE.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(KIT_SRC, dir, { recursive: true });
  fs.writeFileSync(
    path.join(docroot, 'index.html'),
    `<html><head></head><body>${body}</body></html>`
  );
  return docroot;
}

/** the visible text of each route that rendered, in document order */
function shown(window: Window): string[] {
  return [...(window.document.querySelectorAll('[data-route] > div') as any)]
    .map((e: { textContent: string }) => e.textContent.trim())
    .filter(t => t.length);
}

/** compile, render for `url`, then mount it the way a browser does */
async function mounted(body: string, url = 'http://x.test/index.html') {
  const docroot = project(body);
  const page = await new Compiler({ docroot, kits: discoverKits(docroot).kits }).compile(
    '/index.html'
  );
  expect(page.errors.map(e => e.msg)).toStrictEqual([]);
  expect(await renderPage(page, { url })).toStrictEqual([]);
  const served = page.source.doc.toString();

  const window = new Window({ url });
  window.document.write(served);
  const errors: string[] = [];
  const ctx = new WebContext({
    ...loadProps(page.clientProps ?? page.props!),
    doc: window.document as any,
    url,
    onError: e => errors.push(e.message),
  }).refresh();
  return {
    ctx,
    errors,
    window,
    served,
    shown: () => shown(window),
    // every rendered leaf, in document order: a nested route sits INSIDE its
    // outer route's element, so the outer one's text contains the inner
    items: () =>
      [...(window.document.querySelectorAll('i') as any)].map((e: { textContent: string }) =>
        e.textContent.trim()
      ),
  };
}

const PAGES = `
  <std-router>
    <std-route data-route ::page="index"><i>the index</i></std-route>
    <std-route data-route ::page="about"><i>about us</i></std-route>
  </std-router>`;

/** a router whose fallback is a page of its own, rather than the index */
const PAGES_404 = `
  <std-router ::fallback="notfound">
    <std-route data-route ::page="index"><i>the index</i></std-route>
    <std-route data-route ::page="about"><i>about us</i></std-route>
    <std-route data-route ::page="notfound"><i>no such page</i></std-route>
  </std-router>`;

/**
 * Put something on `globalThis` for the length of one test.
 *
 * The kit reads `globalThis.navigation`, which in a browser is the window's
 * and under a test runner is Node's -- so a test that wants one has to say
 * so. Restored afterwards, since this is the real global object.
 */
const restore: (() => void)[] = [];
afterEach(() => {
  while (restore.length) restore.pop()!();
});

function stubGlobal(name: string, value: unknown) {
  const g = globalThis as unknown as Record<string, unknown>;
  const had = name in g;
  const before = g[name];
  g[name] = value;
  restore.push(() => {
    had ? (g[name] = before) : delete g[name];
  });
}

describe('std-router', () => {
  it('shows the route the query names, and the index for a bare address', async () => {
    expect((await mounted(PAGES)).shown()).toStrictEqual(['the index']);
    expect(
      (await mounted(PAGES, 'http://x.test/index.html?about')).shown()
    ).toStrictEqual(['about us']);
    // a query the router did not put there still names its first token
    expect(
      (await mounted(PAGES, 'http://x.test/index.html?about&ref=nl')).shown()
    ).toStrictEqual(['about us']);
  });

  it('serves the right route in the markup, which is the no-JS half', async () => {
    // the multi-page fallback is not a code path, it is this: the server
    // already rendered the route the query asked for, so a browser that
    // never intercepts anything still lands in the right place
    const p = await mounted(PAGES, 'http://x.test/index.html?about');
    expect(p.served).toContain('about us');
    expect(/<div[^>]*>\s*the index/.test(p.served)).toBe(false);
  });

  it('follows the address every time it moves, not just the first time', async () => {
    // the regression this file exists for. A router holding its own copy of
    // the address passes the first hop -- whatever set the copy set it
    // right -- and then never moves again, because assigning a value drops
    // the expression that derived it and with it every edge into `$url`
    const p = await mounted(PAGES);
    expect(p.shown()).toStrictEqual(['the index']);
    p.ctx.adoptUrl('http://x.test/index.html?about');
    expect(p.shown()).toStrictEqual(['about us']);
    p.ctx.adoptUrl('http://x.test/index.html?index');
    expect(p.shown()).toStrictEqual(['the index']);
    p.ctx.adoptUrl('http://x.test/index.html?about');
    expect(p.shown()).toStrictEqual(['about us']);
    expect(p.errors).toStrictEqual([]);
  });

  it('agrees with $url, rather than keeping a second answer beside it', async () => {
    const p = await mounted(
      `<b>\${$url.search}</b>${PAGES}`,
      'http://x.test/index.html?about'
    );
    const search = () => (p.window.document.querySelector('b') as any).textContent;
    expect([search(), p.shown()]).toStrictEqual(['?about', ['about us']]);
    p.ctx.adoptUrl('http://x.test/index.html?index');
    expect([search(), p.shown()]).toStrictEqual(['?index', ['the index']]);
  });

  it('renders where there is no address to read at all', async () => {
    // `markout build` with no `--origin`: `$url` is undefined, and a page
    // built as static files is the deployment this part is most for
    const docroot = project(PAGES);
    const page = await new Compiler({
      docroot,
      kits: discoverKits(docroot).kits,
    }).compile('/index.html');
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    expect(await renderPage(page, {})).toStrictEqual([]);
    expect(page.source.doc.toString()).toContain('the index');
  });
});

describe('when the address names no route', () => {
  it('resolves to the fallback, in the served markup as well', async () => {
    // nothing is written while rendering, so the server reaches the same
    // answer the browser does -- an unknown address is answered in the
    // markup rather than a tick after it arrives
    const visible = (served: string) =>
      served
        .replace(/<template[\s\S]*?<\/template>/g, '')
        .replace(/<script[\s\S]*?<\/script>/g, '');

    const bad = await mounted(PAGES_404, 'http://x.test/index.html?abuot');
    expect(bad.shown()).toStrictEqual(['no such page']);
    expect(visible(bad.served)).toContain('no such page');

    const good = await mounted(PAGES_404, 'http://x.test/index.html?about');
    expect(good.shown()).toStrictEqual(['about us']);
    expect(visible(good.served)).not.toContain('no such page');
  });

  it('defaults the fallback to the index', async () => {
    // a campaign link to the home page: the query was never a route name
    const p = await mounted(PAGES, 'http://x.test/index.html?utm_source=nl');
    expect(p.shown()).toStrictEqual(['the index']);
  });

  it('moves in and out of the fallback as the address does', async () => {
    const p = await mounted(PAGES_404, 'http://x.test/index.html?about');
    expect(p.shown()).toStrictEqual(['about us']);
    p.ctx.adoptUrl('http://x.test/index.html?abuot');
    expect(p.shown()).toStrictEqual(['no such page']);
    p.ctx.adoptUrl('http://x.test/index.html?index');
    expect(p.shown()).toStrictEqual(['the index']);
    expect(p.errors).toStrictEqual([]);
  });

  it('shows exactly one route, never the fallback beside a real one', async () => {
    // the shape that first paint used to get wrong: the router learns its
    // names while rendering, so `page` is computed once before any route
    // exists and has to be carried again once they all do
    for (const [q, want] of [
      ['?about', ['about us']],
      ['?index', ['the index']],
      ['?abuot', ['no such page']],
      ['', ['the index']],
    ] as [string, string[]][]) {
      const p = await mounted(PAGES_404, `http://x.test/index.html${q}`);
      expect([q, p.shown()]).toStrictEqual([q, want]);
    }
  });

  it('finds names it was never told, however many there are', async () => {
    // discovery has to complete in the passes a render is allowed, whatever
    // the route count -- every route registers during the first walk
    const many = Array.from({ length: 12 }, (_, i) => i);
    const p = await mounted(
      `<std-router ::fallback="p0">
         ${many.map(i => `<std-route data-route ::page="p${i}"><i>page ${i}</i></std-route>`).join('')}
       </std-router>`,
      'http://x.test/index.html?p9'
    );
    expect(p.shown()).toStrictEqual(['page 9']);
    expect(p.errors).toStrictEqual([]);
  });

  it('sends an address that names no page to ::defaultPage', async () => {
    // a site whose front door is not called "index": without this the bare
    // address asked for a route that does not exist and rendered nothing
    const named = `
      <std-router ::defaultPage="home">
        <std-route data-route ::page="home"><i>the home page</i></std-route>
        <std-route data-route ::page="about"><i>about us</i></std-route>
      </std-router>`;
    expect((await mounted(named, 'http://x.test/index.html')).shown()).toStrictEqual([
      'the home page',
    ]);
    expect((await mounted(named, 'http://x.test/index.html?about')).shown()).toStrictEqual(
      ['about us']
    );
  });

  it('keeps the two questions apart, so a 404 stays off the front door', async () => {
    // one parameter for both would answer a bare address with the 404
    const both = `
      <std-router ::defaultPage="home" ::fallback="notfound">
        <std-route data-route ::page="home"><i>the home page</i></std-route>
        <std-route data-route ::page="notfound"><i>no such page</i></std-route>
      </std-router>`;
    expect((await mounted(both, 'http://x.test/index.html')).shown()).toStrictEqual([
      'the home page',
    ]);
    expect((await mounted(both, 'http://x.test/index.html?abuot')).shown()).toStrictEqual(
      ['no such page']
    );
  });

  it('uses ::defaultPage where there is no address at all', async () => {
    // `markout build` with no `--origin`: $url is undefined, so nothing
    // named a page and the front door is the answer
    const docroot = project(`
      <std-router ::defaultPage="home">
        <std-route ::page="home"><i>the home page</i></std-route>
        <std-route ::page="about"><i>about us</i></std-route>
      </std-router>`);
    const page = await new Compiler({
      docroot,
      kits: discoverKits(docroot).kits,
    }).compile('/index.html');
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    expect(await renderPage(page, {})).toStrictEqual([]);
    const body = page.source.doc
      .toString()
      .replace(/<template[\s\S]*?<\/template>/g, '')
      .replace(/<script[\s\S]*?<\/script>/g, '');
    expect(body).toContain('the home page');
    expect(body).not.toContain('about us');
  });

  it('publishes ::selected, which a page reads for itself', async () => {
    const p = await mounted(
      `<std-router>
         <std-route :aka="home" ::page="index"><i>the index</i></std-route>
         <std-route :aka="about" ::page="about"><i>about us</i></std-route>
         <b>\${home.selected}|\${about.selected}</b>
       </std-router>`,
      'http://x.test/index.html?about'
    );
    const flags = () => (p.window.document.querySelector('b') as any).textContent;
    expect(flags()).toBe('false|true');
    p.ctx.adoptUrl('http://x.test/index.html?index');
    expect(flags()).toBe('true|false');
  });
});

describe('routers inside routes', () => {
  const NESTED = `
    <std-router>
      <std-route data-route ::page="index"><i>home</i></std-route>
      <std-route data-route ::page="about"><i>about</i>
        <std-router>
          <std-route data-route ::page="index"><i>about index</i></std-route>
          <std-route data-route ::page="team"><i>the team</i></std-route>
        </std-router>
      </std-route>
    </std-router>`;

  it('gives each level its own segment of the address', async () => {
    // `$outer` is what makes this work: the inner router asks the nearest
    // router above it for its depth, walking past the <std-route> between
    for (const [q, want] of [
      ['', ['home']],
      ['?about', ['about', 'about index']],
      ['?about/team', ['about', 'the team']],
      ['?about/', ['about', 'about index']],
    ] as [string, string[]][]) {
      const p = await mounted(NESTED, `http://x.test/index.html${q}`);
      expect([q, p.items(), p.errors]).toStrictEqual([q, want, []]);
    }
  });

  it('serves the nested route too, so the no-JS half still answers', async () => {
    const p = await mounted(NESTED, 'http://x.test/index.html?about/team');
    const body = p.served
      .replace(/<template[\s\S]*?<\/template>/g, '')
      .replace(/<script[\s\S]*?<\/script>/g, '');
    expect(body).toContain('the team');
    expect(body).not.toContain('about index');
  });

  it('moves between levels as the address does', async () => {
    const p = await mounted(NESTED, 'http://x.test/index.html?about/team');
    expect(p.items()).toStrictEqual(['about', 'the team']);
    p.ctx.adoptUrl('http://x.test/index.html?about');
    expect(p.items()).toStrictEqual(['about', 'about index']);
    p.ctx.adoptUrl('http://x.test/index.html?index');
    expect(p.items()).toStrictEqual(['home']);
    p.ctx.adoptUrl('http://x.test/index.html?about/team');
    expect(p.items()).toStrictEqual(['about', 'the team']);
    expect(p.errors).toStrictEqual([]);
  });

  it('sends an unknown inner segment to the inner fallback', async () => {
    const p = await mounted(
      NESTED.replace('<std-router>\n          <std-route data-route ::page="index">',
        '<std-router ::fallback="index">\n          <std-route data-route ::page="index">'),
      'http://x.test/index.html?about/nope'
    );
    expect(p.items()).toStrictEqual(['about', 'about index']);
  });

  it('keeps a query string beside the path', async () => {
    const p = await mounted(NESTED, 'http://x.test/index.html?about/team&ref=nl');
    expect(p.items()).toStrictEqual(['about', 'the team']);
  });
});

describe('what std-router hands to the Navigation API', () => {
  /**
   * A stand-in for `window.navigation`, since no test DOM has one.
   *
   * Only what the router touches: it registers a `navigate` listener in
   * `:did-init` and drops it on dispose, and everything interesting is a
   * decision that listener makes about one event.
   */
  function fakeNavigation() {
    const listeners: Record<string, ((ev: unknown) => void)[]> = {};
    return {
      api: {
        addEventListener: (t: string, fn: (ev: unknown) => void) =>
          (listeners[t] ??= []).push(fn),
        removeEventListener: (t: string, fn: (ev: unknown) => void) => {
          const a = listeners[t] ?? [];
          const i = a.indexOf(fn);
          i >= 0 && a.splice(i, 1);
        },
      },
      count: () => (listeners['navigate'] ?? []).length,
      /**
       * Dispatch one navigate event; answers whether it was intercepted.
       *
       * A handler passed to `intercept()` is CALLED, because the real API
       * calls it and a fake that does not would let a router quietly do its
       * work there and still look clean from out here.
       */
      navigate: (ev: Record<string, unknown> = {}, to?: string) => {
        let intercepted = false;
        const event = {
          canIntercept: true,
          hashChange: false,
          downloadRequest: null,
          formData: null,
          navigationType: 'push',
          destination: { url: to ?? 'http://x.test/index.html' },
          intercept: (opts?: { handler?: () => unknown }) => {
            intercepted = true;
            opts?.handler?.();
          },
          ...ev,
        };
        (listeners['navigate'] ?? []).forEach(fn => fn(event));
        return intercepted;
      },
    };
  }

  /**
   * Mount with a Navigation API present, and answer the fake.
   *
   * It stays installed until the test ends rather than only for the mount:
   * the router reads `globalThis.navigation` again on the way out, so
   * putting it back too early is a dispose that silently unregisters
   * nothing -- which is the bug this suite would then fail to see.
   */
  async function withNavigation(url = 'http://x.test/index.html') {
    const nav = fakeNavigation();
    stubGlobal('navigation', nav.api);
    return { nav, ...(await mounted(PAGES, url)) };
  }

  it('listens once a page is up, and stops when it goes away', async () => {
    const p = await withNavigation();
    expect(p.nav.count()).toBe(1);
    p.ctx.root.dispose();
    expect(p.nav.count()).toBe(0);
  });

  it('takes over an ordinary in-page navigation', async () => {
    expect((await withNavigation()).nav.navigate({})).toBe(true);
  });

  it('leaves the browser everything it should not take over', async () => {
    const p = await withNavigation();
    // cross-document or otherwise not ours to cancel
    expect(p.nav.navigate({ canIntercept: false })).toBe(false);
    // `<a href="#x">`: a real same-document navigation the browser does
    // better, and one the runtime hears through `hashchange` anyway
    expect(p.nav.navigate({ hashChange: true })).toBe(false);
    expect(p.nav.navigate({ downloadRequest: 'file.pdf' })).toBe(false);
    expect(p.nav.navigate({ formData: {} })).toBe(false);
    // the one that costs a user something: intercepting a reload means the
    // document is never refetched, so pressing reload does nothing at all
    expect(p.nav.navigate({ navigationType: 'reload' })).toBe(false);
    expect(p.errors).toStrictEqual([]);
  });

  it('still follows the address after an interception has run', async () => {
    // the whole sequence a browser performs, in order: the click raises
    // `navigate`, the router cancels the document load, and only then does
    // `navigatesuccess` tell the runtime where the page now is.
    //
    // A router that took the address from the event instead of waiting for
    // that last step reads correctly here and is broken afterwards --
    // assigning a value discards the expression behind it, so its copy is
    // severed from `$url` for the rest of the page's life. The hop the
    // router declines is where that shows, and `hashChange` is the one
    // that really happens: the browser navigates, the runtime hears
    // `hashchange`, and a severed copy never learns of it.
    const p = await withNavigation();
    expect(p.shown()).toStrictEqual(['the index']);

    expect(p.nav.navigate({}, 'http://x.test/index.html?about')).toBe(true);
    p.ctx.adoptUrl('http://x.test/index.html?about');
    expect(p.shown()).toStrictEqual(['about us']);

    // a navigation the router did NOT intercept, arriving the only way it can
    expect(p.nav.navigate({ hashChange: true }, 'http://x.test/index.html?index#x')).toBe(
      false
    );
    p.ctx.adoptUrl('http://x.test/index.html?index#x');
    expect(p.shown()).toStrictEqual(['the index']);
    expect(p.errors).toStrictEqual([]);
  });

  it('cancels the load without claiming to handle it', async () => {
    // no handler passed to intercept(): the router's whole job is stopping
    // the document load, and `$url` moves on `navigatesuccess` afterwards
    const p = await withNavigation();
    let arg: unknown = 'not called';
    p.nav.navigate({ intercept: (a: unknown) => (arg = a) });
    expect(arg).toBe(undefined);
  });
});
