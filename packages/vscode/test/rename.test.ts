import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diagnose } from '../src/diagnostics';
import { forgetPages } from '../src/pages';
import { prepareRename, renameEdits } from '../src/rename';

/**
 * Renaming, which is the one feature here that can break a project.
 *
 * Everything else answers a question; this changes files, including files
 * nobody has open. So the two ways it can be half done are what these are
 * about: a page it never looked at, and a usage site that PASSES the name
 * without reading it.
 */

let docroot: string;

beforeEach(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-rename-'));
  forgetPages();
});
afterEach(() => fs.rmSync(docroot, { recursive: true, force: true }));

function write(rel: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(docroot, rel)), { recursive: true });
  fs.writeFileSync(path.join(docroot, rel), text);
  return text;
}

/** the rename that clicking `at` in `rel` would produce, as file:line:col */
async function edits(rel: string, at: string, within?: string) {
  const text = fs.readFileSync(path.join(docroot, rel), 'utf8');
  let offset = text.indexOf(at);
  if (within) {
    offset = text.indexOf(within, offset);
  }
  while (offset < text.length && !/[A-Za-z_]/.test(text[offset])) offset++;
  const found = await renameEdits({
    docroot,
    pathname: `/${rel}`,
    text,
    offset: offset + 1,
  });
  return found
    .map(e => `${e.pathname}:${e.range.start.line + 1}:${e.range.start.character + 1}`)
    .sort();
}

const LIB = [
  '<lib>',
  '  <:define tag="x-card:div" :title=${\'d\'}>',
  '    <h2>${title}</h2>',
  '  </:define>',
  '</lib>',
].join('\n');

describe('a definition parameter', () => {
  beforeEach(() => {
    write('lib.htm', LIB);
    write(
      'a.html',
      '<html><head><:import src="/lib.htm" /></head>\n<body><x-card :title=${\'A\'} /></body></html>'
    );
    write(
      'b.html',
      '<html><head><:import src="/lib.htm" /></head>\n<body><x-card :title=${\'B\'} /></body></html>'
    );
  });

  it('reaches the pages that pass it, not just the one in front of you', async () => {
    // the whole difficulty: a usage site DECLARES a value the definition
    // then reads, so it is not a reference and find-references is right not
    // to return it -- but it carries the name, and a rename that left it
    // alone would stop the parameter being passed, silently, in a file
    // nobody had open
    expect(await edits('lib.htm', ':title=')).toStrictEqual([
      '/a.html:2:16',
      '/b.html:2:16',
      '/lib.htm:2:30',
      '/lib.htm:3:11',
    ]);
  });

  it('finds the same set from a usage site as from the declaration', async () => {
    // it is one name; where the cursor happens to be cannot change what is
    // renamed, or two people renaming the same thing get different projects
    expect(await edits('a.html', ':title=')).toStrictEqual(await edits('lib.htm', ':title='));
  });

  it('finds the same set from a read inside the definition', async () => {
    expect(await edits('lib.htm', '${title}')).toStrictEqual(await edits('lib.htm', ':title='));
  });
});

describe('an ordinary value', () => {
  it('is renamed where it is declared and everywhere it is read', async () => {
    write(
      'index.html',
      [
        '<html :appName=${1}>',
        '<body>',
        '  <p>${appName}</p>',
        '  <p>${appName} again</p>',
        '</body>',
        '</html>',
      ].join('\n')
    );
    expect(await edits('index.html', ':appName=')).toStrictEqual([
      '/index.html:1:8',
      '/index.html:3:8',
      '/index.html:4:8',
    ]);
  });

  it('leaves a same-named value in another scope alone', async () => {
    write(
      'lib.htm',
      [
        '<lib>',
        '  <:define tag="x-a:div" :title=${1}>${title}</:define>',
        '  <:define tag="x-b:div" :title=${2}>${title}</:define>',
        '</lib>',
      ].join('\n')
    );
    const found = await edits('lib.htm', ':title=${1}');
    expect(found).toHaveLength(2);
    expect(found.every(e => e.startsWith('/lib.htm:2:'))).toBe(true);
  });
});

describe('applying it', () => {
  /**
   * The test that earns its keep: perform the rename, write the files, and
   * compile them again.
   *
   * Every other test here asserts a set of positions, which is a claim about
   * what was found. This one asserts the only thing that matters -- that the
   * project still works afterwards -- and it is what caught a read through
   * an instance, `intro.title`, that resolves to the value the USAGE
   * declared rather than to the parameter. Four sites were being renamed and
   * the fifth left behind, which no count of edits would have shown.
   */
  it('leaves every page compiling', async () => {
    write('lib.htm', LIB);
    write(
      'a.html',
      [
        '<html><head><:import src="/lib.htm" /></head>',
        '<body>',
        '  <x-card :title=${\'A\'} :aka="intro" />',
        '  <p>${intro.title}</p>',
        '</body></html>',
      ].join('\n')
    );

    const lib = fs.readFileSync(path.join(docroot, 'lib.htm'), 'utf8');
    const found = await renameEdits({
      docroot,
      pathname: '/lib.htm',
      text: lib,
      offset: lib.indexOf(':title=') + 2,
    });

    const byFile: Record<string, typeof found> = {};
    for (const edit of found) {
      (byFile[edit.pathname] ??= []).push(edit);
    }
    for (const [pathname, edits] of Object.entries(byFile)) {
      const file = path.join(docroot, pathname);
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      // last first, so the earlier offsets are still true when they are used
      edits
        .sort(
          (a, b) =>
            b.range.start.line - a.range.start.line ||
            b.range.start.character - a.range.start.character
        )
        .forEach(({ range }) => {
          const line = lines[range.start.line];
          lines[range.start.line] =
            line.slice(0, range.start.character) + 'heading' + line.slice(range.end.character);
        });
      fs.writeFileSync(file, lines.join('\n'));
    }

    forgetPages();
    for (const rel of ['lib.htm', 'a.html']) {
      const text = fs.readFileSync(path.join(docroot, rel), 'utf8');
      const problems = await diagnose({ docroot, pathname: `/${rel}`, text });
      expect(problems.map(p => p.message), `${rel} after the rename`).toStrictEqual([]);
    }
    // and the old name is genuinely gone from the markup
    expect(fs.readFileSync(path.join(docroot, 'a.html'), 'utf8')).not.toContain('title');
  });
});

describe('what it refuses', () => {
  it('offers no rename for a word that names nothing', async () => {
    const text = write('index.html', '<html :n=${1}>\n  <p class="thing">${n}</p>\n</html>');
    const found = await prepareRename({
      docroot,
      pathname: '/index.html',
      text,
      offset: text.indexOf('thing') + 1,
    });
    expect(found).toBeUndefined();
  });

  it('offers the word itself where there is one', async () => {
    const text = write('index.html', '<html :n=${1}>\n  <p>${n}</p>\n</html>');
    const found = await prepareRename({
      docroot,
      pathname: '/index.html',
      text,
      offset: text.indexOf('${n}') + 2,
    });
    expect(found?.name).toBe('n');
    expect(found?.range).toStrictEqual({
      start: { line: 1, character: 7 },
      end: { line: 1, character: 8 },
    });
  });
});
