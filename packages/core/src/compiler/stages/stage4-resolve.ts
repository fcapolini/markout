import * as estraverse from 'estraverse';
import type { Node } from 'estree';
import type { Page } from '../ir/Page';
import { RT_SCOPE_PARAM } from './stage3-qualify';
import type { ServerAttribute } from '../../html/server-dom';
import {
  DID_VALUE_PREFIX,
  EVENT_VALUE_PREFIX,
  FOR_AS_VALUE,
  FOR_DATA_DEFAULT_NAME,
  FOR_DATA_VALUE,
  FOR_EACH_VALUE,
  IF_VALUE,
  HANDLE_VALUE_PREFIX,
  PARAMETER_MARKER,
  WILL_VALUE_PREFIX,
} from '../ir/Page';
import type { Scope } from '../ir/Scope';
import type { Value, ValueDepRef } from '../ir/Value';

const RT_PARENT_VALUE_KEY = '$parent';
const RT_VALUE_FN_KEY = '$value';
// `scope.$set('name', v)` -- see CoreScope's copy for why a write sometimes
// has to be a call
const RT_SET_FN_KEY = '$set';
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
/**
 * The globals that can change while a page is up, and so are dependencies.
 *
 * `$url` alone: a page's address changes under a client-side navigation
 * that keeps the document, and everything reading it has to re-run. Every
 * other name here is the JS standard library or a fact fixed for the life
 * of the render.
 *
 * Kept beside the list below rather than derived from it, because "does
 * reading this re-run my expression" is a decision per name and not a
 * property anything else can answer.
 */
export const LIVE_GLOBAL_NAMES = new Set(['$url']);

export const GLOBAL_NAMES = new Set([
  '$origin',
  '$url',
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
  // decided over the whole page before any value is resolved: whether a
  // function's body is a dependency turns on what the REST of the page does
  // with it, which no single value can see
  const lazy = collectLazyFunctions(page);
  for (const child of page.global.children) {
    resolveScope(child, page, lazy);
  }
  // after every value has been resolved, since that walk is what fills
  // `readValues` -- including the callback bodies nothing else looks inside
  warnUnreadLocals(page);
  return page;
}

/**
 * Warns about a name a usage site declared that nothing goes on to read.
 *
 * A local is the caller's own state hung on a tag, and one nobody reads is
 * dead either way -- but the shape worth catching is narrower than that.
 * `<bs-alert :variant="danger">` where the tag takes a `variant` is refused
 * outright; `:varient` is not, because it IS a legal local, and this is what
 * is left to notice it.
 *
 * A warning rather than an error, because unlike everything else this stage
 * reports it is a judgment about the page rather than a fact about whether
 * it can be built. A write counts as a use: `:log=${''}` assigned by a
 * handler and displayed nowhere is state, not a mistake.
 */
function warnUnreadLocals(page: Page): void {
  const walk = (scope: Scope) => {
    // the per-item alias is declared by the LANGUAGE, not by whoever wrote
    // the tag: `<my-row :for-each=${rows} />` introduces `data` whether or
    // not anything wants it, and telling someone nothing reads a name they
    // never wrote is noise. A `:for-each` on a plain element says nothing
    // either, which is the behaviour this matches
    const alias =
      scope.values.has(FOR_EACH_VALUE) || scope.values.has(FOR_DATA_VALUE)
        ? (scope.values.get(FOR_AS_VALUE)?.value as string) || FOR_DATA_DEFAULT_NAME
        : undefined;
    for (const [name, value] of scope.usageValues ?? []) {
      if (name === alias || page.readValues.has(value)) continue;
      const tag = scope.usesTag;
      const parameters = tag ? page.customTags.get(tag)?.parameters : undefined;
      const near = parameters && [...parameters].find(p => looksLike(p, name));
      page.addWarning(
        `nothing reads "${name}"` +
          (near
            ? `: <${tag}> takes "${near}" -- did you mean "${PARAMETER_MARKER}${near}"?`
            : `, declared on <${tag}>`),
        value.node.loc
      );
    }
    scope.children.forEach(walk);
  };
  page.main && walk(page.main);
}

/** one edit apart, which is what a misspelling of a parameter name is */
function looksLike(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0, j = 0, slack = 1;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; continue; }
    if (--slack < 0) return false;
    short.length === long.length ? (i++, j++) : j++;
  }
  return true;
}

