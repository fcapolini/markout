import vm from 'vm';
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler';
import { comptimeRealm, COMPTIME_TIMEOUT_MS } from '../../src/compiler/comptime-realm';

/**
 * A compile-time constant cannot reach the process compiling it.
 *
 * This matters because of who writes one. A page is its author's own code,
 * but a KIT is a package installed with one click from a sidebar, and its
 * fragments are spliced into every page that imports them -- so a `:const-`
 * in a kit runs in `markout build` on a CI machine holding deploy secrets,
 * and in the language server on every keystroke.
 *
 * Every payload below reached `process` before this was sandboxed. They are
 * kept as a list rather than reduced to one because the point is that they
 * are not a list of holes: `x.constructor.constructor` is `Function` for
 * every object in the language, so any allowlist that hands over real host
 * objects hands over the host. See comptime-realm.ts.
 */

/** what a kit would write, and what each route reaches the host through */
const ESCAPES: [name: string, expression: string][] = [
  ['a string literal', `''.constructor.constructor('return typeof process')()`],
  ['an array literal', `[].constructor.constructor('return typeof process')()`],
  ['a number literal', `(0).constructor.constructor('return typeof process')()`],
  ['an object literal', `({}).constructor.constructor('return typeof process')()`],
  ['a regex literal', `/x/.constructor.constructor('return typeof process')()`],
  ['__proto__', `''.__proto__.constructor.constructor('return typeof process')()`],
  ['an arrow function', `(()=>1).constructor('return typeof process')()`],
  ['an async function', `(async()=>1).constructor('return typeof process')()`],
  // `new Function` bodies are sloppy-mode, where `this` IS the global object.
  // No prototype walk, no constructor, nothing to deny by name.
  ['sloppy-mode `this`', `(function(){ return typeof this.process })()`],
];

/** compile a page whose only content is one `:const-` value, and read it back */
async function constantOf(expression: string) {
  return pageOf(`<html><body><div :const-p=\${${expression}}>[\${p}]</div></body></html>`);
}

/** the given markup as `/page.html`, from memory rather than from a docroot */
async function pageOf(html: string) {
  const page = await new Compiler({
    docroot: '/nowhere',
    readFile: async () => html,
  }).compile('/page.html');
  return {
    errors: page.errors.map(e => e.msg),
    // a constant is substituted into its readers, so what it computed to is
    // in the markup -- which is also where it would land in a built page
    text: page.source.doc.toString(),
  };
}

describe('a `:const-` value cannot reach the host realm', () => {
  it.each(ESCAPES)('is contained through %s', async (_name, expression) => {
    const { errors, text } = await constantOf(expression);
    // `process` must not be reachable: the sandbox has no such global, so the
    // route either throws or answers "undefined" -- never "object"
    expect(text).not.toContain('object');
    expect(errors.join('\n')).not.toContain('object');
  });

  it('cannot read an environment variable', async () => {
    process.env.MARKOUT_TEST_SECRET = 'sk-live-do-not-leak';
    try {
      const { text } = await constantOf(
        `''.constructor.constructor('return process.env.MARKOUT_TEST_SECRET')()`
      );
      expect(text).not.toContain('sk-live');
    } finally {
      delete process.env.MARKOUT_TEST_SECRET;
    }
  });

  it('cannot require a module', async () => {
    const { text } = await constantOf(
      `''.constructor.constructor('return typeof process.mainModule.require')()`
    );
    expect(text).not.toContain('function');
  });
});

describe('what a constant may still do', () => {
  it('computes from literals, which is what it is for', async () => {
    const { errors, text } = await constantOf(`'#' + (0x6f42c1).toString(16)`);
    expect(errors).toEqual([]);
    expect(text).toContain('#6f42c1');
  });

  it('reads another constant', async () => {
    const { errors, text } = await pageOf(
      '<html><body :const-base=${8}><div :const-wide=${base * 2}>[${wide}]</div>' +
        '</body></html>'
    );
    expect(errors).toEqual([]);
    expect(text).toContain('16');
  });

  it('reports a constant that throws, against the value', async () => {
    const { errors } = await constantOf(`null.oops`);
    expect(errors[0]).toContain('"p" could not be computed');
  });
});

describe('comptimeRealm', () => {
  it('denies eval and the Function constructor inside the sandbox', () => {
    // belt to the realm's braces: a constant computes a token from literals
    // and has no use for either, so switching them off costs nothing and
    // makes the prototype routes fail at their last step as well
    const realm = comptimeRealm();
    expect(() => realm.run(`''.constructor.constructor('return 1')()`)).toThrow();
    expect(realm.run('1 + 1')).toBe(2);
  });

  it('stops an expression that never finishes', () => {
    // this used to hang whatever was compiling, which in the editor is a
    // language server that never answers again
    const realm = comptimeRealm();
    expect(() => realm.run('(function(){ for(;;); })()')).toThrow();
  }, COMPTIME_TIMEOUT_MS * 3);

  it('keeps one page\'s constants out of the next page\'s sandbox', () => {
    const first = comptimeRealm();
    first.run('globalThis.polluted = 1');
    expect(comptimeRealm().run('typeof globalThis.polluted')).toBe('undefined');
  });
});

describe('why `vm` is enough here, and where it would not be', () => {
  it('is opened completely by seeding a context with host objects', () => {
    // Node says `vm` is not a security boundary, and this is what it means:
    // a host object put INTO a context leads back out through its prototype.
    // The realm seeds nothing and lets only primitives cross, which is the
    // condition that makes it hold -- asserted here so that a later change
    // adding a convenience global has to come past this test.
    const seeded = vm.createContext({ Object });
    expect(
      vm.runInContext(`Object.constructor('return typeof process')()`, seeded)
    ).toBe('object');

    const bare = vm.createContext(Object.create(null));
    expect(
      vm.runInContext(`Object.constructor('return typeof process')()`, bare)
    ).toBe('undefined');
  });
});
