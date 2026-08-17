import { Compiler, declarationFor, discoverKits, type ReadFile, type Value } from '@markout/core';
import { openReader, resolveReference, type Range } from './diagnostics';

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
  /** where in that file, in LSP's coordinates */
  range: Range;
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

export async function findDeclaration(
  props: DeclarationProps
): Promise<Declaration | undefined> {
  const path = chainAt(props.text, props.offset);
  if (!path) {
    return undefined;
  }

  const { docroot, pathname } = props;
  const readFile: ReadFile | undefined = openReader(props.open);
  const { kits } = discoverKits(docroot);
  let page;
  try {
    page = await new Compiler({ docroot, kits, readFile }).compile(pathname);
  } catch {
    return undefined;
  }

  // A fragment compiles on its own, which is what makes this work inside one:
  // a definition may not read its call site, so everything a name in there can
  // refer to is declared in the same file. What a fragment cannot resolve is a
  // name belonging to the page that includes it -- and neither can the page,
  // which is why that is an error rather than a gap here.
  const from = expressionAt(page.values.values(), pathname, props.offset);
  if (!from) {
    return undefined;
  }

  const found = declarationFor(from, path);
  // a value is declared by its attribute or its text; a named scope by the
  // element that carries the name -- `body.items` should send someone to
  // `<body>` when they ask about `body`
  const loc = found?.value ? found.value.node.loc : found?.scope?.e?.loc;
  if (!loc?.source) {
    return undefined;
  }
  return {
    pathname: loc.source,
    range: {
      start: { line: loc.start.line - 1, character: loc.start.column },
      end: { line: loc.end.line - 1, character: loc.end.column },
    },
  };
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
function expressionAt(
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

const IDENT_PART = /[A-Za-z0-9_$]/;

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
