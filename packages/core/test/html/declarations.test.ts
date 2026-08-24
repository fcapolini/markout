import { describe, expect, it } from 'vitest';
import { parseDeclarations } from '../../src/html/css';
import { parse } from '../../src/html/parser';

/**
 * What a `style` attribute survives being read.
 *
 * The separators CSS uses between declarations are both legal INSIDE a
 * value -- a data URI carries `;` and `:`, a quoted string can carry
 * either -- so splitting on them silently loses whole declarations. That is
 * plain HTML with no markout syntax anywhere in it, which is the one thing
 * the language promises to leave alone.
 */
describe('reading a style attribute', () => {
  it('keeps a data URI whole', () => {
    expect(
      parseDeclarations('background: url(data:image/svg+xml;base64,PHN2ZyB4=)')
    ).toStrictEqual([['background', 'url(data:image/svg+xml;base64,PHN2ZyB4=)']]);
  });

  it('keeps a separator inside a quoted value', () => {
    expect(parseDeclarations('content: "; "')).toStrictEqual([['content', '"; "']]);
    expect(parseDeclarations("content: ': '")).toStrictEqual([['content', "': '"]]);
  });

  it('splits a declaration at its first colon only', () => {
    expect(parseDeclarations('background: url(http://a/x.png)')).toStrictEqual([
      ['background', 'url(http://a/x.png)'],
    ]);
  });

  it('reads an escaped quote as part of the value', () => {
    expect(parseDeclarations('content: "\\";"; color: red')).toStrictEqual([
      ['content', '"\\";"'],
      ['color', 'red'],
    ]);
  });

  it('reads the ordinary cases unchanged', () => {
    expect(parseDeclarations('color: red; gap: 1rem')).toStrictEqual([
      ['color', 'red'],
      ['gap', '1rem'],
    ]);
    expect(parseDeclarations('font: 12px/1.5 serif')).toStrictEqual([
      ['font', '12px/1.5 serif'],
    ]);
    expect(parseDeclarations('background: linear-gradient(to right, red, blue)')).toStrictEqual([
      ['background', 'linear-gradient(to right, red, blue)'],
    ]);
    expect(parseDeclarations('grid-template-areas: "a b" "c d"')).toStrictEqual([
      ['grid-template-areas', '"a b" "c d"'],
    ]);
  });

  it('drops what is not a declaration', () => {
    expect(parseDeclarations('')).toStrictEqual([]);
    expect(parseDeclarations('   ')).toStrictEqual([]);
    expect(parseDeclarations('color')).toStrictEqual([]);
    expect(parseDeclarations('color:')).toStrictEqual([]);
    expect(parseDeclarations(': red')).toStrictEqual([]);
    expect(parseDeclarations('color: red;;')).toStrictEqual([['color', 'red']]);
  });

  it('survives an unclosed quote or paren rather than looping', () => {
    expect(parseDeclarations('content: "unclosed; color: red')).toStrictEqual([
      ['content', '"unclosed; color: red'],
    ]);
    expect(parseDeclarations('background: url(unclosed; color: red')).toStrictEqual([
      ['background', 'url(unclosed; color: red'],
    ]);
  });

  it('serves a page holding one, which is where this was found', () => {
    const page = parse(
      '<html><body><div style="background: url(data:image/svg+xml;base64,PHN2)' +
        '; color: red"></div></body></html>',
      't.html'
    );
    expect(page.errors).toStrictEqual([]);
    expect(page.doc.toString()).toContain(
      'style="background: url(data:image/svg+xml;base64,PHN2); color: red;"'
    );
  });
});
