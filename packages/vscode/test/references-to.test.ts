import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findReferences } from '../src/references-to';
import { forgetPages } from '../src/pages';

/**
 * Everywhere a value or a scope is read.
 *
 * The reason this cannot be a text search is the reason go-to-definition
 * could not be one: a name belongs to a scope. Two `title`s in two
 * definitions are different things, and `body.items` two files away is the
 * same thing spelled differently -- so each candidate is resolved the way
 * the compiler resolves it, and kept only if it lands on what was asked
 * about.
 */

let docroot: string;

beforeEach(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-refs-'));
  forgetPages();
});
afterEach(() => fs.rmSync(docroot, { recursive: true, force: true }));

function write(rel: string, text: string) {
  const full = path.join(docroot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return text;
}

/** the sites found from the cursor at `at`, as `line:character` */
async function sitesFrom(rel: string, text: string, at: string, within?: string) {
  let offset = text.indexOf(at);
  if (within) {
    offset = text.indexOf(within, offset);
  }
  while (offset < text.length && !/[A-Za-z_]/.test(text[offset])) offset++;
  const found = await findReferences({
    docroot,
    pathname: `/${rel}`,
    text,
    offset: offset + 1,
  });
  return found.map(s => `${s.pathname}:${s.range.start.line + 1}`);
}

const PAGE = [
  '<html :appName=${1}>',
  '<body :items=${[1]}>',
  '  <p>${appName}</p>',
  '  <ul>',
  '    <li :for-each=${body.items} :for-as="item">${item}</li>',
  '  </ul>',
  '  <p>${appName}</p>',
  '</body>',
  '</html>',
].join('\n');

describe('a value', () => {
  it('is found from its declaration, and from a use of it', async () => {
    const text = write('index.html', PAGE);
    // three sites: the declaration and the two reads
    expect(await sitesFrom('index.html', text, ':appName=')).toHaveLength(3);
    expect(await sitesFrom('index.html', text, '${appName}')).toHaveLength(3);
  });

  it('is found through a scope it is read across', async () => {
    // `body.items` is a navigation, and the reference is written with a dot
    // in front of it -- which a word search that excluded one would miss
    const text = write('index.html', PAGE);
    expect(await sitesFrom('index.html', text, ':items=')).toStrictEqual([
      '/index.html:2',
      '/index.html:5',
    ]);
  });
});

describe('a scope', () => {
  it('is found by name, separately from what is inside it', async () => {
    const text = write('index.html', PAGE);
    // `body` in `body.items` reads the scope; `items` reads the value
    expect(await sitesFrom('index.html', text, '${body.items}')).toStrictEqual([
      '/index.html:2',
      '/index.html:5',
    ]);
  });
});

describe('what a text search would get wrong', () => {
  it('does not match a name inside a longer one', async () => {
    // `item` is not `items`, and both are on the same line
    const text = write('index.html', PAGE);
    const found = await findReferences({
      docroot,
      pathname: '/index.html',
      text,
      offset: text.indexOf('${item}') + 3,
    });
    // the `:for-as` that declares it and the `${item}` that reads it -- and
    // not the `items` six characters earlier
    expect(found).toHaveLength(2);
    for (const site of found) {
      expect(site.range.end.character - site.range.start.character).toBeLessThan(20);
    }
  });

  it('keeps two same-named values in two definitions apart', async () => {
    write(
      'lib.htm',
      [
        '<lib>',
        '  <:define tag="x-a:div" ::title=${1}>${title}</:define>',
        '  <:define tag="x-b:div" ::title=${2}>${title} ${title}</:define>',
        '</lib>',
      ].join('\n')
    );
    const text = fs.readFileSync(path.join(docroot, 'lib.htm'), 'utf8');
    // x-a: its own declaration and its one read
    expect(await sitesFrom('lib.htm', text, ':title=${1}')).toHaveLength(2);
    // x-b: its declaration and two reads -- five `title`s in the file, and
    // the answer depends entirely on which definition the cursor is in
    expect(await sitesFrom('lib.htm', text, ':title=${2}')).toHaveLength(3);
  });
});

describe('across files', () => {
  it('finds a definition parameter read inside its own fragment', async () => {
    write(
      'lib.htm',
      '<lib>\n  <:define tag="x-a:div" ::title=${1}>\n    <h2>${title}</h2>\n  </:define>\n</lib>'
    );
    const text = fs.readFileSync(path.join(docroot, 'lib.htm'), 'utf8');
    const found = await sitesFrom('lib.htm', text, '${title}');
    expect(found).toStrictEqual(['/lib.htm:2', '/lib.htm:3']);
  });
});

describe('the declaration itself', () => {
  it('is left out when the editor says it does not want it', async () => {
    const text = write('index.html', PAGE);
    const withIt = await findReferences({
      docroot,
      pathname: '/index.html',
      text,
      offset: text.indexOf('${appName}') + 3,
    });
    const without = await findReferences({
      docroot,
      pathname: '/index.html',
      text,
      offset: text.indexOf('${appName}') + 3,
      includeDeclaration: false,
    });
    expect(without).toHaveLength(withIt.length - 1);
  });
});
