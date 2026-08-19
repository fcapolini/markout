import type { Range } from './diagnostics';
import { findExpressions, type Expression } from './expressions';

/**
 * Indentation, and nothing else.
 *
 * The narrowness is the design. Whitespace in this language is text -- the
 * space between two `<span>`s renders -- so a formatter that moves content
 * around changes what the page says. What it may safely move is whitespace
 * INSIDE an open tag, which is never text and never rendered: the lines an
 * attribute list wraps onto, and the `>` that closes it. That is also
 * exactly what the convention specifies, so the safe half and the wanted
 * half are the same half.
 *
 * Which shape a file gets comes from its extension. A page (`.html`) is
 * indented like HTML, attributes lining up under the first one, because it
 * should read to whoever opens it like the page it is. A fragment (`.htm`)
 * is indented like code, attributes a single step in from their tag and the
 * `>` back at the tag's own column -- a `<:define>` header is a parameter
 * list, its body holds arrow functions and comments, and the closing `>` on
 * its own line was already a block delimiter.
 *
 * Existing line breaks are kept. Deciding WHERE an attribute list should
 * wrap is a judgment about how a component reads; re-indenting the lines it
 * already wraps onto is not, and only the second one can be done to
 * somebody's file on save without an argument.
 */

export interface TextEdit {
  range: Range;
  newText: string;
}

export interface FormatProps {
  text: string;
  /** the file's path or name: a `.htm` fragment indents like code */
  pathname: string;
  /** the editor's tab size; the step a fragment's attributes are indented by */
  tabSize?: number;
  /**
   * False means the file is indented with tabs, and then this does nothing.
   *
   * Not a gap waiting to be filled: the page shape aligns to a COLUMN
   * derived from the tag's name, which no number of tabs can express. Rather
   * than format one of the two shapes and quietly skip the other, or emit a
   * mixture that the next editor renders differently, a tabbed file is left
   * exactly as its author wrote it.
   */
  insertSpaces?: boolean;
  /** limit the edits to these lines, for formatting a selection */
  lines?: { start: number; end: number };
}

export function formatEdits(props: FormatProps): TextEdit[] {
  if (props.insertSpaces === false) {
    return [];
  }
  const step = props.tabSize ?? 2;
  const { text } = props;
  const lines = text.split('\n');
  const starts = lineStarts(lines);
  // `.htm` and `.html` are one language to the editor, which is why this
  // cannot be a setting: `html.format.*` is per language, and there is no
  // per-extension override to hang the distinction on
  const fragment = /\.htm$/i.test(props.pathname);
  const edits: TextEdit[] = [];

  for (const tag of openTags(text)) {
    const opens = lineOf(starts, tag.start);
    const closes = lineOf(starts, tag.end);
    if (opens === closes || !tag.attrs.length) {
      // a tag on one line has nothing wrapped onto another
      continue;
    }
    const col = tag.start - starts[opens];
    if (lines[opens].slice(0, col).trim()) {
      // the tag opened partway through a line, so "one step in from the tag"
      // names no column anyone would recognise. Left alone rather than
      // guessed at
      continue;
    }
    // where the list currently sits: the shallowest item that wrapped onto a
    // line of its own. Anything deeper than that is inside one of them -- an
    // array literal, an arrow function's body -- and travels with it
    const wrapped = tag.attrs
      .map(at => ({ line: lineOf(starts, at), column: at - starts[lineOf(starts, at)] }))
      .filter(at => at.line > opens);
    const onTagLine = tag.attrs.some(at => lineOf(starts, at) === opens);
    const want =
      fragment || !onTagLine
        ? col + step
        : // the column the first attribute sits in: past `<`, the name, and
          // the space after it
          col + 1 + tag.name.length + 1;

    for (let line = opens + 1; line <= closes; line++) {
      const source = lines[line];
      if (!source.trim()) {
        continue;
      }
      const indent = source.length - source.trimStart().length;
      if (source.trim() === '>' || source.trim() === '/>') {
        // the closing delimiter belongs with what it closes
        edit(edits, line, indent, col);
        continue;
      }
      if (!wrapped.length) {
        continue;
      }
      const delta = want - Math.min(...wrapped.map(at => at.column));
      if (indent + delta < 0) {
        continue;
      }
      edit(edits, line, indent, indent + delta);
    }
  }

  const limit = props.lines;
  return limit
    ? edits.filter(e => e.range.start.line >= limit.start && e.range.start.line <= limit.end)
    : edits;
}

