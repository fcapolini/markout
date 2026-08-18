import { declarationFor, type Page, type Scope, type Value } from '@markout-dev/core';
import * as nodePath from 'path';
import { openReader, resolveReference, type Range } from './diagnostics';
import { compilePage } from './pages';

/**
 * Where the name under the cursor was declared.
 *
 * `${title}` inside a `<:define>` should go to the `:title=${…}` that
 * declares it, and the reason this is worth doing properly is that no
 * amount of searching the text answers it: a name belongs to the nearest
 * enclosing scope, a usage site resolves from somewhere other than where it
 * sits, and slotted markup resolves from where it was WRITTEN. Those are the
 * language's rules, and the compiler is the only thing that has them.
 *
 * So the work here is only ever: find the expression the cursor is in, take
 * the identifier under it, and ask. `declarationFor` in core is the asking,
 * and it is the same walk stage4 does to decide whether a reference is known
 * at all -- one implementation, two callers.
 */

export interface Declaration {
  /** the docroot pathname of the file the declaration is in */
  pathname: string;
  /** the whole of it: an attribute, or an element from its `<` to its `>` */
  range: Range;
  /**
   * The point to put the cursor on, which is NOT the same thing.
   *
   * A scope is declared by an element, and an element's range is everything
   * inside it -- `<body>` spans most of the page. An editor reveals the
   * SELECTION range, so returning the whole element means asking it to
   * reveal a region the cursor is already inside, and it does the only
   * sensible thing with that: nothing at all. Which reads exactly like a
   * feature that does not work.
   */
  selection: Range;
}

export interface DeclarationProps {
  docroot: string;
  /** the file the cursor is in, as a docroot pathname */
  pathname: string;
  /** its text, which is the buffer rather than the file */
  text: string;
  /** the cursor, as an offset into that text */
  offset: number;
  open?: (filePath: string) => string | undefined;
}

/**
 * What the cursor is on, as the compiler's own object.
 *
 * Split out of `findDeclaration` because go-to-definition wants a place and
 * find-references wants the THING -- two questions with one answer between
 * them, and resolving it twice by different routes is how they would come to
 * disagree about what a name means.
 */
export async function declarationTargetAt(props: DeclarationProps): Promise<
  { page: Page; target: Value | Scope } | undefined
> {
  const found = await resolveAt(props);
  return found?.target ? { page: found.page, target: found.target } : undefined;
}

export async function findDeclaration(
  props: DeclarationProps
): Promise<Declaration | undefined> {
  const found = await resolveAt(props);
  if (!found?.target) {
    return undefined;
  }
  const loc = 'node' in found.target ? found.target.node.loc : scopeLoc(found.target);
  return locate(loc, props.pathname);
}

async function resolveAt(
  props: DeclarationProps
): Promise<{ page: Page; target?: Value | Scope } | undefined> {
  const tag = tagNameAt(props.text, props.offset);
  const attribute = tag ? undefined : attributeAt(props.text, props.offset);
  const chain = tag ? undefined : chainAt(props.text, props.offset);
  if (!tag && !attribute && !chain) {
    return undefined;
  }

  const { docroot, pathname } = props;
  const page = await compilePage({
    docroot,
    pathname,
    text: props.text,
    readFile: openReader(filePath =>
      filePath === nodePath.join(docroot, pathname) ? props.text : props.open?.(filePath)
    ),
  });
  if (!page) {
    return undefined;
  }

  // a custom tag: the <:define> that gives it meaning, which is usually in
  // another file entirely and is the one thing a reader of a page most often
  // wants. The compiler keeps the map because it needs it to compile at all
  if (tag) {
    return { page, target: page.customTags.get(tag) };
  }

  // an attribute of a custom tag: the PARAMETER it sets, declared on the
  // `<:define>`. What the usage writes is a value of its own, sitting right
  // under the cursor -- the question is about the other end of it
  const parameter = attribute
    ? page.customTags.get(attribute.tag)?.values.get(attribute.name)
    : undefined;
  if (parameter) {
    return { page, target: parameter };
  }
  // an attribute that sets no parameter is an ordinary declaration -- `:items`
  // on a `<body>`. There is nowhere to go from it, which is why
  // go-to-definition asks nothing more; but it is exactly where someone
  // stands to ask who READS this, so it has to resolve to the value itself
  if (!chain) {
    return { page };
  }

  // A fragment compiles on its own, which is what makes this work inside one:
  // a definition may not read its call site, so everything a name in there can
  // refer to is declared in the same file. What a fragment cannot resolve is a
  // name belonging to the page that includes it -- and neither can the page,
  // which is why that is an error rather than a gap here.
  const from = expressionAt(page.values.values(), pathname, props.offset);
  if (!from) {
    return { page };
  }
  // a value is declared by its attribute or its text; a named scope by the
  // element that carries the name -- `body.items` should send someone to
  // `<body>` when they ask about `body`
  const found = declarationFor(from, chain!);
  return { page, target: found?.value ?? found?.scope };
}

