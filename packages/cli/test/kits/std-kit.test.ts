import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Compiler, discoverKits } from '@markout/core';
import { renderPage } from '@markout/core';
import { STATE_GLOBAL } from '@markout/core';
import type { PageState } from '@markout/core';

/**
 * The std kit, compiled and rendered as a page would be.
 *
 * `std-data` is the claim this kit exists to make: a datasource written WITH
 * the language rather than into it. Nothing here is a runtime special case --
 * it is `:server-` plus an expression that returns a promise, and the whole
 * of what makes it work is that the server settles one before it serializes.
 *
 * Nothing reaches the network. `fetch` is a global the runtime reads off
 * `globalThis` when a context is built, so replacing it first is all a test
 * has to do -- which is also how a page under test would supply its own.
 */

const KIT_ROOT = path.resolve(__dirname, '../../../../sites/site');

const PAYLOAD = {
  title: 'Example data 1',
  fetchedBy: 'the server, while rendering',
  rows: [
    { id: 1, name: 'Ada Lovelace', role: 'Analyst' },
    { id: 2, name: 'Grace Hopper', role: 'Compiler' },
  ],
};

/** stands in for the network: records what was asked for, answers with `body` */
function stubFetch(body: unknown, init?: { ok?: boolean; status?: number }) {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string) => {
    calls.push(`${url}`);
    return {
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      statusText: init?.status === 404 ? 'Not Found' : 'OK',
      json: async () => body,
    };
  }) as unknown as typeof fetch);
  return calls;
}

const ORIGIN = 'http://x.test';

/**
 * `origin: null` renders with no origin at all, which is what a page compiled
 * ahead of time gets: no request behind it, and no deploy host to guess.
 */
async function compile(pathname: string, origin: string | null = ORIGIN) {
  const { kits } = discoverKits(KIT_ROOT);
  const page = await new Compiler({ docroot: KIT_ROOT, kits }).compile(pathname);
  const errors = page.errors.map(e => e.msg);
  const raw = errors.length
    ? []
    : await renderPage(page, origin === null ? {} : { origin });
  const runtime = raw.map(e => `${e.phase}: ${e.message}`);
  return { page, errors, runtime, raw, markup: page.source.doc.toString() };
}

/** what the server sent alongside the page */
function state(markup: string): PageState {
  const m = /window\.__MARKOUT_STATE = ([\s\S]*?);<\/script>/.exec(markup);
  if (!m) return {};
  const window: Record<string, unknown> = {};
  new Function('window', `window.${STATE_GLOBAL} = ${m[1]};`)(window);
  return window[STATE_GLOBAL] as PageState;
}

