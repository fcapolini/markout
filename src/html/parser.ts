import * as acorn from 'acorn';
import { NodeType } from './dom';
import * as dom from './server-dom';

//TODO: add support for single-word, unquoted attribute values for HTML compatibility

export const SKIP_CONTENT_TAGS = new Set(['SCRIPT', 'CODE']);
export const ATOMIC_TEXT_TAGS = new Set(['STYLE', 'TITLE']);
// const NON_NORMALIZED_TAGS = { PRE: true, SCRIPT: true };
const SLASH = '/'.charCodeAt(0);
const DASH = '-'.charCodeAt(0);
const GT = '>'.charCodeAt(0);
const EQ = '='.charCodeAt(0);
const QUOT = '"'.charCodeAt(0);
const APOS = "'".charCodeAt(0);
const DOLLAR = '$'.charCodeAt(0);
const LEXP = '${';
const REXP = '}'.charCodeAt(0);

export function parse(
  s: string,
  fname: string,
  ret?: Source,
  sanitize = true
): Source {
  ret || (ret = new Source(s, fname));
  try {
    parseNodes(ret.doc, ret, 0, ret.errors);
  } catch (ignored) {
    // nop: errors are added to returned doc, throws are used
    // to abort parsing when an irrecoverable error is found
  }
  const doc = ret.doc as dom.ServerDocument;
  doc.childNodes.forEach(n => (n.parentElement = null));
  if (sanitize) {
    // sanitize doc
    doc.documentElement ||
      doc.childNodes.push(new dom.ServerElement(doc, 'HTML', doc.loc));
    let head, body;
    doc.documentElement!.childNodes.forEach(n => {
      if (n.nodeType === NodeType.ELEMENT) {
        const e = n as unknown as dom.ServerElement;
        e.tagName === 'HEAD' && (head = e);
        e.tagName === 'BODY' && (body = e);
      }
    });
    body ||
      doc.documentElement!.appendChild(
        (body = new dom.ServerElement(doc, 'BODY', doc.loc))
      );
    head ||
      doc.documentElement!.insertBefore(
        (head = new dom.ServerElement(doc, 'HEAD', doc.loc)),
        body
      );
    doc.documentElement!.tagName = 'HTML';
  }
  return ret;
}

function parseNodes(
  p: dom.ServerElement,
  src: Source,
  i: number,
  errors: PageError[]
) {
  const s = src.s;
  let i1 = i;
  let i2;
  let closure;
  let i3 = i;
  let i4;
  let closetag: string | null = null;
  while ((i2 = s.indexOf('<', i1)) >= 0) {
    i4 = i2;
    i1 = i2 + 1;
    (closure = s.charCodeAt(i1) === SLASH) && i1++;
    if ((i2 = skipName(src, i1)) > i1) {
      if (i4 > i3) {
        parseText(p, src, i3, i4, errors);
      }
      if (closure) {
        const name = s.substring(i1, i2).toUpperCase();
        i2 = skipBlanks(s, i2);
        if (s.charCodeAt(i2) === GT) {
          if (name === p.tagName) {
            i1 = i2 + 1;
            closetag = name;
            break;
          } else {
            errors.push(
              new PageError(
                'error',
                `Found </${name}> instead of </${p.tagName}>`,
                src.loc(i1, i1)
              )
            );
            throw Error();
          }
        } else {
          errors.push(
            new PageError(
              'error',
              `Unterminated close tag ${name}`,
              src.loc(i1, i1)
            )
          );
          throw Error();
        }
        i1 = i2;
      } else {
        i1 = parseElement(p, src, i1, i2, errors);
      }
      i3 = i1;
    } else if (!closure && (i2 = skipComment(p, src, i1, errors)) > i1) {
      if (i4 > i3) {
        parseText(p, src, i3, i4, errors);
      }
      const a = i1 + 3;
      const b = i2 - 3;
      p.appendChild(
        new dom.ServerComment(p.ownerDocument, s.substring(a, b), src.loc(a, b))
      );
      i3 = i1 = i2;
    }
  }
  if (!p.tagName.startsWith('#') && closetag !== p.tagName) {
    errors.push(
      new PageError('error', `expected </${p.tagName}>`, src.loc(i1, i1))
    );
    throw new Error();
  }
  return i1;
}