/**
 * Where a scope was written.
 *
 * Its element, except for an instance of a custom tag, which has none: the
 * usage was spliced out of the tree once its values had been handed over, so
 * `<x-card :aka="intro" …>` leaves a scope named `intro` and no element to
 * point at.
 *
 * What it does leave is the values the usage site wrote, and the compiler
 * says which those are -- `callSiteValues` exists because a definition must
 * not read its caller, and it happens to be the exact list of things the
 * author typed on that tag. The earliest of them is the usage. Its own
 * values are no good for this: a definition's defaults are in the
 * definition's file, and the earliest of THOSE would send someone to a
 * different file entirely.
 */
function scopeLoc(scope: Scope): Value['node']['loc'] | undefined {
  if (scope.e?.loc) {
    return scope.e.loc;
  }
  let earliest: Value['node']['loc'] | undefined;
  for (const name of scope.callSiteValues ?? []) {
    const loc = scope.values.get(name)?.node.loc;
    if (loc && (!earliest || loc.i1 < earliest.i1)) {
      earliest = loc;
    }
  }
  return earliest;
}

/**
 * A source location, as a declaration an editor can act on.
 *
 * A SYNTHESIZED element has offsets but no file: `<head>` and `<body>` are
 * supplied by the parser for a document that did not write them, which is
 * every fragment and plenty of pages. They were synthesized while parsing the
 * file being asked about, so that is where their offsets point.
 */
function locate(
  loc: Value['node']['loc'] | undefined,
  pathname: string
): Declaration | undefined {
  if (!loc) {
    return undefined;
  }
  const start = { line: loc.start.line - 1, character: loc.start.column };
  return {
    pathname: loc.source ?? pathname,
    range: { start, end: { line: loc.end.line - 1, character: loc.end.column } },
    selection: { start, end: start },
  };
}

/**
 * The attribute name the offset is on, and the tag it belongs to.
 *
 * `:title` in `<x-card :title=${'Hi'}>` -- the name, not the value, which is
 * an expression and resolves at the call site like any other. The two are a
 * few characters apart and mean opposite directions: the name asks about the
 * definition, the value about here.
 */
