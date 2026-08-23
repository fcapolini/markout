import { describe, expect, it, beforeEach } from 'vitest';
import * as acorn from 'acorn';
import { generate } from 'escodegen';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../src/compiler/stages/stage4-resolve';
import { DEFAULT_RUNTIME_SRC, stage7generate } from '../../src/compiler/stages/stage7-generate';
import { Page } from '../../src/compiler/ir/Page';
import { Scope } from '../../src/compiler/ir/Scope';
import { Value } from '../../src/compiler/ir/Value';
import { ServerAttribute, ServerDocument, SourceLocation } from '../../src/html/server-dom';
import { Source, parse } from '../../src/html/parser';
import { NodeType } from '../../src/html/dom';
import { renderPage } from '../../src/render/render';
import { loadProps } from '../../src/render/props';

const LOC: SourceLocation = {
  start: { line: 0, column: 0 },
  end: { line: 0, column: 0 },
  i1: 0,
  i2: 0,
};

// simulates a value already qualified by stage3 (this.foo / this.$parent.foo)
function parseExpr(source: string): acorn.Expression {
  return acorn.parseExpressionAt(source, 0, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    locations: true,
  });
}

/**
 * The props as a loader gets them: the expression array and the tree that
 * refers to it by index.
 *
 * Loaded from what the page carries rather than off an intermediate, so
 * these assertions see the artifacts themselves -- including that they
 * parse at all, which is the one thing an AST could never tell us.
 */
function emitted(page: Page): { e: ((s: any) => any)[]; p: any } {
  const { root, exps } = loadProps(page.props!);
  return { e: exps as any, p: root };
}

/** a scope's or value's property, and the expression an `exp` index names */
const prop = (obj: any, name: string): any => obj?.[name];
const expOf = (loaded: { e: ((s: any) => any)[] }, value: any) => loaded.e[value.exp];

describe('stage7-generate', () => {
  let doc: ServerDocument;
  let page: Page;
  let root: Scope;

  beforeEach(() => {
    doc = new ServerDocument('test');
    const source = new Source('test.html', '<html></html>');
    source.doc = doc;
    page = new Page(source);
    root = new Scope(page, page.global, undefined, 'page');
  });

  function addValue(scope: Scope, name: string, value: string | object | null) {
    const attr = new ServerAttribute(doc, null as any, `:${name}`, null, LOC);
    attr.value = value as any;
    attr.valueLoc = LOC;
    const v = new Value(name, attr, scope);
    scope.values.set(name, v);
    return v;
  }

  it('should generate props carrying the root scope id and name', async () => {
    stage4resolve(page);
    stage7generate(page);

    const loaded = emitted(page);
    expect(loaded.p.id).toBe(root.id);
    expect(loaded.p.name).toBe('page');
    expect(Array.isArray(loaded.e)).toBe(true);
    // the tree arrives as data rather than as evaluated JavaScript
    // the tree is data, and stays data: JSON that never becomes JavaScript
    expect(() => JSON.parse(page.props!.data)).not.toThrow();
  });

  it('should compile a literal value into an exp function returning that constant', async () => {
    addValue(root, 'count', parseExpr('42'));

    stage4resolve(page);
    stage7generate(page);

    const loaded = emitted(page);
    expect(expOf(loaded, prop(loaded.p.values, 'count'))({})).toBe(42);
  });

  it('should compile a plain (non-`${}`) string value into an exp returning that literal string', async () => {
    addValue(root, 'label', 'hello');

    stage4resolve(page);
    stage7generate(page);

    const loaded = emitted(page);
    expect(expOf(loaded, prop(loaded.p.values, 'label'))({})).toBe('hello');
  });

  it('should treat a presence-only (null) value as true', async () => {
    addValue(root, 'class$active', null);

    stage4resolve(page);
    stage7generate(page);

    const loaded = emitted(page);
    expect(expOf(loaded, prop(loaded.p.values, 'class$active'))({})).toBe(true);
  });

  it('should qualify $.foo references and evaluate them against the given scope proxy', async () => {
    addValue(root, 'doubled', parseExpr('$.count * 2'));

    stage4resolve(page);
    stage7generate(page);

    const loaded = emitted(page);
    // handed the scope, rather than wearing it as `this`: the wrapper is an
    // arrow now, which is what let the language stop refusing classic
    // functions inside expressions
    expect(expOf(loaded, prop(loaded.p.values, 'doubled'))({ count: 21 })).toBe(42);
  });

  it('should compile deps into the path each one names', async () => {
    addValue(root, 'count', null);
    addValue(page.global, 'count', null);
    addValue(root, 'doubled', parseExpr('$.count * 2'));
    addValue(root, 'fromParent', parseExpr('$.$parent.count * 2'));

    stage4resolve(page);
    stage7generate(page);

    const seen: { viaParent: boolean; key: string }[] = [];
    const fakeScope = {
      $value: (key: string) => {
        seen.push({ viaParent: false, key });
        return 'own-value';
      },
      $parent: {
        $value: (key: string) => {
          seen.push({ viaParent: true, key });
          return 'parent-value';
        },
      },
    };

    // the path to the value, not a closure that walks it: everything before
    // the last segment is a scope navigation and the last is the key. The
    // runtime does the walking (CoreValue.resolveDep), which is what took
    // one allocated-and-called-once function per edge out of the props
    const values = emitted(page).p.values;
    expect(values.doubled.deps).toEqual([['count']]);
    expect(values.fromParent.deps).toEqual([['$parent', 'count']]);
    void fakeScope;
    void seen;
  });

  it('should translate compiled key prefixes to the ones WebScope expects', async () => {
    addValue(root, 'on$click', parseExpr('() => {}'));
    const textAttr = new ServerAttribute(doc, null as any, ':t$0', null, LOC);
    textAttr.value = parseExpr('$.count');
    textAttr.valueLoc = LOC;
    const textValue = new Value('t$0', textAttr, root);
    root.textValues.set('t$0', textValue);
    addValue(root, 'class$active', parseExpr('true'));
    addValue(root, 'style$color', parseExpr('"red"'));

    stage4resolve(page);
    stage7generate(page);

    const keys = Object.keys(emitted(page).p.values);
    expect(keys).toContain('event$click');
    expect(keys).toContain('text$0');
    expect(keys).toContain('class$active');
    expect(keys).toContain('style$color');
    expect(keys).not.toContain('on$click');
    expect(keys).not.toContain('t$0');
  });

  it('should recurse into child scopes', async () => {
    const child = new Scope(page, root, undefined, 'child');
    addValue(child, 'x', parseExpr('1'));

    stage4resolve(page);
    stage7generate(page);

    const loaded = emitted(page);
    const children = loaded.p.children;
    expect(children).toHaveLength(1);
    expect(children[0].id).toBe(child.id);
    expect(expOf(loaded, prop(children[0].values, 'x'))({})).toBe(1);
  });
});

