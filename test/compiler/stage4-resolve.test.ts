import { describe, expect, it, beforeEach } from 'vitest';
import * as acorn from 'acorn';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../src/compiler/stages/stage4-resolve';
import { Page } from '../../src/compiler/ir/Page';
import { Scope } from '../../src/compiler/ir/Scope';
import { Value } from '../../src/compiler/ir/Value';
import { ServerAttribute, ServerDocument, SourceLocation } from '../../src/html/server-dom';
import { Source, parse } from '../../src/html/parser';

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

describe('stage4-resolve', () => {
  let doc: ServerDocument;
  let page: Page;

  beforeEach(() => {
    doc = new ServerDocument('test');
    const source = new Source('test.html', '<html></html>');
    source.doc = doc;
    page = new Page(source);
  });

  function addValue(scope: Scope, name: string, source: string | null) {
    const attr = new ServerAttribute(doc, null as any, `:${name}`, null, LOC);
    attr.value = source == null ? null : parseExpr(source);
    attr.valueLoc = LOC;
    const value = new Value(name, attr, scope);
    scope.values.set(name, value);
    return value;
  }

  it('should record no dependencies for a static literal', () => {
    const scope = new Scope(page, page.global);
    const attr = new ServerAttribute(doc, null as any, ':x', null, LOC);
    attr.value = 'a plain literal string';
    attr.valueLoc = LOC;
    const value = new Value('x', attr, scope);
    scope.values.set('x', value);

    stage4resolve(page);
    expect(value.deps).toStrictEqual([]);
  });

  it('should record a this.foo reference as a non-parent dependency', () => {
    const scope = new Scope(page, page.global);
    const value = addValue(scope, 'x', 'this.count + 1');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ key: 'count' }]);
  });

  it('should record a this.$parent.foo reference as a parent dependency', () => {
    const scope = new Scope(page, page.global);
    const value = addValue(scope, 'x', 'this.$parent.count + 1');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ via: '$parent', key: 'count' }]);
  });

  it('should record a this.foo.bar reference as a named-scope dependency when foo is a known :aka scope', () => {
    const scope = new Scope(page, page.global);
    new Scope(page, page.global, undefined, 'foo');
    const value = addValue(scope, 'x', 'this.foo.bar + 1');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ via: 'foo', key: 'bar' }]);
  });

  it('should resolve a named scope reachable through an intermediate ancestor (ascends the IR tree)', () => {
    const middle = new Scope(page, page.global);
    const scope = new Scope(page, middle);
    new Scope(page, page.global, undefined, 'foo');
    const value = addValue(scope, 'x', 'this.foo.bar + 1');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ via: 'foo', key: 'bar' }]);
  });

  it('should NOT treat this.foo.bar as a scope reference when foo is just an ordinary value', () => {
    const scope = new Scope(page, page.global);
    addValue(page.global, 'items', null);
    const value = addValue(scope, 'x', 'this.items.filter');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ key: 'items' }]);
  });

  it('a closer ordinary value shadows a same-named scope further up', () => {
    const middle = new Scope(page, page.global);
    addValue(middle, 'foo', null);
    const scope = new Scope(page, middle);
    new Scope(page, page.global, undefined, 'foo');
    const value = addValue(scope, 'x', 'this.foo.bar + 1');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ key: 'foo' }]);
  });

  it('should dedupe repeated references to the same dependency', () => {
    const scope = new Scope(page, page.global);
    const value = addValue(scope, 'x', 'this.count + this.count * 2');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ key: 'count' }]);
  });

  it('should record multiple distinct dependencies', () => {
    const scope = new Scope(page, page.global);
    const value = addValue(scope, 'x', 'this.a + this.$parent.b');

    stage4resolve(page);
    expect(value.deps).toEqual(
      expect.arrayContaining([
        { key: 'a' },
        { via: '$parent', key: 'b' },
      ])
    );
    expect(value.deps).toHaveLength(2);
  });

  it('should not record dependencies referenced only inside an event handler body', () => {
    const scope = new Scope(page, page.global);
    const value = addValue(scope, 'on$click', '() => this.count++');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([]);
  });

  it('should not record dependencies referenced only inside a lifecycle hook body', () => {
    const scope = new Scope(page, page.global);
    const value = addValue(scope, 'did$init', '() => this.count++');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([]);
  });

  it('should still record dependencies for a regular value containing a nested arrow function', () => {
    const scope = new Scope(page, page.global);
    const value = addValue(scope, 'x', 'this.items.map(item => item + this.offset)');

    stage4resolve(page);
    expect(value.deps).toEqual(
      expect.arrayContaining([
        { key: 'items' },
        { key: 'offset' },
      ])
    );
    expect(value.deps).toHaveLength(2);
  });

  it('should resolve text values too', () => {
    const scope = new Scope(page, page.global);
    const textAttr = new ServerAttribute(doc, null as any, ':t$0', null, LOC);
    const textValue = new Value('t$0', textAttr, scope);
    textAttr.value = parseExpr('this.count');
    scope.textValues.set('t$0', textValue);

    stage4resolve(page);
    expect(textValue.deps).toStrictEqual([{ key: 'count' }]);
  });

  it('should recurse into child scopes', () => {
    const scope = new Scope(page, page.global);
    const child = new Scope(page, scope);
    const value = addValue(child, 'x', 'this.count');

    stage4resolve(page);
    expect(value.deps).toStrictEqual([{ key: 'count' }]);
  });
});

describe('stage4-resolve: unknown reference validation', () => {
  function compile(html: string) {
    const p = new Page(parse(html, 'test.html'));
    stage1load(p);
    stage2validate(p);
    stage3qualify(p);
    stage4resolve(p);
    return p;
  }

  it('reports an error for a reference to an undeclared value', () => {
    const p = compile('<html><body><div :count=${0}><p>${bar}</p></div></body></html>');
    expect(p.errors.map(e => e.msg)).toContain('Unknown reference: "bar"');
  });

  it('reports an error for an undeclared property on a known named scope', () => {
    const p = compile(
      '<html><body><div :aka="foo" :x=${1}></div><p>${foo.nope}</p></body></html>'
    );
    expect(p.errors.map(e => e.msg)).toContain('Unknown reference: "foo.nope"');
  });

  it('does not error for a same-scope reference', () => {
    const p = compile('<html><body><div :count=${0}><p>${count}</p></div></body></html>');
    expect(p.errors).toStrictEqual([]);
  });

  it('does not error for a reference resolved through an ancestor scope', () => {
    const p = compile(
      '<html><body><div :items=${[1,2,3]}><li :for-each=${items}>${data}</li></div></body></html>'
    );
    expect(p.errors).toStrictEqual([]);
  });

  it('does not error for a value declared on a known named scope', () => {
    const p = compile(
      '<html><body><div :aka="foo" :x=${1}></div><p>${foo.x}</p></body></html>'
    );
    expect(p.errors).toStrictEqual([]);
  });

  it('does not error for a bare reference to a named scope itself', () => {
    const p = compile('<html><body><div :aka="foo"></div><p>${foo}</p></body></html>');
    expect(p.errors).toStrictEqual([]);
  });
});
