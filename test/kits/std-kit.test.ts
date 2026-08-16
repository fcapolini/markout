import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/server/render';
import { STATE_GLOBAL } from '../../src/runtime/core/core-context';
import type { PageState } from '../../src/runtime/core/core-context';

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

const KIT_ROOT = path.resolve(__dirname, '../../kits/std');

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

async function compile(pathname: string) {
  const page = await new Compiler({ docroot: KIT_ROOT }).compile(pathname);
  const errors = page.errors.map(e => e.msg);
  const runtime = errors.length
    ? []
    : (await renderPage(page, { origin: ORIGIN })).map(e => `${e.phase}: ${e.message}`);
  return { page, errors, runtime, markup: page.source.doc.toString() };
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
    const { errors, runtime } = await compile('/index.html');
    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
  });

  it('serves the fetched rows IN the markup', async () => {
    // the whole claim: a reader of the served HTML sees the data, so there is
    // nothing for the browser to fetch and nothing to flash
    const { markup } = await compile('/index.html');
    const html = live(markup);
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('Grace Hopper');
    expect(html).toContain('the server, while rendering');
  });

  it('fetches once, resolving the page-relative url against $origin', async () => {
    const calls = stubFetch(PAYLOAD);
    await compile('/index.html');
    // exactly one: the `:client` datasource on the same page must not have
    // fetched here, and the served one must not have fetched twice
    expect(calls).toStrictEqual(['http://x.test/index-data1.json']);
  });

  it('sends the payload as state, so hydration does not lose it', async () => {
    const { markup } = await compile('/index.html');
    const served = Object.values(state(markup)).find(v => '_served' in v);
    expect(served?._served).toStrictEqual({ body: PAYLOAD });
  });
});

describe('std-data: the served mode', () => {
  const page = (attrs: string, body: string) =>
    `<html><head><:import src="/std-kit/all.htm" /></head><body>` +
    `<std-data :aka="d" ${attrs} />${body}</body></html>`;

  async function renderInline(attrs: string, body: string) {
    const fs = await import('fs');
    const name = `.t${Math.random().toString(36).slice(2)}.html`;
    fs.writeFileSync(path.join(KIT_ROOT, name), page(attrs, body));
    try {
      return await compile(`/${name}`);
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
});
