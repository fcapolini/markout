import path from 'path';
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/server/render';
import { openDatabase } from '../../examples/services/db';

/**
 * The services example, compiled and rendered exactly as its server does it.
 *
 * It is the only page in the repo that reads a host-supplied global, so it is
 * also the regression test for that seam -- and for the promise it makes in
 * its own README: the data is in the markup and the query is not.
 */

const DOCROOT = path.resolve(__dirname, '../../examples/services/public');

async function render() {
  const globals = { db: openDatabase() };
  const page = await new Compiler({
    docroot: DOCROOT,
    serverGlobals: Object.keys(globals),
  }).compile('/index.html');
  const errors = page.errors.map(e => e.msg);
  const runtime = errors.length
    ? []
    : (await renderPage(page, { globals })).map(e => `${e.phase}: ${e.message}`);
  const markup = page.source.doc.toString();
  // `live` is what a reader sees: dynamic text is delimited by comment
  // markers, so `Busiest: ${x}` is not contiguous in the raw markup
  return { page, errors, runtime, markup, live: markup.replace(/<!--[\s\S]*?-->/g, '') };
}

describe('examples/services', () => {
  it('compiles and renders with nothing reported', async () => {
    const r = await render();
    expect(r.errors).toStrictEqual([]);
    expect(r.runtime).toStrictEqual([]);
  });

  it('serves the database rows in the markup', async () => {
    const { markup } = await render();
    expect(markup).toContain('Aurora');
    expect(markup).toContain('Borealis');
    expect(markup).toContain('Draco');
  });

  it('resolves a chain where one query builds the next', async () => {
    // `busiest` has to land before `incidents` can be asked for at all, so
    // this page only renders if the settle loop follows the chain
    const { live } = await render();
    expect(live).toContain('Busiest: Borealis');
    expect(live).toContain('Latency above threshold');
  });

  it('sends none of the queries that produced it', async () => {
    const { markup } = await render();
    for (const trace of ['db.fleet', 'db.incidents', 'this.db', 'forNode', 'busiest()']) {
      expect(markup).not.toContain(trace);
    }
  });
});