describe('stage7-generate bootstrap scripts', () => {
  function compilePage(html: string, runtimeSrc?: string) {
    const p = new Page(parse(html, 'test.html'));
    stage1load(p);
    stage2validate(p);
    stage3qualify(p);
    stage4resolve(p);
    stage7generate(p, runtimeSrc);
    return p;
  }

  /** the scripts markout injected that are actually script */
  function bodyScripts(p: Page) {
    return p.source.doc.body!.childNodes.filter(
      (n: any) =>
        n.nodeType === NodeType.ELEMENT &&
        n.tagName === 'SCRIPT' &&
        // the props data block is a `type="application/json"` script that
        // the browser stores as text and never runs -- see emitProps
        n.getAttribute('type') === null
    ) as any[];
  }

  /** the props tree, carried as JSON beside them */
  function dataScript(p: Page) {
    return p.source.doc.body!.childNodes.find(
      (n: any) => n.nodeType === NodeType.ELEMENT && n.getAttribute?.('type') === 'application/json'
    ) as any;
  }

  it('should append a props script and an async runtime script to the end of body', async () => {
    const p = compilePage('<html><body></body></html>');
    const scripts = bodyScripts(p);

    expect(scripts).toHaveLength(2);
    const [propsScript, runtimeScript] = scripts;
    expect((propsScript.childNodes[0] as any).textContent).toContain('window.__MARKOUT_PROPS =');
    expect(runtimeScript.getAttribute('src')).toBe(DEFAULT_RUNTIME_SRC);
    expect(runtimeScript.getAttributeNode('async')).not.toBeNull();
  });

  it('should honor a custom runtimeSrc', async () => {
    const p = compilePage('<html><body></body></html>', '/custom-runtime.js');
    const [, runtimeScript] = bodyScripts(p);

    expect(runtimeScript.getAttribute('src')).toBe('/custom-runtime.js');
  });

  it('should escape a literal </script> found inside generated source', async () => {
    const p = compilePage(
      '<html :label=${"</script><script>alert(1)</script>"}></html>'
    );
    const [propsScript] = bodyScripts(p);
    const text = (propsScript.childNodes[0] as any).textContent as string;

    expect(text).not.toMatch(/<\/script>/i);
    expect(text).toContain('<\\/script>');
  });

  // The escaper works on finished source and cannot tell a string from a
  // regex. Its `<!--` rewrite is harmless in the first and a syntax error in
  // the second under `u`/`v`, where identity escapes were removed -- and the
  // blast radius is the whole page: the props script does not parse, so
  // nothing binds, nothing updates, and no error is raised anywhere. So the
  // pattern is moved into a string before the escaper ever sees it.
  it('keeps the props script parseable when an expression holds a unicode regex', async () => {
    const p = compilePage('<html :hit=${/<!--x/u.test("a")}></html>');
    const [propsScript] = bodyScripts(p);
    const text = (propsScript.childNodes[0] as any).textContent as string;

    expect(text).toContain('new RegExp(');
    expect(text).not.toContain('/<');
    // run it the way a page does: the script reads the tree out of the
    // data block beside it, so the stub answers with that element's text
    const json = (dataScript(p).childNodes[0] as any).textContent as string;
    const fakeDocument = { querySelector: () => ({ textContent: json }) };
    // the whole point: it runs
    // eslint-disable-next-line no-new-func
    expect(() => new Function('window', 'document', text)({}, fakeDocument)).not.toThrow();
    // and still says what the author wrote
    const window: any = {};
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', text)(window, fakeDocument);
    const { e, p: scope } = window.__MARKOUT_PROPS;
    const hit = scope.values['hit'] ?? scope.children[0]?.values['hit'];
    expect(e[hit.exp]({})).toBe(false);
    expect(e[hit.exp]({}) === /<!--x/u.test('a')).toBe(true);
  });

  it('leaves a regex without the character alone', async () => {
    const p = compilePage('<html :hit=${/ab+/gi.test("abb")}></html>');
    const [propsScript] = bodyScripts(p);
    const text = (propsScript.childNodes[0] as any).textContent as string;

    expect(text).toContain('/ab+/gi');
    expect(text).not.toContain('new RegExp(');
  });
});

