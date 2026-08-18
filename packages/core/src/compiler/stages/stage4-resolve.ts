import * as estraverse from 'estraverse';
import type { Node } from 'estree';
import type { Page } from '../ir/Page';
import {
  DID_VALUE_PREFIX,
  EVENT_VALUE_PREFIX,
  FOR_DATA_VALUE,
  FOR_EACH_VALUE,
  HANDLE_VALUE_PREFIX,
  WILL_VALUE_PREFIX,
} from '../ir/Page';
import type { Scope } from '../ir/Scope';
import type { Value, ValueDepRef } from '../ir/Value';

const RT_PARENT_VALUE_KEY = '$parent';
const RT_VALUE_FN_KEY = '$value';
const RT_ID_VALUE_KEY = '$id';
// the enclosing custom-tag instance, structurally -- see CoreScope's copy
const RT_HOST_VALUE_KEY = '$host';
// DOM-side, but the resolver only needs to know it is always there
const RT_DOM_VALUE_KEY = '$dom';

// values whose top-level expression is itself a callback (an event/lifecycle
// handler): its body only runs later, when invoked, not as part of
// evaluating this value, so references inside it aren't dependencies of the
// value itself
const CALLBACK_VALUE_PREFIXES = [EVENT_VALUE_PREFIX, DID_VALUE_PREFIX, WILL_VALUE_PREFIX];

// The JS standard library, which the runtime's global scope supplies to every
// expression. Duplicated from runtime/core/core-global.ts rather than
// imported -- as with the RT_ keys above, the compiler doesn't depend on
// runtime code -- and a test asserts the two lists stay identical.
export const GLOBAL_NAMES = new Set([
  '$origin',
  'Array', 'BigInt', 'Boolean', 'Date', 'Error', 'Infinity', 'Intl', 'JSON',
  'Map', 'Math', 'NaN', 'Number', 'Object', 'Promise', 'RegExp', 'Set',
  'String', 'Symbol', 'URL', 'WeakMap', 'WeakSet', 'clearInterval', 'clearTimeout',
  'console', 'decodeURI', 'decodeURIComponent', 'encodeURI',
  'encodeURIComponent', 'fetch', 'globalThis', 'isFinite', 'isNaN', 'parseFloat',
  'parseInt', 'queueMicrotask', 'setInterval', 'setTimeout',
  'structuredClone', 'undefined',
]);

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
  indexLexicalChildren(page.global);
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
    // references aren't dependencies of the callback value itself.
    //
    // Safe here and ONLY here, because nothing can consume what these
    // values hold: an event or lifetime handler is called by the DOM, never
    // from inside another value's expression. See below for why that
    // matters -- dropping the same references from an ordinary value would
    // leave whatever calls it reading stale data, in silence.
    //
    // The body still has to RESOLVE, though. Dropping it from `deps` says
    // "this doesn't wake the value up", not "anything goes in here": a name
    // that is nowhere is a typo, and left unchecked it compiles clean and
    // then fails inside a handler nobody has run yet. Collected purely for
    // the errors, which is why the result is discarded.
    validate(ast, value, page);
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
    // the arrow itself is the body case above: validated, never a dependency
    ast.callee && validate(ast.callee as Node, value, page);
    value.deps = [...deps.values()];
    return;
  }
  // Everything else keeps the references inside its function bodies, and
  // that is deliberate rather than an oversight worth optimising away.
  //
  // A value holding a function -- `:fmt=${(n) => n + suffix}` -- is consumed
  // by being CALLED, and its result then depends on `suffix`. But whatever
  // calls it, `${fmt(count)}`, mentions only `fmt` and `count`; it has no
  // way to depend on `suffix` itself. The only path from `suffix` to that
  // text is: `suffix` changes, `fmt` re-evaluates, the new closure is a
  // different object, and THAT propagates. Take the dependency away and the
  // text keeps rendering yesterday's suffix with nothing reported.
  //
  // Two things follow, both load-bearing:
  //  - the re-evaluation must actually produce a new object. Memoising a
  //    closure that captures nothing, or hoisting one out, would break the
  //    chain silently. test/function-values.test.ts pins it.
  //  - references nested inside a function that IS invoked during evaluation
  //    (`items.map(n => n + offset)`) are genuine dependencies for the
  //    ordinary reason, and the two cases are indistinguishable from here.
  //
  // So this over-approximates: a consumer that merely stores the function
  // gets re-notified for nothing. That is the cheap direction to be wrong in.
  value.deps = collectDeps(ast, value, page);
}

