import { describe, expect, it } from 'vitest';
import { formatEdits, type FormatProps } from '../src/formatting';

/**
 * Formatting, which for this language is indentation and nothing else.
 *
 * Two things are being pinned down here. That the shape is right -- a
 * fragment indents like code, a page like HTML -- and, more importantly,
 * that the scan underneath it knows where a tag ends. An HTML formatter does
 * not: `.filter(s => s)` in an attribute holds a `>`, and VS Code's built-in
 * one closes the tag there and turns everything after into text. Every case
 * below that looks like a curiosity is that bug in a different disguise.
 */

/** the source with the edits applied, which is what an editor would show */
function formatted(text: string, pathname = 'part.htm', props: Partial<FormatProps> = {}) {
  const edits = formatEdits({ text, pathname, ...props });
  const lines = text.split('\n');
  for (const edit of edits) {
    const line = lines[edit.range.start.line];
    lines[edit.range.start.line] = edit.newText + line.slice(edit.range.end.character);
  }
  return lines.join('\n');
}

describe('a fragment indents like code', () => {
  it('brings an aligned attribute list one step in from its tag', () => {
    expect(
      formatted(
        [
          '<lib>',
          '  <:define tag="bs-alert:div"',
          '           role="alert"',
          '           ::variant=${1}',
          '  >',
          '  </:define>',
          '</lib>',
        ].join('\n')
      )
    ).toBe(
      [
        '<lib>',
        '  <:define tag="bs-alert:div"',
        '    role="alert"',
        '    ::variant=${1}',
        '  >',
        '  </:define>',
        '</lib>',
      ].join('\n')
    );
  });

  it('puts the closing delimiter back at its tag', () => {
    expect(formatted(['<div :a=${1}', '     :b=${2}', '     >', '</div>'].join('\n'))).toBe(
      ['<div :a=${1}', '  :b=${2}', '>', '</div>'].join('\n')
    );
  });

  it('keeps the extra depth inside a wrapped expression', () => {
    // an array literal or an arrow function body is shaped by its author;
    // the whole block moves, and its internal structure does not
    expect(
      formatted(
        [
          '  <:define tag="x:div"',
          '           :_class=${[',
          "             'alert',",
          '             extra,',
          "           ].filter(s => s).join(' ')}",
          '  >',
          '  </:define>',
        ].join('\n')
      )
    ).toBe(
      [
        '  <:define tag="x:div"',
        '    :_class=${[',
        "      'alert',",
        '      extra,',
        "    ].filter(s => s).join(' ')}",
        '  >',
        '  </:define>',
      ].join('\n')
    );
  });

  it('is not fooled by the > in an arrow function', () => {
    // the case that corrupts a file rather than merely misindenting it: read
    // as the end of the tag, every attribute after it becomes text
    const source = [
      '  <:define tag="x:div"',
      "           :_class=${['a'].filter(s => s).join(' ')}",
      '           :on-click=${() => open = !open}',
      '           role="alert"',
      '  >',
      '  </:define>',
    ].join('\n');
    expect(formatted(source)).toBe(
      [
        '  <:define tag="x:div"',
        "    :_class=${['a'].filter(s => s).join(' ')}",
        '    :on-click=${() => open = !open}',
        '    role="alert"',
        '  >',
        '  </:define>',
      ].join('\n')
    );
  });

  it('is not fooled by a > inside a quoted value, or a comment in the list', () => {
    const source = [
      '  <div title="a > b"',
      '       // which one this is',
      '       :n=${1}',
      '       /* and why',
      '          it is here > there */',
      '       :m=${2}>',
      '  </div>',
    ].join('\n');
    expect(formatted(source)).toBe(
      [
        '  <div title="a > b"',
        '    // which one this is',
        '    :n=${1}',
        '    /* and why',
        '       it is here > there */',
        '    :m=${2}>',
        '  </div>',
      ].join('\n')
    );
  });

  it('leaves a tag that fits on one line alone', () => {
    const source = '<div :n=${1} :m=${2}>${n}</div>';
    expect(formatEdits({ text: source, pathname: 'x.htm' })).toStrictEqual([]);
  });
});

