import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { Compiler, STD_KIT_PACKAGE } from '../src/compiler';
import { discoverKits } from '../src/kits';

/**
 * The standard kit is in every page, and takes nothing away from one.
 *
 * `@markout-dev/std-kit` is the system parts of a page written with the
 * language rather than built into it, which makes it part of the language --
 * and a part of the language you have to import is ceremony HTML does not
 * ask for anywhere else. So a page gets it the way it gets `<video>`.
 *
 * What has to stay true for that to be a convenience rather than a trap is
 * the whole of this file: an author can always take the name back, saying it
 * out loud still works, and a project without the kit is untouched.
 */

const temps: string[] = [];
afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()!;
    fs.existsSync(dir) && fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** a docroot with the standard kit installed beside it, unless told otherwise */
function project(files: Record<string, string>, kit = true): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-std-'));
  temps.push(root);
  const docroot = path.join(root, 'site');
  fs.mkdirSync(docroot);
  if (kit) {
    const dir = path.join(root, 'node_modules', ...STD_KIT_PACKAGE.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: STD_KIT_PACKAGE, markout: { root: '/std-kit' } })
    );
    // the real kit's `std-data` is a `:logic` scope that renders nothing;
    // this one renders, so a test can see WHICH definition answered
    fs.writeFileSync(
      path.join(dir, 'all.htm'),
      '<lib><:define tag="std-data:div">from the kit</:define></lib>'
    );
  }
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(docroot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return docroot;
}

/** compile the way a host does: kits discovered, then handed to the compiler */
async function compile(docroot: string, pathname = '/index.html') {
  const kits = discoverKits(docroot).kits;
  return new Compiler({ docroot, kits }).compile(pathname);
}

describe('the standard kit', () => {
  it('is there without being imported', async () => {
    const docroot = project({
      'index.html': '<html><head></head><body><std-data /></body></html>',
    });
    const page = await compile(docroot);
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    expect([...page.customTags.keys()]).toContain('std-data');
    // and it is READ, which is what makes a change to it reach the page
    expect(page.source.files).toContain('/std-kit/all.htm');
  });

  it('lets a page take the name back', async () => {
    // the rule that makes this a convenience rather than a claim on the
    // namespace: an author's own definition is later in document order, and
    // customTags is filled in that order
    const docroot = project({
      'index.html':
        '<html><head><:define tag="std-data:section">mine</:define></head>' +
        '<body><std-data /></body></html>',
    });
    const page = await compile(docroot);
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    expect(page.customTags.get('std-data')?.e.tagName).toBe('SECTION');
  });

  it('still takes the import, and reads the kit once', async () => {
    // every page written before this, and every page that would rather say
    // it out loud: `<:import>` is once-only by path, so the second one is
    // skipped rather than defining everything twice
    const docroot = project({
      'index.html':
        '<html><head><:import src="/npm/@markout-dev/std-kit/all.htm" /></head>' +
        '<body><std-data /></body></html>',
    });
    const page = await compile(docroot);
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    expect(page.source.files.filter(f => f === '/std-kit/all.htm')).toHaveLength(1);
  });

  it('is absent from a project that has not got it', async () => {
    const docroot = project(
      { 'index.html': '<html><head></head><body><p>ordinary</p></body></html>' },
      false
    );
    const page = await compile(docroot);
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    expect(page.source.files).toStrictEqual(['/index.html']);
  });

  it('leaves no trace in a page that does not use it', async () => {
    // treeshaking already drops what nothing mentions, which is what makes
    // an implicit import cost nothing but the millisecond it takes to read
    const docroot = project({
      'index.html': '<html><head></head><body><p>ordinary</p></body></html>',
    });
    const page = await compile(docroot);
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    expect([...page.customTags.keys()]).toStrictEqual([]);
  });

  it('does not reach a fragment compiled on its own', async () => {
    // a fragment has no <head> to put an import in, and the page that
    // imports it has already got the kit
    const docroot = project({
      'lib.htm': '<lib><:define tag="x-card:div">card</:define></lib>',
      'index.html':
        '<html><head><:import src="/lib.htm" /></head><body><x-card /></body></html>',
    });
    const page = await compile(docroot);
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    expect(page.source.files.filter(f => f === '/std-kit/all.htm')).toHaveLength(1);
  });
});
