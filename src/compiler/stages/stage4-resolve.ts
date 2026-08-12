import * as estraverse from 'estraverse';
import type { Node } from 'estree';
import type { Page } from '../ir/Page';
import { DID_VALUE_PREFIX, EVENT_VALUE_PREFIX, WILL_VALUE_PREFIX } from '../ir/Page';
import type { Scope } from '../ir/Scope';
import type { Value, ValueDepRef } from '../ir/Value';

const RT_PARENT_VALUE_KEY = '$parent';
const RT_VALUE_FN_KEY = '$value';

// values whose top-level expression is itself a callback (an event/lifecycle
// handler): its body only runs later, when invoked, not as part of
// evaluating this value, so references inside it aren't dependencies of the
// value itself
const CALLBACK_VALUE_PREFIXES = [EVENT_VALUE_PREFIX, DID_VALUE_PREFIX, WILL_VALUE_PREFIX];

/**
 * Stage 4: Resolve value references at compile time.
 *
 * Walks each value's qualified expression (from stage3) and records every
 * `this.foo`/`this.<via>.foo` reference it makes as a `ValueDepRef` on
 * `Value.deps`, mirroring the runtime's `CoreValueProps.deps` contract.
 */

export function stage4resolve(page: Page) {
  for (const child of page.global.children) {
    resolveScope(child, page);
  }
  page.main && resolveScope(page.main, page);
  return page;
}

function resolveScope(scope: Scope, page: Page) {
  for (const [name, value] of scope.values) {
    resolveValue(name, value, page);
  }
  for (const [name, value] of scope.textValues) {
    resolveValue(name, value, page);
  }
  for (const child of scope.children) {
    resolveScope(child, page);
  }
}

function resolveValue(name: string, value: Value, page: Page) {
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
  value.deps = isCallback ? [] : collectDeps(ast, page);
  isCallback || validateDeps(page, value);
}

// each dep must actually resolve to something real: a declared value, or a
// named (:aka) scope reference -- mirroring how CoreScope.link() registers
// a named child scope as a value on ITS OWN parent, not on itself
function validateDeps(page: Page, value: Value) {
  for (const dep of value.deps) {
    if (dep.key === RT_PARENT_VALUE_KEY || dep.key === RT_VALUE_FN_KEY) continue;
    const target = dep.via
      ? dep.via === RT_PARENT_VALUE_KEY
        ? value.scope.parent
        : page.defines.get(dep.via)
      : value.scope;
    if (!target || !resolvesToKnownValue(target, dep.key)) {
      const ref = dep.via ? `${dep.via}.${dep.key}` : dep.key;
      addError(page, `Unknown reference: "${ref}"`, value.node.loc);
    }
  }
}

function resolvesToKnownValue(scope: Scope, key: string): boolean {
  let s: Scope | undefined = scope;
  while (s) {
    if (s.values.has(key)) return true;
    if (s.children.some(c => c.name === key)) return true;
    s = s.parent;
  }
  return false;
}

function addError(page: Page, msg: string, loc: Value['node']['loc']) {
  page.errors.push({ type: 'error', msg, loc });
}

function collectDeps(ast: Node, page: Page): ValueDepRef[] {
  const deps = new Map<string, ValueDepRef>();
  estraverse.traverse(ast, {
    enter(node) {
      const dep = matchDep(node, page);
      if (dep) {
        deps.set(`${dep.via}:${dep.key}`, dep);
        this.skip();
      }
    },
  });
  return [...deps.values()];
}

// a segment navigates to another scope only if it's the reserved $parent, or
// a known `:aka`-named scope -- anything else is just a regular value whose
// own runtime shape we can't (and shouldn't) peek into at compile time (e.g.
// `this.items.filter` isn't a dependency on some scope named "items")
function isNavigableScopeName(name: string, page: Page): boolean {
  return name === RT_PARENT_VALUE_KEY || page.defines.has(name);
}

function matchDep(node: Node, page: Page): ValueDepRef | undefined {
  if (node.type !== 'MemberExpression' || node.computed) {
    return undefined;
  }
  if (node.property.type !== 'Identifier') {
    return undefined;
  }
  const object = node.object;
  if (object.type === 'ThisExpression') {
    return { key: node.property.name };
  }
  if (
    object.type === 'MemberExpression' &&
    !object.computed &&
    object.object.type === 'ThisExpression' &&
    object.property.type === 'Identifier' &&
    isNavigableScopeName(object.property.name, page)
  ) {
    return { via: object.property.name, key: node.property.name };
  }
  return undefined;
}