describe('a page indents like HTML', () => {
  it('lines a wrapped attribute list up under the first attribute', () => {
    expect(
      formatted(
        ['<body>', '  <input value=${v}', '    :on-input=${e => v = e}>', '</body>'].join('\n'),
        'page.html'
      )
    ).toBe(
      ['<body>', '  <input value=${v}', '         :on-input=${e => v = e}>', '</body>'].join('\n')
    );
  });

  it('is the same file laid out two ways, decided by the extension', () => {
    const source = ['  <div :a=${1}', '       :b=${2}>', '  </div>'].join('\n');
    expect(formatted(source, 'x.html')).toBe(source);
    expect(formatted(source, 'x.htm')).toBe(['  <div :a=${1}', '    :b=${2}>', '  </div>'].join('\n'));
  });
});

describe('what it will not touch', () => {
  it('moves nothing that is text', () => {
    // whitespace between two elements RENDERS, so a formatter that reaches
    // past the `>` is changing what the page says, not how it looks
    const source = [
      '  <div :a=${1}',
      '       :b=${2}>',
      '        <span>one</span>',
      '            <span>two</span>',
      '  </div>',
    ].join('\n');
    expect(formatted(source).split('\n').slice(2)).toStrictEqual([
      '        <span>one</span>',
      '            <span>two</span>',
      '  </div>',
    ]);
  });

  it('leaves a tag that opens partway through a line', () => {
    const source = ['  <div>${x}<span class="a"', '                 :n=${1}>y</span></div>'].join('\n');
    expect(formatted(source)).toBe(source);
  });

  it('does nothing at all to a file indented with tabs', () => {
    const source = ['\t<div :a=${1}', '\t     :b=${2}>', '\t</div>'].join('\n');
    expect(formatEdits({ text: source, pathname: 'x.htm', insertSpaces: false })).toStrictEqual([]);
  });

  it('stops at a tag nobody closed', () => {
    expect(formatEdits({ text: '<div :a=${1}\n     :b=${2}', pathname: 'x.htm' })).toStrictEqual([]);
  });

  it('answers with nothing when there is nothing to do', () => {
    const source = ['  <:define tag="x:div"', '    ::a=${1}', '  >', '  </:define>'].join('\n');
    expect(formatEdits({ text: source, pathname: 'x.htm' })).toStrictEqual([]);
  });
});

describe('as an editor uses it', () => {
  it('settles: formatting what it formatted changes nothing', () => {
    const source = [
      '  <:define tag="x:div"',
      '           :_class=${[1, 2]',
      '             .filter(Boolean)}',
      '           :on-click=${() => x()}',
      '  >',
      '  </:define>',
    ].join('\n');
    const once = formatted(source);
    expect(formatEdits({ text: once, pathname: 'x.htm' })).toStrictEqual([]);
  });

  it('changes only leading whitespace', () => {
    const source = [
      '  <:define tag="x:div"',
      '           ::a=${1}',
      "           ::b=${'>'}",
      '  >text</:define>',
    ].join('\n');
    expect(formatted(source).replace(/^\s+/gm, '')).toBe(source.replace(/^\s+/gm, ''));
  });

  it('honours a selection, leaving the rest as it was', () => {
    const source = [
      '  <div :a=${1}',
      '       :b=${2}>',
      '  </div>',
      '  <div :c=${3}',
      '       :d=${4}>',
      '  </div>',
    ].join('\n');
    const edits = formatEdits({ text: source, pathname: 'x.htm', lines: { start: 0, end: 2 } });
    expect(edits).toHaveLength(1);
    expect(edits[0].range.start.line).toBe(1);
  });

  it('takes the step from the editor', () => {
    expect(
      formatted(['  <div :a=${1}', '       :b=${2}>', '  </div>'].join('\n'), 'x.htm', { tabSize: 4 })
    ).toBe(['  <div :a=${1}', '      :b=${2}>', '  </div>'].join('\n'));
  });
});
