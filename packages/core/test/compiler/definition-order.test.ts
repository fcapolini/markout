import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/render/render';

/**
 * A definition that uses a definition declared after it. Issue #24.
 *
 * `<:define>` is order-independent at a usage site, and was not inside
 * another definition's body: an instance takes a COPY of its definition's
 * children when it is built, so a usage still sitting unexpanded in that
 * body arrived on the copy as the scope the loader built for it -- which is
 * spliced out of the tree when its own turn comes, leaving the copy pointing
 * at a scope that reaches no output. What the page served in its place was
 * the raw usage marker, with nothing reported at compile time or at render.
 *
 * Only the innermost level was lost, which is what made it read as a
 * three-deep problem rather than an ordering one.
 */
let docroot: string;
let seq = 0;

beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-deforder-'));
});
afterAll(() => fs.rmSync(docroot, { recursive: true, force: true }));

async function body(source: string) {
  const name = `d${seq++}.html`;
  fs.writeFileSync(path.join(docroot, name), source);
  const page = await new Compiler({ docroot }).compile(`/${name}`);
  expect(page.errors.map(e => e.msg)).toStrictEqual([]);
  expect(await renderPage(page)).toStrictEqual([]);
  const html = page.source.doc.toString();
  return html
    .slice(html.indexOf('<body'), html.indexOf('<script>window.'))
    .replace(/<!--.*?-->/g, '')
    .replace(/ data-markout="[^"]*"| class=""/g, '');
}

const OUTER = '<:define tag="c-outer:div"><c-mid/></:define>';
const MID = '<:define tag="c-mid:div"><c-leaf/></:define>';
const LEAF = '<:define tag="c-leaf:span">leaf</:define>';
const RENDERED = '<body><div><div><span>leaf</span></div></div>';

describe('definitions using one another', () => {
  it.each([
    ['declared outermost first', OUTER + MID + LEAF],
    ['declared leaf first', LEAF + MID + OUTER],
    ['declared middle first', MID + LEAF + OUTER],
    ['declared middle last', LEAF + OUTER + MID],
  ])('render the same however they are ordered: %s', async (_what, defs) => {
    expect(await body(`<html><head>${defs}</head><body><c-outer/></body></html>`)).toBe(
      RENDERED
    );
  });

  it('leaves no usage marker where the page renders', async () => {
    // the shape the failure took: a subtree replaced by `<!---usNN-->`, and
    // no error on either side to say a component had gone missing. The
    // markers in <head> are the definitions' own, which is where an
    // instance is stamped out from and where they belong
    expect(
      await body(`<html><head>${OUTER}${MID}${LEAF}</head><body><c-outer/></body></html>`)
    ).not.toMatch(/<!---us/);
  });

  it('carries a value down through all three', async () => {
    // the instances are real scopes rather than merely present markup
    const out = await body(
      '<html><head>' +
        '<:define tag="d-outer:div"><d-mid :n=${2}/></:define>' +
        '<:define tag="d-mid:div" :n=${0}><d-leaf :n=${n * 3}/></:define>' +
        '<:define tag="d-leaf:span" :n=${0}>${n}</:define>' +
        '</head><body><d-outer/></body></html>'
    );
    expect(out).toContain('>6<');
  });
});
