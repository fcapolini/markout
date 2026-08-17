import { describe, expect, it } from 'vitest';
import {
  escapeScriptText,
  serialize,
  UnserializableError,
} from '../../src/render/serialize';

// A `:server-` result crosses to the client as a JS literal rather than as
// JSON, so what these assert is mostly that the things JSON would flatten
// survive. See docs/design/value-transfer.md for why each one is on the list.
//
// Every case round-trips through eval as well as being compared as text: the
// text says what was emitted, the round-trip says the client would rebuild
// the same value from it, and only the second one is the actual contract.
function roundTrip(value: unknown): unknown {
  // eslint-disable-next-line no-eval
  return (0, eval)(`(${serialize(value)})`);
}

describe('serialize: primitives', () => {
  it('writes the ordinary ones', () => {
    expect(serialize(1)).toBe('1');
    expect(serialize('a')).toBe('"a"');
    expect(serialize(true)).toBe('true');
    expect(serialize(false)).toBe('false');
    expect(serialize(null)).toBe('null');
  });

  it('keeps undefined distinct from null', () => {
    // the one JSON loses that this language cannot afford to: a failed
    // expression yields undefined and deliberately never null, so landing it
    // as null would transfer a different fact than the server had
    expect(serialize(undefined)).toBe('void 0');
    expect(roundTrip(undefined)).toBeUndefined();
    expect(roundTrip({ a: undefined })).toStrictEqual({ a: undefined });
    expect('a' in (roundTrip({ a: undefined }) as object)).toBe(true);
  });

  it('keeps the numbers JSON turns into null', () => {
    expect(roundTrip(NaN)).toBeNaN();
    expect(roundTrip(Infinity)).toBe(Infinity);
    expect(roundTrip(-Infinity)).toBe(-Infinity);
  });

  it('keeps -0 apart from 0', () => {
    expect(serialize(-0)).toBe('-0');
    expect(Object.is(roundTrip(-0), -0)).toBe(true);
    expect(Object.is(roundTrip(0), 0)).toBe(true);
  });

  it('writes a BigInt as one', () => {
    expect(serialize(10n ** 30n)).toBe('1000000000000000000000000000000n');
    expect(roundTrip(7n)).toBe(7n);
  });
});

describe('serialize: containers', () => {
  it('writes arrays and plain objects', () => {
    expect(serialize([1, 'two', null])).toBe('[1,"two",null]');
    expect(serialize({ a: 1, b: [2] })).toBe('{a:1,b:[2]}');
  });

  it('quotes a key that is not identifier-shaped', () => {
    expect(serialize({ 'a-b': 1, $c: 2, '2d': 3 })).toBe('{"a-b":1,$c:2,"2d":3}');
  });

  it('keeps array holes as holes', () => {
    // `[1,,3]` is not `[1,undefined,3]`: the first has no index 1 at all
    const holed = [1, , 3];
    expect(serialize(holed)).toBe('[1,,3]');
    expect(1 in (roundTrip(holed) as unknown[])).toBe(false);
  });

  it('round-trips Date, Map, Set, RegExp and URL', () => {
    const date = new Date(1_700_000_000_000);
    expect(roundTrip(date)).toStrictEqual(date);
    expect(roundTrip(new Map([['a', 1]]))).toStrictEqual(new Map([['a', 1]]));
    expect(roundTrip(new Set([1, 2]))).toStrictEqual(new Set([1, 2]));
    expect(roundTrip(/ab+/gi)).toStrictEqual(/ab+/gi);
    expect(`${roundTrip(new URL('https://x.test/a?b=1'))}`).toBe('https://x.test/a?b=1');
  });

  it('round-trips an invalid Date as one', () => {
    expect(Number.isNaN((roundTrip(new Date(NaN)) as Date).getTime())).toBe(true);
  });

  it('nests', () => {
    const value = { rows: [{ at: new Date(0), tags: new Set(['a']) }] };
    expect(roundTrip(value)).toStrictEqual(value);
  });

  it('passes a null-prototype object through as a plain one', () => {
    const bare = Object.create(null);
    bare.a = 1;
    expect(serialize(bare)).toBe('{a:1}');
  });
});

describe('serialize: strings', () => {
  it('escapes what would break the literal', () => {
    expect(roundTrip('he said "hi"\\')).toBe('he said "hi"\\');
    expect(roundTrip('a\nb\tc\r\0')).toBe('a\nb\tc\r\0');
  });

  it('escapes the JS line terminators JSON allows raw', () => {
    // legal inside a JSON string, but line terminators in JS source before
    // ES2019 -- so a raw one used to end the statement mid-string
    expect(serialize('a b c')).toBe('"a\\u2028b\\u2029c"');
    expect(roundTrip('a b c')).toBe('a b c');
  });

  it('keeps a paired surrogate whole and escapes a lone one', () => {
    expect(roundTrip('a😀b')).toBe('a😀b');
    expect(serialize('\ud800')).toBe('"\\ud800"');
    expect(roundTrip('\ud800')).toBe('\ud800');
  });
});

describe('serialize: what cannot cross', () => {
  it('refuses a function', () => {
    expect(() => serialize(() => 1)).toThrow(UnserializableError);
    expect(() => serialize({ go: () => 1 })).toThrow(/a function/);
  });

  it('refuses a symbol', () => {
    expect(() => serialize(Symbol('s'))).toThrow(/a symbol/);
  });

  it('refuses a class instance, naming the class', () => {
    // it would arrive as a plain object, with its fields but none of its
    // methods -- exactly the quietly-wrong result this codebase reports
    class Session {
      user = 'a';
    }
    expect(() => serialize(new Session())).toThrow(/an instance of Session/);
  });

  it('refuses a circular structure', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => serialize(a)).toThrow(/circular/);
  });

  it('does not mistake a repeated reference for a cycle', () => {
    // shared, not circular: it serializes, though the two arrive as separate
    // objects -- structure survives the trip, identity does not
    const shared = { n: 1 };
    expect(serialize([shared, shared])).toBe('[{n:1},{n:1}]');
    const [x, y] = roundTrip([shared, shared]) as object[];
    expect(x).toStrictEqual(y);
    expect(x).not.toBe(y);
  });
});

describe('escapeScriptText', () => {
  it('neutralizes a closing script tag in any case', () => {
    expect(escapeScriptText('"</script>"')).toBe('"<\\/script>"');
    // the replacement is a lowercase literal, so a mixed-case tag comes back
    // case-normalized. Only that it can no longer close the element matters
    expect(escapeScriptText('"</ScRiPt >"')).not.toMatch(/<\/script/i);
  });

  it('neutralizes a legacy comment opener', () => {
    // inside a script element `<!--` opens a comment the parser reads to
    // `-->`, and it stops recognizing the closing tag in between -- which is
    // enough to carry a `</script` past the first rule
    expect(escapeScriptText('"<!--"')).toBe('"<\\!--"');
  });

  it('survives a hostile payload end to end', () => {
    const hostile = { note: '</script><script>alert(1)</script><!--' };
    const emitted = escapeScriptText(`window.S = ${serialize(hostile)};`);
    expect(emitted).not.toMatch(/<\/script/i);
    expect(emitted).not.toContain('<!--');
    // and still means what it said
    const window: Record<string, unknown> = {};
    // eslint-disable-next-line no-new-func
    new Function('window', emitted)(window);
    expect(window.S).toStrictEqual(hostile);
  });
});