function parseElement(
  p: dom.ServerElement,
  src: Source,
  i1: number,
  i2: number,
  errors: PageError[]
): number {
  const s = src.s;
  const tagName = s.substring(i1, i2).toUpperCase();
  const loc = src.loc(i1 - 1, i2);
  const e =
    tagName === 'TEMPLATE'
      ? new dom.ServerTemplateElement(p.ownerDocument, loc)
      : new dom.ServerElement(p.ownerDocument, tagName, loc);
  p.appendChild(e);
  i1 = parseAttributes(e, src, i2, errors);
  i1 = skipBlanks(s, i1);
  let selfclose = false;
  if ((selfclose = s.charCodeAt(i1) === SLASH)) {
    i1++;
  }
  if (s.charCodeAt(i1) != GT) {
    errors.push(
      new PageError('error', `Unterminated tag ${e.tagName}`, src.loc(i1, i1))
    );
    throw new Error();
  }
  i1++;
  if (!selfclose && !dom.VOID_ELEMENTS.has(e.tagName)) {
    if (SKIP_CONTENT_TAGS.has(e.tagName)) {
      const res = skipContent(p, e.tagName, src, i1, errors);
      if (!res) {
        errors.push(
          new PageError(
            'error',
            `Unterminated tag ${e.tagName}`,
            src.loc(i1, i1)
          )
        );
        throw new Error();
      }
      if (res.i0 > i1) {
        e.appendChild(
          new dom.ServerText(
            e.ownerDocument,
            s.substring(i1, res.i0),
            src.loc(i1, res.i0)
          )
        );
      }
      i1 = res.i2;
    } else {
      i1 = parseNodes(e, src, i1, errors);
    }
  }
  e.loc.end = src.pos(i1);
  e.loc.i2 = i1;
  return i1;
}

function parseAttributes(
  e: dom.ServerElement,
  src: Source,
  i2: number,
  errors: PageError[]
) {
  const s = src.s;
  let i1 = skipBlanksAndComments(s, i2);
  while ((i2 = skipName(src, i1, true)) > i1) {
    const name = s.substring(i1, i2);
    if (hasAttribute(e, name)) {
      errors.push(
        new PageError(
          'error',
          `duplicated attribute "${name}"`,
          src.loc(i1, i1)
        )
      );
      throw Error();
    }
    const a = new dom.ServerAttribute(
      e.ownerDocument,
      e,
      name,
      null,
      src.loc(i1, i2)
    );
    i1 = skipBlanksAndComments(s, i2);
    if (s.charCodeAt(i1) === EQ) {
      i1 = skipBlanksAndComments(s, i1 + 1);
      const quote = s.charCodeAt(i1);
      a.valueLoc = src.loc(i1, i1);
      if (a && (quote === QUOT || quote === APOS)) {
        i1 = parseValue(
          e,
          a,
          src,
          i1 + 1,
          quote,
          String.fromCharCode(quote),
          errors
        );
      } else if (a && s.startsWith(LEXP, i1)) {
        i1 = parseValue(e, a, src, i1 + LEXP.length, quote, '}', errors);
      } else {
        // we don't support unquoted attribute values
        errors.push(
          new PageError('error', 'Missing attribute value', src.loc(i1, i1))
        );
        throw new Error();
      }
    }
    i1 = skipBlanksAndComments(s, i1);

    // patch "class" attribute behavior
    if (name.toLowerCase() === 'class' && typeof a.value !== 'object') {
      e.className = a.value ?? '';
      e.delAttributeNode(a);
    }

    // patch "style" attribute behavior
    if (name.toLowerCase() === 'style' && typeof a.value !== 'object') {
      e.style = a.value ?? '';
      e.delAttributeNode(a);
    }
  }
  return i1;
}

