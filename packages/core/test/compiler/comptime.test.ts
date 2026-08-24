import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/render/render';

/**
 * Stage 5 computes `:const-` values and writes them into their readers.
 *
 * A design token is a constant, and the point of the prefix is that it
 * costs like one: nothing of a `:const-` value reaches the runtime -- no scope
 * entry, no dependency closure, no cell that can never fire.
 *
 * What keeps it tractable is that a `:const-` value may read only literals and
 * other `:const-` values. Anything else is refused rather than quietly left
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
  return { page, errors, props: (page.props?.exps ?? '') + (page.props?.data ?? ''), markup: page.source.doc.toString() };
}

describe('stage5-comptime', () => {
  it('substitutes a constant into every reader', async () => {
    const r = await build(
      '<html :const-accent="#6f42c1"><body><i :n=${accent}>${accent}</i></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.markup).toContain('#6f42c1');
    // and nothing of it is left for the runtime
    expect(r.props).not.toContain('accent');
  });

  it('lets one constant read another', async () => {
    const r = await build(
      '<html :const-unit=${4} :const-gap=${unit * 2 + "px"}><body><i>${gap}</i></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.markup).toContain('8px');
    expect(r.props).not.toContain('gap');
  });

  it('reaches a constant declared further up the scope chain', async () => {
    const r = await build(
      '<html :const-pad="2rem"><body><div><i>${pad}</i></div></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.markup).toContain('2rem');
  });

  it('works in a stylesheet, which is the point of it', async () => {
    const r = await build(
      '<html :const-accent="#111"><head><style>:root { --a: ${accent} }</style></head>' +
        '<body>x</body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.markup).toContain('--a: #111');
    // a stylesheet is one binding, so a token in one made the whole sheet
    // reactive; now there is no binding at all
    expect(r.props).not.toContain('accent');
  });

  it('refuses one that reads an ordinary value', async () => {
    const r = await build('<html :n=${1} :const-x=${n + 1}><body>${x}</body></html>');
    expect(r.errors.join()).toMatch(/may only read literals and other ":const-" values.*"n"/);
  });

  it('refuses one that reads a runtime-supplied name', async () => {
    const r = await build('<html :const-x=${$id}><body>${x}</body></html>');
    expect(r.errors.join()).toMatch(/may only read literals and other ":const-" values/);
  });

  it('refuses a result that is not a primitive', async () => {
    // substituting an object would give every reader a separate copy, which
    // is a different program from the one that was written
    const r = await build('<html :const-x=${({ a: 1 })}><body>${x.a}</body></html>');
    expect(r.errors.join()).toMatch(/has to be a string, number, boolean, null or undefined/);
  });

  it('refuses being assigned to', async () => {
    // it is gone by the time the page runs, so there is nothing to assign
    // to -- and substitution rewrote the target along with every read,
    // turning `n = 5` into `2 = 5` and handing stage7 a function body
    // that is not JavaScript. `new Function` then threw while the page was
    // being built, taking the page with it, and nothing had said a word
    const r = await build(
      '<html><body :const-n=${2}><button :on-click=${() => n = 5}>b</button></body></html>'
    );
    expect(r.errors.join()).toMatch(/not there to be assigned to/);
  });
  it('refuses being incremented', async () => {
    const r = await build(
      '<html><body :const-n=${2}><button :on-click=${() => n++}>b</button></body></html>'
    );
    expect(r.errors.join()).toMatch(/not there to be assigned to/);
  });
  it('still lets an ordinary value be assigned to', async () => {
    const r = await build(
      '<html><body :n=${2}><button :on-click=${() => n = 5}>b</button></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
  });

  it('refuses every shape of write, not just `a = 1`', async () => {
    // `[a] = xs`, `({ v: a } = o)` and `for (a of xs)` all write to `a`
    // without `a` ever being the left of anything, so the target is walked
    // as a subtree rather than compared as a node
    for (const write of [
      '[a] = [1]',
      '({v: a} = {v: 1})',
      '({a} = {a: 1})',
      '[...a] = [1]',
      'for (a of [1]) {}',
    ]) {
      const r = await build(
        `<html :const-a=\${2}><body><button :on-click=\${() => { ${write}; }}>x</button></body></html>`
      );
      expect(r.errors.join(), write).toMatch(/not there to be assigned to/);
    }
  });

  it('refuses a cycle', async () => {
    const r = await build('<html :const-a=${b} :const-b=${a}><body>${a}</body></html>');
    expect(r.errors.join()).toMatch(/cycle of ":const-" values/);
  });

  it('refuses being both compile-time and server-only', async () => {
    const r = await build('<html :const-server-x=${1}><body>${x}</body></html>');
    expect(r.errors.join()).toMatch(/both compile-time and server-only/);
  });

  it('takes an override from the import site, which is how a kit is themed', async () => {
    fs.writeFileSync(
      path.join(docroot, 'lib.htm'),
      '<lib :const-radius="0.375rem"><:define tag="x-b:div" class="b" ' +
        'style="border-radius: ${radius}"><:slot /></:define></lib>'
    );
    const dflt = await build(
      '<html><head><:import src="/lib.htm" /></head><body><x-b>x</x-b></body></html>'
    );
    expect(dflt.errors).toStrictEqual([]);
    expect(dflt.markup).toContain('0.375rem');

    const themed = await build(
      '<html><head :const-radius="1rem"><:import src="/lib.htm" /></head>' +
        '<body><x-b>x</x-b></body></html>'
    );
    expect(themed.errors).toStrictEqual([]);
    expect(themed.markup).toContain('1rem');
    expect(themed.markup).not.toContain('0.375rem');
  });

  it('lets the import site make a kit\'s constant reactive instead', async () => {
    // the modifier is not part of what the value is CALLED, so the page can
    // declare the name plainly and the kit goes on reading `${radius}` -- a
    // token fixed at build time for every page but the one that needs to
    // change it while running, which pays for a binding only where it asked
    fs.writeFileSync(
      path.join(docroot, 'lib2.htm'),
      '<lib :const-radius="0.375rem"><:define tag="x-c:div" class="c" ' +
        'style="border-radius: ${radius}"><:slot /></:define></lib>'
    );
    const live = await build(
      '<html><head :radius=${"2rem"}><:import src="/lib2.htm" /></head>' +
        '<body><x-c>x</x-c></body></html>'
    );
    expect(live.errors).toStrictEqual([]);
    expect(live.markup).toContain('2rem');
    expect(live.markup).not.toContain('0.375rem');
    // and this one IS a runtime value, unlike every other case in this file
    expect(live.props).toContain('radius');
  });
});
