import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Compiler } from '../../src/compiler/index';
import { renderPage } from '../../src/server/render';

/**
 * An include is a splice, and a splice has to be invisible.
 *
 * Markup written in an included file must compile to what the same markup
 * written inline compiles to. It did not: the preprocessor spliced the
 * included nodes into the page by setting `parentElement` and pushing them
 * onto the new parent's `childNodes` by hand, without touching
 * `parentNode` -- which is the pointer the DOM's own insertBefore and
 * removeChild read.
 *
 * So every included node was listed by the page while still claiming the
 * fragment it came from as its parent, and anything that later tried to
 * REPLACE one worked on a document nobody serves. Custom-tag usages were
 * the visible casualty: stage1 removed the tag from the fragment and left
 * the copy in the page, so the usage rendered as an unknown element with a
 * scope and no instance behind it -- with nothing reported, which is what
 * makes this worth a test file of its own rather than a line in another.
 */

describe('an included file behaves like the same markup inline', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-include-'));
    fs.mkdirSync(path.join(dir, 'lib'));
    fs.writeFileSync(
      path.join(dir, 'lib/defs.htm'),
      '<lib><:define tag="my-src:span" :n=${1} :doubled=${n * 2} /></lib>'
    );
    fs.writeFileSync(
      path.join(dir, 'lib/logic-defs.htm'),
      '<lib><:define tag="my-logic:logic" :n=${1} :doubled=${n * 2} /></lib>'
    );
    fs.writeFileSync(
      path.join(dir, 'sources.htm'),
      '<lib><my-src :aka="a" :n=${21} /><my-src :aka="b" :n=${5} /></lib>'
    );
    fs.writeFileSync(
      path.join(dir, 'logic-sources.htm'),
      '<lib><my-logic :aka="a" :n=${21} /></lib>'
    );
  });

  afterAll(() => fs.existsSync(dir) && fs.rmSync(dir, { recursive: true }));

  async function compile(name: string, html: string) {
    fs.writeFileSync(path.join(dir, name), html);
    // a fresh compiler per page: `<:import>` is cached per instance, and
    // sharing one across cases quietly serves the first file's definitions
    // to every later one (which cost me an hour of chasing a bug that was
    // my own test harness)
    const page = await new Compiler({ docroot: dir }).compile(`/${name}`);
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    await renderPage(page);
    return page.source.doc.toString().replace(/<script[\s\S]*?<\/script>/g, '');
  }

  it('expands a custom-tag usage written in an included file', async () => {
    const html = await compile(
      'included.html',
      '<html><head><:import src="/lib/defs.htm" /></head><body>' +
        '<:include src="/sources.htm" />' +
        '<i>${a.doubled}/${b.doubled}</i></body></html>'
    );
    // the tag is gone, which is what "expanded" means
    expect(html).not.toContain('<my-src');
    // and the instances are real: these values come from the DEFINITION,
    // so they can only be here if the usage became one
    expect(html).toContain('42');
    expect(html).toContain('10');
  });

  it('gives the same result as writing it inline', async () => {
    const inline = await compile(
      'inline.html',
      '<html><head><:import src="/lib/defs.htm" /></head><body>' +
        '<my-src :aka="a" :n=${21} /><my-src :aka="b" :n=${5} />' +
        '<i>${a.doubled}/${b.doubled}</i></body></html>'
    );
    const included = await compile(
      'included2.html',
      '<html><head><:import src="/lib/defs.htm" /></head><body>' +
        '<:include src="/sources.htm" />' +
        '<i>${a.doubled}/${b.doubled}</i></body></html>'
    );
    const shape = (s: string) =>
      s.replace(/ data-markout="[^"]*"/g, '').replace(/s\d+/g, 'S').replace(/\s+/g, ' ');
    expect(shape(included)).toBe(shape(inline));
  });

  it('leaves nothing behind for an elementless definition', async () => {
    // what the whole `:logic` base tag is for: a page's datasources should
    // not be in its markup. They were, and this is the reason
    const html = await compile(
      'logic.html',
      '<html><head><:import src="/lib/logic-defs.htm" /></head><body>' +
        '<:include src="/logic-sources.htm" />' +
        '<i>${a.doubled}</i></body></html>'
    );
    expect(html).not.toContain('my-logic');
    expect(html).toContain('42');
  });
});