function parseValue(
  p: dom.ServerElement,
  a: dom.ServerAttribute,
  src: Source,
  i1: number,
  quote: number,
  term: string,
  errors: PageError[]
) {
  if (quote !== DOLLAR) {
    return parseLiteralValue(p, a, src, i1, quote, term, errors);
  } else {
    return parseExpressionValue(p, a, src, i1, errors);
  }
}

function parseLiteralValue(
  p: dom.ServerElement,
  a: dom.ServerAttribute,
  src: Source,
  i1: number,
  quote: number,
  term: string,
  errors: PageError[]
) {
  const s = src.s;
  let i2 = s.indexOf(term, i1);
  if (i2 < 0) {
    errors.push(
      new PageError('error', 'Unterminated attribute value', src.loc(i1, i1))
    );
    throw new Error();
  } else {
    a.quote = String.fromCharCode(quote);
    let j = i2 + term.length;
    while (j < s.length && s.charCodeAt(j) === term.charCodeAt(0)) {
      i2++;
      j++;
    }
    a.value = dom.unescapeText(s.substring(i1, i2));
    i1 = i2 + term.length;
    a.loc.end = src.pos(i1);
    a.loc.i2 = i1;
    a.valueLoc!.end = src.pos(i1);
    a.valueLoc!.i2 = i1;
  }
  return i1;
}

function parseExpressionValue(
  p: dom.ServerElement,
  a: dom.ServerAttribute,
  src: Source,
  i1: number,
  errors: PageError[]
) {
  const s = src.s;
  const exp = parseExpression(p, src, i1, errors);
  let i2 = exp.end;
  i2 = skipBlanks(s, i2);
  if (i2 >= s.length || s.charCodeAt(i2) !== REXP) {
    errors.push(
      new PageError(
        'error',
        'Unterminated attribute expression',
        src.loc(i1, i1)
      )
    );
    // abort parsing
    throw new Error();
  }
  i2++;
  a.value = exp;
  a.loc.end = src.pos(i2);
  a.loc.i2 = i2;
  a.valueLoc!.end = src.pos(i2);
  a.valueLoc!.i2 = i2;
  return i2;
}

function parseText(
  p: dom.ServerElement,
  src: Source,
  i1: number,
  i2: number,
  errors: PageError[]
) {
  if (ATOMIC_TEXT_TAGS.has(p.tagName)) {
    parseAtomicText(p, src, i1, i2, errors);
  } else {
    parseSplittableText(p, src, i1, i2, errors);
  }
}

function parseAtomicText(
  p: dom.ServerElement,
  src: Source,
  i1: number,
  i2: number,
  errors: PageError[]
) {
  const s = src.s;
  const k = s.indexOf(LEXP, i1);
  if (k < 0 || k >= i2) {
    // static text
    p.appendChild(
      new dom.ServerText(p.ownerDocument, s.substring(i1, i2), src.loc(i1, i2))
    );
    return;
  }
  const exps = new Array<acorn.Expression>();
  for (let j1 = i1; j1 < i2; ) {
    let j2 = s.indexOf(LEXP, j1);
    if (j2 < 0 || j2 >= i2) {
      exps.push({
        type: 'Literal',
        value: s.substring(j1, i2),
        start: j1,
        end: i2,
        loc: src.loc(j1, i2),
      });
      break;
    }
    if (j2 > j1) {
      exps.push({
        type: 'Literal',
        value: s.substring(j1, j2),
        start: j1,
        end: j2,
        loc: src.loc(j1, j2),
      });
      j1 = j2;
    }
    j2 += LEXP.length;
    j1 = skipBlanks(s, j2);
    if (j1 >= i2 || s.charCodeAt(j1) === REXP) {
      errors.push(
        new PageError('error', 'Invalid expression', src.loc(j2, j2))
      );
      break;
    }
    const exp = parseExpression(p, src, j1, errors);
    j1 = exp.end;
    j1 = skipBlanks(s, j1);
    if (s.charCodeAt(j1) === REXP) {
      j1++;
    }
    exps.push(exp);
  }
  // ensure first expression is a string literal so '+' will mean concatenation
  if (exps[0].type !== 'Literal' || typeof exps[0].value !== 'string') {
    exps.unshift({
      type: 'Literal',
      value: '',
      start: i1,
      end: i1,
      loc: src.loc(i1, i1),
    });
  }
  if (exps.length === 1) {
    p.appendChild(
      new dom.ServerText(p.ownerDocument, exps[0], src.loc(i1, i2))
    );
    return;
  }
  function concat(n: number): acorn.BinaryExpression {
    const start = n > 1 ? exps[n - 1].start : exps[0].start;
    const end = exps[n].end;
    return {
      type: 'BinaryExpression',
      operator: '+',
      left: n > 1 ? concat(n - 1) : exps[0],
      right: exps[n],
      start,
      end,
      loc: src.loc(start, end),
    };
  }
  const exp = concat(exps.length - 1);
  p.appendChild(new dom.ServerText(p.ownerDocument, exp, src.loc(i1, i2)));
}

