import { describe, expect, it, beforeEach } from 'vitest';
import * as acorn from 'acorn';
import { stage3qualify } from '../../src/compiler/stages/stage3-qualify';
import { Page } from '../../src/compiler/ir/Page';
import { Scope } from '../../src/compiler/ir/Scope';
import { Value } from '../../src/compiler/ir/Value';
import {
  ServerDocument,
  ServerAttribute,
  ServerText,
  SourceLocation,
} from '../../src/html/server-dom';
import { Source } from '../../src/html/parser';

const LOC: SourceLocation = {
  start: { line: 0, column: 0 },
  end: { line: 0, column: 0 },
  i1: 0,
  i2: 0,
};

// the html parser only produces an AST for a `:`-attribute/text value when
// it contains `${...}`; simulate that here for values meant to be qualified.
function parseExpr(source: string): acorn.Expression {
  return acorn.parseExpressionAt(source, 0, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    locations: true,
  });
}

describe('stage3-qualify', () => {
  let doc: ServerDocument;
  let page: Page;

  beforeEach(() => {
    doc = new ServerDocument('test');
    const source = new Source('test.html', '<html></html>');
    source.doc = doc;
    page = new Page(source);
  });

  it('should qualify unqualified value references with this', () => {
    const scope = new Scope(page, page.global);

    const attr = new ServerAttribute(doc, null as any, ':class-active', null, LOC);
    attr.value = parseExpr('otherValue + 1');
    attr.valueLoc = LOC;
    const exprValue = new Value('class-active', attr, scope);
    scope.values.set('class-active', exprValue);

    const otherAttr = new ServerAttribute(doc, null as any, ':style-color', null, LOC);
    otherAttr.value = 'red';
    otherAttr.valueLoc = LOC;
    scope.values.set('otherValue', new Value('otherValue', otherAttr, scope));

    stage3qualify(page);

    const qualified = attr.value as any;
    expect(qualified.type).toBe('BinaryExpression');
    const left = qualified.left;
    expect(left.type).toBe('MemberExpression');
    expect(left.object.type).toBe('ThisExpression');
    expect(left.property.type).toBe('Identifier');
    expect(left.property.name).toBe('otherValue');
  });

  it('should use $parent for self references', () => {
    const scope = new Scope(page, page.global);

    const attr = new ServerAttribute(doc, null as any, ':class-active', null, LOC);
    attr.value = parseExpr('value');
    attr.valueLoc = LOC;
    scope.values.set('value', new Value('value', attr, scope));

    stage3qualify(page);

    const qualified = attr.value as any;
    expect(qualified.type).toBe('MemberExpression');
    expect(qualified.object.type).toBe('MemberExpression');
    expect(qualified.object.object.type).toBe('ThisExpression');
    expect(qualified.object.property.name).toBe('$parent');
    expect(qualified.property.name).toBe('value');
  });

  it('should not qualify local declarations inside functions', () => {
    const scope = new Scope(page, page.global);

    const attr = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
    attr.value = parseExpr('(name) => name');
    attr.valueLoc = LOC;
    scope.values.set('on-click', new Value('on-click', attr, scope));

    stage3qualify(page);

    const qualified = attr.value as any;
    expect(qualified.type).toBe('ArrowFunctionExpression');
    expect(qualified.body.type).toBe('Identifier');
    expect(qualified.body.name).toBe('name');
  });

  it('should leave plain (non-interpolated) text values unchanged', () => {
    const scope = new Scope(page, page.global);

    const textNode = doc.createTextNode('Hello');
    const textValue = new Value('t$0', textNode as any, scope);
    scope.textValues.set('t$0', textValue);

    stage3qualify(page);

    expect(textNode.textContent).toBe('Hello');
  });

  it('should qualify dynamic text values (from `${...}`)', () => {
    const scope = new Scope(page, page.global);

    const textNode = new ServerText(doc, parseExpr('name'), LOC);
    const textValue = new Value('t$0', textNode, scope);
    scope.textValues.set('t$0', textValue);

    stage3qualify(page);

    const qualified = textNode.textContent as any;
    expect(qualified.type).toBe('MemberExpression');
    expect(qualified.object.type).toBe('ThisExpression');
    expect(qualified.property.name).toBe('name');
  });

  it('should not qualify values in the global scope', () => {
    const attr = new ServerAttribute(doc, null as any, ':class-active', null, LOC);
    attr.value = parseExpr('value');
    attr.valueLoc = LOC;
    page.global.values.set('value', new Value('value', attr, page.global));

    stage3qualify(page);

    expect((attr.value as any).type).toBe('Identifier');
  });
});
