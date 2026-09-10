import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/render/render';
import { hydrate } from '../../src/render/hydrate';
import { Window } from 'happy-dom';
import type { RuntimeError } from '../../src/runtime/core/core-context';
import { WebContext } from '../../src/runtime/web/web-context';
import { loadProps } from '../../src/render/props';

/**
 * `:if`, `:for-each` and `:for-data` on a `<:define>`.
 *
 * A definition renders nowhere itself -- it is a stencil in `<head>` -- so
 * the only thing an arity on one can mean is an arity for each USE of the
 * tag. That is what it now means. Before, it was accepted, compiled clean,
 * and every instance of the tag silently rendered nothing: the value reached
 * the instance like every other declaration, and nothing had made the
 * instance a region in the markup, so the runtime went looking for a marker
 * that was never written.
 *
 * The everyday shape is a component guarding on its own parameter --
 * `<:define tag="bs-alert:div" ::msg=${null} :if=${msg}>` -- which is also
 * the case that says the guard has to be live while the region is away: the
 * parameter is what the condition reads.
 */
let docroot: string;
let seq = 0;

beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-arity-'));
});
afterAll(() => fs.rmSync(docroot, { recursive: true, force: true }));

async function compile(html: string) {
  const name = `a${seq++}.html`;
  fs.writeFileSync(path.join(docroot, name), html);
  return await new Compiler({ docroot }).compile(`/${name}`);
}

/** what the body renders, markers and bookkeeping taken out */
function body(page: { source: { doc: { toString(): string } } }) {
  const html = page.source.doc.toString();
  return html
    .slice(html.indexOf('<body'), html.indexOf('<script'))
    .replace(/<!--.*?-->/g, '')
    .replace(/ data-markout="[^"]*"/g, '')
    .replace(/<\/?body>/g, '')
    .trim();
}

/** compile, render, and mount over the served document -- as a browser would */
async function run(html: string) {
  const page = await compile(html);
  expect(page.errors.filter(e => e.type === 'error').map(e => e.msg)).toStrictEqual([]);
  expect(await renderPage(page)).toStrictEqual([]);
  const errors: RuntimeError[] = [];
  const ctx = new WebContext({
    ...loadProps(page.props!),
    doc: page.source.doc,
    onError: (e: RuntimeError) => errors.push(e),
  }).refresh();
  return { page, ctx, errors, body: () => body(page) };
}

/** the errors a page is refused with */
async function refused(html: string) {
  const page = await compile(html);
  return page.errors.filter(e => e.type === 'error').map(e => e.msg);
}

const ALERT =
  '<:define tag="my-alert:div" ::msg=${null} :if=${msg} class="alert">${msg}</:define>';

describe('an arity on a <:define>', () => {
  it('renders the instances whose condition holds, and no others', async () => {
    const { body } = await run(
      `<html><head>${ALERT}</head><body>` +
        '<my-alert ::msg=${"hi"} /><my-alert /><my-alert ::msg=${"there"} />' +
        '</body></html>'
    );
    expect(body()).toBe('<div class="alert">hi</div><div class="alert">there</div>');
  });

  it('brings an instance back when the parameter it guards on arrives', async () => {
    // the case the arity exists for, and the one that made the runtime
    // change necessary: `msg` is the instance's own value, and a region's
    // values are dead while it is away -- except the ones that resolve at
    // the call site, which this is
    const { ctx, body } = await run(
      `<html :m=\${null}><head>${ALERT}</head>` +
        '<body><my-alert ::msg=${m} /></body></html>'
    );
    expect(body()).toBe('');
    ctx.root.proxy.m = 'now';
    expect(body()).toBe('<div class="alert">now</div>');
    ctx.root.proxy.m = null;
    expect(body()).toBe('');
  });

  it('replicates every instance when the definition says :for-each', async () => {
    const { body } = await run(
      '<html><head><:define tag="my-row:p" ::rows=${[]} :for-each=${rows}>${data}' +
        '</:define></head><body><my-row ::rows=${["a", "b"]} /><my-row /></body></html>'
    );
    expect(body()).toBe('<p>a</p><p>b</p>');
  });

  it('takes :for-data, and binds the item it guards on', async () => {
    const { ctx, body } = await run(
      '<html :u=${null}><head><:define tag="my-user:div" ::of=${null} :for-data=${of}>' +
        '${data.name}</:define></head><body><my-user ::of=${u} /></body></html>'
    );
    expect(body()).toBe('');
    ctx.root.proxy.u = { name: 'Ada' };
    expect(body()).toBe('<div>Ada</div>');
  });

  it('carries slotted content in and out with the instance', async () => {
    const { ctx, body } = await run(
      '<html :on=${false}><head><:define tag="my-box:div" ::open=${false} :if=${open}' +
        ' class="box"><:slot /></:define></head>' +
        '<body><my-box ::open=${on}><i>mine</i></my-box></body></html>'
    );
    expect(body()).toBe('');
    ctx.root.proxy.on = true;
    expect(body()).toBe('<div class="box"><i>mine</i></div>');
  });

  it('holds through hydration, in a real DOM', async () => {
    const page = await compile(
      `<html :m=\${null}><head>${ALERT}</head>` +
        '<body><my-alert ::msg=${m} /></body></html>'
    );
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    expect(await renderPage(page)).toStrictEqual([]);
    const window = new Window();
    window.document.write(page.source.doc.toString());
    const mounted = hydrate(page, { doc: window.document as any });
    const shown = () => window.document.querySelector('.alert')?.textContent ?? null;
    expect(shown()).toBe(null);
    mounted.root.m = 'now';
    expect(shown()).toBe('now');
    expect(mounted.errors).toStrictEqual([]);
  });

  it('takes :for-as beside it, and the body reads the name it chose', async () => {
    const { body } = await run(
      '<html><head><:define tag="my-row:p" ::rows=${[]} :for-each=${rows} :for-as="row">' +
        '${row}</:define></head><body><my-row ::rows=${["a", "b"]} /></body></html>'
    );
    expect(body()).toBe('<p>a</p><p>b</p>');
  });

  it('takes :for-key beside it, and keeps a replica through a reorder', async () => {
    const { ctx, page, body } = await run(
      '<html :rows=${[{ id: 1, n: "a" }, { id: 2, n: "b" }]}>' +
        '<head><:define tag="my-row:p" ::of=${[]} :for-each=${of} :for-key=${data.id}>' +
        '${data.n}</:define></head><body><my-row ::of=${rows} /></body></html>'
    );
    expect(body()).toBe('<p>a</p><p>b</p>');
    const rowsIn = () =>
      [...(page.source.doc.body as any).childNodes].filter((n: any) => n.tagName === 'P');
    // by position, not by reading the text: a replica's content is a marker
    // comment and a text node rather than one string
    const [wasA, wasB] = rowsIn();

    ctx.root.proxy.rows = [{ id: 2, n: 'b' }, { id: 1, n: 'a' }];

    expect(body()).toBe('<p>b</p><p>a</p>');
    // the key's whole point: the replicas MOVED rather than being rewritten,
    // which is what an unkeyed list of the same two rows does instead
    expect(rowsIn()).toStrictEqual([wasB, wasA]);
  });

  it('leaves a usage-site arity working where the definition declares none', async () => {
    const { ctx, body } = await run(
      '<html :on=${false}><head><:define tag="my-box:div" class="box">x</:define></head>' +
        '<body><my-box :if=${on} /></body></html>'
    );
    expect(body()).toBe('');
    ctx.root.proxy.on = true;
    expect(body()).toBe('<div class="box">x</div>');
  });
});

