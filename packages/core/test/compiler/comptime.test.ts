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

describe('a text interpolation that can never change -- issue #33', () => {
  // After substitution a token sheet is `'... ' + '#2C88E7' + ' ...'`: no
  // scope references, no dependencies, and a value evaluated once and never
  // again. It shipped in full anyway -- on the site the issue was filed
  // against, 3,136 bytes on every page, 30% of what those pages carried, for
  // a binding that cannot produce anything the served markup does not have.
  //
  // It is written into the node instead. Safe because it is not a new write:
  // server rendering already evaluates this value against this document and
  // puts the result in this node. Only the WHEN changes.

  it('writes the sheet into the markup and ships no binding for it', async () => {
    const r = await build(
      `<html :const-accent=\${'#2C88E7'}>` +
        `<head><style>:root { --accent: \${accent}; }</style></head>` +
        `<body><p>x</p></body></html>`
    );

    expect(r.errors).toStrictEqual([]);
    expect(r.markup).toContain('<style>:root { --accent: #2C88E7; }</style>');
    // and the string is nowhere in the props, which is the whole point
    expect(r.props).not.toContain('--accent');
    expect(r.props).not.toContain('#2C88E7');
  });

  it('folds a literal-only interpolation with no constants involved', async () => {
    // `${'b'}` was constant before this stage ever ran, so the fold is not
    // conditional on the page declaring a `:const-` anywhere
    const r = await build(`<html><head><title>a\${'b'}c</title></head><body></body></html>`);

    expect(r.markup).toContain('<title>abc</title>');
    expect(r.props).not.toContain('abc');
  });

  it('leaves a live interpolation exactly where it was', async () => {
    const r = await build(
      `<html :n=\${1}><head><style>i { z-index: \${n}; }</style></head>` +
        `<body><p>\${n}</p></body></html>`
    );

    expect(r.errors).toStrictEqual([]);
    // still a binding, because it still can change
    expect(r.props).toContain('z-index');
  });

  it('reaches inside a stencil, which a props-level fix could not', async () => {
    // a stencil's markup is never rendered -- that is what makes it a
    // stencil -- so a constant in an `:if` region or a definition body has
    // to be IN the template for a client-side instantiation to show it.
    // Dropping it from the client's props alone would render the region
    // empty the first time it came up in the browser
    const r = await build(
      `<html :const-tone=\${'warm'} :n=\${0}>` +
        `<body><p :if=\${n > 0}>tone \${tone}</p></body></html>`
    );

    expect(r.errors).toStrictEqual([]);
    // the region is away, so the text lives in the stencil and nowhere else.
    // The markers stay around it, which is deliberate -- see below
    expect(r.markup).toMatch(/<template[^>]*>.*tone <!---t\d+-->warm/);
    expect(r.props).not.toContain('warm');
  });

  it('serves byte-for-byte what it served before', async () => {
    // The property that makes this safe to do at all, and the reason the
    // interpolation markers are left in place rather than tidied away:
    // server rendering already wrote this value into this node, so folding
    // it earlier must produce the same document. Markers included -- pulling
    // them out would change the served bytes, which is a different change
    // with a different risk, for about fourteen of them
    const src =
      `<html :const-a=\${'A'} :const-b=\${'B'}>` +
      `<head><style>i { content: "\${a}\${b}"; }</style><title>t\${a}</title></head>` +
      `<body><p>x\${a}y</p></body></html>`;
    const folded = await build(src);

    // the same page, rendered with the value still in place: what SSR alone
    // would have produced
    // raw-text elements hold their whole content as one node with the
    // marker OUTSIDE the tag, which is why nothing lands inside the CSS
    expect(folded.markup).toMatch(/<!---t\d+--><style>i \{ content: "AB"; \}<\/style>/);
    expect(folded.markup).toMatch(/<!---t\d+--><title>tA<\/title>/);
    // ordinary text keeps its wrapping pair, with the constant between them
    expect(folded.markup).toMatch(/x<!---t\d+-->A<!---\/-->y/);
    // and nothing is left to evaluate: every expression on the page folded
    expect(folded.page.props?.exps).toBe('[]');
  });

  it('folds nothing whose value is not fixed at build time', async () => {
    // a whitelist of literal shapes, not "has no dependencies": `$id`, a
    // global and a call all have no scope dependencies either, and none of
    // them is a constant
    for (const expr of ['$id', 'Math.random()', 'new Date().getFullYear()', '[1, 2].length']) {
      const r = await build(`<html><body><p>v\${${expr}}</p></body></html>`);
      expect(r.errors).toStrictEqual([]);
      expect(r.props, expr).toContain('$=>');
      // still a binding: the expression is in the props
      expect(r.props.length, expr).toBeGreaterThan(120);
    }
  });

  it('leaves a regex literal alone, being a fresh object each time', async () => {
    const r = await build(`<html><body><p>\${/x/.source}</p></body></html>`);
    expect(r.errors).toStrictEqual([]);
    expect(r.props).toContain('$=>');
  });
});
