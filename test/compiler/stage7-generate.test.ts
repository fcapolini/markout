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
import { renderPage } from '../../src/server/render';

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

// looks up an ObjectExpression AST's property value by key name -- keys are
// either an Identifier (structural props) or a quoted Literal (scope values)
function prop(obj: any, name: string): any {
  return obj.properties.find((p: any) => keyName(p) === name)?.value;
}

function keyName(p: any): string {
  return p.key.type === 'Literal' ? p.key.value : p.key.name;
}

// turns a generated FunctionExpression AST node into a real callable, the
// way an actual loader (outside the compiler) would after reading the code
function evalExpr(node: any): (...args: any[]) => any {
  return new Function(`return (${generate(node)});`)();
}

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

  it('should generate propsAST and propsString with the root scope id and name', () => {
    stage4resolve(page);
    stage7generate(page);

    expect(page.propsAST).toBeDefined();
    expect(prop(page.propsAST, 'id').value).toBe(root.id);
    expect(prop(page.propsAST, 'name').value).toBe('page');
    expect(typeof page.propsString).toBe('string');
    expect(page.propsString).toContain(root.id);
  });

  it('should compile a literal value into an exp function returning that constant', () => {
    addValue(root, 'count', parseExpr('42'));

    stage4resolve(page);
    stage7generate(page);

    const count = prop(prop(page.propsAST, 'values'), 'count');
    const exp = evalExpr(prop(count, 'exp'));
    expect(exp.apply({})).toBe(42);
  });

  it('should compile a plain (non-`${}`) string value into an exp returning that literal string', () => {
    addValue(root, 'label', 'hello');

    stage4resolve(page);
    stage7generate(page);

    const label = prop(prop(page.propsAST, 'values'), 'label');
    const exp = evalExpr(prop(label, 'exp'));
    expect(exp.apply({})).toBe('hello');
  });

  it('should treat a presence-only (null) value as true', () => {
    addValue(root, 'class$active', null);

    stage4resolve(page);
    stage7generate(page);

    const value = prop(prop(page.propsAST, 'values'), 'class$active');
    const exp = evalExpr(prop(value, 'exp'));
    expect(exp.apply({})).toBe(true);
  });

  it('should qualify this.foo references and evaluate them against the given scope proxy', () => {
    addValue(root, 'doubled', parseExpr('this.count * 2'));

    stage4resolve(page);
    stage7generate(page);

    const doubled = prop(prop(page.propsAST, 'values'), 'doubled');
    const exp = evalExpr(prop(doubled, 'exp'));
    expect(exp.apply({ count: 21 })).toBe(42);
  });

  it('should compile deps into functions resolving via $value/$parent.$value', () => {
    addValue(root, 'count', null);
    addValue(page.global, 'count', null);
    addValue(root, 'doubled', parseExpr('this.count * 2'));
    addValue(root, 'fromParent', parseExpr('this.$parent.count * 2'));

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

    const values = prop(page.propsAST, 'values');
    const ownDep = evalExpr(prop(values, 'doubled').properties.find((p: any) => p.key.name === 'deps').value.elements[0]);
    expect(ownDep.apply(fakeScope)).toBe('own-value');

    const parentDep = evalExpr(prop(values, 'fromParent').properties.find((p: any) => p.key.name === 'deps').value.elements[0]);
    expect(parentDep.apply(fakeScope)).toBe('parent-value');

    expect(seen).toEqual([
      { viaParent: false, key: 'count' },
      { viaParent: true, key: 'count' },
    ]);
  });

  it('should translate compiled key prefixes to the ones WebScope expects', () => {
    addValue(root, 'on$click', parseExpr('() => {}'));
    const textAttr = new ServerAttribute(doc, null as any, ':t$0', null, LOC);
    textAttr.value = parseExpr('this.count');
    textAttr.valueLoc = LOC;
    const textValue = new Value('t$0', textAttr, root);
    root.textValues.set('t$0', textValue);
    addValue(root, 'class$active', parseExpr('true'));
    addValue(root, 'style$color', parseExpr('"red"'));

    stage4resolve(page);
    stage7generate(page);

    const keys = prop(page.propsAST, 'values').properties.map((p: any) => keyName(p));
    expect(keys).toContain('event$click');
    expect(keys).toContain('text$0');
    expect(keys).toContain('class$active');
    expect(keys).toContain('style$color');
    expect(keys).not.toContain('on$click');
    expect(keys).not.toContain('t$0');
  });

  it('should recurse into child scopes', () => {
    const child = new Scope(page, root, undefined, 'child');
    addValue(child, 'x', parseExpr('1'));

    stage4resolve(page);
    stage7generate(page);

    const children = prop(page.propsAST, 'children').elements;
    expect(children).toHaveLength(1);
    expect(prop(children[0], 'id').value).toBe(child.id);
    const x = prop(prop(children[0], 'values'), 'x');
    expect(evalExpr(prop(x, 'exp')).apply({})).toBe(1);
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

  function bodyScripts(p: Page) {
    return p.source.doc.body!.childNodes.filter(
      (n: any) => n.nodeType === NodeType.ELEMENT && n.tagName === 'SCRIPT'
    ) as any[];
  }

  it('should append a props script and an async runtime script to the end of body', () => {
    const p = compilePage('<html><body></body></html>');
    const scripts = bodyScripts(p);

    expect(scripts).toHaveLength(2);
    const [propsScript, runtimeScript] = scripts;
    expect((propsScript.childNodes[0] as any).textContent).toContain('window.__MARKOUT_PROPS =');
    expect(runtimeScript.getAttribute('src')).toBe(DEFAULT_RUNTIME_SRC);
    expect(runtimeScript.getAttributeNode('async')).not.toBeNull();
  });

  it('should honor a custom runtimeSrc', () => {
    const p = compilePage('<html><body></body></html>', '/custom-runtime.js');
    const [, runtimeScript] = bodyScripts(p);

    expect(runtimeScript.getAttribute('src')).toBe('/custom-runtime.js');
  });

  it('should escape a literal </script> found inside generated source', () => {
    const p = compilePage(
      '<html :label=${"</script><script>alert(1)</script>"}></html>'
    );
    const [propsScript] = bodyScripts(p);
    const text = (propsScript.childNodes[0] as any).textContent as string;

    expect(text).not.toMatch(/<\/script>/i);
    expect(text).toContain('<\\/script>');
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

  it('compiles a same-scope reference from a plain child element into this.$value(key)', () => {
    // :count and ${count} end up on the same scope: <p> has no special
    // attribute of its own, so it doesn't get a scope and the
    // interpolation attaches to the enclosing <div>'s
    const p = compilePage(
      '<html><body><div :count=${0}><p>${count}</p></div></body></html>'
    );

    const body = prop(p.propsAST, 'children').elements[1];
    const div = prop(body, 'children').elements[0];
    const textValue = prop(div, 'values').properties.find(
      (property: any) => keyName(property) === 'text$0'
    ).value;
    const dep = prop(textValue, 'deps').elements[0];

    expect(generate(dep)).toContain("this.$value('count')");
  });

  it('still compiles to this.$value(key) when the reference lives in its own nested (:aka) scope', () => {
    // ${count} qualifies to `this.count` regardless of which scope actually
    // owns it -- the scope-chain walk happens at runtime, in lookup(),
    // never at compile time -- so this must compile exactly like the
    // same-scope case above, even though <p> now has its own scope
    const p = compilePage(
      '<html><body><div :count=${0}><p :aka="foo">${count}</p></div></body></html>'
    );

    const body = prop(p.propsAST, 'children').elements[1];
    const div = prop(body, 'children').elements[0];
    const foo = prop(div, 'children').elements[0];
    const textValue = prop(foo, 'values').properties.find(
      (property: any) => keyName(property) === 'text$0'
    ).value;
    const dep = prop(textValue, 'deps').elements[0];

    expect(generate(dep)).toContain("this.$value('count')");
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

  it('renders each sub-array with its own items, not the outer alias shadowing itself', () => {
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

    renderPage(p);
    const markup = p.source.doc.body!.toString();

    expect(markup).toContain('<!---t0-->1<!---/-->');
    expect(markup).toContain('<!---t0-->2<!---/-->');
    expect(markup).toContain('<!---t0-->3<!---/-->');
    expect(markup).toContain('<!---t0-->4<!---/-->');
    expect(markup).toContain('<!---t0-->5<!---/-->');
  });

  it('still shadows correctly when both levels use the same custom :for-as alias', () => {
    // shadowKeyFor() must use the SCOPE'S OWN resolved alias (whatever
    // :for-as says), not a hardcoded 'data' -- verify that holds even when
    // the outer and inner :for-each deliberately reuse the same alias name
    const p = compilePage(
      '<html><body><ul :for-each=${[[1, 2, 3], [4, 5]]} :for-as="item">' +
        '<li :for-each=${item} :for-as="item">Item ${item}</li></ul></body></html>'
    );
    expect(p.errors).toStrictEqual([]);

    renderPage(p);
    const markup = p.source.doc.body!.toString();

    expect(markup).toContain('<!---t0-->1<!---/-->');
    expect(markup).toContain('<!---t0-->2<!---/-->');
    expect(markup).toContain('<!---t0-->3<!---/-->');
    expect(markup).toContain('<!---t0-->4<!---/-->');
    expect(markup).toContain('<!---t0-->5<!---/-->');
  });
});

