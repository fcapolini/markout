import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/render/render';
import { loadProps } from '../../src/render/props';
import { WebContext } from '../../src/runtime/web/web-context';

/**
 * A page routed by its fragment, driven the way a visitor drives one.
 *
 * Not a feature of its own -- there is no router here, and nothing in the
 * language knows what a route is. It is `$url` being live, a `<:group>`
 * carrying an `:if`, and `<a href="#x">`, which is why it is worth a test:
 * those three were built separately and this is the first thing that puts
 * all of them on one page.
 *
 * The fragment is also the one part of an address a server never sees --
 * browsers do not send it -- so this pins the consequence: the served page
 * is whatever the fragment-less address renders, and arriving at `#about`
 * is corrected on hydration rather than served correct.
 */
let docroot: string;
beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-fragment-'));
});
afterAll(() => {
  fs.rmSync(docroot, { recursive: true, force: true });
});

const PAGE = `<html :route=\${$url?.hash.slice(1) || "home"}><body>
  <nav><a href="#home">home</a> <a href="#about">about</a> <a href="#list">list</a></nav>
  <:group :if=\${route === "home"}><h1>Home</h1><p>welcome</p></:group>
  <:group :if=\${route === "about"}><h1>About</h1><p>us</p></:group>
  <:group :if=\${route === "list"}>
    <h1>List</h1>
    <:group :for-each=\${[1, 2]} :for-as="n"><li>\${n}</li></:group>
  </:group>
</body></html>`;

/** what the page shows, with the fixed nav and the runtime's marks out */
function shown(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<!---[^>]*-->/g, '')
    .replace(/<nav>[\s\S]*?<\/nav>/, '')
    .replace(/ data-markout="[^"]*"/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('routing on the fragment alone', () => {
  it('serves, corrects on arrival, navigates and traverses back', async () => {
    fs.writeFileSync(path.join(docroot, 'p.html'), PAGE);
    const page = await new Compiler({ docroot }).compile('/p.html');
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);

    // the address a server is given never has a fragment in it
    expect(await renderPage(page, { url: 'http://x.test/p.html' })).toStrictEqual([]);
    const served = page.source.doc.toString();
    expect(
      shown(/<body[^>]*>([\s\S]*?)<script type="application\/json"/.exec(served)?.[1] ?? '')
    ).toBe('<h1>Home</h1><p>welcome</p>');

    // and the visitor arrives at one the server could not have known about
    const window = new Window({ url: 'http://x.test/p.html#about' });
    window.document.write(served);
    const win = window as unknown as {
      addEventListener(type: string, fn: () => void): void;
      history: { back(): void };
      location: { href: string };
    };
    const errors: string[] = [];
    const ctx = new WebContext({
      ...loadProps(page.clientProps ?? page.props!),
      doc: window.document as any,
      url: `${win.location.href}`,
      onError: e => errors.push(e.message),
    }).refresh();
    // what browser.ts attaches on boot
    const update = () => ctx.adoptUrl(`${win.location.href}`);
    win.addEventListener('popstate', update);
    win.addEventListener('hashchange', update);

    const body = () =>
      shown((window.document.querySelector('body') as unknown as { innerHTML: string }).innerHTML);
    const link = (i: number) =>
      (window.document.querySelectorAll('a')[i] as unknown as { click(): void }).click();
    const settle = () => new Promise(r => setTimeout(r, 20));

    expect(body()).toBe('<h1>About</h1><p>us</p>');

    link(2);
    await settle();
    expect(body()).toBe('<h1>List</h1> <li>1</li><li>2</li>');

    link(0);
    await settle();
    expect(body()).toBe('<h1>Home</h1><p>welcome</p>');

    win.history.back();
    await settle();
    expect(`${win.location.href}`).toBe('http://x.test/p.html#list');
    expect(body()).toBe('<h1>List</h1> <li>1</li><li>2</li>');

    expect(errors).toStrictEqual([]);
  });
});

/**
 * The head is a page's markup like any other, which is the whole of what
 * per-page metadata needs -- `<title>` here reads the same `:route` the
 * branches do, declared once on the root tag because that is the one scope
 * both `<head>` and `<body>` are inside. Nothing about it is a metadata
 * API.
 *
 * The half it does NOT fix is worth pinning too. A browser corrects the
 * title on arrival; a link unfurler, an RSS reader or a `curl` reads the
 * response and stops, and the response was rendered without a fragment
 * because no fragment was sent. So a deep link previews as the default
 * route however right the tab looks.
 */
describe('what the head does on a deep link', () => {
  it('corrects itself on arrival and on every navigation after', async () => {
    fs.writeFileSync(
      path.join(docroot, 't.html'),
      '<html :route=${$url?.hash.slice(1) || "home"}>' +
        '<head><title>${route} — site</title></head>' +
        '<body><a href="#list">list</a>' +
        '<:group :if=${route === "about"}><h1>About</h1></:group>' +
        '</body></html>'
    );
    const page = await new Compiler({ docroot }).compile('/t.html');
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    expect(await renderPage(page, { url: 'http://x.test/t.html' })).toStrictEqual([]);
    const served = page.source.doc.toString();

    // what anything reading the response gets, whichever route was asked for
    expect(
      /<title>([\s\S]*?)<\/title>/.exec(served)?.[1]?.replace(/<!---[^>]*-->/g, '')
    ).toBe('home — site');

    const window = new Window({ url: 'http://x.test/t.html#about' });
    window.document.write(served);
    const win = window as unknown as {
      addEventListener(type: string, fn: () => void): void;
      location: { href: string };
      document: { title: string };
    };
    const ctx = new WebContext({
      ...loadProps(page.clientProps ?? page.props!),
      doc: window.document as any,
      url: `${win.location.href}`,
      onError: () => undefined,
    }).refresh();
    const update = () => ctx.adoptUrl(`${win.location.href}`);
    win.addEventListener('popstate', update);
    win.addEventListener('hashchange', update);

    const title = () =>
      (window.document.querySelector('title') as unknown as { textContent: string })
        .textContent;
    expect(title()).toBe('about — site');
    expect(`${win.document.title}`).toBe('about — site');

    (window.document.querySelector('a') as unknown as { click(): void }).click();
    await new Promise(r => setTimeout(r, 20));
    expect(title()).toBe('list — site');
  });
});
