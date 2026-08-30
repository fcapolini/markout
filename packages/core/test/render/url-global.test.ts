import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/render/render';
import { hydrate } from '../../src/render/hydrate';
import { loadProps } from '../../src/render/props';
import { WebContext } from '../../src/runtime/web/web-context';

/**
 * `$url`: the address this page is being rendered for.
 *
 * The same bar `$origin` clears, and for the same reason -- the server has
 * it from the request, the browser from `location`, and the two mean one
 * thing. `$origin` is a strict subset and stays, taken from `$url` when a
 * caller passes only the address.
 *
 * A `URL` instance rather than a path and a search: `URL` was already a
 * name expressions could use, so `searchParams` arrives with it and there
 * is no new type to explain.
 */
let docroot: string;
let seq = 0;
beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-url-'));
});
afterAll(() => {
  fs.rmSync(docroot, { recursive: true, force: true });
});

async function served(markup: string, props?: { url?: string; origin?: string }) {
  const name = `u${seq++}.html`;
  fs.writeFileSync(path.join(docroot, name), `<html><body>${markup}</body></html>`);
  const page = await new Compiler({ docroot }).compile(`/${name}`);
  expect(page.errors.map(e => e.msg)).toStrictEqual([]);
  expect(await renderPage(page, props)).toStrictEqual([]);
  const html = page.source.doc.toString();
  return (/<body[^>]*>([\s\S]*?)<script type="application\/json"/.exec(html)?.[1] ?? '')
    .replace(/<!---[^>]*-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('what a page can read of its own address', () => {
  const url = 'http://x.test/a/b?q=1#f';

  it('gives the path, the query and the rest of a URL', async () => {
    expect(await served('${$url.pathname}', { url })).toBe('/a/b');
    expect(await served('${$url.searchParams.get("q")}', { url })).toBe('1');
    expect(await served('${$url.hash}', { url })).toBe('#f');
  });

  it('answers $origin out of it, so one fact is supplied once', async () => {
    expect(await served('${$origin}|${$url.origin}', { url })).toBe(
      'http://x.test|http://x.test'
    );
  });

  it('lets an explicit origin win, for a caller that knows better', async () => {
    expect(await served('${$origin}', { url, origin: 'http://other.test' })).toBe(
      'http://other.test'
    );
  });

  it('is undefined where there is no address at all', async () => {
    expect(await served('${$url === undefined}|${$origin === undefined}')).toBe(
      'true|true'
    );
  });

  it('treats an unreadable address as none rather than failing the render', async () => {
    expect(await served('${$url === undefined}', { url: 'not-a-url' })).toBe('true');
  });
});

describe('the browser half', () => {
  it('takes the address it is given, over the document it mounts into', async () => {
    // what a test document has is its runner's location, which is why
    // hydrate() takes this at all -- the same reason it takes `origin`
    const name = `u${seq++}.html`;
    fs.writeFileSync(
      path.join(docroot, name),
      '<html><body><i>${$url ? $url.pathname : "none"}</i></body></html>'
    );
    const page = await new Compiler({ docroot }).compile(`/${name}`);
    await renderPage(page, { url: 'http://x.test/served/path' });
    expect(
      /<i>([\s\S]*?)<\/i>/.exec(page.source.doc.toString())?.[1]?.replace(/<!---[^>]*-->/g, '')
    ).toBe('/served/path');

    const window = new Window({ url: 'http://x.test/served/path' });
    window.document.write(page.source.doc.toString());
    const mounted = hydrate(page, {
      doc: window.document as any,
      url: 'http://x.test/other/path',
    });
    expect(
      (window.document.querySelector('i') as unknown as { textContent: string }).textContent
    ).toBe('/other/path');
    expect(mounted.errors).toStrictEqual([]);
  });
});

/**
 * `$url` is the one global that changes while a page is up.
 *
 * Every other name in the global scope is the JS standard library or a fact
 * fixed for the life of the render, which is why the compiler emits no
 * dependency on one -- there would be nothing to wake. An address is not
 * fixed: a client-side navigation keeps the document and moves it, so
 * `$url` is a dependency like any value, and reading it re-runs.
 *
 * It cannot be written, in whole or in part. `$url` is where the page IS,
 * and navigating is a side effect with a lifetime that belongs to a kit --
 * TODO.md's second layer. A page that assigned it would be saying it had
 * arrived somewhere it has not.
 */
async function mounted(markup: string, url = 'http://x.test/start') {
  const name = `u${seq++}.html`;
  fs.writeFileSync(path.join(docroot, name), `<html><body>${markup}</body></html>`);
  const page = await new Compiler({ docroot }).compile(`/${name}`);
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
  return {
    ctx,
    errors,
    window,
    deps: (page.clientProps ?? page.props!) as unknown,
    body: () =>
      (window.document.querySelector('body') as unknown as { innerHTML: string }).innerHTML
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<!---[^>]*-->/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
  };
}

describe('an address that changes', () => {
  it('re-renders what read it', async () => {
    const p = await mounted('<i>${$url.pathname}</i>');
    expect(p.body()).toBe('<i>/start</i>');
    p.ctx.adoptUrl('http://x.test/moved?q=2');
    expect(p.body()).toBe('<i>/moved</i>');
    expect(p.errors).toStrictEqual([]);
  });

  it('shows and hides a region, which is the whole of what routing needs', async () => {
    const p = await mounted(
      '<i>x</i><:group :if=${$url.pathname === "/a"}><p>A</p><b>a</b></:group>'
    );
    expect(p.body()).toBe('<i>x</i>');
    p.ctx.adoptUrl('http://x.test/a');
    expect(p.body()).toBe('<i>x</i><p>A</p><b>a</b>');
    p.ctx.adoptUrl('http://x.test/b');
    expect(p.body()).toBe('<i>x</i>');
  });

  it('refuses an assignment, which would claim the page had moved', async () => {
    const p = await mounted(
      '<i>${$url.pathname}</i><button :on-click=${() => { $url = "/about"; }}>go</button>'
    );
    (p.window.document.querySelector('button') as unknown as { click(): void }).click();
    await new Promise(r => setTimeout(r, 10));
    expect(`${p.window.location.href}`).toBe('http://x.test/start');
    expect(p.body()).toMatch(/<i>\/start<\/i>/);
    expect(p.errors.join()).toMatch(/\$url is where the page is/);
    expect(p.errors.join()).toMatch(/follows the address bar/);
  });

  it('refuses a write to a part of it too', async () => {
    const p = await mounted(
      '<i>${$url.pathname}</i>' +
        '<button :on-click=${() => { $url.pathname = "/x"; }}>go</button>'
    );
    (p.window.document.querySelector('button') as unknown as { click(): void }).click();
    await new Promise(r => setTimeout(r, 10));
    expect(p.body()).toMatch(/<i>\/start<\/i>/);
    expect(p.errors.join()).toMatch(/\$url\.pathname is where the page is/);
  });
});
