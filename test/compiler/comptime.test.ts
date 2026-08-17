import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/server/render';

/**
 * Stage 5 computes `::` values and writes them into their readers.
 *
 * A design token is a constant, and the point of the prefix is that it
 * costs like one: nothing of a `::` value reaches the runtime -- no scope
 * entry, no dependency closure, no cell that can never fire.
 *
 * What keeps it tractable is that a `::` value may read only literals and
 * other `::` values. Anything else is refused rather than quietly left
 * reactive, since falling back would hand the page exactly the cost the
 * marker was meant to avoid, with nothing said.
 */
let docroot: string;
let seq = 0;

beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-k-'));
});
afterAll(() => fs.rmSync(docroot, { recursive: true, force: true }));

async function build(html: string) {
  const name = `p${seq++}.html`;
  fs.writeFileSync(path.join(docroot, name), html);
  const page = await new Compiler({ docroot }).compile(`/${name}`);
  const errors = page.errors.map(e => e.msg);
  if (!errors.length) await renderPage(page);
  return { page, errors, props: page.propsString ?? '', markup: page.source.doc.toString() };
}

describe('stage5-comptime', () => {
  it('substitutes a constant into every reader', async () => {
    const r = await build(
      '<html ::accent="#6f42c1"><body><i :n=${accent}>${accent}</i></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.markup).toContain('#6f42c1');
    // and nothing of it is left for the runtime
    expect(r.props).not.toContain('accent');
  });

  it('lets one constant read another', async () => {
    const r = await build(
      '<html ::unit=${4} ::gap=${unit * 2 + "px"}><body><i>${gap}</i></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.markup).toContain('8px');
    expect(r.props).not.toContain('gap');
  });

  it('reaches a constant declared further up the scope chain', async () => {
    const r = await build(
      '<html ::pad="2rem"><body><div><i>${pad}</i></div></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.markup).toContain('2rem');
  });

  it('works in a stylesheet, which is the point of it', async () => {
    const r = await build(
      '<html ::accent="#111"><head><style>:root { --a: ${accent} }</style></head>' +
        '<body>x</body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.markup).toContain('--a: #111');
    // a stylesheet is one binding, so a token in one made the whole sheet
    // reactive; now there is no binding at all
    expect(r.props).not.toContain('accent');
  });

  it('refuses one that reads an ordinary value', async () => {
    const r = await build('<html :n=${1} ::x=${n + 1}><body>${x}</body></html>');
    expect(r.errors.join()).toMatch(/may only read literals and other "::" values.*"n"/);
  });

  it('refuses one that reads a runtime-supplied name', async () => {
    const r = await build('<html ::x=${$id}><body>${x}</body></html>');
    expect(r.errors.join()).toMatch(/may only read literals and other "::" values/);
  });

  it('refuses a result that is not a primitive', async () => {
    // substituting an object would give every reader a separate copy, which
    // is a different program from the one that was written
    const r = await build('<html ::x=${({ a: 1 })}><body>${x.a}</body></html>');
    expect(r.errors.join()).toMatch(/has to be a string, number, boolean, null or undefined/);
  });

  it('refuses being assigned to', async () => {
    // it is gone by the time the page runs, so there is nothing to assign
    // to -- and substitution rewrote the target along with every read,
    // turning `n = 5` into `2 = 5` and handing stage7 a function body
    // that is not JavaScript. `new Function` then threw while the page was
    // being built, taking the page with it, and nothing had said a word
    const r = await build(
      '<html><body ::n=${2}><button :on-click=${() => n = 5}>b</button></body></html>'
    );
    expect(r.errors.join()).toMatch(/not there to be assigned to/);
  });
  it('refuses being incremented', async () => {
    const r = await build(
      '<html><body ::n=${2}><button :on-click=${() => n++}>b</button></body></html>'
    );
    expect(r.errors.join()).toMatch(/not there to be assigned to/);
  });
  it('still lets an ordinary value be assigned to', async () => {
    const r = await build(
      '<html><body :n=${2}><button :on-click=${() => n = 5}>b</button></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
  });

  it('refuses a cycle', async () => {
    const r = await build('<html ::a=${b} ::b=${a}><body>${a}</body></html>');
    expect(r.errors.join()).toMatch(/cycle of "::" values/);
  });

  it('refuses being both compile-time and server-only', async () => {
    const r = await build('<html ::server-x=${1}><body>${x}</body></html>');
    expect(r.errors.join()).toMatch(/both compile-time and server-only/);
  });

  it('takes an override from the import site, which is how a kit is themed', async () => {
    fs.writeFileSync(
      path.join(docroot, 'lib.htm'),
      '<lib ::radius="0.375rem"><:define tag="x-b:div" class="b" ' +
        'style="border-radius: ${radius}"><:slot /></:define></lib>'
    );
    const dflt = await build(
      '<html><head><:import src="/lib.htm" /></head><body><x-b>x</x-b></body></html>'
    );
    expect(dflt.errors).toStrictEqual([]);
    expect(dflt.markup).toContain('0.375rem');

    const themed = await build(
      '<html><head ::radius="1rem"><:import src="/lib.htm" /></head>' +
        '<body><x-b>x</x-b></body></html>'
    );
    expect(themed.errors).toStrictEqual([]);
    expect(themed.markup).toContain('1rem');
    expect(themed.markup).not.toContain('0.375rem');
  });
});
