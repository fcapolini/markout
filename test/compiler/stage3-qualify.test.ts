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
import { Source, parse } from '../../src/html/parser';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../src/compiler/stages/stage2-validate';
import { stage4resolve } from '../../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../../src/compiler/stages/stage7-generate';

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

  it('should shadow-qualify a :for-each expression referencing its own alias name, so a nested :for-each does not accidentally self-reference the alias it is about to define', () => {
    const scope = new Scope(page, page.global);

    // :for-each=${data} -- 'data' is also this scope's own per-item alias
    // name (the default), so the reference must resolve to whatever the
    // PARENT scope already has, not the alias this :for-each is defining
    const attr = new ServerAttribute(doc, null as any, ':for-each', null, LOC);
    attr.value = parseExpr('data');
    attr.valueLoc = LOC;
    scope.values.set('for$each', new Value('for$each', attr, scope));

    stage3qualify(page);

    const qualified = attr.value as any;
    expect(qualified.type).toBe('MemberExpression');
    expect(qualified.object.type).toBe('MemberExpression');
    expect(qualified.object.object.type).toBe('ThisExpression');
    expect(qualified.object.property.name).toBe('$parent');
    expect(qualified.property.name).toBe('data');
  });

  it('should NOT shadow-qualify a :for-key expression referencing the alias, since it legitimately means the current item', () => {
    const scope = new Scope(page, page.global);
    scope.values.set('for$each', new Value('for$each', new ServerAttribute(doc, null as any, ':for-each', null, LOC), scope));

    const attr = new ServerAttribute(doc, null as any, ':for-key', null, LOC);
    attr.value = parseExpr('data.id');
    attr.valueLoc = LOC;
    scope.values.set('for$key', new Value('for$key', attr, scope));

    stage3qualify(page);

    const qualified = attr.value as any;
    expect(qualified.type).toBe('MemberExpression');
    expect(qualified.object.type).toBe('MemberExpression');
    expect(qualified.object.object.type).toBe('ThisExpression');
    expect(qualified.object.property.name).toBe('data');
  });
});

describe('destructuring: a binding or a target', () => {
  // The same shapes serve both. `const [a] = xs` declares `a`; `[a] = xs`
  // writes to whatever `a` already is -- and every pattern member used to
  // count as a binding, so the second kind stayed bare. `[n] = [5]`
  // compiled to `[n] = [5]`, wrote an undeclared global, and left the value
  // it was aimed at exactly where it was, with nothing reported anywhere.
  function handler(body: string): string {
    const page = new Page(
      parse(
        '<html><body :n=${1} :m=${2}><button :on-click=${' + body + '}>x</button></body></html>',
        'test.html'
      )
    );
    stage1load(page);
    stage2validate(page);
    stage3qualify(page);
    stage4resolve(page);
    stage7generate(page);
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    const props = page.propsString ?? '';
    // the generated props have to BE JavaScript, which is what a bad
    // qualification costs: `({ n } = o)` cannot keep its shorthand once its
    // target is an expression rather than the bare name
    expect(() => new Function(`return (${props});`)()).not.toThrow();
    return props;
  }

  it('qualifies an array pattern target', () => {
    expect(handler('() => { [n] = [5]; }')).toContain('[this.n]=[5]');
  });

  it('qualifies an object pattern target, but not the property it names', () => {
    expect(handler('() => { ({v: n} = {v: 5}); }')).toContain('{v:this.n}');
  });

  it('spells out a shorthand it had to qualify', () => {
    expect(handler('() => { ({n} = {n: 5}); }')).toContain('{n:this.n}');
  });

  it('handles defaults, rests and several targets at once', () => {
    expect(handler('() => { [n = 9] = []; }')).toContain('[this.n=9]');
    expect(handler('() => { [n, ...m] = [1, 2, 3]; }')).toContain('[this.n,...this.m]');
    // the one worth being able to write
    expect(handler('() => { [n, m] = [m, n]; }')).toContain('[this.n,this.m]=[this.m,this.n]');
  });

  it('leaves a real binding alone', () => {
    expect(handler('() => { const [x] = [n]; return x; }')).toContain('const [x]=[this.n]');
    expect(handler('({ v }) => v + n')).toContain('({v})=>v+this.n');
    expect(handler('() => { const {a: {b}} = {a: {b: n}}; return b; }')).toContain('{a:{b}}');
  });
});