function parseSplittableText(
  p: dom.ServerElement,
  src: Source,
  i1: number,
  i2: number,
  errors: PageError[]
) {
  const s = src.s;
  for (let j1 = i1; j1 < i2; ) {
    let j2 = s.indexOf(LEXP, j1);
    if (j2 < 0 || j2 >= i2) {
      p.appendChild(
        new dom.ServerText(
          p.ownerDocument,
          s.substring(j1, i2),
          src.loc(j1, i2)
        )
      );
      break;
    }
    if (j2 > j1) {
      p.appendChild(
        new dom.ServerText(
          p.ownerDocument,
          s.substring(j1, j2),
          src.loc(j1, j2)
        )
      );
      j1 = j2;
    }
    const j0 = j2;
    j2 += LEXP.length;
    j1 = skipBlanks(s, j2);
    if (j1 >= i2 || s.charCodeAt(j1) === REXP) {
      errors.push(
        new PageError('error', 'Invalid expression', src.loc(j2, j2))
      );
      break;
    }
    const exp = parseExpression(p, src, j1, errors);
    j1 = exp.end;
    j1 = skipBlanks(s, j1);
    if (s.charCodeAt(j1) === REXP) {
      j1++;
    }
    p.appendChild(new dom.ServerText(p.ownerDocument, exp, src.loc(j0, j1)));
  }
}

function parseExpression(
  p: dom.ServerElement,
  src: Source,
  i1: number,
  errors: PageError[]
) {
  const s = src.s;
  try {
    const exp = acorn.parseExpressionAt(s, i1, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      sourceFile: src.fname,
    });
    return exp;
  } catch (err) {
    errors.push(new PageError('error', `${err}`, src.loc(i1, i1)));
    // abort parsing
    throw new Error();
  }
}

// =============================================================================
// utils
// =============================================================================

function hasAttribute(e: dom.ServerElement, name: string): boolean {
  for (const a of e.attributes) {
    if (a.name === name) {
      return true;
    }
  }
  return false;
}

function skipBlanks(s: string, i: number) {
  while (i < s.length) {
    if (s.charCodeAt(i) > 32) {
      break;
    }
    i++;
  }
  return i;
}

function skipBlanksAndComments(s: string, i: number) {
  i = skipBlanks(s, i);
  while (i < s.length) {
    if (s.startsWith('//', i)) {
      const i2 = s.indexOf('\n', i + 2);
      if (i2 < 0) {
        return s.length;
      }
      i = i2 + 1;
    } else if (s.startsWith('/*', i)) {
      const i2 = s.indexOf('*/', i + 2);
      if (i2 < 0) {
        return s.length;
      }
      i = i2 + 2;
    } else {
      return i;
    }
    i = skipBlanks(s, i);
  }
  return i;
}

function skipContent(
  p: dom.ServerElement,
  tag: string,
  src: Source,
  i1: number,
  errors: PageError[]
) {
  const s = src.s;
  let i2;
  while ((i2 = s.indexOf('</', i1)) >= 0) {
    const i0 = i2;
    i1 = i2 + 2;
    i2 = skipName(src, i1);
    if (i2 > i1) {
      if (s.substring(i1, i2).toUpperCase() === tag) {
        i2 = skipBlanks(s, i2);
        if (s.charCodeAt(i2) != GT) {
          errors.push(
            new PageError('error', 'Unterminated close tag', src.loc(i1, i1))
          );
          throw new Error();
        }
        i2++;
        // break;
        return { i0, i2 };
      }
    }
    i1 = i2;
  }
  return null;
}

