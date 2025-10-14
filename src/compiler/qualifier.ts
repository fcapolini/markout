import * as acorn from 'acorn';
import estraverse from 'estraverse';
import * as es from 'estree';
import { Source } from '../html/parser';
import { BaseGlobal } from '../runtime/base/base-global';
import { RT_PARENT_VALUE_KEY } from '../runtime/base/base-scope';
import { CompilerScope } from './compiler';

export function qualify(
  source: Source,
  root: CompilerScope,
  global: BaseGlobal
): boolean {
  const qualify = (scope: CompilerScope) => {
    scope.values &&
      Object.keys(scope.values).forEach(key => {
        const value = scope.values![key];
        if (value.val === null || typeof value.val === 'string') {
          return;
        }
        value.val = qualifyExpression(key, value.val, global);
      });
    scope.children.forEach(child => qualify(child));
  };
  qualify(root);
  return source.errors.length === 0;
}

function qualifyExpression(
  key: string,
  exp: acorn.Expression,
  global: BaseGlobal
): acorn.Expression {
  const stack: es.Node[] = [];
  const ret = estraverse.replace(exp as es.Node, {
    enter: (node, parent) => {
      stack.push(node);
      if (node.type === 'Identifier') {
        if (isInDeclaration(node, stack)) {
          // this ID is getting declared
          return;
        }
        if (!isLocalAccess(node, stack)) {
          if (!isQualified(node, parent)) {
            if (global.values[node.name]) {
              // don't qualify references to global values
              return;
            }
            // unqualified remote ID reference: prefix with `this.`
            let object: unknown = { type: 'ThisExpression', ...loc(node) };
            if (node.name === key && !inFunctionBody(stack)) {
              // reference to itself -> $parent.<itself>
              const id = RT_PARENT_VALUE_KEY;
              object = {
                type: 'MemberExpression',
                object,
                property: { type: 'Identifier', name: id, ...loc(node) },
                computed: false,
                optional: false,
                ...loc(node),
              };
            }
            return {
              type: 'MemberExpression',
              object,
              property: node,
              computed: false,
              optional: false,
              ...loc(node),
            } as es.MemberExpression;
          }
        }
      }
    },

    leave: () => {
      stack.pop();
    },
  });
  return ret as acorn.Expression;
}

function loc(node: es.Node) {
  const anode = node as acorn.Node;
  return {
    range: [anode.start, anode.end],
    loc: node.loc,
  };
}

function isQualified(id: es.Identifier, parent: es.Node | null) {
  return parent?.type === 'MemberExpression' && parent.property === id;
}

function isInDeclaration(id: es.Identifier, stack: es.Node[]) {
  if (stack.length < 2) {
    return false;
  }
  const parent = stack[stack.length - 2];
  if (['VariableDeclarator', 'Property', 'CatchClause'].includes(parent.type)) {
    return true;
  }
  if (
    parent.type === 'FunctionDeclaration' ||
    parent.type === 'FunctionExpression' ||
    parent.type === 'ArrowFunctionExpression'
  ) {
    return parent.params.includes(id);
  }
  if (parent.type === 'AssignmentPattern') {
    return parent.left === id;
  }
  return false;
}

function isLocalAccess(id: es.Identifier, stack: es.Node[]) {
  for (let i = stack.length - 2; i >= 0; i--) {
    const parent = stack[i];
    if (
      parent.type === 'FunctionDeclaration' ||
      parent.type === 'FunctionExpression' ||
      parent.type === 'ArrowFunctionExpression'
    ) {
      if (isFunctionParam(id.name, parent.params)) {
        return true;
      }
    }
    if (parent.type === 'BlockStatement') {
      if (isDeclaredInBlock(id.name, parent.body)) {
        return true;
      }
    }
  }
  return false;
}

function isFunctionParam(name: string, params: es.Pattern[]) {
  for (const p of params) {
    switch (p.type) {
      case 'Identifier':
        if (p.name === name) {
          return true;
        }
        break;
      case 'AssignmentPattern':
        if (p.left.type === 'Identifier' && p.left.name === name) {
          return true;
        }
        break;
    }
  }
  return false;
}

function inFunctionBody(stack: es.Node[]) {
  for (let i = stack.length - 2; i >= 0; i--) {
    if (
      [
        'FunctionDeclaration',
        'FunctionExpression',
        'ArrowFunctionExpression',
      ].includes(stack[i].type)
    ) {
      return true;
    }
  }
  return false;
}

function isDeclaredInBlock(name: string, body: es.Statement[]) {
  for (const s of body) {
    if (s.type === 'VariableDeclaration') {
      for (const d of s.declarations) {
        if (d.id.type === 'Identifier') {
          if (d.id.name === name) {
            return true;
          }
        }
      }
    }
  }
  return false;
}
