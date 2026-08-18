import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completionPathAt, findCompletions, repaired } from '../src/completions';

/**
 * What to offer where the cursor is.
 *
 * The list itself is the compiler's -- `visibleFrom` walks the chain that
 * decides what resolves -- so what is tested here is the two things around
 * it: that the right question is asked, and that there is anything to ask at
 * all. The second is the hard one. Completion happens WHILE TYPING, and
 * `${body.}` is a syntax error, and a syntax error leaves the compiler with
 * no page at all.
 */

let docroot: string;

beforeEach(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-complete-'));
});
afterEach(() => fs.rmSync(docroot, { recursive: true, force: true }));

function write(rel: string, text: string) {
  const full = path.join(docroot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

/** the names offered where `at` appears in the text, with the cursor after it */
async function offered(text: string, at: string) {
  const filePath = write('index.html', text);
  const offset = text.indexOf(at) + at.length;
  const found = await findCompletions({
    docroot,
    pathname: '/index.html',
    text,
    offset,
    filePath,
  });
  return found.map(c => c.name);
}

const PAGE = [
  '<html :appName=${1}>',
  '<body :items=${[1]} :tone=${2}>',
  '  <p>PLACEHOLDER</p>',
  '</body>',
  '</html>',
].join('\n');

describe('after a scope name and a dot', () => {
  it("offers that scope's values first", async () => {
    const names = await offered(PAGE.replace('PLACEHOLDER', '${body.}'), '<p>${body.');
    expect(names.slice(0, 2).sort()).toStrictEqual(['items', 'tone']);
  });

  it('offers what is further out too, because that is what resolves', async () => {
    // `body.appName` compiles: a navigated lookup keeps walking outward. A
    // list that hid those would be shorter than the truth
    const names = await offered(PAGE.replace('PLACEHOLDER', '${body.}'), '<p>${body.');
    expect(names).toContain('appName');
  });

  it('offers nothing for a scope that does not exist', async () => {
    expect(await offered(PAGE.replace('PLACEHOLDER', '${nope.}'), '<p>${nope.')).toStrictEqual([]);
  });
});

describe('a bare name', () => {
  it('offers everything in scope, values and scopes alike', async () => {
    // `<p>${` and not `${`: the page opens with `:appName=${1}`, and an
    // anchor that matches that puts the cursor four lines from the test
    const names = await offered(PAGE.replace('PLACEHOLDER', '${}'), '<p>${');
    expect(names).toContain('items');
    expect(names).toContain('appName');
    expect(names).toContain('body');
    expect(names).toContain('page');
  });

  it('offers the same list when a word has been started', async () => {
    // the editor filters by the word itself; offering only complete matches
    // would mean offering nothing as soon as anyone typed
    const names = await offered(PAGE.replace('PLACEHOLDER', '${ite}'), '<p>${ite');
    expect(names).toContain('items');
  });
});

describe('nothing to offer', () => {
  it('says nothing outside an expression', async () => {
    expect(await offered(PAGE.replace('PLACEHOLDER', 'plain text'), 'plain')).toStrictEqual([]);
  });

  it('says nothing after something that is not a chain of names', async () => {
    expect(completionPathAt('${rows[0].}', 10)).toBeUndefined();
  });
});

describe('the path under the cursor', () => {
  it('is the prefix, never the word being typed', () => {
    expect(completionPathAt('${body.it}', 9)).toStrictEqual(['body']);
    expect(completionPathAt('${body.}', 7)).toStrictEqual(['body']);
    expect(completionPathAt('${it}', 4)).toStrictEqual([]);
    expect(completionPathAt('${a.b.c}', 7)).toStrictEqual(['a', 'b']);
  });
});

describe('repairing the expression under the cursor', () => {
  it('makes it parseable without moving anything', () => {
    const text = '<p>${body.}</p>\n<p>after</p>';
    const fixed = repaired(text, text.indexOf('${body.') + 7);
    expect(fixed).toHaveLength(text.length);
    expect(fixed!.indexOf('<p>after</p>')).toBe(text.indexOf('<p>after</p>'));
    expect(fixed).toContain('${0    }');
  });

  it('handles one the author has not closed yet', () => {
    // there is no `}` at all while typing, and the expression ends wherever
    // they have got to
    const text = '<p>${body.\n<p>after</p>';
    const fixed = repaired(text, text.indexOf('${body.') + 7);
    expect(fixed).toHaveLength(text.length);
    expect(fixed!.split('\n')[1]).toBe('<p>after</p>');
  });

  it('leaves an expression the cursor is not in alone', () => {
    const text = '<p>${done}</p> here';
    expect(repaired(text, text.length - 1)).toBeUndefined();
  });

  it('still works when the page has other faults', async () => {
    // completion is wanted most in a file that is mid-edit, which is to say
    // one that does not compile
    const names = await offered(
      PAGE.replace('PLACEHOLDER', '${body.}').replace('</body>', '<p>${alsoBroken.}</p></body>'),
      '<p>${body.'
    );
    expect(names).toStrictEqual([]);
  });
});
