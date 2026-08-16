import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/server/render';

/**
 * Objects the host hands the server, reachable from a `:server-` value.
 *
 * They exist on the server and nowhere else -- nothing could ship a database
 * connection to a browser -- so the whole question is what happens when a
 * page reads one somewhere the browser will go. The answer is that it does
 * not compile, and that is settled entirely at build time: the compiler is
 * told the names, and the runtime is not asked to police anything.
 */

let docroot: string;
let seq = 0;

beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-globals-'));
});
afterAll(() => fs.rmSync(docroot, { recursive: true, force: true }));

const DB = {
  fleet: () => [{ id: 'a', name: 'Aurora' }],
  slow: () => new Promise(resolve => setTimeout(() => resolve('late'), 5)),
};

async function build(html: string, names: string[] = ['db']) {
  const name = `p${seq++}.html`;
  fs.writeFileSync(path.join(docroot, name), html);
  return new Compiler({ docroot, serverGlobals: names }).compile(`/${name}`);
}

/** the markup a reader would see: text markers out */
function live(markup: string): string {
  return markup.replace(/<!--[\s\S]*?-->/g, '');
}

async function render(html: string) {
  const page = await build(html);
  const errors = page.errors.map(e => e.msg);
  const runtime = errors.length ? [] : await renderPage(page, { globals: { db: DB } });
  return { page, errors, runtime, markup: page.source.doc.toString() };
}

describe('a supplied global, read from a :server- value', () => {
  it('is there, and its result renders', async () => {
    const r = await render(
      '<html :server-fleet=${db.fleet()}><body><i>${fleet[0].name}</i></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.runtime).toStrictEqual([]);
    expect(live(r.markup)).toContain('<i>Aurora</i>');
  });

  it('may return a promise, like any other server value', async () => {
    const r = await render('<html :server-v=${db.slow()}><body><i>${v}</i></body></html>');
    expect(r.runtime).toStrictEqual([]);
    expect(live(r.markup)).toContain('<i>late</i>');
  });

  it('sends the result but not the call that produced it', async () => {
    // the disclosure the stripping closes, now with the thing worth hiding:
    // the page carries the rows, and no trace of how they were asked for
    const r = await render(
      '<html :server-fleet=${db.fleet()}><body><i>${fleet[0].name}</i></body></html>'
    );
    expect(r.markup).toContain('Aurora');
    expect(r.markup).not.toContain('db.fleet');
    expect(r.markup).not.toContain('this.db');
  });
});

describe('a supplied global, read anywhere else', () => {
  it.each([
    ['a plain value', '<html :x=${db.fleet()}><body>${x}</body></html>'],
    ['text', '<html><body>${db.fleet()[0].name}</body></html>'],
    ['an attribute', '<html><body><i title=${db.fleet()[0].name}>x</i></body></html>'],
    ['an event handler', '<html><body><i :on-click=${() => db.fleet()}>x</i></body></html>'],
    ['a value holding a function', '<html :f=${() => db.fleet()}><body>${f}</body></html>'],
  ])('is refused in %s', async (_what, html) => {
    // each of these compiles clean without the rule, and is then `undefined`
    // in a browser nobody thought to test -- the exact failure this language
    // reports rather than produces
    const { errors } = await render(html);
    expect(errors.join('\n')).toMatch(/supplied to the server.*":server-" value/s);
  });
});

describe('a supplied global cannot be shadowed', () => {
  it('refuses a value declared over it', async () => {
    // unlike `Math`, which a page may deliberately take over: this name was
    // put there by the host, and quietly winning over it is nobody's intent
    const { errors } = await render('<html :db=${1}><body>${db}</body></html>');
    expect(errors.join()).toMatch(/Cannot declare "db"/);
  });

  it('refuses a scope named over it', async () => {
    // `db.users` would find the scope rather than the database
    const { errors } = await render(
      '<html><body><div :aka="db" :users=${1}>${db.users}</div></body></html>'
    );
    expect(errors.join()).toMatch(/Cannot name a scope "db"/);
  });
});

describe('registration', () => {
  it('refuses a name the language already has', async () => {
    // it would be unreachable behind the built-in, with no way for a page
    // author to tell which one they got
    expect(() => new Compiler({ docroot, serverGlobals: ['Math'] })).toThrow(
      /already one of the language's own/
    );
  });

  it('leaves a page that supplies none exactly as it was', async () => {
    const name = `p${seq++}.html`;
    fs.writeFileSync(path.join(docroot, name), '<html :n=${1}><body>${n}</body></html>');
    const plain = await new Compiler({ docroot }).compile(`/${name}`);
    const withGlobals = await new Compiler({ docroot, serverGlobals: ['db'] }).compile(
      `/${name}`
    );
    expect(plain.errors).toStrictEqual([]);
    expect(withGlobals.propsString).toBe(plain.propsString);
  });
});
