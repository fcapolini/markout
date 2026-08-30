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

const PAGE = `<html><body :route=\${$url.hash.slice(1) || "home"}>
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
