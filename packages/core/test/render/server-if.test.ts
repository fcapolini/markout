import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/render/render';
import { hydrate } from '../../src/render/hydrate';

/**
 * `:server-if`: a branch the server decides, and does not decide again.
 *
 * An ordinary `:if` must keep its stencil whatever it decided, because its
 * condition is live and the browser may turn it -- so the markup of the
 * branch that did NOT show travels to every visitor, in the page source.
 * For a hidden panel that is weight; for one behind `${user.isAdmin}` it is
 * the panel, its links and its labels, sent to whoever asked.
 *
 * `:server-` says where a value runs and that its answer crosses frozen. On
 * a branch it says the same thing, and the consequence is that a browser
 * cannot re-decide it: what did not show can never show, so its stencil is
 * markup nobody will ever build, and it is dropped instead of served.
 *
 * The mirror of the case dropSpentStencils already covers -- that one drops
 * the stencil of a region that IS standing, this one of a region that never
 * will be.
 */
let docroot: string;
let seq = 0;
beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-server-if-'));
});
afterAll(() => {
  fs.rmSync(docroot, { recursive: true, force: true });
});

async function served(markup: string) {
  const name = `s${seq++}.html`;
  fs.writeFileSync(path.join(docroot, name), markup);
  const page = await new Compiler({ docroot }).compile(`/${name}`);
  expect(page.errors.map(e => e.msg)).toStrictEqual([]);
  expect(await renderPage(page)).toStrictEqual([]);
  const html = page.source.doc.toString();
  return {
    page,
    html,
    body: (/<body[^>]*>([\s\S]*?)<script/.exec(html)?.[1] ?? '').replace(
      /<!---[^>]*-->/g,
      ''
    ),
  };
}

const SECRET = '<a href="/admin/delete-everything">Danger zone</a>';

describe('markup a visitor was not meant to have', () => {
  it('travels behind a plain :if, which is why this exists', async () => {
    const out = await served(
      '<html><body :server-admin=${false}>' +
        `<div :if=\${admin}>${SECRET}</div><p>ordinary</p></body></html>`
    );

    expect(out.body).not.toContain('Danger zone');
    // not rendered, and still in the response -- in the stencil the browser
    // would build it from if the condition turned
    expect(out.html).toContain('Danger zone');
  });

  it('does not travel behind :server-if', async () => {
    const out = await served(
      '<html><body :server-admin=${false}>' +
        `<div :server-if=\${admin}>${SECRET}</div><p>ordinary</p></body></html>`
    );

    expect(out.html).not.toContain('Danger zone');
    expect(out.body).toContain('ordinary');
  });

  it('is served as usual when the server decided the other way', async () => {
    const out = await served(
      '<html><body :server-admin=${true}>' +
        `<div :server-if=\${admin}>${SECRET}</div></body></html>`
    );

    expect(out.body).toContain('Danger zone');
  });
});

describe('what the browser makes of one', () => {
  async function mounted(markup: string) {
    const out = await served(markup);
    const window = new Window({ url: 'http://x.test/' });
    window.document.write(out.html);
    const m = hydrate(out.page, { doc: window.document as any });
    return {
      errors: m.errors.map(e => e.message),
      body: (window.document.querySelector('body') as unknown as { innerHTML: string })
        .innerHTML.replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<!---[^>]*-->/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    };
  }

  it('leaves a hidden one hidden, with nothing to build it from', async () => {
    const p = await mounted(
      '<html><body :server-admin=${false}>' +
        `<div :server-if=\${admin}>${SECRET}</div><p>ordinary</p></body></html>`
    );

    expect(p.body).toBe('<p>ordinary</p>');
    // no stencil and no expression is not an error: the condition crossed
    // frozen, so there is nothing for the browser to be missing
    expect(p.errors).toStrictEqual([]);
  });

  it('leaves a shown one standing', async () => {
    const p = await mounted(
      '<html><body :server-admin=${true}>' +
        '<div :server-if=${admin}>SECRET</div><p>ordinary</p></body></html>'
    );

    expect(p.body).toContain('SECRET');
    expect(p.errors).toStrictEqual([]);
  });

  it('takes its place in a chain, with the :else answering for it', async () => {
    const p = await mounted(
      '<html><body :server-admin=${false}>' +
        '<div :server-if=${admin}>A</div><div :else>B</div></body></html>'
    );

    expect(p.body).toContain('B');
    expect(p.body).not.toContain('>A<');
  });
});

describe('what it refuses', () => {
  it('still refuses :const-if, which is a different question', async () => {
    const name = `s${seq++}.html`;
    fs.writeFileSync(
      path.join(docroot, name),
      '<html><body><div :const-if=${false}>x</div></body></html>'
    );
    const page = await new Compiler({ docroot }).compile(`/${name}`);
    expect(page.errors.map(e => e.msg).join()).toMatch(
      /":const-if" is not a value/
    );
  });

  it('and the rest of the family, which declare no value at all', async () => {
    const name = `s${seq++}.html`;
    fs.writeFileSync(
      path.join(docroot, name),
      '<html><body><div :server-for-each=${[1]}>x</div></body></html>'
    );
    const page = await new Compiler({ docroot }).compile(`/${name}`);
    expect(page.errors.map(e => e.msg).join()).toMatch(
      /":server-for-each" is not a value/
    );
  });
});
