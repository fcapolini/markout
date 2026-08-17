import { beforeEach, describe, expect, it } from 'vitest';
import * as acorn from 'acorn';
import { Page } from '../../src/compiler/ir/Page';
import { Scope } from '../../src/compiler/ir/Scope';
import { Value } from '../../src/compiler/ir/Value';
import { ServerAttribute, ServerDocument } from '../../src/html/server-dom';
import { Source } from '../../src/html/parser';
import { stage3qualify } from '../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../src/compiler/stages/stage4-resolve';
import { stage5comptime } from '../../src/compiler/stages/stage5-comptime';

const LOC = {
  start: { line: 0, column: 0 },
  end: { line: 0, column: 0 },
  i1: 0,
  i2: 0,
};

// the html parser only produces an AST for a `:`-attribute value when it
// contains `${...}`; simulate that here for values meant to be qualified.
function parseExpr(source: string): acorn.Expression {
  return acorn.parseExpressionAt(source, 0, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    locations: true,
  });
}

describe('stage5-comptime', () => {
  let doc: ServerDocument;
  let page: Page;

  beforeEach(() => {
    doc = new ServerDocument('test');
    const source = new Source('test.html', '<html></html>');
    source.doc = doc;
    page = new Page(source);
  });

  it('should leave values unchanged as a placeholder', () => {
    const scope = new Scope(page, page.global);

    const exprAttr = new ServerAttribute(doc, null as any, ':class-active', null, LOC as any);
    exprAttr.value = parseExpr('otherValue + 1');
    exprAttr.valueLoc = LOC as any;
    scope.values.set('class$active', new Value('class$active', exprAttr, scope));

    const otherAttr = new ServerAttribute(doc, null as any, ':class-other', null, LOC as any);
    otherAttr.value = "'red'";
    otherAttr.valueLoc = LOC as any;
    scope.values.set('otherValue', new Value('otherValue', otherAttr, scope));

    stage3qualify(page);
    stage4resolve(page);
    stage5comptime(page);

    expect(exprAttr.value).toMatchObject({ type: 'BinaryExpression' });
  });
});
