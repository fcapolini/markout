import * as acorn from 'acorn';
import * as estraverse from 'estraverse';
import type { Identifier, Node, Pattern } from 'estree';
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
  for (const [name, value] of scope.textValues) {
    qualifyValue(name, value);
  }

  for (const child of scope.children) {
    qualifyScope(child);
  }
}

function qualifyValue(name: string, value: Value) {
  const expression = value.value;
  // a plain (non-`${}`) string is a static literal, not an expression to
  // qualify; only already-parsed `${...}` expressions need qualifying
  if (!expression || typeof expression === 'string') {
    return;
  }

  const qualified = qualifyExpression(name, expression as unknown as Node);
  if (value.node.nodeType === NodeType.ATTRIBUTE) {
    (value.node as ServerAttribute).value = qualified as unknown as acorn.Expression;
  } else if (value.node.nodeType === NodeType.TEXT) {
    (value.node as ServerText).textContent = qualified as unknown as acorn.Expression;
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
    if (parent.type === 'ForOfStatement' || parent.type === 'ForInStatement') {
      if (
        parent.left.type === 'VariableDeclaration' &&
        isDeclaredByPatterns(identifier.name, parent.left.declarations.map(d => d.id as unknown as Node))
      ) {
        return true;
      }
    }
    if (parent.type === 'ForStatement') {
      if (
        parent.init?.type === 'VariableDeclaration' &&
        isDeclaredByPatterns(identifier.name, parent.init.declarations.map(d => d.id as unknown as Node))
      ) {
        return true;
      }
    }
  }
  return false;
}

function isFunctionParam(name: string, params: Pattern[]) {
  return isDeclaredByPatterns(name, params as unknown as Node[]);
}

function isDeclaredByPatterns(name: string, patterns: Node[]) {
  const names = new Set<string>();
  patterns.forEach(pattern => collectPatternNames(pattern, names));
  return names.has(name);
}

function collectPatternNames(pattern: Node | null | undefined, names: Set<string>) {
  if (!pattern) {
    return;
  }
  switch (pattern.type) {
    case 'Identifier':
      names.add(pattern.name);
      break;
    case 'ObjectPattern':
      pattern.properties.forEach(prop => {
        collectPatternNames(
          (prop.type === 'RestElement' ? prop.argument : prop.value) as unknown as Node,
          names
        );
      });
      break;
    case 'ArrayPattern':
      pattern.elements.forEach(el => collectPatternNames(el as unknown as Node, names));
      break;
    case 'AssignmentPattern':
      collectPatternNames(pattern.left as unknown as Node, names);
      break;
    case 'RestElement':
      collectPatternNames(pattern.argument as unknown as Node, names);
      break;
    default:
      break;
  }
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
  const names = new Set<string>();
  for (const statement of body) {
    if (statement.type === 'VariableDeclaration') {
      statement.declarations.forEach(d => collectPatternNames(d.id as unknown as Node, names));
    } else if (statement.type === 'FunctionDeclaration' && statement.id) {
      names.add(statement.id.name);
    }
  }
  return names.has(name);
}
