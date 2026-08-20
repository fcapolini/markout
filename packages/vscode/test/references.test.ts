import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileReferenceAt, findFileReferences } from '../src/references';
import { resolveReference } from '../src/diagnostics';

/**
 * Which quoted strings in a page name a file the editor can open.
 *
 * The offsets are the point: they are what gets underlined and what gets
 * clicked, so a reference that is found but mislocated sends the author to a
 * file from the middle of a word they did not click on.
 */

function values(source: string): string[] {
  return findFileReferences(source).map(r => r.value);
}

describe('what counts as a file reference', () => {
  it('finds an import and an include', () => {
    expect(
      values('<:import src="/lib.htm" /><:include src="parts/x.htm" />')
    ).toStrictEqual(['/lib.htm', 'parts/x.htm']);
  });

  it('finds one with other attributes around it', () => {
    expect(values('<:include as="div" src="/a.htm" data-x="1" />')).toStrictEqual(['/a.htm']);
  });

  it('takes single quotes too', () => {
    expect(values("<:import src='/lib.htm' />")).toStrictEqual(['/lib.htm']);
  });

  it('finds a package import, which is the one worth following', () => {
    expect(values('<:import src="/npm/@markout-lang/bootstrap-kit/all.htm" />')).toStrictEqual([
      '/npm/@markout-lang/bootstrap-kit/all.htm',
    ]);
  });

  it('ignores src attributes that name a URL rather than a file', () => {
    // the browser fetches these; where they live on disk depends on how the
    // site is deployed, which an editor does not know
    expect(values('<script src="/app.js"></script><img src="/logo.png">')).toStrictEqual([]);
    expect(values('<link rel="stylesheet" href="/app.css">')).toStrictEqual([]);
  });

  it('ignores a directive with no src', () => {
    expect(values('<:define tag="x-a:div">a</:define>')).toStrictEqual([]);
  });
});

describe('where it says the reference is', () => {
  const source = '<html>\n  <:import src="/lib.htm" />\n</html>';

  it('points at the path and not at the quotes or the tag', () => {
    const [ref] = findFileReferences(source);
    expect(source.slice(ref.start, ref.end)).toBe('/lib.htm');
    expect(source[ref.start - 1]).toBe('"');
    expect(source[ref.end]).toBe('"');
  });

  it('answers for an offset inside the path', () => {
    const [ref] = findFileReferences(source);
    expect(fileReferenceAt(source, ref.start)?.value).toBe('/lib.htm');
    expect(fileReferenceAt(source, ref.start + 3)?.value).toBe('/lib.htm');
    expect(fileReferenceAt(source, ref.end)?.value).toBe('/lib.htm');
  });

  it('answers for nothing outside it', () => {
    const [ref] = findFileReferences(source);
    expect(fileReferenceAt(source, ref.start - 2)).toBeUndefined();
    expect(fileReferenceAt(source, ref.end + 2)).toBeUndefined();
    expect(fileReferenceAt(source, 0)).toBeUndefined();
  });

  it('keeps them apart when a page has several', () => {
    const many = '<:import src="/a.htm" /><:import src="/b.htm" />';
    const [a, b] = findFileReferences(many);
    expect(fileReferenceAt(many, a.start + 1)?.value).toBe('/a.htm');
    expect(fileReferenceAt(many, b.start + 1)?.value).toBe('/b.htm');
  });
});


describe('following one to a file', () => {
  let docroot: string;

  beforeEach(() => {
    docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-refs-'));
  });
  afterEach(() => fs.rmSync(docroot, { recursive: true, force: true }));

  function write(rel: string, text = '<lib></lib>') {
    const full = path.join(docroot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    return full;
  }

  it('resolves an absolute path against the DOCROOT, not the file', () => {
    // the reason this is worth offering at all: `/lib.htm` in a page three
    // directories down does not mean the file next to it, and an editor
    // guessing from the filesystem would open the wrong one or nothing
    const target = write('lib.htm');
    write('deep/pages/x.html');
    expect(
      resolveReference({ docroot, fromPathname: '/deep/pages/x.html', spec: '/lib.htm' })
    ).toBe(target);
  });

  it('resolves a relative path against the file that wrote it', () => {
    const target = write('deep/pages/parts/card.htm');
    expect(
      resolveReference({ docroot, fromPathname: '/deep/pages/x.html', spec: 'parts/card.htm' })
    ).toBe(target);
  });

  it('follows a package import into the installed package', () => {
    // `/npm/@markout-lang/bootstrap-kit/all.htm` is inside node_modules, which is
    // nowhere an editor would look. The compiler's resolver knows because it
    // is the same call the compiler makes when it reads the file
    const target = write('node_modules/@markout-lang/bootstrap-kit/all.htm');
    write(
      'node_modules/@markout-lang/bootstrap-kit/package.json',
      JSON.stringify({ name: '@markout-lang/bootstrap-kit', markout: { root: '/bootstrap-kit' } })
    );
    expect(
      resolveReference({
        docroot,
        fromPathname: '/index.html',
        spec: '/npm/@markout-lang/bootstrap-kit/all.htm',
      })
    ).toBe(target);
  });

  it('refuses a path that leaves the docroot', () => {
    // the compiler reports this as an error; opening something plausible
    // instead would hide the fact that the page cannot reach it
    expect(
      resolveReference({ docroot, fromPathname: '/index.html', spec: '/../secret.htm' })
    ).toBeUndefined();
  });
});
