import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../src/compiler';
import type { ReadFile } from '../src/html/preprocessor';

/**
 * Where a page's text comes from is a parameter.
 *
 * It exists for the editor: a language server holds the buffer being typed
 * into, which is not what is on disk and is exactly the version whose
 * mistakes the author wants to hear about. Everything else -- the server,
 * `build` -- reads the disk, and that stays the default.
 *
 * What is checked here is that the hook reaches EVERY read and no more than
 * that: the page, the fragments it imports, and nothing about which paths a
 * page is allowed to reach in the first place. A reader is handed a path the
 * resolver already approved, so it cannot widen a docroot.
 */

let docroot: string;

const PAGE = '<html :greeting=${"on disk"}><body>${greeting}</body></html>';

beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-readfile-'));
  fs.writeFileSync(path.join(docroot, 'index.html'), PAGE);
  fs.writeFileSync(
    path.join(docroot, 'lib.htm'),
    '<lib><:define tag="x-thing:div">on disk</:define></lib>'
  );
});

afterAll(() => fs.rmSync(docroot, { recursive: true, force: true }));

describe('the default reader', () => {
  it('reads the disk', async () => {
    const page = await new Compiler({ docroot }).compile('/index.html');
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    expect(page.props!.exps).toContain('on disk');
  });

  it('reports a file that is not there', async () => {
    const page = await new Compiler({ docroot }).compile('/nope.html');
    expect(page.errors.map(e => e.msg)).toStrictEqual(['File not found "/nope.html"']);
  });
});

describe('a reader of the caller\'s own', () => {
  /** what an editor has: unsaved buffers, and the disk behind them */
  function overlay(open: { [absPath: string]: string }): ReadFile {
    return async filePath =>
      open[filePath] ?? (await fs.promises.readFile(filePath, 'utf8').catch(() => undefined));
  }

  it('compiles the buffer instead of the file', async () => {
    const readFile = overlay({
      [path.join(docroot, 'index.html')]:
        '<html :greeting=${"unsaved"}><body>${greeting}</body></html>',
    });
    const page = await new Compiler({ docroot, readFile }).compile('/index.html');
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    // the buffer's expression, not the file's
    expect(page.props!.exps).toContain('unsaved');
    expect(page.props!.exps).not.toContain('on disk');
  });

  it('reaches imported fragments too, not just the page', async () => {
    const readFile = overlay({
      [path.join(docroot, 'index.html')]:
        '<html><head><:import src="/lib.htm" /></head><body><x-thing /></body></html>',
      [path.join(docroot, 'lib.htm')]:
        '<lib><:define tag="x-thing:div">unsaved</:define></lib>',
    });
    const page = await new Compiler({ docroot, readFile }).compile('/index.html');
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    expect(page.source.doc.toString()).toContain('unsaved');
  });

  it('falls back to the disk for anything it does not hold', async () => {
    const readFile = overlay({
      [path.join(docroot, 'index.html')]:
        '<html><head><:import src="/lib.htm" /></head><body><x-thing /></body></html>',
    });
    const page = await new Compiler({ docroot, readFile }).compile('/index.html');
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    expect(page.source.doc.toString()).toContain('on disk');
  });

  it('reads as a missing file when it returns nothing', async () => {
    const readFile: ReadFile = async () => undefined;
    const page = await new Compiler({ docroot, readFile }).compile('/index.html');
    expect(page.errors.map(e => e.msg)).toStrictEqual(['File not found "/index.html"']);
  });

  it('is never asked for a path the resolver refused', async () => {
    const asked: string[] = [];
    const readFile: ReadFile = async filePath => {
      asked.push(filePath);
      return undefined;
    };
    const page = await new Compiler({ docroot, readFile }).compile('/../secret.html');
    expect(page.errors[0].msg).toMatch(/Forbidden/);
    expect(asked).toStrictEqual([]);
  });
});
