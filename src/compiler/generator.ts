import * as acorn from 'acorn';
import { SourceLocation } from '../html/server-dom';
import { RT_VALUE_FN_KEY } from '../runtime/base/base-scope';
import { CompilerScope, CompilerValue } from './compiler';

// https://astexplorer.net

/**
 * @see BaseScopeProps
 */
const ID_PROP = 'id';
const TYPE_PROP = 'type';
const DEFINES_PROP = 'defines';
const EXTENDS_PROP = 'extends';
const SLOTMAP_PROP = 'slotmap';
const USES_PROP = 'uses';
const NAME_PROP = 'name';
const CHILDREN_PROP = 'children';
const VALUES_PROP = 'values';

export function generate(root: CompilerScope): acorn.ExpressionStatement {
  return {
    type: 'ExpressionStatement',
    expression: genScope(root),
    ...genLoc(root.loc),
  };
}

function genLoc(loc: SourceLocation) {
  return { start: loc.i1, end: loc.i2, loc };
}

function genScope(scope: CompilerScope): acorn.ObjectExpression {
  return {
    type: 'ObjectExpression',
    properties: genScopeProps(scope),
    ...genLoc(scope.loc),
  };
}

function genScopeProps(scope: CompilerScope): acorn.Property[] {
  const ret: acorn.Property[] = [];
  ret.push(genProperty(scope.loc, ID_PROP, genLiteral(scope.loc, scope.id)));
  scope.type &&
    ret.push(
      genProperty(scope.loc, TYPE_PROP, genLiteral(scope.loc, scope.type))
    );
  scope.defines &&
    ret.push(
      genProperty(scope.loc, DEFINES_PROP, genLiteral(scope.loc, scope.defines))
    );
  typeof scope.xtends === 'object' &&
    ret.push(
      genProperty(
        scope.loc,
        EXTENDS_PROP,
        genLiteral(scope.loc, scope.xtends.defines!)
      )
    );
  scope.slotmap &&
    ret.push(
      genProperty(
        scope.loc,
        SLOTMAP_PROP,
        genObject(
          scope.loc,
          Object.keys(scope.slotmap).map(key =>
            genProperty(
              scope.loc,
              key,
              genLiteral(scope.loc, scope.slotmap![key]),
              true
            )
          )
        )
      )
    );
  scope.uses &&
    ret.push(
      genProperty(scope.loc, USES_PROP, genLiteral(scope.loc, scope.uses))
    );
  scope.name &&
    ret.push(
      genProperty(
        scope.name.keyLoc,
        NAME_PROP,
        genLiteral(scope.name.valLoc ?? scope.name.keyLoc, scope.name.val)
      )
    );
  if (scope.values && Object.keys(scope.values).length > 0) {
    const valueProps: acorn.Property[] = [];
    Object.keys(scope.values).forEach(key => {
      valueProps.push(genValue(scope.loc, key, scope.values![key]));
    });
    ret.push(
      genProperty(scope.loc, VALUES_PROP, genObject(scope.loc, valueProps))
    );
  }
  ret.push(
    genProperty(
      scope.loc,
      CHILDREN_PROP,
      genArray(scope.loc, genScopeChildren(scope))
    )
  );
  return ret;
}

function genValue(
  loc: SourceLocation,
  key: string,
  value: CompilerValue
): acorn.Property {
  return genProperty(loc, key, genObject(loc, genValueProps(value)));
}

function genValueProps(value: CompilerValue): acorn.Property[] {
  const ret: acorn.Property[] = [];
  ret.push(genValueExp(value));
  value.refs && ret.push(genValueRefs(value));
  return ret;
}

function genValueExp(value: CompilerValue): acorn.Property {
  const loc = value.valLoc ?? value.keyLoc;
  return genProperty(
    loc,
    'exp',
    genFunction(
      loc,
      //TODO: check what null would mean and if it's valid/needed
      value.val === null || typeof value.val === 'string'
        ? genLiteral(loc, value.val)
        : value.val
    )
  );
}

function genValueRefs(value: CompilerValue): acorn.Property {
  const loc = value.valLoc ?? value.keyLoc;
  return genProperty(
    loc,
    'deps',
    genArray(
      loc,
      [...value.refs!].map(ref => genFunction(loc, genValueRefCall(loc, ref)))
    )
  );
}

function genValueRefCall(loc: SourceLocation, ref: string): acorn.Expression {
  return {
    type: 'CallExpression',
    callee: genValueRefCallee(loc, ref),
    arguments: [genLiteral(loc, ref.split('.').pop()!)],
    optional: false,
    ...genLoc(loc),
  };
}

function genValueRefCallee(loc: SourceLocation, ref: string): acorn.Expression {
  const slices = ref.split('.');
  slices.pop();
  slices.push(RT_VALUE_FN_KEY);
  slices.shift();
  let ret: acorn.Expression = genThis(loc);
  while (slices.length) {
    ret = {
      type: 'MemberExpression',
      object: ret,
      property: genIdentifier(loc, slices.shift()!),
      computed: false,
      optional: false,
      ...genLoc(loc),
    };
  }
  return ret;
}

function genScopeChildren(scope: CompilerScope): acorn.ObjectExpression[] {
  const ret: acorn.ObjectExpression[] = [];
  scope.children.forEach(child => ret.push(genScope(child)));
  return ret;
}

// =============================================================================
// util
// =============================================================================

function genFunction(
  loc: SourceLocation,
  exp: acorn.Expression
): acorn.FunctionExpression {
  return {
    type: 'FunctionExpression',
    id: null,
    expression: false,
    generator: false,
    async: false,
    params: [],
    body: {
      type: 'BlockStatement',
      body: [
        {
          type: 'ReturnStatement',
          argument: exp,
          ...genLoc(loc),
        },
      ],
      ...genLoc(loc),
    },
    ...genLoc(loc),
  };
}

function genObject(
  loc: SourceLocation,
  properties: acorn.Property[]
): acorn.ObjectExpression {
  return {
    type: 'ObjectExpression',
    properties,
    ...genLoc(loc),
  };
}

function genArray(
  loc: SourceLocation,
  elements: acorn.Expression[]
): acorn.ArrayExpression {
  return {
    type: 'ArrayExpression',
    elements,
    ...genLoc(loc),
  };
}

function genProperty(
  loc: SourceLocation,
  key: string,
  val: acorn.Expression,
  useLiteralId?: boolean
): acorn.Property {
  return {
    type: 'Property',
    key: useLiteralId ? genLiteral(loc, key) : genIdentifier(loc, key),
    value: val,
    kind: 'init',
    method: false,
    shorthand: false,
    computed: false,
    ...genLoc(loc),
  };
}

function genIdentifier(loc: SourceLocation, name: string): acorn.Identifier {
  return {
    type: 'Identifier',
    name,
    ...genLoc(loc),
  };
}

function genLiteral(
  loc: SourceLocation,
  val: string | number | null
): acorn.Literal {
  return {
    type: 'Literal',
    value: val,
    ...genLoc(loc),
  };
}

function genThis(loc: SourceLocation): acorn.ThisExpression {
  return {
    type: 'ThisExpression',
    ...genLoc(loc),
  };
}
