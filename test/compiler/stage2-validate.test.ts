import { describe, expect, it, beforeEach } from 'vitest';
import { stage2validate } from '../../src/compiler/stages/stage2-validate';
import { Page, TEXT_VALUE_PREFIX } from '../../src/compiler/ir/Page';
import { Scope } from '../../src/compiler/ir/Scope';
import { Value } from '../../src/compiler/ir/Value';
import { ServerDocument, ServerAttribute, SourceLocation } from '../../src/html/server-dom';
import { Source } from '../../src/html/parser';

const LOC: SourceLocation = {
  start: { line: 0, column: 0 },
  end: { line: 0, column: 0 },
  i1: 0,
  i2: 0,
};

describe('stage2-validate', () => {
  let doc: ServerDocument;
  let page: Page;

  beforeEach(() => {
    doc = new ServerDocument('test');
    const source = new Source('test.html', '<html></html>');
    source.doc = doc;
    page = new Page(source);
  });

  describe('event handler validation', () => {
    it('should accept arrow function event handlers', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
      attr.value = '() => console.log("clicked")';
      attr.valueLoc = LOC;

      const value = new Value('on-click', attr, scope);
      scope.values.set('on-click', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should accept arrow functions with parameters', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-change', null, LOC);
      attr.value = '(e) => setName(e.target.value)';
      attr.valueLoc = LOC;

      const value = new Value('on-change', attr, scope);
      scope.values.set('on-change', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should accept arrow functions with multiple parameters', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-custom', null, LOC);
      attr.value = '(a, b, c) => a + b + c';
      attr.valueLoc = LOC;

      const value = new Value('on-custom', attr, scope);
      scope.values.set('on-custom', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should accept arrow functions with block body', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-submit', null, LOC);
      attr.value = '() => { console.log("submitted"); return false; }';
      attr.valueLoc = LOC;

      const value = new Value('on-submit', attr, scope);
      scope.values.set('on-submit', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should reject function declarations in event handlers', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
      attr.value = 'function handleClick() { }';
      attr.valueLoc = LOC;

      const value = new Value('on-click', attr, scope);
      scope.values.set('on-click', value);

      const result = stage2validate(page);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].msg).toContain('must be an arrow function');
    });

    it('should reject function expressions in event handlers', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
      attr.value = 'function (e) { console.log(e); }';
      attr.valueLoc = LOC;

      const value = new Value('on-click', attr, scope);
      scope.values.set('on-click', value);

      const result = stage2validate(page);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].msg).toContain('must be an arrow function');
    });

    it('should reject plain identifiers in event handlers', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
      attr.value = 'handleClick';
      attr.valueLoc = LOC;

      const value = new Value('on-click', attr, scope);
      scope.values.set('on-click', value);

      const result = stage2validate(page);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].msg).toContain('must be an arrow function');
    });

    it('should reject invalid expressions in event handlers', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
      attr.value = '() => {';  // Incomplete arrow function
      attr.valueLoc = LOC;

      const value = new Value('on-click', attr, scope);
      scope.values.set('on-click', value);

      const result = stage2validate(page);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].msg).toContain('Invalid expression');
    });

    it('should allow $ in event handler expressions (identifier access)', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
      attr.value = '() => $state.count++';
      attr.valueLoc = LOC;

      const value = new Value('on-click', attr, scope);
      scope.values.set('on-click', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should allow multiple $ references in event handlers', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
      attr.value = '() => { $a = 1; $b = 2; return $a + $b; }';
      attr.valueLoc = LOC;

      const value = new Value('on-click', attr, scope);
      scope.values.set('on-click', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });
  });

  describe('identifier declaration validation', () => {
    it('should accept value names without $', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':class-active', null, LOC);
      attr.value = 'isActive';
      attr.valueLoc = LOC;

      const value = new Value('class-active', attr, scope);
      scope.values.set('class-active', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should allow compiler-generated text placeholder names', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':class-active', null, LOC);
      attr.value = 'true';
      attr.valueLoc = LOC;

      const value = new Value(`${TEXT_VALUE_PREFIX}0`, attr, scope);
      scope.textValues.set(`${TEXT_VALUE_PREFIX}0`, value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should accept alphanumeric value names with underscores', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':style-bg_color', null, LOC);
      attr.value = '#fff';
      attr.valueLoc = LOC;

      const value = new Value('style-bg_color', attr, scope);
      scope.values.set('style-bg_color', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should reject value names with $ prefix', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-$click', null, LOC);
      attr.value = '() => {}';
      attr.valueLoc = LOC;

      const value = new Value('on-$click', attr, scope);
      scope.values.set('on-$click', value);

      const result = stage2validate(page);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].msg).toContain('cannot include "$"');
    });

    it('should reject value names with $ in the middle', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':class-active$flag', null, LOC);
      attr.value = 'true';
      attr.valueLoc = LOC;

      const value = new Value('class-active$flag', attr, scope);
      scope.values.set('class-active$flag', value);

      const result = stage2validate(page);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].msg).toContain('cannot include "$"');
    });

    it('should reject value names with multiple $', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':style-$color$bg', null, LOC);
      attr.value = 'red';
      attr.valueLoc = LOC;

      const value = new Value('style-$color$bg', attr, scope);
      scope.values.set('style-$color$bg', value);

      const result = stage2validate(page);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].msg).toContain('cannot include "$"');
    });
  });

  describe('scope hierarchy traversal', () => {
    it('should validate all scopes in hierarchy', () => {
      const globalScope = page.global;
      const childScope = new Scope(page, globalScope);
      const grandchildScope = new Scope(page, childScope);

      // Add values to each scope
      const attr1 = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
      attr1.value = '() => {}';
      attr1.valueLoc = LOC;
      const value1 = new Value('on-click', attr1, globalScope);
      globalScope.values.set('on-click', value1);

      const attr2 = new ServerAttribute(doc, null as any, ':on-change', null, LOC);
      attr2.value = '(e) => e';
      attr2.valueLoc = LOC;
      const value2 = new Value('on-change', attr2, childScope);
      childScope.values.set('on-change', value2);

      const attr3 = new ServerAttribute(doc, null as any, ':on-submit', null, LOC);
      attr3.value = '() => true';
      attr3.valueLoc = LOC;
      const value3 = new Value('on-submit', attr3, grandchildScope);
      grandchildScope.values.set('on-submit', value3);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should report errors from child scopes', () => {
      const globalScope = page.global;
      const childScope = new Scope(page, globalScope);

      // Add invalid value to child scope
      const attr = new ServerAttribute(doc, null as any, ':class-test$invalid', null, LOC);
      attr.value = 'true';
      attr.valueLoc = LOC;
      const value = new Value('class-test$invalid', attr, childScope);
      childScope.values.set('class-test$invalid', value);

      const result = stage2validate(page);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].msg).toContain('cannot include "$"');
    });

    it('should validate multiple child scopes', () => {
      const globalScope = page.global;
      const child1 = new Scope(page, globalScope);
      const child2 = new Scope(page, globalScope);

      const attr1 = new ServerAttribute(doc, null as any, ':on-invalid$1', null, LOC);
      attr1.value = '() => {}';
      attr1.valueLoc = LOC;
      child1.values.set('on-invalid$1', new Value('on-invalid$1', attr1, child1));

      const attr2 = new ServerAttribute(doc, null as any, ':on-invalid$2', null, LOC);
      attr2.value = '() => {}';
      attr2.valueLoc = LOC;
      child2.values.set('on-invalid$2', new Value('on-invalid$2', attr2, child2));

      const result = stage2validate(page);
      expect(result.errors.length).toBe(2);
    });
  });

  describe('non-event values', () => {
    it('should not validate class values as expressions', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':class-active', null, LOC);
      attr.value = 'not-an-expression-at-all';
      attr.valueLoc = LOC;

      const value = new Value('class-active', attr, scope);
      scope.values.set('class-active', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should not validate style values as expressions', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':style-color', null, LOC);
      attr.value = 'rgb(255, 0, 0)';
      attr.valueLoc = LOC;

      const value = new Value('style-color', attr, scope);
      scope.values.set('style-color', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should skip non-string values', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
      attr.value = null;  // Non-string value
      attr.valueLoc = LOC;

      const value = new Value('on-click', attr, scope);
      scope.values.set('on-click', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should skip empty string values', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
      attr.value = '';
      attr.valueLoc = LOC;

      const value = new Value('on-click', attr, scope);
      scope.values.set('on-click', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });
  });

  describe('complex expressions', () => {
    it('should validate arrow functions with nested function calls', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
      attr.value = '() => calculateTotal(value, multiplier)';
      attr.valueLoc = LOC;

      const value = new Value('on-click', attr, scope);
      scope.values.set('on-click', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should validate arrow functions with object access', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
      attr.value = '() => obj.prop.nested';
      attr.valueLoc = LOC;

      const value = new Value('on-click', attr, scope);
      scope.values.set('on-click', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should validate arrow functions with array access', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
      attr.value = '() => arr[0]';
      attr.valueLoc = LOC;

      const value = new Value('on-click', attr, scope);
      scope.values.set('on-click', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should validate arrow functions with ternary expressions', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
      attr.value = '() => condition ? valueA : valueB';
      attr.valueLoc = LOC;

      const value = new Value('on-click', attr, scope);
      scope.values.set('on-click', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should validate arrow functions with logical operators', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
      attr.value = '() => a && b || c';
      attr.valueLoc = LOC;

      const value = new Value('on-click', attr, scope);
      scope.values.set('on-click', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });

    it('should validate arrow functions with template literals', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':on-click', null, LOC);
      attr.value = '() => `Hello ${name}`';
      attr.valueLoc = LOC;

      const value = new Value('on-click', attr, scope);
      scope.values.set('on-click', value);

      const result = stage2validate(page);
      expect(result.errors).toStrictEqual([]);
    });
  });

  describe('return value', () => {
    it('should return the page object', () => {
      const result = stage2validate(page);
      expect(result).toBe(page);
    });

    it('should return the same page with error array populated', () => {
      const scope = page.global;
      const attr = new ServerAttribute(doc, null as any, ':class-test$invalid', null, LOC);
      attr.value = 'true';
      attr.valueLoc = LOC;
      const value = new Value('class-test$invalid', attr, scope);
      scope.values.set('class-test$invalid', value);

      const result = stage2validate(page);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].type).toBe('error');
    });
  });
});
