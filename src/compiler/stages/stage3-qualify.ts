import * as acorn from 'acorn';
import * as estraverse from 'estraverse';
import type { AssignmentPattern, Identifier, Node, Pattern } from 'estree';
import { NodeType } from '../../html/dom';
import { ServerAttribute, ServerText } from '../../html/server-dom';
import type { Page } from '../ir/Page';
import type { Scope } from '../ir/Scope';
import type { Value } from '../ir/Value';

const RT_PARENT_VALUE_KEY = '$parent';

/**
 * Stage 3: Qualify value references:
 * - references to values in expressions must be qualified with the appropriate scope prefix
 * - references to local variables inside expressions are not qualified
 *
 * @param page - The Page object with the validated scope hierarchy from stage 2
 * @returns The same Page object after references qualification
 */

export function stage3qualify(page: Page) {
  for (const child of page.global.children) {
    qualifyScope(child);
  }
  page.main && qualifyScope(page.main);
  return page;
}

function qualifyScope(scope: Scope) {
  for (const [name, value] of scope.values) {
    qualifyValue(name, value);
  }

  for (const child of scope.children) {
    qualifyScope(child);
  }
}

function qualifyValue(name: string, value: Value) {
  if (value.node.nodeType !== NodeType.ATTRIBUTE) {
    return;
  }

  const expression = value.value;
  if (!expression || typeof expression !== 'string') {
    return;
  }

  try {
    const ast = acorn.parseExpressionAt(expression, 0, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
    });
    const qualified = qualifyExpression(name, ast as unknown as Node);
    if (value.node.nodeType === NodeType.ATTRIBUTE) {
      (value.node as ServerAttribute).value = qualified as unknown as string;
    } else if (value.node.nodeType === NodeType.TEXT) {
      (value.node as ServerText).textContent = qualified as unknown as string;
    }
  } catch {
    // Keep the original expression if it cannot be parsed.
  }
}

function qualifyExpression(key: string, expression: Node) {
  const stack: Node[] = [];
  return estraverse.replace(expression, {
    enter(node: Node, parent: Node | null | undefined) {
      stack.push(node);
      if (node.type !== 'Identifier') {
        return;
      }
      if (isInDeclaration(node, stack)) {
        return;
      }
      if (isLocalAccess(node, stack)) {
        return;
      }
      if (isQualified(node, parent)) {
        return;
      }
      if (key === node.name && !inFunctionBody(stack)) {
        return {
          type: 'MemberExpression',
          object: {
            type: 'MemberExpression',
            object: { type: 'ThisExpression' },
            property: { type: 'Identifier', name: RT_PARENT_VALUE_KEY },
            computed: false,
            optional: false,
          },
          property: node,
          computed: false,
          optional: false,
        };
      }
      return {
        type: 'MemberExpression',
        object: { type: 'ThisExpression' },
        property: node,
        computed: false,
        optional: false,
      };
    },
    leave() {
      stack.pop();
    },
  });
}

function isQualified(id: Node, parent: Node | null | undefined) {
  return parent?.type === 'MemberExpression' && parent.property === id;
}

function isInDeclaration(id: Node, stack: Node[]) {
  if (stack.length < 2) {
    return false;
  }
  const parent = stack[stack.length - 2];
  if (parent.type === 'VariableDeclarator') {
    // only the binding (`id`), not the initializer, is a declaration
    return parent.id === id;
  }
  if (parent.type === 'Property') {
    // acorn reuses `Property` for both object literals and destructuring
    // patterns; only the latter's key/value are bindings, not references
    const grandparent = stack.length >= 3 ? stack[stack.length - 3] : undefined;
    if (grandparent?.type === 'ObjectPattern') {
      return true;
    }
    return !parent.computed && parent.key === id;
  }
  if (parent.type === 'CatchClause') {
    return parent.param === id;
  }
  if (
    parent.type === 'FunctionDeclaration' ||
    parent.type === 'FunctionExpression' ||
    parent.type === 'ArrowFunctionExpression'
  ) {
    return parent.params.some(param => param === (id as Pattern));
  }
  if (parent.type === 'AssignmentPattern') {
    return parent.left === id;
  }
  if (parent.type === 'ArrayPattern' || parent.type === 'RestElement') {
    return true;
  }
  return false;
}

function isLocalAccess(id: Node, stack: Node[]) {
  if (id.type !== 'Identifier') {
    return false;
  }

  const identifier = id as Identifier;
  for (let i = stack.length - 2; i >= 0; i--) {
    const parent = stack[i];
    if (
      parent.type === 'FunctionDeclaration' ||
      parent.type === 'FunctionExpression' ||
      parent.type === 'ArrowFunctionExpression'
    ) {
      if (isFunctionParam(identifier.name, parent.params)) {
        return true;
      }
    }
    if (parent.type === 'BlockStatement') {
      if (isDeclaredInBlock(identifier.name, parent.body)) {
        return true;
      }
    }
  }
  return false;
}

function isFunctionParam(name: string, params: Pattern[]) {
  return params.some(param => {
    if (param.type === 'Identifier') {
      return param.name === name;
    }
    if (param.type === 'AssignmentPattern') {
      const assignment = param as AssignmentPattern;
      return assignment.left.type === 'Identifier' && assignment.left.name === name;
    }
    return false;
  });
}

function inFunctionBody(stack: Node[]) {
  for (let i = stack.length - 2; i >= 0; i--) {
    if (
      ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(stack[i].type)
    ) {
      return true;
    }
  }
  return false;
}

function isDeclaredInBlock(name: string, body: Node[]) {
  return body.some(statement => {
    if (statement.type !== 'VariableDeclaration') {
      return false;
    }
    return statement.declarations.some(declaration => {
      return declaration.id.type === 'Identifier' && declaration.id.name === name;
    });
  });
}
