import * as estraverse from 'estraverse';
import type { Node } from 'estree';
import type { Page } from '../ir/Page';
import { DID_VALUE_PREFIX, EVENT_VALUE_PREFIX, HANDLE_VALUE_PREFIX, WILL_VALUE_PREFIX } from '../ir/Page';
import type { Scope } from '../ir/Scope';
import type { Value, ValueDepRef } from '../ir/Value';

const RT_PARENT_VALUE_KEY = '$parent';
const RT_VALUE_FN_KEY = '$value';
const RT_ID_VALUE_KEY = '$id';
// DOM-side, but the resolver only needs to know it is always there
const RT_DOM_VALUE_KEY = '$dom';

// values whose top-level expression is itself a callback (an event/lifecycle
// handler): its body only runs later, when invoked, not as part of
// evaluating this value, so references inside it aren't dependencies of the
// value itself
const CALLBACK_VALUE_PREFIXES = [EVENT_VALUE_PREFIX, DID_VALUE_PREFIX, WILL_VALUE_PREFIX];

/**
 * Stage 4: Resolve value references at compile time.
 *
 * Walks each value's qualified expression (from stage3) and records every
 * `this.foo`/`this.<via...>.foo` reference it makes as a `ValueDepRef` on
 * `Value.deps`, mirroring the runtime's `CoreValueProps.deps` contract.
 *
 * A reference is a `this`-rooted chain of static property accesses. It's
 * consumed whole, walking one segment at a time and resolving each against
 * the scope the previous segment landed in -- exactly mirroring what
 * `CoreScope.lookup()` does at runtime. The walk stops at the first segment
 * that isn't a scope navigation: that segment is the dependency key, and
 * anything after it is plain JS property access on the value's own runtime
 * shape (`items.filter`), not something the compiler can or should track.
 *
 * Every chain that can't be resolved this way is a compile error. That
 * matters more than it looks: a reference the compiler fails to record
 * doesn't fail loudly at runtime, it produces a binding that silently never
 * updates -- so "unrecognized" must never be a quiet no-op here.
 */

export function stage4resolve(page: Page) {
  // `page.main` is itself one of `page.global`'s children (stage1-load builds
  // it with global as its parent), so walking it separately would resolve the
  // whole tree a second time -- harmless for `deps`, which get reassigned, but
  // it reported every error twice
  for (const child of page.global.children) {
    resolveScope(child, page);
  }
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
  if (isCallback) {
    // a callback's own body isn't evaluated until it's invoked, so its
    // references aren't dependencies of the callback value itself
    value.deps = [];
    return;
  }
  // `:handle-x` is that same callback, wrapped by stage1 in a call that
  // passes `x`. The call runs on every evaluation, so the argument IS a
  // dependency -- but the body still isn't, and picking references out of it
  // would re-run the handler whenever anything it happens to touch changed,
  // which is not what "handle changes to x" says
  if (name.startsWith(HANDLE_VALUE_PREFIX) && ast.type === 'CallExpression') {
    const deps = new Map<string, ValueDepRef>();
    for (const arg of ast.arguments) {
      for (const dep of collectDeps(arg as Node, value, page)) {
        deps.set([...(dep.via ?? []), dep.key].join('.'), dep);
      }
    }
    value.deps = [...deps.values()];
    return;
  }
  value.deps = collectDeps(ast, value, page);
}

function resolvesToKnownValue(scope: Scope, key: string): boolean {
  let s: Scope | undefined = scope;
  while (s) {
    if (s.values.has(key)) return true;
    if (s.children.some(c => c.name === key)) return true;
    // lexical, not structural: slotted markup and custom-tag instances sit
    // where their DOM belongs but resolve where they were written
    s = s.lexical();
  }
  return false;
}

function addError(page: Page, msg: string, loc: Value['node']['loc']) {
  page.errors.push({ type: 'error', msg, loc });
}

function collectDeps(ast: Node, value: Value, page: Page): ValueDepRef[] {
  const deps = new Map<string, ValueDepRef>();
  estraverse.traverse(ast, {
    enter(node) {
      // a computed access on a scope (`foo[expr].bar`) resolves fine at
      // runtime but can't be followed statically -- report it rather than
      // silently recording a dependency on the scope itself, which would
      // never change and so would never trigger an update
      const dynamic = dynamicScopeAccess(node, value.scope);
      if (dynamic) {
        addError(
          page,
          `Cannot track dependencies through a computed property access on scope "${dynamic}"`,
          value.node.loc
        );
        this.skip();
        return;
      }
      const segments = chainSegments(node);
      if (!segments) {
        return;
      }
      // the chain is consumed whole; descending into it again would re-match
      // its own prefixes as separate (wrong) dependencies
      this.skip();
      const dep = resolveChain(segments, value, page);
      dep && deps.set(depKey(dep), dep);
    },
  });
  return [...deps.values()];
}