/** the live document: stencils and markers out */
function live(markup: string): string {
  return markup
    .replace(/<template>[\s\S]*?<\/template>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

beforeEach(() => stubFetch(PAYLOAD));
afterEach(() => vi.restoreAllMocks());

describe('std-kit: the showcase', () => {
  it('compiles and renders with nothing reported', async () => {
    const { errors, runtime } = await compile('/demos/std/index.html');
    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
  });

  it('serves the fetched rows IN the markup', async () => {
    // the whole claim: a reader of the served HTML sees the data, so there is
    // nothing for the browser to fetch and nothing to flash
    const { markup } = await compile('/demos/std/index.html');
    const html = live(markup);
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('Grace Hopper');
    expect(html).toContain('the server, while rendering');
  });

  it('fetches once, resolving the page-relative url against $origin', async () => {
    const calls = stubFetch(PAYLOAD);
    await compile('/demos/std/index.html');
    // exactly one: the `:client` datasource on the same page must not have
    // fetched here, and the served one must not have fetched twice
    expect(calls).toStrictEqual(['http://x.test/demos/std/index-data1.json']);
  });

  it('sends the payload as state, so hydration does not lose it', async () => {
    const { markup } = await compile('/demos/std/index.html');
    const served = Object.values(state(markup)).find(v => '_served' in v);
    expect(served?._served).toStrictEqual({ body: PAYLOAD });
  });
});

describe('std-data: the served mode', () => {
  const page = (attrs: string, body: string) =>
    `<html><head><:import src="/std-kit/all.htm" /></head><body>` +
    `<std-data :aka="d" ${attrs} />${body}</body></html>`;

  async function renderInline(
    attrs: string,
    body: string,
    origin: string | null = ORIGIN
  ) {
    const fs = await import('fs');
    const name = `.t${Math.random().toString(36).slice(2)}.html`;
    fs.writeFileSync(path.join(KIT_ROOT, name), page(attrs, body));
    try {
      return await compile(`/${name}`, origin);
    } finally {
      fs.unlinkSync(path.join(KIT_ROOT, name));
    }
  }

  it('renders what the server fetched', async () => {
    const r = await renderInline(':url="http://x.test/d.json"', '<i>${d.data.title}</i>');
    expect(r.errors).toStrictEqual([]);
    expect(live(r.markup)).toContain('<i>Example data 1</i>');
  });

  it('fetches nothing without a src', async () => {
    const calls = stubFetch(PAYLOAD);
    const r = await renderInline('', '<i>${d.data ?? "none"}</i>');
    expect(r.errors).toStrictEqual([]);
    expect(calls).toStrictEqual([]);
    expect(live(r.markup)).toContain('<i>none</i>');
  });

  it('carries a failed response back as a value rather than a log line', async () => {
    // a 404 is a fact about the page's data, not a fault in the render, so it
    // has to reach the page. Reported as a runtime error it would land in a
    // server log the visitor never sees, and the page would render blank
    stubFetch(null, { ok: false, status: 404 });
    const r = await renderInline(':url="http://x.test/missing.json"', '<i>${d.error}</i>');
    expect(r.errors).toStrictEqual([]);
    expect(r.runtime).toStrictEqual([]);
    expect(live(r.markup)).toContain('<i>404 Not Found</i>');
  });

  it('carries a network failure back the same way', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await renderInline(':url="http://x.test/d.json"', '<i>${d.error}</i>');
    expect(r.runtime).toStrictEqual([]);
    expect(live(r.markup)).toContain('ECONNREFUSED');
  });

  it('leaves the render alone in :client mode', async () => {
    const calls = stubFetch(PAYLOAD);
    const r = await renderInline(':client :url="/d.json"', '<i>${d.data ?? "none"}</i>');
    expect(r.errors).toStrictEqual([]);
    expect(calls).toStrictEqual([]);
    expect(live(r.markup)).toContain('<i>none</i>');
  });

  // A page compiled ahead of time has no request behind its render, so no
  // `$origin` -- and a relative `:url` has nothing to be resolved against.
  describe('with no server behind the render', () => {
    it('lets a :client datasource through untouched', async () => {
      // this used to fail, which made the one mode meant for a built page the
      // one that could not be built: `_url` is computed whether or not the
      // fetch happens, and resolving `/d.json` against an absent origin threw
      const calls = stubFetch(PAYLOAD);
      const r = await renderInline(
        ':client :url="/d.json"',
        '<i>${d.data ?? "none"}</i>',
        null
      );
      expect(r.errors).toStrictEqual([]);
      expect(r.runtime).toStrictEqual([]);
      expect(calls).toStrictEqual([]);
      expect(live(r.markup)).toContain('<i>none</i>');
    });

    it('says why a relative url cannot be fetched, as a server failure', async () => {
      const calls = stubFetch(PAYLOAD);
      const r = await renderInline(':url="/d.json"', '<i>${d.data ?? "none"}</i>', null);

      expect(calls).toStrictEqual([]);
      expect(r.raw).toHaveLength(1);
      // `serverOnly` is what `markout build` fails on: this value crosses
      // frozen, so the browser cannot retry what the server could not do
      expect(r.raw[0].serverOnly).toBe(true);
      expect(r.raw[0].message).toContain('nothing is serving this page');
      expect(r.raw[0].message).toContain(':client');
    });

    it('still fetches an absolute url, which is what makes it generation', async () => {
      // answering while the page is BUILT and carrying the result in the
      // markup is static site generation, and worth keeping
      const calls = stubFetch(PAYLOAD);
      const r = await renderInline(
        ':url="http://x.test/d.json"',
        '<i>${d.data.title}</i>',
        null
      );
      expect(r.errors).toStrictEqual([]);
      expect(r.runtime).toStrictEqual([]);
      expect(calls).toStrictEqual(['http://x.test/d.json']);
      expect(live(r.markup)).toContain('<i>Example data 1</i>');
    });
  });
});
