import { describe, expect, it, beforeEach } from 'vitest';
import * as acorn from 'acorn';
import { stage4resolve } from '../../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../../src/compiler/stages/stage7-generate';
import { Page } from '../../src/compiler/ir/Page';
import { Scope } from '../../src/compiler/ir/Scope';
import { Value } from '../../src/compiler/ir/Value';
import { ServerAttribute, ServerDocument, SourceLocation } from '../../src/html/server-dom';
import { Source } from '../../src/html/parser';

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

  it('should generate props with the root scope id and name', () => {
    stage4resolve(page);
    stage7generate(page);

    expect(page.props).toBeDefined();
    expect(page.props!.id).toBe(root.id);
    expect(page.props!.name).toBe('page');
  });

  it('should compile a literal value into an exp function returning that constant', () => {
    addValue(root, 'count', parseExpr('42'));

    stage4resolve(page);
    stage7generate(page);

    const exp = page.props!.values!.count.exp!;
    expect(exp.apply({})).toBe(42);
  });

  it('should compile a plain (non-`${}`) string value into an exp returning that literal string', () => {
    addValue(root, 'label', 'hello');

    stage4resolve(page);
    stage7generate(page);

    const exp = page.props!.values!.label.exp!;
    expect(exp.apply({})).toBe('hello');
  });

  it('should treat a presence-only (null) value as true', () => {
    addValue(root, 'class$active', null);

    stage4resolve(page);
    stage7generate(page);

    const exp = page.props!.values!['class$active'].exp!;
    expect(exp.apply({})).toBe(true);
  });

  it('should qualify this.foo references and evaluate them against the given scope proxy', () => {
    addValue(root, 'doubled', parseExpr('this.count * 2'));

    stage4resolve(page);
    stage7generate(page);

    const exp = page.props!.values!.doubled.exp!;
    expect(exp.apply({ count: 21 })).toBe(42);
  });

  it('should compile deps into ValueDep functions resolving via $value/$parent.$value', () => {
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

    const ownDep = page.props!.values!.doubled.deps![0];
    expect(ownDep.apply(fakeScope)).toBe('own-value');

    const parentDep = page.props!.values!.fromParent.deps![0];
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

    const keys = Object.keys(page.props!.values!);
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

    expect(page.props!.children).toHaveLength(1);
    expect(page.props!.children![0].id).toBe(child.id);
    expect(page.props!.children![0].values!.x.exp!.apply({})).toBe(1);
  });
});
