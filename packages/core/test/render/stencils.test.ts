import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/render/render';

/**
 * What a served page carries of the markup it is not showing.
 *
 * A region's stencil holds that markup, out of the way in <head>, and the
 * page says where it goes with a marker comment. The rule this pins is that
 * the arrangement costs no bytes: whatever is standing in the page is not
 * ALSO in a stencil, and whatever is not standing in the page is in one --
 * see docs/design/stencil-placement.md.
 *
 * The last case is the one that bites: the compiled document is cached and
 * rendered once per request, so a stencil one response proved spent has to
 * be back for the next, whose data may hide the very region that was
 * showing.
 */
let docroot: string;
let seq = 0;
beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-stencils-'));
});
afterAll(() => fs.rmSync(docroot, { recursive: true, force: true }));

async function serve(page: string) {
  const name = `p${seq++}.html`;
  fs.writeFileSync(path.join(docroot, name), page);
  const compiled = await new Compiler({ docroot }).compile(`/${name}`);
  expect(compiled.errors.map(e => e.msg)).toStrictEqual([]);
  const errors = await renderPage(compiled);
  expect(errors).toStrictEqual([]);
  return { compiled, html: compiled.source.doc.toString() };
}

describe('what a rendered page carries', () => {
  it('drops the stencil of a region that is standing in the page', async () => {
    const { html } = await serve(
      '<html><head></head><body :on=${true}><p :if=${on}>shown</p></body></html>'
    );
    expect(html).toContain('>shown</p>');
    expect(html.match(/shown/g)).toHaveLength(1);
    expect(html).not.toContain('data-markout-stencil');
  });

  it('serves the markup once, in the stencil, for a region that is not', async () => {
    const { html } = await serve(
      '<html><head></head><body :on=${false}><p :if=${on}>hidden</p></body></html>'
    );
    expect(html.match(/hidden/g)).toHaveLength(1);
    expect(html).toContain('data-markout-stencil');
    expect(html.slice(html.indexOf('<body'))).not.toContain('<p');
  });

  it('keeps a replicated region\'s stencil, which every replica needs', async () => {
    const { html } = await serve(
      '<html><head></head><body><ul><li :for-each=${[1,2]}>${data}</li></ul></body></html>'
    );
    expect(html).toContain('data-markout-stencil');
    expect(html.match(/<li/g)).toHaveLength(3);
  });

  it('has the markup back for a request that hides what the last one showed', async () => {
    // the trap the whole restore step exists for, and the one a page served
    // twice with the same data cannot show: the first render proves a
    // stencil spent and drops it, and the second render's data hides the
    // very region that was standing there. `$origin` is the one input a
    // render takes that can differ between two renders of one compiled page
    const name = `p${seq++}.html`;
    fs.writeFileSync(
      path.join(docroot, name),
      '<html><head></head><body><p :if=${$origin.endsWith("one")}>maybe</p></body></html>'
    );
    const compiled = await new Compiler({ docroot }).compile(`/${name}`);
    expect(await renderPage(compiled, { origin: 'https://one' })).toStrictEqual([]);
    const shown = compiled.source.doc.toString();
    expect(shown).toContain('>maybe</p>');
    expect(shown).not.toContain('data-markout-stencil');

    expect(await renderPage(compiled, { origin: 'https://two' })).toStrictEqual([]);
    const hidden = compiled.source.doc.toString();
    // out of the page, and still on it: a response whose markup went
    // nowhere is a region the browser could never show
    expect(hidden.slice(hidden.indexOf('<body'))).not.toContain('<p');
    expect(hidden).toContain('data-markout-stencil');
    expect(hidden.match(/maybe/g)).toHaveLength(1);
  });

  it('renders the same bytes twice, whatever the first render dropped', async () => {
    const name = `p${seq++}.html`;
    fs.writeFileSync(
      path.join(docroot, name),
      '<html><head></head><body :on=${true}><p :if=${on}>a</p>' +
        '<b :if=${!on}>b</b></body></html>'
    );
    const compiled = await new Compiler({ docroot }).compile(`/${name}`);
    await renderPage(compiled);
    const first = compiled.source.doc.toString();
    await renderPage(compiled);
    expect(compiled.source.doc.toString()).toBe(first);
  });
});