function depKey(dep: ValueDepRef): string {
  return `${(dep.via ?? []).join('.')}:${dep.key}`;
}

/**
 * The segments of a fully static `this`-rooted member chain, outermost last:
 * `this.a.b.c` -> `['a', 'b', 'c']`.
 *
 * Returns undefined for anything else -- a computed access, a non-Identifier
 * key, or a chain rooted somewhere other than `this` -- so the traversal
 * descends and matches sub-expressions individually instead. That's what
 * keeps `this.items[this.i]` recording both `items` and `i`.
 */
function chainSegments(node: Node): string[] | undefined {
  const segments: string[] = [];
  let n: Node = node;
  while (n.type === 'MemberExpression') {
    if (n.computed || n.property.type !== 'Identifier') {
      return undefined;
    }
    segments.unshift(n.property.name);
    n = n.object as Node;
  }
  return n.type === 'ThisExpression' && segments.length ? segments : undefined;
}

/**
 * Walk a chain segment by segment, resolving each against the scope the
 * previous one landed in, and return the dependency it denotes. Reports a
 * compile error (and returns undefined) if it doesn't resolve.
 */
function resolveChain(segments: string[], value: Value, page: Page): ValueDepRef | undefined {
  const via: string[] = [];
  let target: Scope = value.scope;

  // every segment but the last is a candidate navigation; the last is always
  // a key, so that `this.foo` on a named scope depends on the scope-valued
  // entry itself rather than trying to navigate into it
  for (let i = 0; i < segments.length - 1; i++) {
    const step = navigate(target, segments[i]);
    if (!step.isNavigation) {
      // an ordinary value: it's the dependency, and the remaining segments
      // are plain property access on whatever it holds at runtime
      return validated(via, segments[i], target, value, page);
    }
    if (!step.scope) {
      addError(page, `Unknown reference: "${segments.join('.')}"`, value.node.loc);
      return undefined;
    }
    via.push(segments[i]);
    target = step.scope;
  }

  return validated(via, segments[segments.length - 1], target, value, page);
}

function validated(
  via: string[],
  key: string,
  target: Scope,
  value: Value,
  page: Page
): ValueDepRef | undefined {
  // the runtime supplies these on every scope; there's nothing to declare
  if (
    key !== RT_PARENT_VALUE_KEY &&
    key !== RT_VALUE_FN_KEY &&
    key !== RT_ID_VALUE_KEY &&
    key !== RT_DOM_VALUE_KEY
  ) {
    if (!resolvesToKnownValue(target, key)) {
      addError(page, `Unknown reference: "${[...via, key].join('.')}"`, value.node.loc);
      return undefined;
    }
  }
  return via.length ? { via, key } : { key };
}

/**
 * Whether `name` navigates to another scope from `scope`. `isNavigation`
 * says the name means "go to a scope" (so failing to find one is an error);
 * `scope` is where it lands.
 */
function navigate(scope: Scope, name: string): { isNavigation: boolean; scope?: Scope } {
  if (name === RT_PARENT_VALUE_KEY) {
    return { isNavigation: true, scope: scope.lexical() };
  }
  const target = findNavigableScope(scope, name);
  return { isNavigation: !!target, scope: target };
}

// the object of a computed access, when that object is itself a static chain
// landing on a named scope -- e.g. `foo[k]` / `outer.inner[k]`
function dynamicScopeAccess(node: Node, scope: Scope): string | undefined {
  if (node.type !== 'MemberExpression' || !node.computed) {
    return undefined;
  }
  const segments = chainSegments(node.object as Node);
  if (!segments) {
    return undefined;
  }
  let target: Scope = scope;
  for (const segment of segments) {
    const step = navigate(target, segment);
    if (!step.isNavigation || !step.scope) {
      return undefined;
    }
    target = step.scope;
  }
  return segments.join('.');
}

// walks up from `scope` (inclusive) looking for an ancestor with a named
// child scope called `name` -- mirrors the runtime's CoreScope.lookup(),
// where a named child registers itself as a value on its OWN PARENT, so at
// each level we check whether THAT level has such a child. An ordinary
// value of the same name at a closer level shadows any named scope further
// up (same precedence a real lookup() walk would give it).
function findNavigableScope(scope: Scope, name: string): Scope | undefined {
  let s: Scope | undefined = scope;
  while (s) {
    const child = s.children.find(c => c.name === name);
    if (child) return child;
    if (s.values.has(name)) return undefined;
    s = s.lexical();
  }
  return undefined;
}

