/**
 * Serializes a `:server-` result to a JavaScript literal.
 *
 * A JS literal rather than JSON, because JSON loses things this language
 * treats as ordinary. `undefined` is the clearest case: a failed expression
 * yields `undefined` and deliberately never `null` (see docs/concepts/
 * values.md), so a format that lands it as `null` would transfer a different
 * fact than the server had. `Date`, `Map`, `Set` and `BigInt` are the same
 * argument from the other end -- `structuredClone` and `BigInt` are both on
 * the globals list, so the language already presents these as unremarkable.
 *
 * The output goes into a `<script>`, so it is escaped for that: no `<` from
 * a transferred value survives `quote`, which is what keeps a database row
 * holding `</script>` from closing the element it is sitting in.
 * `escapeScriptText` backs that up for the text around it.
 */

/** thrown for a value that cannot cross; the caller reports it and moves on */
export class UnserializableError extends Error {
  constructor(what: string) {
    super(`cannot be sent to the client: ${what}`);
    this.name = 'UnserializableError';
  }
}

export function serialize(value: unknown): string {
  return write(value, new Set());
}

function write(value: unknown, path: Set<object>): string {
  switch (typeof value) {
    case 'undefined':
      // `void 0`, not `undefined`: the latter is an ordinary identifier and
      // could in principle be shadowed where this lands
      return 'void 0';
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return writeNumber(value);
    case 'bigint':
      return `${value}n`;
    case 'string':
      return quote(value);
    case 'function':
      throw new UnserializableError('a function');
    case 'symbol':
      throw new UnserializableError('a symbol');
  }
  if (value === null) {
    return 'null';
  }
  const object = value as object;
  // Cycles are refused rather than encoded. Encoding them means hoisting
  // every container into a var and filling it afterwards, which changes the
  // shape of ALL output to serve a case a server-only value is unlikely to
  // reach. A clear error beats a format nobody can read -- and note this
  // also means two references to the same object arrive as two objects:
  // identity does not survive the trip, only structure.
  if (path.has(object)) {
    throw new UnserializableError('a circular structure');
  }
  path.add(object);
  try {
    return writeObject(object, path);
  } finally {
    path.delete(object);
  }
}

function writeObject(value: object, path: Set<object>): string {
  if (Array.isArray(value)) {
    // holes stay holes: `[1,,3]` is a different array from `[1,undefined,3]`
    const parts = value.map((v, i) => (i in value ? write(v, path) : ''));
    return `[${parts.join(',')}]`;
  }
  if (value instanceof Date) {
    // an invalid Date has no round-trippable literal; NaN through the
    // constructor reproduces it exactly
    return `new Date(${writeNumber(value.getTime())})`;
  }
  if (value instanceof RegExp) {
    // the constructor rather than a literal, so that the pattern crosses as
    // a string and every byte of it goes through `quote` like all the
    // others. A literal would put user bytes into the output raw, which is
    // the one thing this file is careful never to do -- and `/<!--x/u`
    // written out raw is a syntax error waiting for `escapeScriptText`.
    // `source` round-trips exactly, an empty regex included: it reads back
    // as `(?:)`, which is what the literal shows too
    return `new RegExp(${quote(value.source)},${quote(value.flags)})`;
  }
  if (value instanceof Map) {
    const parts = [...value].map(([k, v]) => `[${write(k, path)},${write(v, path)}]`);
    return `new Map([${parts.join(',')}])`;
  }
  if (value instanceof Set) {
    return `new Set([${[...value].map(v => write(v, path)).join(',')}])`;
  }
  if (value instanceof URL) {
    return `new URL(${quote(`${value}`)})`;
  }
  // A class instance would serialize as a plain object and arrive without
  // its prototype, so its methods would be gone and only its fields would
  // survive -- the kind of quietly-wrong result this codebase reports rather
  // than produces. Only plain objects and null-prototype ones pass.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    const name = value.constructor?.name;
    throw new UnserializableError(`an instance of ${name || 'a class'}`);
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    parts.push(`${quoteKey(k)}:${write(v, path)}`);
  }
  return `{${parts.join(',')}}`;
}

function writeNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  // `Object.is` rather than `=== 0`, which cannot tell the two zeroes apart.
  // `-0` matters wherever a number carries a direction as well as a size
  if (Object.is(value, -0)) return '-0';
  return `${value}`;
}

// an identifier-shaped key is written bare, anything else quoted. Purely
// cosmetic -- it keeps the blob readable in a page's source, which is how
// "what did I just publish?" gets answered
const BARE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function quoteKey(key: string): string {
  return BARE_KEY.test(key) ? key : quote(key);
}

const ESCAPES: { [ch: string]: string } = {
  '\\': '\\\\',
  '"': '\\"',
  // not a JS concern at all: `<` is escaped because of where this lands.
  // `</script` and `<!--` both end an inline script's contents early, and
  // neither can be spelled without this character -- so escaping it means
  // no string, key or pattern from a `:server-` value can reach for the
  // markup around it, whatever else it holds. Six bytes per `<` in
  // transferred text, which is a price worth not thinking about
  '<': '\\u003c',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
  '\v': '\\v',
};

export function quote(s: string): string {
  let out = '"';
  // by code unit rather than code point: a lone surrogate -- half an emoji,
  // left behind by a slice somewhere upstream -- is not valid on its own and
  // has to be escaped rather than written through
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    const escape = ESCAPES[ch];
    if (escape) {
      out += escape;
    } else if (
      code < 0x20 ||
      code === 0x7f ||
      // legal in a JSON string but line terminators in JS source before
      // ES2019, and cheap insurance against an old engine either way
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0xd800 && code <= 0xdfff && !isPaired(s, i, code))
    ) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += ch;
    }
  }
  return out + '"';
}

function isPaired(s: string, i: number, code: number): boolean {
  if (code <= 0xdbff) {
    const next = s.charCodeAt(i + 1);
    return next >= 0xdc00 && next <= 0xdfff;
  }
  const prev = s.charCodeAt(i - 1);
  return prev >= 0xd800 && prev <= 0xdbff;
}

/**
 * Escapes generated JS for embedding in an inline `<script>`.
 *
 * The props script has needed the `</script` half of this all along, where
 * the only source of one was a string the page's own author wrote. A server-only
 * value can carry bytes from anywhere -- a fetch response, a database row --
 * and it covers `<!--` too: inside a script element that sequence opens a
 * legacy comment, after which the parser stops treating `</script` as the
 * end of the element until it sees `-->`.
 *
 * For everything `serialize` produces this is now a BACKSTOP and nothing
 * more: `quote` escapes `<` itself, so neither sequence can be spelled by
 * the time the text arrives here. That is deliberate -- the guarantee is
 * easier to check where the value is written than by reasoning about what a
 * regular expression over finished source can and cannot see. It stays
 * because the state blob is not the only thing that reaches a `<script>`.
 */
export function escapeScriptText(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}
