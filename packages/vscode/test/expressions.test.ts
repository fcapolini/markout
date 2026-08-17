import { describe, expect, it } from 'vitest';
import { findExpressions } from '../src/expressions';

/**
 * Where each `${…}` starts and ends.
 *
 * Every case here is a way that scanning forward to the first `}` gets the
 * wrong answer, which matters because the end of an expression is where the
 * editor stops treating text as JavaScript. Too short and the rest of the
 * expression is highlighted as markup; too long and the markup after it is
 * handed to a JavaScript service.
 */

/** the expressions found, as the source text of each */
function texts(source: string): string[] {
  return findExpressions(source).map(e => e.text);
}

describe('finding expressions', () => {
  it('finds one in text and one in an attribute', () => {
    expect(texts('<div :n=${1 + 1}>${n}</div>')).toStrictEqual(['1 + 1', 'n']);
  });

  it('reports offsets that slice back to the same text', () => {
    const source = '<p>${a}</p>${b}';
    for (const e of findExpressions(source)) {
      expect(source.slice(e.contentStart, e.contentEnd)).toBe(e.text);
      expect(source.slice(e.start, e.end)).toBe('${' + e.text + '}');
    }
  });

  it('finds none where there are none', () => {
    expect(texts('<div class="a">plain</div>')).toStrictEqual([]);
  });

  it('ignores one the source escaped', () => {
    expect(texts('<p>\\${not an expression}</p>')).toStrictEqual([]);
  });
});

describe('where a naive scan would stop too early', () => {
  it('an object literal', () => {
    expect(texts('<x :o=${{ a: 1, b: { c: 2 } }} />')).toStrictEqual(['{ a: 1, b: { c: 2 } }']);
  });

  it('a brace inside a string', () => {
    expect(texts("<p>${'}'}</p>")).toStrictEqual(["'}'"]);
    expect(texts('<p>${"a } b"}</p>')).toStrictEqual(['"a } b"']);
  });

  it('an escaped quote inside a string', () => {
    expect(texts("<p>${'it\\'s } fine'}</p>")).toStrictEqual(["'it\\'s } fine'"]);
  });

  it('a template literal, and one nested inside it', () => {
    expect(texts('<p>${`a ${b} c`}</p>')).toStrictEqual(['`a ${b} c`']);
    expect(texts("<p>${`${x ? '}' : ''}`}</p>")).toStrictEqual(["`${x ? '}' : ''}`"]);
  });

  it('a brace inside a comment', () => {
    expect(texts('<x :v=${1 /* } */ + 2} />')).toStrictEqual(['1 /* } */ + 2']);
    expect(texts('<x :v=${[\n  1, // }\n  2,\n]} />')).toStrictEqual(['[\n  1, // }\n  2,\n]']);
  });

  it('an arrow function body, which is where this bites in practice', () => {
    const source = '<x :handle-open=${(v) => { if (v) { show(); } else { hide(); } }} />';
    expect(texts(source)).toStrictEqual(['(v) => { if (v) { show(); } else { hide(); } }']);
  });
});

describe('what it refuses to guess', () => {
  it('stops at an unterminated expression rather than inventing an end', () => {
    // the compiler reports this; a scanner picking an arbitrary `}` later in
    // the file would put the squiggle somewhere the author never typed
    expect(texts('<p>${a</p>')).toStrictEqual([]);
  });

  it('keeps the expressions before it', () => {
    expect(texts('<p>${ok}</p><p>${broken')).toStrictEqual(['ok']);
  });

  it('stops at an unterminated string inside one', () => {
    expect(texts("<p>${'oops}</p>")).toStrictEqual([]);
  });
});