function skipName(src: Source, i: number, acceptsDots = false) {
  const s = src.s;
  while (i < s.length) {
    const code = s.charCodeAt(i);
    if (
      (code < 'a'.charCodeAt(0) || code > 'z'.charCodeAt(0)) &&
      (code < 'A'.charCodeAt(0) || code > 'Z'.charCodeAt(0)) &&
      (code < '0'.charCodeAt(0) || code > '9'.charCodeAt(0)) &&
      code != DASH &&
      code != '_'.charCodeAt(0) &&
      (!acceptsDots || code != '.'.charCodeAt(0)) &&
      code != ':'.charCodeAt(0)
    ) {
      break;
    }
    i++;
  }
  return i;
}

function skipComment(
  p: dom.ServerElement,
  src: Source,
  i1: number,
  errors: PageError[]
) {
  const s = src.s;
  if (
    s.charCodeAt(i1) === '!'.charCodeAt(0) &&
    s.charCodeAt(i1 + 1) === DASH &&
    s.charCodeAt(i1 + 2) === DASH
  ) {
    if ((i1 = s.indexOf('-->', i1 + 3)) < 0) {
      errors.push(
        new PageError('error', 'Unterminated comment', src.loc(i1, i1))
      );
      throw new Error();
    }
    i1 += 3;
  }
  return i1;
}

export function normalizeText(s?: string): string | undefined {
  return s
    ?.split(/\n\s+/)
    .join('\n')
    .split(/\s{2,}/)
    .join(' ');
}

// export function normalizeSpace(s?: string): string | undefined {
//   return s?.split(/\s+/).join(' ');
// }

export class Source {
  s!: string;
  fname: string;
  files: string[];
  linestarts!: number[];
  errors!: PageError[];
  doc!: dom.ServerDocument;

  constructor(s: string, fname: string) {
    this.reset(s);
    this.fname = fname;
    this.files = [];
  }

  reset(s: string) {
    this.s = s = s.trimEnd();
    this.linestarts = [0];
    this.errors = [];
    this.doc = new dom.ServerDocument(this.loc(0, s.length));
    for (let i1 = 0, i2; (i2 = s.indexOf('\n', i1)) >= 0; i1 = i2 + 1) {
      this.linestarts.push(i2 + 1);
    }
  }

  addError(
    type: 'error' | 'warning',
    msg: string,
    loc: acorn.SourceLocation | null | undefined
  ) {
    this.errors.push(new PageError(type, msg, loc));
  }

  pos(n: number): acorn.Position {
    const max = this.linestarts.length - 1;
    let i1 = 0,
      i2 = max;
    while (i1 < i2) {
      const j = i1 + Math.floor((i2 - i1) / 2);
      const n1 = this.linestarts[j];
      const n2 = j < max ? this.linestarts[j + 1] : n1;
      if (n >= n1 && n < n2) {
        i1 = i2 = j;
      } else if (n >= n2) {
        i1 = j + 1;
      } else if (n < n1) {
        i2 = j;
      }
    }
    return {
      // 1-based
      line: i1 + 1,
      // 0-based
      column: n - this.linestarts[i1],
    };
  }

  loc(i1: number, i2: number): dom.SourceLocation {
    return {
      source: this.fname,
      start: this.pos(i1),
      end: this.pos(i2),
      i1,
      i2,
    };
  }

  get lineCount() {
    return this.linestarts.length;
  }
}

export class PageError {
  type: 'error' | 'warning';
  msg: string;
  loc?: acorn.SourceLocation;

  constructor(
    type: 'error' | 'warning',
    msg: string,
    loc: acorn.SourceLocation | null | undefined
  ) {
    this.type = type;
    this.msg = msg;
    this.loc = loc ?? undefined;
  }
}
