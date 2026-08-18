import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diagnose, folderOf, guessDocroot, pathnameOf } from '../src/diagnostics';

/**
 * What the editor will show, checked against the real compiler.
 *
 * The value of these is that they are not about the extension: they are
 * about whether the compiler's errors survive the trip into an editor's
 * coordinates intact. A message that arrives on the wrong line is worse than
 * no message, because it sends the author to the wrong place with
 * confidence.
 */

let docroot: string;

beforeEach(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-lsp-'));
});
afterEach(() => fs.rmSync(docroot, { recursive: true, force: true }));

function write(rel: string, text: string) {
  const full = path.join(docroot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

/**
 * Diagnose a file, reading its text off the disk.
 *
 * `diagnose` requires the text because that is what a compile is cached on,
 * and a caller that leaves it out gets somebody else's answer. These tests
 * are about files that were just written, so reading it back is the honest
 * short form -- the one case that is about an UNSAVED buffer passes its own.
 */
async function diagnoseFile(rel: string, open?: (p: string) => string | undefined) {
  return diagnose({
    docroot,
    pathname: `/${rel}`,
    text: fs.readFileSync(path.join(docroot, rel), 'utf8'),
    open,
  });
}

describe('a page with nothing wrong', () => {
  it('reports nothing', async () => {
    write('index.html', '<html :n=${21}><body>${n * 2}</body></html>');
    expect(await diagnoseFile('index.html')).toStrictEqual([]);
  });
});

describe('a page with a mistake', () => {
  it('names it, on the line it is on', async () => {
    write(
      'index.html',
      ['<html>', '  <body>', '    ${nope}', '  </body>', '</html>'].join('\n')
    );
    const [d, ...rest] = await diagnoseFile('index.html');
    expect(rest).toStrictEqual([]);
    expect(d.message).toMatch(/nope/);
    expect(d.severity).toBe('error');
    // line 3 of the file, which LSP counts as 2
    expect(d.range.start.line).toBe(2);
    // and a real range rather than a caret, so the squiggle covers the fault
    expect(d.range.end.character).toBeGreaterThan(d.range.start.character);
  });

  it('reports a file that is not there', async () => {
    write('index.html', '<html><head><:import src="/gone.htm" /></head></html>');
    const found = await diagnoseFile('index.html');
    expect(found.map(d => d.message)).toStrictEqual(['File not found "/gone.htm"']);
  });

  it('blames the fragment when the fault is in the fragment', async () => {
    write('index.html', '<html><head><:import src="/lib.htm" /></head><body><x-a /></body></html>');
    write('lib.htm', '<lib>\n  <:define tag="x-a:div">${missing}</:define>\n</lib>');
    const [d] = await diagnoseFile('index.html');
    expect(d.message).toMatch(/missing/);
    // the author has to be sent to the file that is actually wrong
    expect(d.pathname).toBe('/lib.htm');
    expect(d.range.start.line).toBe(1);
  });
});

describe('the buffer, not the file', () => {
  it('diagnoses what is being typed', async () => {
    const file = write('index.html', '<html :n=${21}><body>${n}</body></html>');
    const clean = await diagnoseFile('index.html');
    expect(clean).toStrictEqual([]);

    // the same file, with an unsaved mistake in it
    const typed = '<html :n=${21}><body>${typo}</body></html>';
    const found = await diagnose({
      docroot,
      pathname: '/index.html',
      text: typed,
      open: p => (p === file ? typed : undefined),
    });
    expect(found.map(d => d.message)).toHaveLength(1);
    expect(found[0].message).toMatch(/typo/);

    // and the file on disk is untouched, which is what "unsaved" means
    expect(fs.readFileSync(file, 'utf8')).toContain('${n}');
  });

  it('clears once the buffer is fixed, without a save', async () => {
    const file = write('index.html', '<html><body>${typo}</body></html>');
    expect(await diagnoseFile('index.html')).toHaveLength(1);
    const typed = '<html :n=${1}><body>${n}</body></html>';
    const fixed = await diagnose({
      docroot,
      pathname: '/index.html',
      text: typed,
      open: p => (p === file ? typed : undefined),
    });
    expect(fixed).toStrictEqual([]);
  });

  it('sees an unsaved fragment through the page that imports it', async () => {
    write('index.html', '<html><head><:import src="/lib.htm" /></head><body><x-a /></body></html>');
    const lib = write('lib.htm', '<lib><:define tag="x-a:div">fine</:define></lib>');
    const found = await diagnose({
      docroot,
      pathname: '/index.html',
      text: fs.readFileSync(path.join(docroot, 'index.html'), 'utf8'),
      open: p => (p === lib ? '<lib><:define tag="x-a:div">${broken}</:define></lib>' : undefined),
    });
    expect(found.map(d => d.message)).toHaveLength(1);
    expect(found[0].pathname).toBe('/lib.htm');
  });
});

describe('where a page is served from', () => {
  it('takes a directory named markout/ as the docroot', async () => {
    // the delivery mode with no install at all: a folder of pages and
    // `npx markout ./markout`. There is no package.json to be found, and
    // getting this wrong does not lose a feature -- it INVENTS an error,
    // because `/lib.htm` stops resolving to the file sitting next door
    write('markout/lib.htm', '<lib><:define tag="x-a:div">ok</:define></lib>');
    const page = write(
      'markout/index.html',
      '<html><head><:import src="/lib.htm" /></head><body><x-a /></body></html>'
    );
    const guessed = guessDocroot(page, docroot);
    expect(guessed).toBe(path.join(docroot, 'markout'));
    expect(pathnameOf(page, guessed)).toBe('/index.html');
    // and the proof that it matters: compiled against this docroot the page
    // is clean, and against the workspace folder it is not
    const pageText = fs.readFileSync(page, 'utf8');
    expect(
      await diagnose({ docroot: guessed, pathname: '/index.html', text: pageText })
    ).toStrictEqual([]);
    const wrong = await diagnoseFile('markout/index.html');
    expect(wrong.map(d => d.message)).toStrictEqual(['File not found "/lib.htm"']);
  });

  it('prefers the nearest of the two', () => {
    write('package.json', '{}');
    const page = write('markout/deep/x.html', '<html></html>');
    expect(guessDocroot(page, docroot)).toBe(path.join(docroot, 'markout'));
  });

  it('takes the nearest package.json as the docroot', () => {
    write('site/package.json', '{}');
    const page = write('site/demos/x.html', '<html></html>');
    expect(guessDocroot(page, docroot)).toBe(path.join(docroot, 'site'));
    expect(pathnameOf(page, guessDocroot(page, docroot))).toBe('/demos/x.html');
  });

  it('falls back to the workspace folder', () => {
    const page = write('loose/x.html', '<html></html>');
    expect(guessDocroot(page, docroot)).toBe(path.resolve(docroot));
    expect(pathnameOf(page, docroot)).toBe('/loose/x.html');
  });

  it('looks under the folder the file is in, out of several', () => {
    // a multi-root window is several projects at once, and the ceiling for
    // the guess is the one this file belongs to -- under the wrong folder
    // the walk goes nowhere near this page's package.json
    const a = write('a/package.json', '{}');
    const b = write('b/package.json', '{}');
    const page = write('b/deep/x.html', '<html></html>');
    const folders = [path.dirname(a), path.dirname(b)];
    expect(folderOf(page, folders)).toBe(path.join(docroot, 'b'));
    expect(guessDocroot(page, folderOf(page, folders))).toBe(path.join(docroot, 'b'));
  });

  it('prefers the innermost folder, and none at all for a file outside them', () => {
    // folders are allowed to nest, and an editor is allowed to open a file
    // that is in none of them
    const outer = write('w/package.json', '{}');
    const inner = write('w/nested/package.json', '{}');
    const page = write('w/nested/x.html', '<html></html>');
    const folders = [path.dirname(outer), path.dirname(inner)];
    expect(folderOf(page, folders)).toBe(path.join(docroot, 'w/nested'));
    expect(folderOf(write('elsewhere/x.html', '<html></html>'), folders)).toBeUndefined();
    expect(folderOf(page, [])).toBeUndefined();
  });
});