describe('stage7-generate full pipeline: dependency codegen', () => {
  function compilePage(html: string) {
    const p = new Page(parse(html, 'test.html'));
    stage1load(p);
    stage2validate(p);
    stage3qualify(p);
    stage4resolve(p);
    stage7generate(p);
    return p;
  }

  it('compiles a same-scope reference from a plain child element into a bare key', async () => {
    // :count and ${count} end up on the same scope: <p> has no special
    // attribute of its own, so it doesn't get a scope and the
    // interpolation attaches to the enclosing <div>'s
    const p = compilePage(
      '<html><body><div :count=${0}><p>${count}</p></div></body></html>'
    );

    const body = emitted(p).p.children[1];
    const div = body.children[0];
    const textValue = prop(div, 'values')['text$0'];
    expect(prop(textValue, 'deps')[0]).toEqual(['count']);
  });

  it('still compiles to the same path when the reference lives in its own nested (:aka) scope', async () => {
    // ${count} qualifies to `this.count` regardless of which scope actually
    // owns it -- the scope-chain walk happens at runtime, in lookup(),
    // never at compile time -- so this must compile exactly like the
    // same-scope case above, even though <p> now has its own scope
    const p = compilePage(
      '<html><body><div :count=${0}><p :aka="foo">${count}</p></div></body></html>'
    );

    const body = emitted(p).p.children[1];
    const div = body.children[0];
    const foo = div.children[0];
    const textValue = prop(foo, 'values')['text$0'];
    expect(prop(textValue, 'deps')[0]).toEqual(['count']);
  });
});

describe('stage7-generate full pipeline: nested :for-each', () => {
  function compilePage(html: string) {
    const p = new Page(parse(html, 'test.html'));
    stage1load(p);
    stage2validate(p);
    stage3qualify(p);
    stage4resolve(p);
    stage7generate(p);
    return p;
  }

  it('renders each sub-array with its own items, not the outer alias shadowing itself', async () => {
    // regression test: :for-each's own alias (default 'data') used to be
    // qualified as a same-scope reference, so a nested :for-each=${data}
    // accidentally resolved to the alias IT was about to define instead of
    // the outer :for-each's already-bound array -- this is the README's
    // own flagship replication example
    const p = compilePage(
      '<html><body><ul :for-each=${[[1, 2, 3], [4, 5]]}>' +
        '<li :for-each=${data}>Item ${data}</li></ul></body></html>'
    );
    expect(p.errors).toStrictEqual([]);

    await renderPage(p);
    const markup = p.source.doc.body!.toString();

    expect(markup).toContain('<!---t0-->1<!---/-->');
    expect(markup).toContain('<!---t0-->2<!---/-->');
    expect(markup).toContain('<!---t0-->3<!---/-->');
    expect(markup).toContain('<!---t0-->4<!---/-->');
    expect(markup).toContain('<!---t0-->5<!---/-->');
  });

  it('still shadows correctly when both levels use the same custom :for-as alias', async () => {
    // shadowKeyFor() must use the SCOPE'S OWN resolved alias (whatever
    // :for-as says), not a hardcoded 'data' -- verify that holds even when
    // the outer and inner :for-each deliberately reuse the same alias name
    const p = compilePage(
      '<html><body><ul :for-each=${[[1, 2, 3], [4, 5]]} :for-as="item">' +
        '<li :for-each=${item} :for-as="item">Item ${item}</li></ul></body></html>'
    );
    expect(p.errors).toStrictEqual([]);

    await renderPage(p);
    const markup = p.source.doc.body!.toString();

    expect(markup).toContain('<!---t0-->1<!---/-->');
    expect(markup).toContain('<!---t0-->2<!---/-->');
    expect(markup).toContain('<!---t0-->3<!---/-->');
    expect(markup).toContain('<!---t0-->4<!---/-->');
    expect(markup).toContain('<!---t0-->5<!---/-->');
  });
});