export function attributeAt(
  text: string,
  offset: number
): { tag: string; name: string } | undefined {
  const isPart = (c: string) => /[A-Za-z0-9_:$-]/.test(c);
  let start = offset;
  while (start > 0 && isPart(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && isPart(text[end])) end++;
  if (start === end || text[start - 1] === '<' || text[start - 1] === '/') {
    return undefined;
  }
  // an attribute NAME is followed by `=`, or by nothing at all when it is a
  // bare one; a word inside a value or in text is followed by neither
  const after = text.slice(end).match(/^\s*(.?)/)?.[1] ?? '';
  if (!'=/>'.includes(after) || after === '') {
    return undefined;
  }
  const tag = enclosingTag(text, start);
  const name = text.slice(start, end).replace(/^:+/, '');
  return tag && name ? { tag, name } : undefined;
}

/** the tag whose opening `<` is before `from`, with no `>` in between */
function enclosingTag(text: string, from: number): string | undefined {
  const open = text.lastIndexOf('<', from);
  if (open < 0 || text.lastIndexOf('>', from) > open) {
    return undefined;
  }
  return /^<([A-Za-z][A-Za-z0-9_-]*)/.exec(text.slice(open, from))?.[1];
}

/**
 * The tag name the offset is on, when the cursor is on a tag rather than in
 * an expression.
 *
 * It has to be preceded by `<` or `</`, which is what keeps `x-card` inside
 * `<:define tag="x-card:div">` from matching -- that is the declaration, and
 * offering to navigate from a thing to itself is noise.
 */
export function tagNameAt(text: string, offset: number): string | undefined {
  const isPart = (c: string) => /[A-Za-z0-9_-]/.test(c);
  let start = offset;
  while (start > 0 && isPart(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && isPart(text[end])) end++;
  if (start === end) {
    return undefined;
  }
  let before = start - 1;
  if (text[before] === '/') {
    before--;
  }
  return text[before] === '<' ? text.slice(start, end) : undefined;
}

/** the absolute path of a declaration's file */
export function fileOf(declaration: Declaration, props: { docroot: string; from: string }) {
  return resolveReference({
    docroot: props.docroot,
    fromPathname: props.from,
    spec: declaration.pathname,
  });
}

/**
 * The expression the offset is inside.
 *
 * The narrowest one: an attribute's range encloses its value's, and the
 * answer wanted is always the innermost. Only expressions from THIS file
 * count -- a page's values include everything its imports declared, and
 * those offsets are into the fragment, where they would otherwise match
 * whatever happens to sit at the same numbers here.
 */
export function expressionAt(
  values: Iterable<Value>,
  pathname: string,
  offset: number
): Value | undefined {
  let best: Value | undefined;
  let width = Infinity;
  for (const value of values) {
    const loc = value.node.loc;
    if (loc.source !== pathname || loc.i1 > offset || loc.i2 < offset) {
      continue;
    }
    const span = loc.i2 - loc.i1;
    if (span < width) {
      best = value;
      width = span;
    }
  }
  return best;
}

export const IDENT_PART = /[A-Za-z0-9_$]/;

/**
 * The dotted chain up to and including the identifier the offset is on.
 *
 * The chain matters because `body.items` is not a property access: `body` is
 * a named scope and `items` is a value *inside it*, so the second segment
 * cannot be looked up without the first. Asking about `body` gives
 * `['body']` and asking about `items` gives `['body', 'items']` -- the same
 * text, two questions, and the answer to the second depends on the first.
 *
 * What comes back is only ever the prefix: nothing after the cursor is part
 * of the question.
 */
export function chainAt(text: string, offset: number): string[] | undefined {
  const key = identifierAt(text, offset);
  if (!key) {
    return undefined;
  }
  let start = offset;
  while (start > 0 && IDENT_PART.test(text[start - 1])) start--;

  const path = [key];
  while (text[start - 1] === '.') {
    let from = start - 1;
    while (from > 0 && IDENT_PART.test(text[from - 1])) from--;
    const segment = text.slice(from, start - 1);
    if (!segment || /^[0-9]/.test(segment)) {
      // `a[0].b`, `f().b`: not a chain of names, so not a question this can
      // answer -- and a partial answer would point somewhere arbitrary
      return undefined;
    }
    path.unshift(segment);
    start = from;
  }
  return path;
}

/** the identifier the offset is on, if it is one */
export function identifierAt(text: string, offset: number): string | undefined {
  let start = offset;
  while (start > 0 && IDENT_PART.test(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && IDENT_PART.test(text[end])) end++;
  if (start === end || /[0-9]/.test(text[start])) {
    return undefined;
  }
  return text.slice(start, end);
}