/**
 * The scope a chain resolves against, which is not always the one the value
 * lives on.
 *
 * A value written at a usage site keeps the scope its ELEMENT was loaded
 * into -- spliced out of the tree, but still holding it, so its own name
 * would resolve to itself here. That scope does not exist at runtime: the
 * value lives on the instance and evaluates against the call site
 * (CoreScope.hostFor). Starting one level up is what the runtime does, and
 * what keeps the dependency this stage records true of it.
 */
function resolvesFrom(value: Value): Scope {
  const scope = value.scope;
  if (!scope.detachedUsageSite) {
    return scope;
  }
  // Unless the usage replicates. `<my-tag :for-each=${rows} :x=${data} />`
  // binds the per-item alias on the usage itself, and its own values have
  // to see it -- which is what the runtime's LoopSiteScope is for. There the
  // call site DOES carry the alias, so this scope is the right place to
  // start after all.
  if (scope.values.has(FOR_EACH_VALUE) || scope.values.has(FOR_DATA_VALUE)) {
    return scope;
  }
  // And a usage written in someone's slot has its call site further out than
  // its structural parent, which is inside the instance it was slotted into.
  // The runtime evaluates it at the call site either way (callSiteScope), and
  // for as long as every `:aka` landed flat on <body> both walks reached the
  // same names, so the difference never showed. It shows the moment a name
  // belongs to the instance: `<bs-modal :aka="newDeploy">` holding
  // `<bs-input :aka="ndCommit">` accepted a bare `ndCommit` here, by walking
  // structurally back through the modal, and failed to link out there
  return (scope.slotted ? scope.lexical() : scope.parent) ?? scope;
}

/**
 * Records, for every scope, which scopes named themselves in it.
 *
 * A scope's name belongs where its markup was WRITTEN, and stage1-load moves
 * slotted markup under the instance it fills -- so `children` answers with
 * the instance for something whose `:aka` was written at the call site. The
 * runtime registers the name at the call site too (CoreScope.link), and
 * resolution here has to agree with it or a page compiles clean and finds
 * nothing at runtime.
 */
function indexLexicalChildren(scope: Scope): void {
  for (const child of scope.children) {
    const host = child.nameSite();
    if (host) (host.lexicalChildren ??= []).push(child);
    indexLexicalChildren(child);
  }
}

/** a scope that named itself in `scope`, whichever subtree it now sits in */
function namedScopeIn(scope: Scope, name: string): Scope | undefined {
  return scope.lexicalChildren?.find(c => c.name === name);
}

/**
 * Whether `key` resolves from `scope`.
 *
 * `navigated` says the chain has already stepped into this scope by name --
 * `a.b` rather than a bare `b` -- and it changes which chain is walked. A
 * bare name is looked up from where the expression sits, and slotted markup
 * and usage sites make that a structural question (see resolvesFrom). A
 * navigated one means "in there", and walking out of a custom-tag instance
 * is a step the runtime has no edge for. See Scope.resolvesVia().
 */
function resolvesToKnownValue(scope: Scope, key: string, navigated = false): boolean {
  return !!lookup(scope, key, navigated);
}

