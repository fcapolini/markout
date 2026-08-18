import { Compiler, discoverKits, visibleFrom, type Visible } from '@markout/core';
import { openReader } from './diagnostics';
import { expressionAt, IDENT_PART } from './declarations';

/**
 * What could be written where the cursor is.
 *
 * `body.` offers what is in `body`; a bare name offers everything in scope.
 * Both come from `visibleFrom`, which walks the chain the compiler walks --
 * so the list is what would actually resolve, rather than a list of things
 * that might work.
 *
 * The difficulty is not the listing. It is that completion happens WHILE
 * TYPING, and `${body.}` is not valid JavaScript: the compile fails, and a
 * failed compile has no scopes to ask. See `repaired`.
 */

export interface Completion {
  name: string;
  kind: 'value' | 'scope';
  /** where it was declared, for the detail line */
  detail?: string;
}

export interface CompletionProps {
  docroot: string;
  pathname: string;
  text: string;
  offset: number;
  open?: (filePath: string) => string | undefined;
  /** the file being edited, so the repaired text can stand in for it */
  filePath: string;
}

export async function findCompletions(props: CompletionProps): Promise<Completion[]> {
  const path = completionPathAt(props.text, props.offset);
  if (!path) {
    return [];
  }
  const text = repaired(props.text, props.offset) ?? props.text;
  const { docroot, pathname } = props;
  const readFile = openReader(filePath =>
    filePath === props.filePath ? text : props.open?.(filePath)
  );

  const { kits } = discoverKits(docroot);
  let page;
  try {
    page = await new Compiler({ docroot, kits, readFile }).compile(pathname);
  } catch {
    return [];
  }
  const from = expressionAt(page.values.values(), pathname, props.offset);
  if (!from) {
    return [];
  }
  return visibleFrom(from, path).map(describe);
}

function describe(visible: Visible): Completion {
  if (visible.kind === 'scope') {
    const tag = visible.scope?.e?.tagName?.toLowerCase();
    return { name: visible.name, kind: 'scope', detail: tag ? `<${tag}>` : 'scope' };
  }
  const loc = visible.value?.node.loc;
  return {
    name: visible.name,
    kind: 'value',
    detail: loc?.source ? `${loc.source}:${loc.start.line}` : undefined,
  };
}

/**
 * The navigation prefix under the cursor: `['body']` after `body.`, and the
 * empty list for a bare name.
 *
 * The partial word being typed is NOT part of it -- the editor filters the
 * list by that itself, and including it would mean offering only names that
 * are already complete.
 *
 * `undefined` where completion has no business happening: after something
 * that is not a chain of names.
 */
export function completionPathAt(text: string, offset: number): string[] | undefined {
  let start = offset;
  while (start > 0 && IDENT_PART.test(text[start - 1])) start--;

  const path: string[] = [];
  let at = start;
  while (text[at - 1] === '.') {
    let from = at - 1;
    while (from > 0 && IDENT_PART.test(text[from - 1])) from--;
    const segment = text.slice(from, at - 1);
    if (!segment || /^[0-9]/.test(segment)) {
      return undefined;
    }
    path.unshift(segment);
    at = from;
  }
  return path;
}

/**
 * The text with the expression under the cursor made valid, and NOT ONE
 * CHARACTER shorter or longer.
 *
 * A half-typed expression is a syntax error, and the compiler answers a
 * syntax error by producing no page at all -- so the moment completion is
 * wanted is the moment there is nothing to ask. Replacing the expression's
 * contents with `0` and spaces gives the compiler something it can parse
 * while leaving every offset in the file exactly where it was, which is what
 * lets the cursor still be found afterwards.
 *
 * Only the one under the cursor: another broken expression elsewhere is a
 * mistake the author has yet to fix, and the diagnostics say so.
 */
export function repaired(text: string, offset: number): string | undefined {
  const open = text.lastIndexOf('${', offset);
  if (open < 0) {
    return undefined;
  }
  // already closed before the cursor: the cursor is not in this one
  const closed = text.indexOf('}', open + 2);
  if (closed >= 0 && closed < offset) {
    return undefined;
  }
  const end = closed >= 0 ? closed : unterminatedEnd(text, offset);
  const length = end - (open + 2);
  if (length < 1) {
    // `${}`, with nothing between the braces yet. One character has to be
    // added rather than substituted, which moves everything after it -- and
    // is harmless, because the only offset that matters is the cursor's, and
    // it sits before the insertion inside an expression that still contains it
    return `${text.slice(0, open + 2)}0${text.slice(open + 2)}`;
  }
  const filler = `0${' '.repeat(length - 1)}`;
  return text.slice(0, open + 2) + filler + text.slice(end);
}

/**
 * Where an expression with no `}` yet should be treated as ending.
 *
 * At the markup, not at the end of the line: `<p>${body.</p>` has four
 * characters of tag after the cursor, and blanking those to make the
 * expression parse would hand the compiler a page with no closing tag --
 * trading one syntax error for another.
 */
function unterminatedEnd(text: string, from: number): number {
  const at = text.slice(from).search(/[<\n]/);
  return at < 0 ? text.length : from + at;
}
