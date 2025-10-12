import estraverse from 'estraverse';
import * as es from 'estree';
import { PageError, Source } from '../html/parser';
import { RT_PARENT_VALUE_KEY } from '../runtime/base/base-scope';
import { CompilerScope, CompilerValue } from './compiler';

//TODO: in order to support comptime:
// * scope property 'comptime'
// * references from non-comptime to comptime scopes cause error
// * a comptime scope makes all its neted scopes comptime too
// * all traces of comptime stuff will be removed by the treeshaker

export function resolve(source: Source, root: CompilerScope): boolean {
  const resolve = (scope: CompilerScope) => {
    scope.values &&
      Object.keys(scope.values).forEach(key => {
        const value = scope.values![key];
        addValueRefs(source, scope, value);
      });
    scope.children.forEach(child => resolve(child));
  };
  resolve(root);
  return source.errors.length === 0;
}

function addValueRefs(
  source: Source,
  scope: CompilerScope,
  value: CompilerValue
) {
  if (typeof value.val !== 'object') {
    return;
  }

  const stack: es.Node[] = [];

  // arrow functions are used to implement scope methods,
  // and references in methods are ignored
  const inArrowFunctionexpression = () => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].type === 'ArrowFunctionExpression') {
        return true;
      }
    }
    return false;
  };

  estraverse.traverse(value.val as es.Node, {
    enter: (node, parent) => {
      stack.push(node);
      if (node.type === 'ThisExpression' && !inArrowFunctionexpression()) {
        addValueRef(source, scope, value, node, stack);
      }
    },

    leave: () => {
      stack.pop();
    },
  });
}

function addValueRef(
  source: Source,
  scope: CompilerScope,
  value: CompilerValue,
  node: es.ThisExpression,
  stack: es.Node[]
) {
  const path: string[] = [];
  for (let i = stack.length - 2; i >= 0; i--) {
    const node = stack[i];
    if (node.type !== 'MemberExpression') {
      break;
    }
    const p = node.property;
    if (p.type !== 'Identifier' && p.type !== 'Literal') {
      break;
    }
    if (p.type === 'Literal' && typeof p.value !== 'string') {
      break;
    }
    const key = p.type === 'Literal' ? (p.value as string) : p.name;
    path.push(key);
  }
  validateValueRef(source, scope, value, path, node.loc!);
}

function validateValueRef(
  source: Source,
  scope: CompilerScope,
  value: CompilerValue,
  path: string[],
  loc: es.SourceLocation
) {
  for (let i = 0; i < path.length; i++) {
    const slice = path[i];
    const target = lookup(scope, slice);
    if (!target) {
      break;
    }
    if (!target.value) {
      // we found a scope: look up next slice
      scope = target.scope;
      continue;
    }
    // we found a value
    path.length = i + 1;
    const s = `this.` + path.join('.');
    value.refs || (value.refs = new Set());
    // store reference
    value.refs.add(s);
    return;
  }
  // we didn't find the target
  source.errors.push(new PageError('warning', 'invalid reference', loc));
}

type Target = {
  scope: CompilerScope;
  value?: CompilerValue;
};

function lookup(scope: CompilerScope, name: string): Target | null {
  for (const key of Object.keys(scope.values ?? {})) {
    if (key === name) {
      return { scope, value: scope.values![key] };
    }
  }
  for (const child of scope.children) {
    if (child.name?.val === name) {
      return { scope: child };
    }
  }
  if (!scope.closed && scope.parent) {
    if (name === RT_PARENT_VALUE_KEY) {
      return { scope: scope.parent };
    }
    return lookup(scope.parent, name);
  }
  return null;
}
