import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { Compiler } from '../../../src/compiler';
import { formatRuntimeError, LOCS_GLOBAL } from '../../../src/runtime/core/core-context';
import { renderPage } from '../../../src/render/render';
import { hydrate } from '../../../src/render/hydrate';

/**
 * A runtime failure names the line it was written on.
 *
 * "Mistakes caught before the page loads, with a file and a line" is the row
 * this project is sold on, and it used to hold exactly until the page
 * started running: after that a failure said `markout [update] s12.total`,
 * where `s12` is a scope uid and neither half is anything an author typed.
 * The claim expiring at the moment it matters most.
 *
 * Dev only, and the tests below are as much about that as about the
 * messages: a served page must not describe its own sources, which is
 * already why the production error page says less than the dev one.
 */

let docroot: string;
let seq = 0;

beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-locs-'));
});

afterAll(() => {
  fs.rmSync(docroot, { recursive: true, force: true });
});

async function compile(page: string, dev: boolean, files: Record<string, string> = {}) {
  for (const [file, code] of Object.entries(files)) {
    fs.writeFileSync(path.join(docroot, file), code);
  }
  const name = `e${seq++}.html`;
  fs.writeFileSync(path.join(docroot, name), page);
  // the pathname, as the compiler names it: a value's `loc.source` is
  // docroot-relative and leading-slashed, the same spelling a compile error
  // uses, so the two name a place identically
  return { compiled: await new Compiler({ docroot, dev }).compile(`/${name}`), name: `/${name}` };
}

describe('in dev mode', () => {
  it('names the file, the line and the column that failed', async () => {
    const { compiled, name } = await compile(
      '<html>\n<body :v=${null}>\n  <i>${v.missing}</i>\n</body>\n</html>',
      true
    );
    const errors = await renderPage(compiled);

    expect(errors).toHaveLength(1);
    // the line the interpolation is on, not the line the scope starts on
    expect(errors[0].loc).toBe(`${name}:3:6`);
    expect(formatRuntimeError(errors[0])).toBe(
      `markout [update] ${name}:3:6 (text$0): Cannot read properties of null (reading 'missing')`
    );
  });

  it('names the fragment a value came from, not the page using it', async () => {
    // the case where naming the file earns the most: a component's failure
    // is in the component's file, and the page that used it is innocent
    const { compiled } = await compile(
      '<html><head><:import src="/frag.htm" /></head><body><my-box /></body></html>',
      true,
      {
        'frag.htm': '<lib>\n<:define tag="my-box:div" :bad=${null}>${bad.nope}</:define>\n</lib>',
      }
    );
    const errors = await renderPage(compiled);

    expect(errors).toHaveLength(1);
    expect(errors[0].loc).toMatch(/^\/frag\.htm:2:/);
  });

  it('carries the map to the browser, and mounting reads it', async () => {
    const { compiled, name } = await compile(
      '<html>\n<body :v=${{ a: 1 }}>\n  <i>${v.a}</i>\n</body>\n</html>',
      true
    );
    expect(await renderPage(compiled)).toStrictEqual([]);

    // the served markup carries it, which is how a browser gets it
    expect(compiled.source.doc.toString()).toContain(LOCS_GLOBAL);

    const window = new Window();
    window.document.write(compiled.source.doc.toString());
    const p = hydrate(compiled, { doc: window.document as any });

    p.root.body.v = null;
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0].loc).toBe(`${name}:3:6`);
  });
});

describe('outside dev mode', () => {
  it('carries no map, and says what it always said', async () => {
    const { compiled } = await compile(
      '<html>\n<body :v=${null}>\n  <i>${v.missing}</i>\n</body>\n</html>',
      false
    );
    const errors = await renderPage(compiled);

    expect(errors).toHaveLength(1);
    expect(errors[0].loc).toBeUndefined();
    // the scope uid and the key, exactly as before: a page that is not being
    // developed neither pays for the map nor publishes its own file names
    expect(formatRuntimeError(errors[0])).toMatch(
      /^markout \[update\] s\d+\.text\$0: Cannot read properties of null/
    );
  });

  it('puts no source path anywhere in what it serves', async () => {
    // the assertion that gives "dev only" a reason to exist, and the one
    // worth having: not merely that the global is absent, but that the file
    // names are not in the bytes at all
    const { compiled } = await compile(
      '<html><head><:import src="/secret-frag.htm" /></head>' +
        '<body><my-thing /></body></html>',
      false,
      { 'secret-frag.htm': '<lib><:define tag="my-thing:div" :n=${1}>${n}</:define></lib>' }
    );
    await renderPage(compiled);

    const served = compiled.source.doc.toString();
    expect(served).not.toContain(LOCS_GLOBAL);
    expect(served).not.toContain('secret-frag.htm');
  });
});