function resolveScope(scope: Scope, page: Page, lazy: Set<Value>) {
  for (const [name, value] of scope.values) {
    resolveValue(name, value, page, lazy);
  }
  // what the usage site declared rather than passed: not the instance's, but
  // still this page's, and it reads names like anything else
  for (const [name, value] of scope.usageValues ?? []) {
    resolveValue(name, value, page, lazy);
  }
  for (const [name, value] of scope.textValues) {
    resolveValue(name, value, page, lazy);
  }
  for (const child of scope.children) {
    resolveScope(child, page, lazy);
  }
}

function resolveValue(name: string, value: Value, page: Page, lazy: Set<Value>) {
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
  if (lazy.has(value)) {
    // the same licence, reached the long way round: collectLazyFunctions has
    // established that nothing in this page can consume what this value
    // holds, so there is no caller for its body to leave stale. Validated
    // and discarded for the same reason as above -- a name that is nowhere
    // in here is still a typo
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
  // that is deliberate rather than an oversight worth optimising away --
  // except where collectLazyFunctions has PROVED there is no one to be
  // wrong for, which is the branch above.
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
  // So this over-approximates, and deliberately: a consumer that merely
  // stores the function gets re-notified for nothing, which is the cheap
  // direction to be wrong in. Cheap is not free -- ten thousand cards
  // holding one `:buy=${add}` made it the benchmark's dominant cost -- and
  // collectLazyFunctions buys back the cases where the page itself shows
  // that nobody is listening.
  value.deps = collectDeps(ast, value, page);
}

/**
 * The scope a chain resolves against, which is not always the one the value
 * lives on.
 *
 * A value written at a usage site keeps the scope its ELEMENT was loaded
 * into -- spliced out of the tree, but still holding what that site
 * DECLARED. Those names are exactly what resolution should find here: they
 * are the usage's own, the way a native element's are, and the runtime holds
 * them on the instance's usage-site scope (CoreScope.usageSiteScope) for
 * this stage's dependencies to stay true of.
 *
 * The arguments have already been taken out of that map by stage1, so a
 * name the tag accepts is NOT found here and goes on meaning what it means
 * at the call site -- which is what keeps `<bs-badge ::variant=${variant} />`
 * a pass-through rather than a self-reference.
 */
function resolvesFrom(value: Value): Scope {
  const scope = value.scope;
  if (!scope.detachedUsageSite) {
    return scope;
  }
  // and it carries on outwards from here by `lexical()`, which is the same
  // step the old code took eagerly: the structural parent, or -- for a usage
  // written in someone's slot -- the call site further out, since the
  // structural one is inside the instance it was slotted into. The runtime
  // evaluates it at the call site either way (callSiteScope), and for as
  // long as every `:aka` landed flat on <body> both walks reached the same
  // names, so the difference never showed. It shows the moment a name
  // belongs to the instance: `<bs-modal :aka="newDeploy">` holding
  // `<bs-input :aka="ndCommit">` accepted a bare `ndCommit` by walking
  // structurally back through the modal, and failed to link out there
  return scope;
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
  return [...found, ...SYSTEM_VALUES];
}

/**
 * Every expression that reads `target`, and the name it reads it by.
 *
 * The reverse of `declarationFor`, and it has to be computed rather than
 * looked up: what stage4 records on each value is the SHAPE of what it reads
 * -- `{ via: ['body'], key: 'items' }` -- and two pages can spell the same
 * name meaning different things. So each dependency is resolved the way the
 * compiler resolved it, and kept only if it lands on the target.
 *
 * Every prefix is tried, because one dependency mentions more than one
 * thing: `body.items` reads the value `items` and the scope `body`, and
 * somebody asking where `body` is used means that one too.
 */
export function referencesTo(page: Page, target: Value | Scope): Reference[] {
  const found: Reference[] = [];
  for (const value of page.values.values()) {
    for (const dep of value.deps) {
      const path = [...(dep.via ?? []), dep.key];
      for (let i = 1; i <= path.length; i++) {
        const at = declarationFor(value, path.slice(0, i));
        if (at?.value === target || at?.scope === target) {
          found.push({ from: value, key: path[i - 1] });
        }
      }
    }
  }
  return found;
}

/** an expression that reads something, and the name it reads it by */
export interface Reference {
  /** the value whose expression does the reading */
  from: Value;
  /** the name as written there, which is the word to underline */
  key: string;
}

/** a name that resolves, and what it resolves to */
export interface Visible {
  name: string;
  kind: 'value' | 'scope' | 'system';
  value?: Value;
  scope?: Scope;
  /** for a system value, which has no declaration to read one off */
  detail?: string;
  /** a system value that is called rather than read */
  call?: boolean;
}

/**
 * What every scope supplies, offered last.
 *
 * These were left out of the list for a long time on the grounds that they
 * are "the runtime's own bookkeeping, which nobody writes by hand", and that
 * stopped being true some way back: the bootstrap kit and the demo site write
 * `$id`, `$host` and `$dom` forty-seven times between them, building HTML ids
 * and asking what they are inside. `$set` settled it -- a function whose
 * whole reason for existing is that it is the non-obvious spelling for a
 * guarded write, which is exactly the thing an author needs prompting for.
 *
 * Last in the list, because they are rarer than what the page declares and
 * `visibleFrom` answers nearest-first.
 */
const SYSTEM_VALUES: Visible[] = [
  { name: RT_ID_VALUE_KEY, kind: 'system', detail: "this scope's id, unique in the page" },
  {
    name: RT_PARENT_VALUE_KEY,
    kind: 'system',
    detail: 'the enclosing scope -- where this markup was written',
  },
  {
    name: RT_HOST_VALUE_KEY,
    kind: 'system',
    detail: 'the custom-tag instance this markup is inside, if any',
  },
  {
    name: RT_VALUE_FN_KEY,
    kind: 'system',
    call: true,
    detail: '$value("name") -- looks a value up by name',
  },
  {
    name: RT_SET_FN_KEY,
    kind: 'system',
    call: true,
    detail: '$set("name", value) -- assigns, and answers whether it landed',
  },
  {
    name: RT_DOM_VALUE_KEY,
    kind: 'system',
    detail: "this scope's own element; browser-only",
  },
];

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
/**
 * The function values whose bodies are safe to leave untracked.
 *
 * `:add=${(item) => cart = [...cart, item]}` reads `cart` only when it is
 * CALLED, and it reads it through the live scope -- so re-evaluating the
 * value when `cart` moves buys nothing but a new closure identity. That
 * identity is not free: everything holding the function re-evaluates too,
 * which on the catalog benchmark is ten thousand `:buy=${add}` values per
 * click, all of them arriving at a function that behaves identically.
 *
 * The identity IS load-bearing wherever something consumes the function:
 * `${fmt(count)}` recomputes only because `fmt` became a different object
 * (test/function-values.test.ts pins the whole chain). So a body can be
 * dropped exactly when nothing in the page can consume it, which is what
 * this works out, over the page rather than over one value:
 *
 *  - a reference that is a value's WHOLE expression (`:buy=${add}`) hands
 *    the function on untouched and consumes nothing itself -- but whatever
 *    it flows into has to come out clear as well
 *  - a reference anywhere else (`fmt(x)`, `rows.map(fmt)`, `[fmt]`) may
 *    call it while another value is being evaluated, and THAT value's
 *    result is what would then go stale
 *  - a reference inside a callback body consumes nothing either: those
 *    bodies are already untracked, so they can no more go stale than the
 *    callback itself can
 *
 * Names are matched across the whole page rather than per scope. Two
 * unrelated `fmt`s therefore tar each other -- which costs a missed
 * optimisation and never a wrong answer, the direction this has to be
 * wrong in.
 */
function collectLazyFunctions(page: Page): Set<Value> {
  const consumed = new Set<string>();
  // `:buy=${add}` -- what `add` flows into, so consumption can be traced
  // back through the hand-off
  const flows = new Map<string, string[]>();
  const fns: { value: Value; name: string; body: string[] }[] = [];

  eachValue(page, (name, value) => {
    const ast = astOf(value);
    if (!ast || isCallbackValue(name, ast)) {
      return;
    }
    if (ast.type === 'ArrowFunctionExpression' || ast.type === 'FunctionExpression') {
      // its body is the question, not evidence about it
      fns.push({ value, name, body: referencedNames(ast) });
      return;
    }
    const chain = chainSegments(ast);
    if (chain?.length === 1) {
      flows.set(chain[0].name, [...(flows.get(chain[0].name) ?? []), name]);
      return;
    }
    referencedNames(ast).forEach(n => consumed.add(n));
  });

  // a fixpoint rather than one pass: a function that turns out to be
  // consumed keeps its body, and the names in that body are consumed in
  // turn -- which can reach a function already decided about this round
  for (let moved = true; moved; ) {
    moved = false;
    const mark = (n: string) => {
      if (!consumed.has(n)) {
        consumed.add(n);
        moved = true;
      }
    };
    flows.forEach((into, from) => into.some(n => consumed.has(n)) && mark(from));
    fns.forEach(fn => consumed.has(fn.name) && fn.body.forEach(mark));
  }

  return new Set(fns.filter(fn => !consumed.has(fn.name)).map(fn => fn.value));
}

/** every scope name an expression mentions, chains included (`a.b` -> both) */
function referencedNames(ast: Node): string[] {
  const names: string[] = [];
  estraverse.traverse(ast, {
    enter(node) {
      const segments = chainSegments(node);
      if (!segments) {
        return;
      }
      // consumed whole, exactly as collectDeps does it
      this.skip();
      segments.forEach(s => names.push(s.name));
    },
  });
  return names;
}

function astOf(value: Value): Node | undefined {
  const expression = value.value;
  return !expression || typeof expression === 'string'
    ? undefined
    : (expression as unknown as Node);
}

function isCallbackValue(name: string, ast: Node): boolean {
  return (
    CALLBACK_VALUE_PREFIXES.some(p => name.startsWith(p)) &&
    (ast.type === 'ArrowFunctionExpression' || ast.type === 'FunctionExpression')
  );
}

function eachValue(page: Page, visit: (name: string, value: Value) => void) {
  const walk = (scope: Scope) => {
    scope.values.forEach((value, name) => visit(name, value));
    scope.usageValues?.forEach((value, name) => visit(name, value));
    scope.textValues.forEach((value, name) => visit(name, value));
    scope.children.forEach(walk);
  };
  page.global.children.forEach(walk);
}

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
      // whether this chain is being WRITTEN, which changes what can be said
      // about a region: a read into one is guarded with `?.`, and there is no
      // such spelling for an assignment target
      const owners = this.parents();
      const owner = owners[owners.length - 1] as Node | undefined;
      const writing =
        (owner?.type === 'AssignmentExpression' && owner.left === (node as never)) ||
        (owner?.type === 'UpdateExpression' && owner.argument === (node as never));
      // `x.$set('name', v)`: the name is an argument rather than a segment,
      // so it has to be picked out of the call to be checked at all -- and it
      // has to be checked, or a typo would be a write that lands nowhere,
      // which is the exact shape `$set` exists to make impossible
      const call =
        owner?.type === 'CallExpression' && owner.callee === (node as never) ? owner : undefined;
      const dep = resolveChain(segments, value, page, writing, call);
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

/**
 * One step of a reference chain, and whether the page wrote `?.` to get here.
 *
 * The flag belongs to the step that READS the previous one -- `a.b?.c` marks
 * `c`, because what may be missing is `b`. That is JavaScript's own reading of
 * it, and it is the shape `reachable` asks about at a region boundary.
 */
interface Segment {
  name: string;
  optional: boolean;
}

function chainSegments(node: Node): Segment[] | undefined {
  const segments: Segment[] = [];
  let n: Node = node;
  while (n.type === 'MemberExpression') {
    if (n.computed || n.property.type !== 'Identifier') {
      return undefined;
    }
    segments.unshift({ name: n.property.name, optional: !!n.optional });
    n = n.object as Node;
  }
  // rooted at the scope parameter stage3 qualified with. It was a
  // `this` until expressions started reaching their scope by argument --
  // which is one node type to a walk like this one, and one language rule
  // fewer to everyone else (see RT_SCOPE_PARAM)
  return n.type === 'Identifier' && n.name === RT_SCOPE_PARAM && segments.length
    ? segments
    : undefined;
}

/**
 * Walk a chain segment by segment, resolving each against the scope the
 * previous one landed in, and return the dependency it denotes. Reports a
 * compile error (and returns undefined) if it doesn't resolve.
 */
function resolveChain(
  segments: Segment[],
  value: Value,
  page: Page,
  writing = false,
  call?: Node
): ValueDepRef | undefined {
  const via: string[] = [];
  let target: Scope = resolvesFrom(value);
  // set once the walk steps into a region: everything from there on may be
  // absent, so the dependency the chain ends in is one the runtime is told to
  // tolerate finding nothing for
  let maybe = false;

  // every segment but the last is a candidate navigation; the last is always
  // a key, so that `this.foo` on a named scope depends on the scope-valued
  // entry itself rather than trying to navigate into it
  for (let i = 0; i < segments.length - 1; i++) {
    // past the first segment the chain is already inside a named scope, so
    // the lookup is "in there" rather than "from here"
    const step = navigate(target, segments[i].name, i > 0);
    if (!step.isNavigation) {
      // an ordinary value: it's the dependency, and the remaining segments
      // are plain property access on whatever it holds at runtime
      return validated(via, segments[i].name, target, value, page, maybe, call);
    }
    if (!step.scope) {
      if (!step.dynamic) {
        addError(
          page,
          `Unknown reference: "${segments.map(s => s.name).join('.')}"`,
          value.node.loc
        );
        return undefined;
      }
      // navigable, but to somewhere only the usage decides. The hop is
      // recorded -- `this.$host.$value(key)` resolves fine at runtime, so
      // what it reads still propagates -- and anything past it is plain
      // property access on whatever turns up
      via.push(segments[i].name);
      return { via, key: segments[i + 1].name, ...(maybe ? { maybe } : {}) };
    }
    const crossing = reachable(step.scope, value, page, segments, i, writing);
    if (crossing === 'refused') {
      return undefined;
    }
    maybe ||= crossing === 'guarded';
    via.push(segments[i].name);
    target = step.scope;
  }

  return validated(
    via,
    segments[segments.length - 1].name,
    target,
    value,
    page,
    maybe,
    call
  );
}

/**
 * What it takes to read a name reached by navigating INTO `into`.
 *
 * A region -- `:if`, `:else`, `:for-data` -- is not built while it is a
 * stencil, so the scopes inside one do not exist and have registered no name.
 * A reference into one is therefore a reference to something that may not be
 * there, which is a thing JavaScript already has a spelling for: the page
 * writes `?.` at the crossing, and reads `undefined` while the region is
 * away.
 *
 * Required rather than merely allowed. Without it the reference compiled
 * clean and the browser answered `Cannot read properties of undefined
 * (reading '$value')` -- which names nothing the author wrote, and which the
 * runtime is entitled to read as a markout bug, since the compiler is meant
 * to guarantee every dependency resolves. `?.` is the page saying it knows.
 *
 * `:for-each` is refused outright, and not for want of a spelling: `?.` says
 * "this may be absent", and a loop's trouble is that the name means as many
 * scopes as there are items. Zero-or-one is what optional chaining answers,
 * so it is offered exactly where the arity is zero-or-one.
 *
 * The walk is STRUCTURAL, and has to be: markup slotted into a component
 * resolves its names at the call site but LIVES wherever the definition put
 * it, which can be inside a region of the component's own. Its name is
 * perfectly reachable and its scope still will not exist -- the one case a
 * lexical walk would wave through.
 *
 * Two things need no guard. A value ON a region host, since that scope exists
 * whether or not it is showing -- which is how a region's own condition is
 * read. And anything read from inside the same region, where everything is
 * built together and stops existing together.
 */
/**
 * A scope with no element of its own: a `<:logic>`, or an instance of a
 * `tag="x:logic"` component.
 *
 * The same answer the generator writes into props as `elementless`, and it
 * matters here for the same reason: such a scope DISPOSES when its condition
 * goes false rather than parking markup it has not got, so its name really
 * does stop answering. Unlike every other region host, a value on one is
 * absent while it is away.
 */
function elementlessScope(scope: Scope, page: Page): boolean {
  return (
    page.logicScopes.has(scope) ||
    (!!scope.usesTag && page.elementlessTags.has(scope.usesTag))
  );
}

function reachable(
  into: Scope,
  value: Value,
  page: Page,
  segments: Segment[],
  at: number,
  writing: boolean
): 'plain' | 'guarded' | 'refused' {
  const from = resolvesFrom(value);
  // Normally from the PARENT: a value on a region host needs no guard,
  // because an element host is there whether or not it is showing. That
  // reasoning is exactly as good as hiding being a detach, and an elementless
  // host does not detach -- it disposes -- so for one of those the host
  // itself is the first crossing to consider. An unconditional one carries no
  // region value and the loop moves on to the parent as before.
  //
  // It is not only a check. Classifying the read as `guarded` is what
  // registers the reader as a maybe, which is what `relinkMaybes` walks when
  // the region comes back; called `plain`, the read is evaluated once against
  // a name that was not there yet and never asked again.
  const start = elementlessScope(into, page) ? into : into.parent;
  for (let host: Scope | undefined = start; host; host = host.parent) {
    const region = [FOR_EACH_VALUE, FOR_DATA_VALUE, IF_VALUE].find(k => host!.values.has(k));
    if (!region) {
      continue;
    }
    // inside it too, and so inside every region further out: nothing left
    // between the two of them to come and go
    for (let s: Scope | undefined = from; s; s = s.parent) {
      if (s === host) {
        return 'plain';
      }
    }
    const written = (host.values.get(region)!.node as ServerAttribute).name;
    const path = segments.slice(at).map(s => s.name).join('.');
    // The segment BEFORE this one is what the page navigated through, and
    // naming it locates the crossing. There is not always one. `at` is the
    // segment that lands inside, and it is the FIRST whenever the region host
    // is UNNAMED: `<div :if>` around `<span :aka="field">` is reached as
    // `field.text`, where a named host would have made it `panel.field.text`.
    // Then there is no crossing to name -- the reference starts inside -- and
    // saying so is the whole of the difference between the two wordings.
    const via = at > 0 ? ` through "${segments[at - 1].name}"` : '';
    // A scope that CARRIES the directive is not inside anything, and being
    // told that it is reads as a puzzle -- the same reason an `:else` is
    // reported as ":else" rather than as the ":if" it compiles to
    const where =
      host === into
        ? `carries a "${written}", so it is there only while that condition holds`
        : `is inside a "${written}", so it is there only while that region is showing`;
    if (region === FOR_EACH_VALUE) {
      addError(
        page,
        `Cannot read "${path}"${via}: "${segments[at].name}" is ` +
          `inside a "${written}", which renders it once per item -- so the name ` +
          `means as many scopes as there are items and none of them in ` +
          `particular. Declare what the outside needs to read outside the loop`,
        value.node.loc
      );
      return 'refused';
    }
    // the crossing is the read OF the segment that lands inside, which is the
    // access the next segment makes
    if (!writing && segments[at + 1]?.optional) {
      return 'guarded';
    }
    if (writing) {
      // `a?.b = c` is not JavaScript, so an assignment has no guarded form --
      // but `a?.b(c)` is, which is the whole reason `$set` exists
      const target = segments.slice(0, at + 1).map(s => s.name).join('.');
      const rest = segments.slice(at + 1).map(s => s.name).join('.');
      addError(
        page,
        `Cannot assign to "${path}"${via}: ` +
          `"${segments[at].name}" ${where}, and "?." cannot go on the left ` +
          `of an "=". Write it as "${target}?.${RT_SET_FN_KEY}('${rest}', ...)", ` +
          `which does nothing while the region is away and answers whether it ` +
          `did -- or declare what the outside changes outside the region`,
        value.node.loc
      );
      return 'refused';
    }
    const guarded =
      `${segments.slice(0, at + 1).map(s => s.name).join('.')}?.` +
      `${segments.slice(at + 1).map(s => s.name).join('.')}`;
    addError(
      page,
      `"${segments[at].name}" ${where}. ` +
        (segments[segments.length - 1].name === RT_SET_FN_KEY
          ? // a `$set` is a write wearing a call, so "read it as" would be
            // the wrong verb for the one thing this spelling exists to allow
            `Call it as "${guarded}(...)", which does nothing while the ` +
            `region is away and answers whether it did`
          : `Read it as "${guarded}", which is undefined while the region is ` +
            `away`) +
        ` -- or declare what the outside needs outside the region`,
      value.node.loc
    );
    return 'refused';
  }
  return 'plain';
}

function validated(
  via: string[],
  key: string,
  target: Scope,
  value: Value,
  page: Page,
  maybe = false,
  call?: Node
): ValueDepRef | undefined {
  if (key === RT_SET_FN_KEY) {
    return setCall(target, value, page, call);
  }
  // the runtime supplies these on every scope; there's nothing to declare
  if (
    key !== RT_PARENT_VALUE_KEY &&
    key !== RT_VALUE_FN_KEY &&
    key !== RT_ID_VALUE_KEY &&
    key !== RT_HOST_VALUE_KEY &&
    key !== RT_DOM_VALUE_KEY
  ) {
    const resolved = lookup(target, key, via.length > 0);
    // noted as this stage walks -- which is the only walk that sees inside a
    // callback body, whose references are resolved for the errors alone and
    // recorded as dependencies nowhere (see collectLazyFunctions). Anything
    // asking "does something read this" has to count those, or a value a
    // handler is the sole user of reads as used by nobody
    resolved?.value && page.readValues.add(resolved.value);
    if (!resolved) {
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
      // declared has claimed the name. Most never change, so they are not
      // dependencies either: returning no ref keeps them out of `deps`
      if (!via.length && GLOBAL_NAMES.has(key)) {
        // except the one that does. A dep of one segment resolves through
        // `$value`, which walks the scope chain to the global scope from
        // wherever it was written, so nothing has to know how deep it is
        return LIVE_GLOBAL_NAMES.has(key) ? { key } : undefined;
      }
      addError(page, unknownRef(page, via, key, target), value.node.loc);
      return undefined;
    }
  }
  const found = via.length ? { via, key } : { key };
  return maybe ? { ...found, maybe } : found;
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
/**
 * `<scope>.$set('name', v)` -- checked, and never a dependency.
 *
 * Not a dependency because it is a write: subscribing a value to the thing it
 * assigns would make it re-evaluate itself, and what a handler does is not
 * what it reads.
 *
 * The name is checked because it is a string rather than a segment, and an
 * unchecked one would be a write that lands nowhere -- which is precisely the
 * failure `$set` was introduced to have a spelling for, so producing a new
 * one would be an odd way to go about it. A name that isn't a literal cannot
 * be checked, and is refused for the same reason a computed access on a scope
 * is: the compiler cannot follow it, and the runtime failing quietly later is
 * the thing being avoided.
 */
function setCall(
  target: Scope,
  value: Value,
  page: Page,
  call?: Node
): ValueDepRef | undefined {
  const args = call?.type === 'CallExpression' ? call.arguments : undefined;
  if (!args) {
    addError(
      page,
      `"${RT_SET_FN_KEY}" is a call: write "${RT_SET_FN_KEY}('name', value)"`,
      value.node.loc
    );
    return undefined;
  }
  const first = args[0] as Node | undefined;
  if (first?.type !== 'Literal' || typeof first.value !== 'string') {
    addError(
      page,
      `"${RT_SET_FN_KEY}" needs the name as a literal, so the compiler can ` +
        `check it: a name it cannot follow is a write that lands nowhere, ` +
        `which is what "${RT_SET_FN_KEY}" is for saying`,
      value.node.loc
    );
    return undefined;
  }
  if (args.length !== 2) {
    addError(
      page,
      `"${RT_SET_FN_KEY}" takes the name and the value: ` +
        `"${RT_SET_FN_KEY}('${first.value}', value)"`,
      value.node.loc
    );
    return undefined;
  }
  if (!resolvesToKnownValue(target, first.value, true)) {
    addError(page, `Unknown reference: "${first.value}"`, value.node.loc);
  }
  return undefined;
}

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
    const step = navigate(target, segment.name);
    if (!step.isNavigation || !step.scope) {
      return undefined;
    }
    target = step.scope;
  }
  return segments.map(s => s.name).join('.');
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