/**
 * What a bare `key` resolves to from `scope`, walking the same chain the
 * compiler walks: a value declared here or further out, or a named scope.
 *
 * Split out of `resolvesToKnownValue` so that something other than an error
 * message can be built on it -- an editor's go-to-definition is this exact
 * question asked about the name under a cursor, and asking it any other way
 * would be a second implementation of the language's scoping rules, drifting
 * from this one the first time either changed. See declarationFor.
 */
function lookup(scope: Scope, key: string, navigated = false): Declaration | undefined {
  let s: Scope | undefined = scope;
  while (s) {
    const value = s.values.get(key);
    if (value) return { value };
    const named = namedScopeIn(s, key);
    if (named) return { scope: named };
    s = navigated ? s.resolvesVia() : s.lexical();
  }
  return undefined;
}

/**
 * Every name that would resolve from a point in a page.
 *
 * The completion half of `declarationFor`, walking the same chain for the
 * same reason: what an editor offers and what the compiler accepts have to
 * be the same set, or the list is a list of things that might not work.
 *
 * `path` is the navigation prefix -- empty for a bare name, `['body']` for
 * what follows `body.` -- and nearest wins, so a name declared closer hides
 * one further out exactly as it does at compile time.
 */
export function visibleFrom(from: Value, path: string[] = []): Visible[] {
  let scope: Scope | undefined = resolvesFrom(from);
  let navigated = false;
  for (const segment of path) {
    const step = navigate(scope, segment, navigated);
    if (!step.isNavigation || !step.scope) {
      return [];
    }
    scope = step.scope;
    navigated = true;
  }

  const found: Visible[] = [];
  const seen = new Set<string>();
  for (let s: Scope | undefined = scope; s; s = navigated ? s.resolvesVia() : s.lexical()) {
    for (const [name, value] of s.values) {
      // the runtime's own bookkeeping, which nobody writes by hand
      if (!seen.has(name) && !name.includes('$')) {
        seen.add(name);
        found.push({ name, kind: 'value', value });
      }
    }
    for (const child of s.lexicalChildren ?? []) {
      if (child.name && !seen.has(child.name)) {
        seen.add(child.name);
        found.push({ name: child.name, kind: 'scope', scope: child });
      }
    }
  }
  return found;
}

/** a name that resolves, and what it resolves to */
export interface Visible {
  name: string;
  kind: 'value' | 'scope';
  value?: Value;
  scope?: Scope;
}

/** what a reference resolves to: a value, or a scope that has a name */
export type Declaration = { value: Value; scope?: undefined } | { scope: Scope; value?: undefined };

/**
 * What `path`, written inside `from`'s expression, refers to.
 *
 * The three halves an editor cannot get right on its own. Where the lookup
 * STARTS, which is not simply the value's own scope -- a usage site, a
 * replicated usage and slotted markup each resolve from somewhere else.
 * Where it goes from there, walking outward by the same rule the compiler
 * uses. And what a dotted path means: `body.items` is not a property access
 * but a navigation into a named scope followed by a lookup *in there*, which
 * is why the second segment cannot be found by searching for a name.
 *
 * `path` is the chain up to and including the name asked about, so asking
 * about `body` in `body.items` passes `['body']` and gets the scope.
 *
 * `undefined` when nothing declares it, and when a segment turns out to be
 * an ordinary value rather than a scope -- `data.name` navigates nowhere,
 * because `name` is a property of whatever `data` holds at runtime and has
 * no declaration site in the page at all.
 */
export function declarationFor(from: Value, path: string[]): Declaration | undefined {
  if (!path.length) {
    return undefined;
  }
  let scope = resolvesFrom(from);
  let navigated = false;
  for (const segment of path.slice(0, -1)) {
    const step = navigate(scope, segment, navigated);
    if (!step.isNavigation || !step.scope) {
      return undefined;
    }
    scope = step.scope;
    navigated = true;
  }
  const key = path[path.length - 1];
  const found = lookup(scope, key, navigated);
  if (found) {
    return found;
  }
  // `$parent` names a scope without being a name IN one, so the lookup above
  // cannot see it -- and asking where `$parent` goes is a fair question with
  // an exact answer. `$host` is the deliberate non-answer: it is whichever
  // instance encloses this one, which is a property of each usage rather
  // than of the definition, so `navigate` reports it as dynamic and there is
  // no single element to open.
  const step = navigate(scope, key, navigated);
  return step.isNavigation && step.scope ? { scope: step.scope } : undefined;
}

