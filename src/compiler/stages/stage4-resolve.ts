import * as estraverse from 'estraverse';
import type { Node } from 'estree';
import type { Page } from '../ir/Page';
import { DID_VALUE_PREFIX, EVENT_VALUE_PREFIX, WILL_VALUE_PREFIX } from '../ir/Page';
import type { Scope } from '../ir/Scope';
import type { Value, ValueDepRef } from '../ir/Value';

const RT_PARENT_VALUE_KEY = '$parent';

// values whose top-level expression is itself a callback (an event/lifecycle
// handler): its body only runs later, when invoked, not as part of
// evaluating this value, so references inside it aren't dependencies of the
// value itself
const CALLBACK_VALUE_PREFIXES = [EVENT_VALUE_PREFIX, DID_VALUE_PREFIX, WILL_VALUE_PREFIX];

/**
 * Stage 4: Resolve value references at compile time.
 *
 * Walks each value's qualified expression (from stage3) and records every
 * `this.foo`/`this.$parent.foo` reference it makes as a `ValueDepRef` on
 * `Value.deps`, mirroring the runtime's `CoreValueProps.deps` contract.
 */

export function stage4resolve(page: Page) {
  for (const child of page.global.children) {
    resolveScope(child);
  }
  page.main && resolveScope(page.main);
  return page;
}

function resolveScope(scope: Scope) {
  for (const [name, value] of scope.values) {
    resolveValue(name, value);
  }
  for (const [name, value] of scope.textValues) {
    resolveValue(name, value);
  }
  for (const child of scope.children) {
    resolveScope(child);
  }
}

function resolveValue(name: string, value: Value) {
  const expression = value.value;
  if (!expression || typeof expression === 'string') {
    // a static literal has no dependencies
    value.deps = [];
    return;
  }

  const ast = expression as unknown as Node;
  const isCallback =
    CALLBACK_VALUE_PREFIXES.some(p => name.startsWith(p)) &&
    (ast.type === 'ArrowFunctionExpression' || ast.type === 'FunctionExpression');
  // a callback's own body isn't evaluated until it's invoked, so its
  // references aren't dependencies of the callback value itself
  value.deps = isCallback ? [] : collectDeps(ast);
}

function collectDeps(ast: Node): ValueDepRef[] {
  const deps = new Map<string, ValueDepRef>();
  estraverse.traverse(ast, {
    enter(node) {
      const dep = matchDep(node);
      if (dep) {
        deps.set(`${dep.viaParent}:${dep.key}`, dep);
        this.skip();
      }
    },
  });
  return [...deps.values()];
}

function matchDep(node: Node): ValueDepRef | undefined {
  if (node.type !== 'MemberExpression' || node.computed) {
    return undefined;
  }
  if (node.property.type !== 'Identifier') {
    return undefined;
  }
  const object = node.object;
  if (object.type === 'ThisExpression') {
    return { viaParent: false, key: node.property.name };
  }
  if (
    object.type === 'MemberExpression' &&
    !object.computed &&
    object.object.type === 'ThisExpression' &&
    object.property.type === 'Identifier' &&
    object.property.name === RT_PARENT_VALUE_KEY
  ) {
    return { viaParent: true, key: node.property.name };
  }
  return undefined;
}