describe('what an arity on a <:define> refuses', () => {
  it('refuses a second answer from the usage site', async () => {
    const errors = await refused(
      `<html><head>${ALERT}</head><body><my-alert ::msg=\${"hi"} :if=\${true} />` +
        '</body></html>'
    );
    expect(errors).toStrictEqual([
      '<my-alert> already decides how many times it renders -- its definition ' +
        'carries ":if" -- so ":if" here is a second answer to the same question. ' +
        'Keep the one that belongs to every instance of <my-alert> in the ' +
        'definition, and this one only where the definition declares none',
    ]);
  });

  it('says it once, rather than through everything the usage then breaks', async () => {
    // the usage is expanded anyway, as though the definition declared
    // nothing: left standing it is a custom tag nobody expanded, and its
    // parameters and slotted markup each report a second, misleading error
    const errors = await refused(
      '<html><head><:define tag="my-box:div" ::open=${false} :if=${open} class="box">' +
        '<:slot /></:define></head><body>' +
        '<my-box ::open=${true} :for-each=${[1, 2]}><i>slotted</i></my-box>' +
        '</body></html>'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('is a second answer to the same question');
  });

  it('refuses a usage site renaming an item that is not its own', async () => {
    // it used to RENDER: the definition's body goes on reading `data`,
    // which after the rename resolved to something else entirely and was
    // written into the page as `true`
    const errors = await refused(
      '<html><head><:define tag="my-row:p" ::rows=${[]} :for-each=${rows}>${data}' +
        '</:define></head><body><my-row ::rows=${["a"]} :for-as="row" /></body></html>'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('<my-row> binds the item itself');
    expect(errors[0]).toContain(`":for-as" here renames the item the definition's body reads`);
  });

  it('refuses a usage site keying a replication it does not declare', async () => {
    // one message, where the key's own expression reading `data` at a site
    // that has no such name reported a second, unrelated-looking one
    const errors = await refused(
      '<html><head><:define tag="my-row:p" ::rows=${[]} :for-each=${rows}>${data.n}' +
        '</:define></head><body><my-row ::rows=${[{ id: 1, n: "a" }]} :for-key=${data.id} />' +
        '</body></html>'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('":for-key" here keys a replication the caller does not declare');
  });

  it('says the same about :for-as against a definition that binds one item', async () => {
    const errors = await refused(
      '<html><head><:define tag="my-b:p" ::of=${null} :for-data=${of}>${data}</:define>' +
        '</head><body><my-b ::of=${"x"} :for-as="it" /></body></html>'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('its definition carries ":for-data"');
  });

  it('leaves the modifiers alone where the loop IS the caller\'s', async () => {
    const { body } = await run(
      '<html :rows=${["a", "b"]}><head><:define tag="my-row:p"><:slot /></:define></head>' +
        '<body><my-row :for-each=${rows} :for-as="row">${row}</my-row></body></html>'
    );
    expect(body()).toBe('<p>a</p><p>b</p>');
  });

  it('refuses the branch spellings that are resolved by position', async () => {
    for (const attr of ['else', 'else-if']) {
      const errors = await refused(
        `<html><head><:define tag="my-box:div" :${attr}=\${true} class="box">x</:define>` +
          '</head><body><my-box /></body></html>'
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(`<:define> cannot carry ":${attr}"`);
      expect(errors[0]).toContain('resolved by position among siblings');
    }
  });

  it('refuses an arity on a definition whose instances have no element', async () => {
    const errors = await refused(
      '<html><head><:define tag="my-l:logic" ::v=${1} :if=${v} /></head>' +
        '<body><my-l /></body></html>'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('has no element, so ":if" has nothing to take away');
  });
});
