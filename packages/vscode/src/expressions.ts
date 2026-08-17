/**
 * Where the `${…}` expressions are in a page's text.
 *
 * A lexical scan, and deliberately only that: it finds the boundaries of
 * each expression so an editor can hand its contents to a JavaScript
 * service and map the answers back. It decides nothing about what an
 * expression MEANS -- that is the compiler's, and the compiler is what
 * produces the diagnostics the extension shows.
 *
 * The rules it has to get right are the ones that decide where an
 * expression ends, and every one of them is a way a naive scan for `}` gets
 * it wrong: a nested object literal, a `}` inside a string, an escaped
 * quote, a nested template literal, a `}` inside a comment.
 */

export interface Expression {
  /** offset of the `$` */
  start: number;
  /** offset just past the closing `}` */
  end: number;
  /** offset of the first character inside `${` */
  contentStart: number;
  /** offset of the closing `}` */
  contentEnd: number;
  /** the JavaScript between the braces */
  text: string;
}

/** every `${…}` in the text, in order, skipping unterminated ones */
export function findExpressions(text: string): Expression[] {
  const found: Expression[] = [];
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] !== '$' || text[i + 1] !== '{') {
      continue;
    }
    // `$$ {` is not an escape markout has, but a `\$` in the source is a
    // literal `$` to the parser, so a backslash before it means no expression
    if (i > 0 && text[i - 1] === '\\') {
      continue;
    }
    const contentStart = i + 2;
    const contentEnd = scanToClose(text, contentStart);
    if (contentEnd < 0) {
      // unterminated: the compiler will say so, and guessing an end here
      // would put a squiggle somewhere arbitrary
      break;
    }
    found.push({
      start: i,
      end: contentEnd + 1,
      contentStart,
      contentEnd,
      text: text.slice(contentStart, contentEnd),
    });
    i = contentEnd;
  }
  return found;
}

/** the offset of the `}` closing the `${` whose content starts at `from`, or -1 */
function scanToClose(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      if (depth === 0) {
        return i;
      }
      depth--;
    } else if (c === '"' || c === "'") {
      i = skipQuoted(text, i, c);
    } else if (c === '`') {
      i = skipTemplate(text, i);
    } else if (c === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
      if (i < 0) return -1;
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close < 0) return -1;
      i = close + 1;
    }
    if (i < 0) return -1;
  }
  return -1;
}

/** the offset of the closing quote, or the end of the text */
function skipQuoted(text: string, open: number, quote: string): number {
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
    } else if (text[i] === quote) {
      return i;
    }
  }
  return text.length;
}

/**
 * The offset of the backtick closing a template literal.
 *
 * Its own scan because a template can hold `${…}` of its own, and what is
 * inside that is JavaScript again -- so `` `${a ? '}' : ''}` `` has to come
 * back with the outer expression still open.
 */
function skipTemplate(text: string, open: number): number {
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
    } else if (c === '`') {
      return i;
    } else if (c === '$' && text[i + 1] === '{') {
      const close = scanToClose(text, i + 2);
      if (close < 0) {
        return text.length;
      }
      i = close;
    }
  }
  return text.length;
}