/** replaces a line's leading whitespace, unless it is already what it should be */
function edit(edits: TextEdit[], line: number, was: number, want: number): void {
  if (was === want) {
    return;
  }
  edits.push({
    range: { start: { line, character: 0 }, end: { line, character: was } },
    newText: ' '.repeat(want),
  });
}

interface OpenTag {
  /** offset of the `<` */
  start: number;
  name: string;
  /**
   * Where each item in the attribute list begins -- an attribute, or one of
   * the comments a list may carry.
   *
   * All of them rather than the first, because the level the list sits at
   * has to be read off the list itself. Taking it from the first attribute's
   * column works only while the file is already in the shape being asked
   * for: a fragment written page-style has every wrapped line ABOVE that
   * column, and one written fragment-style has them below it.
   */
  attrs: number[];
  /** offset of the `>` that closes it */
  end: number;
}

const TAG = /<(\/?)([A-Za-z:][\w:.-]*)/y;

/**
 * Every open tag, with where its attribute list starts and ends.
 *
 * The reason this cannot be a pattern is the reason an HTML formatter
 * destroys these files: `:_class=${['a', 'b'].filter(s => s)}` holds a `>`
 * that ends no tag, and a formatter that believes it does will close the tag
 * there and turn the rest of the attributes into text. So expressions are
 * found first, by the scanner that already knows where one ends, and this
 * walk steps over them whole. Quoted values, and the line and block
 * comments a parameter list is allowed to carry, are stepped over the same
 * way.
 */
function openTags(text: string): OpenTag[] {
  const spans = findExpressions(text);
  const found: OpenTag[] = [];
  let span = 0;
  /** the offset just past any expression covering `at`, or `at` itself */
  const over = (at: number): number => {
    while (span < spans.length && spans[span].end <= at) {
      span++;
    }
    const here: Expression | undefined = spans[span];
    return here && here.start <= at ? here.end : at;
  };

  let i = 0;
  while (i < text.length) {
    const past = over(i);
    if (past > i) {
      i = past;
      continue;
    }
    if (text[i] !== '<') {
      i++;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4);
      i = close < 0 ? text.length : close + 3;
      continue;
    }
    TAG.lastIndex = i;
    const match = TAG.exec(text);
    if (!match) {
      i++;
      continue;
    }
    if (match[1] === '/') {
      const close = text.indexOf('>', i);
      i = close < 0 ? text.length : close + 1;
      continue;
    }
    let k = TAG.lastIndex;
    const attrs: number[] = [];
    // the tag name is behind us, so the next thing that is not whitespace
    // starts an item -- and nothing does again until whitespace has been
    // seen, or `x=${...}` would count as two
    let afterSpace = true;
    let end = -1;
    while (k < text.length) {
      const jumped = over(k);
      if (jumped > k) {
        if (afterSpace) {
          attrs.push(k);
        }
        afterSpace = false;
        k = jumped;
        continue;
      }
      const c = text[k];
      if (c === '>') {
        end = k;
        break;
      }
      if (c === '/' && text[k + 1] === '>') {
        end = k + 1;
        break;
      }
      if (/\s/.test(c)) {
        afterSpace = true;
        k++;
        continue;
      }
      if (afterSpace) {
        attrs.push(k);
      }
      afterSpace = false;
      if (c === '"' || c === "'") {
        k = quoted(text, k, over);
        continue;
      }
      if (c === '/' && text[k + 1] === '/') {
        const nl = text.indexOf('\n', k);
        k = nl < 0 ? text.length : nl;
        continue;
      }
      if (c === '/' && text[k + 1] === '*') {
        const close = text.indexOf('*/', k + 2);
        k = close < 0 ? text.length : close + 2;
        continue;
      }
      k++;
    }
    if (end < 0) {
      // unterminated: the compiler reports it, and formatting past the end of
      // a tag nobody closed would move lines that are not in one
      break;
    }
    found.push({ start: i, name: match[2], attrs, end });
    i = end + 1;
  }
  return found;
}

/** the offset just past a quoted attribute value, expressions and all */
function quoted(text: string, open: number, over: (at: number) => number): number {
  let i = open + 1;
  while (i < text.length) {
    const past = over(i);
    if (past > i) {
      i = past;
      continue;
    }
    if (text[i] === text[open]) {
      return i + 1;
    }
    i++;
  }
  return text.length;
}

function lineStarts(lines: string[]): number[] {
  const starts = [0];
  for (let i = 0; i < lines.length - 1; i++) {
    starts.push(starts[i] + lines[i].length + 1);
  }
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}
