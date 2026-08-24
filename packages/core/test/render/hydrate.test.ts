import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/render/render';
import { hydrate } from '../../src/render/hydrate';

/**
 * `hydrate()` from the outside: the recipe in `docs/reference/testing.md`,
 * run the way somebody testing their own component would run it.
 *
 * This is a test OF the testing story rather than of a feature, and the
 * distinction matters -- everything here goes through the package's public
 * surface (`Compiler`, `renderPage`, `hydrate`) and imports no internal, so
 * it fails if the recipe stops being writable with what is exported. The
 * suite's other harnesses reach for `WebContext`, `loadProps` and the seven
 * stages directly, which is why none of them was ever evidence that a user
 * could do this.
 */

let docroot: string;

beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-hydrate-'));
});

afterAll(() => {
  fs.rmSync(docroot, { recursive: true, force: true });
});

let seq = 0;

/** compile, server-render, and mount into a real DOM -- the whole recipe */
async function mount(page: string, files: Record<string, string> = {}) {
  for (const [file, code] of Object.entries(files)) {
    fs.writeFileSync(path.join(docroot, file), code);
  }
  const name = `h${seq++}.html`;
  fs.writeFileSync(path.join(docroot, name), page);

  const compiled = await new Compiler({ docroot }).compile(`/${name}`);
  expect(compiled.errors.map(e => `${e.type}: ${e.msg}`)).toStrictEqual([]);
  expect(await renderPage(compiled)).toStrictEqual([]);

  const window = new Window();
  window.document.write(compiled.source.doc.toString());
  const mounted = hydrate(compiled, { doc: window.document as any });
  return { ...mounted, doc: window.document, window };
}

describe('mounting a compiled page against a supplied DOM', () => {
  it('reads a value, and re-renders when it is written', async () => {
    const p = await mount('<html><body :n=${1}><i>${n}</i></body></html>');

    expect(p.doc.querySelector('i')!.textContent).toBe('1');
    // nested scopes are properties: <body>'s values live under `body`
    p.root.body.n = 7;
    expect(p.doc.querySelector('i')!.textContent).toBe('7');
    expect(p.errors).toStrictEqual([]);
  });

  it('runs a handler bound to a real event', async () => {
    // the case that needs a real DOM at all: the compiler's own document
    // has a no-op addEventListener, so a handler can be bound there and
    // never be shown to do anything
    const p = await mount(
      '<html><body :n=${0}>' +
        '<button :on-click=${() => n++}>go</button><i>${n}</i>' +
        '</body></html>'
    );

    p.doc.querySelector('button')!.click();
    p.doc.querySelector('button')!.click();
    expect(p.doc.querySelector('i')!.textContent).toBe('2');
    expect(p.errors).toStrictEqual([]);
  });

  it('tests a component through the tag rather than through its insides', async () => {
    // what someone actually wants to assert about a `<:define>`: give it
    // parameters, use it as a tag, and read the markup it produced
    const p = await mount(
      '<html><head><:import src="/badge.htm" /></head>' +
        '<body><my-badge ::label=${"new"} ::tone=${"warn"} /></body></html>',
      {
        'badge.htm': `<lib>
          <:define tag="my-badge:span"
            ::label=\${''}
            ::tone=\${'info'}
            class="badge"
            :class-badge-warn=\${tone === 'warn'}>\${label}</:define>
        </lib>`,
      }
    );

    const badge = p.doc.querySelector('span.badge')!;
    expect(badge.textContent).toBe('new');
    expect(badge.classList.contains('badge-warn')).toBe(true);
    expect(p.errors).toStrictEqual([]);
  });

  it('reaches a named scope by its :aka', async () => {
    const p = await mount(
      '<html><body><:logic :aka="cart" :count=${2} />' +
        '<i>${cart.count}</i></body></html>'
    );

    expect(p.doc.querySelector('i')!.textContent).toBe('2');
    p.root.body.cart.count = 5;
    expect(p.doc.querySelector('i')!.textContent).toBe('5');
  });

  it('keeps collecting failures caused after the mount', async () => {
    // the array is the context's own rather than a copy taken at mount, so
    // a test asserting it is empty at the END is asserting about the whole
    // interaction. It renders clean and only breaks on the write, which is
    // the shape a handler bug has
    const p = await mount(
      '<html><body :v=${{ name: "a" }}><i>${v.name}</i></body></html>'
    );

    expect(p.errors).toStrictEqual([]);
    expect(p.doc.querySelector('i')!.textContent).toBe('a');

    p.root.body.v = null;
    expect(p.errors.map(e => e.phase)).toContain('update');
  });

  it('mounts a page with nothing reactive in it', async () => {
    // a static page still has a scope tree, so it still has props -- there
    // is simply nothing to drive
    const p = await mount('<html><body><i>plain</i></body></html>');

    expect(p.doc.querySelector('i')!.textContent).toBe('plain');
    expect(p.errors).toStrictEqual([]);
  });

  it('carries a host-supplied global over as state, without one at mount', async () => {
    // The seam documented in testing.md, and the reason `hydrate` takes no
    // `globals`: a supplied name may only be read from a `:server-` value,
    // so it is `renderPage` that needs the fake. By mount time the result
    // has been carried over as state, and the browser supplies nothing --
    // which is exactly what this asserts, by supplying nothing here either
    const name = `g${seq++}.html`;
    fs.writeFileSync(
      path.join(docroot, name),
      '<html><body :server-user=${session.user}><i>${user}</i></body></html>'
    );
    const compiled = await new Compiler({
      docroot,
      serverGlobals: ['session'],
    }).compile(`/${name}`);
    expect(compiled.errors.map(e => e.msg)).toStrictEqual([]);
    expect(
      await renderPage(compiled, { globals: { session: { user: 'ada' } } })
    ).toStrictEqual([]);

    const window = new Window();
    window.document.write(compiled.source.doc.toString());
    const p = hydrate(compiled, { doc: window.document as any });

    expect(window.document.querySelector('i')!.textContent).toBe('ada');
    expect(p.errors).toStrictEqual([]);
  });

  it('refuses a page that did not compile, naming why', () => {
    // the alternative is a test that mounts nothing, asserts nothing and
    // passes -- which is the failure this whole entry point exists to let
    // someone catch
    const page = { props: undefined, errors: [{ type: 'error', msg: 'Unknown reference: "nope"' }] };
    expect(() => hydrate(page as any, { doc: new Window().document as any })).toThrow(
      /did not compile: Unknown reference: "nope"/
    );
  });
});
