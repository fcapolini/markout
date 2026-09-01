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
 * `std-params`, compiled and mounted as a page would be.
 *
 * A datasource whose source is the address. What it has to get right is the
 * line between the page and the parameters -- the leading query segment is
 * the page path, and a segment carrying `=` is a parameter -- because
 * `std-router` reads the same line and the two would otherwise disagree about
 * `?user=42`.
 *
 * And `href`, which is the reason this is more than `$url.searchParams`:
 * round-tripping a query through `URLSearchParams` turns the page path into
 * `user%2Forders=` and no router recognises it back.
 */

const KIT_SRC = path.resolve(__dirname, '../../../kits/std-kit');

const temps: string[] = [];
afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()!;
    fs.existsSync(dir) && fs.rmSync(dir, { recursive: true, force: true });
  }
});

function project(body: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-params-'));
  temps.push(root);
  const docroot = path.join(root, 'site');
  fs.mkdirSync(docroot);
  const dir = path.join(root, 'node_modules', ...STD_KIT_PACKAGE.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(KIT_SRC, dir, { recursive: true });
  fs.writeFileSync(
    path.join(docroot, 'index.html'),
    `<html><body>${body}</body></html>`
  );
  return docroot;
}

const PAGE = `
  <std-params :aka="q" />
  <i>id=\${q.data.id ?? '-'} sort=\${q.data.sort ?? '-'}</i>
  <a id="add" href=\${q.href({ page: 2 })}>next</a>
  <a id="drop" href=\${q.href({ id: null })}>clear</a>
  <a id="move" href=\${q.href({}, 'about')}>about</a>`;

async function mounted(body: string, url: string) {
  const docroot = project(body);
  const page = await new Compiler({ docroot, kits: discoverKits(docroot).kits }).compile(
    '/index.html'
  );
  expect(page.errors.map(e => e.msg)).toStrictEqual([]);
  expect(await renderPage(page, { url })).toStrictEqual([]);
  const window = new Window({ url });
  window.document.write(page.source.doc.toString());
  const errors: string[] = [];
  const ctx = new WebContext({
    ...loadProps(page.clientProps ?? page.props!),
    doc: window.document as any,
    url,
    onError: e => errors.push(e.message),
  }).refresh();
  const at = (id: string) =>
    (window.document.querySelector(`#${id}`) as any)?.getAttribute('href');
  return {
    ctx,
    errors,
    text: () => (window.document.querySelector('i') as any).textContent.trim(),
    hrefs: () => [at('add'), at('drop'), at('move')],
  };
}

describe('std-params', () => {
  it('reads the parameters, and only those', async () => {
    // the leading segment is the page path and never a parameter
    expect((await mounted(PAGE, 'http://x.test/p?user/orders&id=42')).text()).toBe(
      'id=42 sort=-'
    );
    expect((await mounted(PAGE, 'http://x.test/p?id=42&sort=age')).text()).toBe(
      'id=42 sort=age'
    );
    expect((await mounted(PAGE, 'http://x.test/p?user')).text()).toBe('id=- sort=-');
    expect((await mounted(PAGE, 'http://x.test/p')).text()).toBe('id=- sort=-');
  });

  it('builds a link that keeps the page and merges the rest', async () => {
    const p = await mounted(PAGE, 'http://x.test/p?user/orders&id=42');
    expect(p.hrefs()).toStrictEqual([
      '?user/orders&id=42&page=2', // added, page path intact
      '?user/orders', // null removes
      '?about&id=42', // second argument moves the page, parameters ride along
    ]);
    expect(p.errors).toStrictEqual([]);
  });

  it('builds one where there is no page, and where there are no parameters', async () => {
    expect((await mounted(PAGE, 'http://x.test/p?id=42')).hrefs()).toStrictEqual([
      '?id=42&page=2',
      '?',
      '?about&id=42',
    ]);
    expect((await mounted(PAGE, 'http://x.test/p?user')).hrefs()).toStrictEqual([
      '?user&page=2',
      '?user',
      '?about',
    ]);
  });

  it('follows the address, being derived from it like anything else', async () => {
    const p = await mounted(PAGE, 'http://x.test/p?user&id=42');
    expect([p.text(), p.hrefs()[0]]).toStrictEqual(['id=42 sort=-', '?user&id=42&page=2']);
    p.ctx.adoptUrl('http://x.test/p?user&id=7&sort=name');
    expect([p.text(), p.hrefs()[0]]).toStrictEqual([
      'id=7 sort=name',
      '?user&id=7&sort=name&page=2',
    ]);
    expect(p.errors).toStrictEqual([]);
  });

  it('agrees with std-router about where the page ends', async () => {
    // `?user=42` is a parameter to both, not a page to one of them: a route
    // named `user` must not be selected by a parameter that happens to share
    // its name
    const together = `
      <std-router ::defaultPage="home">
        <std-route ::page="home"><b>home</b></std-route>
        <std-route ::page="user"><b>user</b></std-route>
      </std-router>
      ${PAGE}`;
    const asParam = await mounted(together, 'http://x.test/p?user=42');
    expect(asParam.text()).toBe('id=- sort=-');
    const shown = () => asParam.hrefs();
    expect(shown()[2]).toBe('?about&user=42');

    const asPage = await mounted(together, 'http://x.test/p?user&id=42');
    expect(asPage.text()).toBe('id=42 sort=-');
  });
});