function addError(page: Page, msg: string, loc: Value['node']['loc']) {
  page.addError(msg, loc);
}

/**
 * Resolve every reference in a callback body, for the errors alone.
 *
 * Same walk as collectDeps, minus the computed-access complaint: that one is
 * about a dependency this stage cannot follow, and a body has no
 * dependencies to follow in the first place.
 */
function validate(ast: Node, value: Value, page: Page): void {
  collectDeps(ast, value, page, true);
}

function collectDeps(
  ast: Node,
  value: Value,
  page: Page,
  validateOnly = false
): ValueDepRef[] {
  const deps = new Map<string, ValueDepRef>();
  estraverse.traverse(ast, {
    enter(node) {
      // a computed access on a scope (`foo[expr].bar`) resolves fine at
      // runtime but can't be followed statically -- report it rather than
      // silently recording a dependency on the scope itself, which would
      // never change and so would never trigger an update
      const dynamic = dynamicScopeAccess(node, value.scope);
      if (dynamic && !validateOnly) {
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
/**
 * The dependency a `this`-rooted chain resolves to, or nothing if this node
 * is not one.
 *
 * Exposed for stage5, which has to ask the same question this stage asks --
 * "what does this chain read?" -- while walking an expression looking for
 * comptime constants to substitute. Resolving it a second way there would
 * be two answers to one question, and the one that mattered would be
 * whichever ran last.
 */
export function chainDep(
  node: Node,
  value: Value,
  page: Page
): ValueDepRef | undefined {
  const segments = chainSegments(node);
  return segments ? resolveChain(segments, value, page) : undefined;
}

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
  let target: Scope = resolvesFrom(value);

  // every segment but the last is a candidate navigation; the last is always
  // a key, so that `this.foo` on a named scope depends on the scope-valued
  // entry itself rather than trying to navigate into it
  for (let i = 0; i < segments.length - 1; i++) {
    // past the first segment the chain is already inside a named scope, so
    // the lookup is "in there" rather than "from here"
    const step = navigate(target, segments[i], i > 0);
    if (!step.isNavigation) {
      // an ordinary value: it's the dependency, and the remaining segments
      // are plain property access on whatever it holds at runtime
      return validated(via, segments[i], target, value, page);
    }
    if (!step.scope) {
      if (!step.dynamic) {
        addError(page, `Unknown reference: "${segments.join('.')}"`, value.node.loc);
        return undefined;
      }
      // navigable, but to somewhere only the usage decides. The hop is
      // recorded -- `this.$host.$value(key)` resolves fine at runtime, so
      // what it reads still propagates -- and anything past it is plain
      // property access on whatever turns up
      via.push(segments[i]);
      return { via, key: segments[i + 1] };
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
    key !== RT_HOST_VALUE_KEY &&
    key !== RT_DOM_VALUE_KEY
  ) {
    if (!resolvesToKnownValue(target, key, via.length > 0)) {
      // Supplied by the host to the SERVER, so it exists in one half of the
      // render and not the other. Readable only from a `:server-` value,
      // whose expression never reaches the browser -- anywhere else it would
      // compile clean and then be `undefined` in a page nobody tested,
      // which is the failure this language reports rather than produces.
      //
      // Checked here rather than left to the runtime: it costs a set lookup
      // at build time and nothing at all afterwards.
      if (!via.length && page.serverGlobals.has(key)) {
        if (!value.serverOnly) {
          addError(
            page,
            `"${key}" is supplied to the server, so it can only be read from ` +
              `a ":server-" value`,
            value.node.loc
          );
        }
        return undefined;
      }
      // a JS global, resolved at runtime from the global scope -- the last
      // link of the chain, which is why it is only consulted once nothing
      // declared has claimed the name. It never changes, so it is not a
      // dependency either: returning no ref keeps it out of `deps`
      if (!via.length && GLOBAL_NAMES.has(key)) {
        return undefined;
      }
      addError(page, unknownRef(page, via, key, target), value.node.loc);
      return undefined;
    }
  }
  return via.length ? { via, key } : { key };
}

/**
 * The message for a chain that did not resolve.
 *
 * Worth the extra search because of how this one is usually met: the name IS
 * in the markup, a line or two away, and only the path to it is wrong -- so
 * "unknown" reads as the compiler being mistaken rather than as an
 * explanation. A name belongs to the nearest enclosing NAMED scope
 * (Scope.nameSite), which is exactly the thing that is hard to see when the
 * scope in question is a tag someone else wrote.
 */
function unknownRef(page: Page, via: string[], key: string, from: Scope): string {
  const path = [...via, key].join('.');
  const where = via.length ? undefined : pathTo(page, key, from);
  return where
    ? `Unknown reference: "${path}" -- it belongs to <${where.split('.')[0]}>; ` +
      `read it as "${where}"`
    : `Unknown reference: "${path}"`;
}

/**
 * How `key` would have to be spelled to be reachable from `from`.
 *
 * Walks out from the scope that carries the name, collecting the names it
 * is nested in, and stops as soon as the head of the path is something the
 * reader can already see. Gives up rather than guess: an anonymous scope on
 * the way out cannot be written down, and a definition's own names are
 * behind one, which is what keeps this from suggesting a spelling that
 * would breach a component.
 */
function pathTo(page: Page, key: string, from: Scope): string | undefined {
  let found: Scope | undefined;
  const walk = (s: Scope) => {
    if (!found && s.name === key) found = s;
    s.children.forEach(walk);
  };
  walk(page.global);
  const parts: string[] = [];
  let s: Scope | undefined = found;
  for (let i = 0; s && i < 8; i++) {
    if (!s.name) return undefined;
    parts.unshift(s.name);
    if (parts.length > 1 && resolvesToKnownValue(from, s.name)) return parts.join('.');
    s = s.nameSite();
  }
  return undefined;
}

/**
 * Whether `name` navigates to another scope from `scope`. `isNavigation`
 * says the name means "go to a scope" (so failing to find one is an error);
 * `scope` is where it lands.
 */
function navigate(
  scope: Scope,
  name: string,
  navigated = false
): { isNavigation: boolean; scope?: Scope; dynamic?: boolean } {
  if (name === RT_PARENT_VALUE_KEY) {
    return { isNavigation: true, scope: scope.lexical() };
  }
  if (name === RT_HOST_VALUE_KEY) {
    // Structural rather than lexical, and that is what puts it out of this
    // stage's reach: a definition's values are declared once and evaluated
    // on every instance, so which instance encloses THEM is a property of
    // each usage, not of the definition. The chain is recorded so what it
    // reads still triggers an update; what is on the other end is checked by
    // nobody, the same trade `$dom` makes
    return { isNavigation: true, dynamic: true };
  }
  const target = findNavigableScope(scope, name, navigated);
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
//
// `navigated` picks the chain, for the reason resolvesToKnownValue gives:
// once a chain is inside a named scope, stepping back OUT of a custom-tag
// instance is a hop the runtime has no edge for.
function findNavigableScope(
  scope: Scope,
  name: string,
  navigated = false
): Scope | undefined {
  let s: Scope | undefined = scope;
  while (s) {
    const child = namedScopeIn(s, name);
    if (child) return child;
    if (s.values.has(name)) return undefined;
    s = navigated ? s.resolvesVia() : s.lexical();
  }
  return undefined;
}

