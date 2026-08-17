import * as estraverse from 'estraverse';
import { generate } from 'escodegen';
import type { Expression, Node } from 'estree';
import { NodeType } from '../../html/dom';
import { PageError } from '../../html/parser';
import type { Page } from '../ir/Page';
import type { Scope } from '../ir/Scope';
import type { Value, ValueDepRef } from '../ir/Value';
import { chainDep } from './stage4-resolve';

/** the attribute marker that declares a value compile-time: `::name` */
export const COMPTIME_MARKER = '::';

/**
 * Stage 5: Evaluate `::` values and substitute them into their readers.
 *
 * A design token is a constant, and today it costs what a changing value
 * costs: a scope entry, a dependency closure, and a cell that will never
 * fire. `::accent=${'#6f42c1'}` says the value is fixed when the page is
 * built, and this stage takes it at its word -- computing it, writing the
 * result into every expression that reads it, and removing it from the
 * scope so nothing about it reaches the runtime at all.
 *
 * The mark is on the DECLARATION and the value keeps its own name, so
 * `${accent}` reads the same whichever it is. That was once the other way
 * round -- the name carried it, as `k_accent` -- on the grounds that a
 * reader has to be able to tell a constant from something live. What
 * settled it was that the difference costs something in exactly one place,
 * assigning to one, and no prefix was stopping that: `k_n = 5` compiled,
 * substituted to `2 = 5`, and took the page down at `new Function`. The
 * compiler has to refuse it either way (see rejectWrites), and once it
 * does, a name that says WHEN it was computed buys little and costs the
 * thing every use site pays: change your mind about a constant and every
 * reader has to be renamed. `accent` in the Orbit demo made exactly that
 * journey, from a fixed token to a value the settings panel writes.
 *
 * Doubling the attribute prefix rather than a `:const-` family, because
 * markout's families name things in ANOTHER namespace -- `:class-` a CSS
 * class, `:on-` a DOM event -- where the dash-case part is that other
 * thing's real name. A constant is a markout value, so a family form would
 * have to invent a rule for what `:const-accent` is called when read.
 *
 * What keeps this tractable is one rule:
 *
 *     a `::` value may read only literals and other `::` values
 *
 * That is a closure check rather than partial evaluation. Anything reaching
 * an ordinary value, `$id`, the DOM or a handler is refused -- and refused
 * rather than quietly left reactive, since falling back would hand the page
 * exactly the cost it marked the value to avoid, with nothing said.
 *
 * The result must be a primitive. A token is one, and an object constant
 * would change meaning under substitution: one shared object today, a
 * separate copy per use site after inlining.
 */
export function stage5comptime(page: Page) {
  const constants = collect(page);
  if (!constants.size) {
    return page;
  }
  rejectWrites(page, constants);
  const values = evaluate(page, constants);
  substitute(page, constants, values);
  // only once every reader has been rewritten: a constant removed earlier
  // would leave stage7 emitting a dependency on a value that is gone
  for (const value of constants.values()) {
    value.scope.values.delete(value.name);
    page.values.delete(value.id);
  }
  return page;
}

/**
 * Refuses `::x = 1`, and `x++` on one.
 *
 * A constant is gone by the time the page runs, so an assignment to one has
 * nothing to assign to -- and substitution rewrites the target along with
 * every other read, which turned `n = 5` into `2 = 5` and handed stage7 a
 * function body that is not JavaScript. `new Function` then threw while the
 * page was being built, taking the whole page with it, and nothing had said
 * a word: the expression compiled, the constant computed, and the failure
 * arrived somewhere that names neither.
 *
 * Worth its own pass rather than a guard inside substitute(), because the
 * answer is "this cannot be written" whether or not anything reads it.
 */
function rejectWrites(page: Page, constants: Map<Value, Value>) {
  for (const value of page.values.values()) {
    const ast = value.value;
    if (!ast || typeof ast === 'string') continue;
    // the TARGET, walked as a subtree rather than compared as a node:
    // `[a] = xs` and `({ v: a } = o)` write to `a` without `a` ever being
    // the left of anything, and `for (a of xs)` writes once per item
    const flag = (target: Node) =>
      estraverse.traverse(target, {
        enter(node) {
          const dep = chainDep(node, value, page);
          if (!dep) return;
          this.skip();
          targetOf(value, dep, constants) &&
            addError(
              page,
              `"${dep.key}" is a "${COMPTIME_MARKER}" value, so it is computed once ` +
                `while the page is built and is not there to be assigned to`,
              value
            );
        },
      });
    estraverse.traverse(ast as unknown as Node, {
      enter(node) {
        if (node.type === 'AssignmentExpression') flag(node.left as Node);
        else if (node.type === 'UpdateExpression') flag(node.argument as Node);
        else if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
          flag(node.left as Node);
        }
      },
    });
  }
}

/** every `::` value in the page, by the id stage4 records dependencies against */
function collect(page: Page): Map<Value, Value> {
  const found = new Map<Value, Value>();
  const walk = (scope: Scope) => {
    for (const [, value] of scope.values) {
      value.comptime && found.set(value, value);
    }
    scope.children.forEach(walk);
  };
  walk(page.global);
  return found;
}

/**
 * Computes each constant, in whatever order their references allow.
 *
 * Rounds rather than a topological sort: a constant becomes computable once
 * everything it reads has been, so a pass that resolves nothing means what
 * is left is circular -- which is the only way this can fail to terminate,
 * and is reported as such.
 */
function evaluate(page: Page, constants: Map<Value, Value>): Map<Value, unknown> {
  const done = new Map<Value, unknown>();
  let pending = [...constants.values()];
  while (pending.length) {
    const blocked: Value[] = [];
    let progressed = false;
    for (const value of pending) {
      const ast = value.value;
      if (!ast || typeof ast === 'string') {
        // a plain (non-`${}`) attribute is already a literal
        done.set(value, ast ?? '');
        progressed = true;
        continue;
      }
      const ready = readsOf(page, value, constants);
      if (!ready) {
        // reported by readsOf; treat as computed so one bad constant does
        // not also report everything downstream of it
        done.set(value, undefined);
        progressed = true;
        continue;
      }
      if (ready.some(dep => !done.has(dep))) {
        blocked.push(value);
        continue;
      }
      done.set(value, run(page, value, done));
      progressed = true;
    }
    if (!progressed) {
      for (const value of blocked) {
        addError(page, `"${value.name}" is part of a cycle of "${COMPTIME_MARKER}" values`, value);
        done.set(value, undefined);
      }
      break;
    }
    pending = blocked;
  }
  return done;
}

/**
 * The constants a constant reads, or nothing if it reads anything else.
 *
 * This is the closure check, and where an unsolvable one is reported.
 */
function readsOf(page: Page, value: Value, constants: Map<Value, Value>): Value[] | undefined {
  const reads: Value[] = [];
  let ok = true;
  estraverse.traverse(value.value as unknown as Node, {
    enter(node) {
      const dep = chainDep(node, value, page);
      if (!dep) return;
      this.skip();
      const target = targetOf(value, dep, constants);
      if (!target) {
        ok = false;
        addError(
          page,
          `"${value.name}" is a "${COMPTIME_MARKER}" value, so it may only read ` +
            `literals and other "${COMPTIME_MARKER}" values -- but it reads ` +
            `"${[...(dep.via ?? []), dep.key].join('.')}"`,
          value
        );
        return;
      }
      reads.push(target);
    },
  });
  return ok ? reads : undefined;
}

/** the compile-time Value a resolved dependency points at, if it points at one */
function targetOf(
  from: Value,
  dep: ValueDepRef,
  constants: Map<Value, Value>
): Value | undefined {
  let scope: Scope | undefined = from.scope;
  for (const step of dep.via ?? []) {
    scope = step === '$parent' ? scope?.parent : scope?.children.find(c => c.name === step);
  }
  // found by walking the same chain stage4 recorded, then up the scope
  // chain, which is what the runtime would have done
  while (scope) {
    const found = scope.values.get(dep.key);
    if (found) return constants.get(found);
    scope = scope.parent;
  }
  return undefined;
}

/** evaluates one constant, its own constant reads already substituted */
function run(page: Page, value: Value, done: Map<Value, unknown>): unknown {
  const ast = inlined(page, value, done, value.value as unknown as Node);
  let result: unknown;
  try {
    result = new Function(`return (${generate(ast)});`)();
  } catch (err) {
    addError(page, `"${value.name}" could not be computed: ${(err as Error).message}`, value);
    return undefined;
  }
  if (result !== null && !['string', 'number', 'boolean', 'undefined'].includes(typeof result)) {
    addError(
      page,
      `"${value.name}" is a "${COMPTIME_MARKER}" value, so it has to be a string, ` +
        `number, boolean, null or undefined -- this one is ${typeof result}. ` +
        `Substituting it would give every reader a separate copy`,
      value
    );
    return undefined;
  }
  return result;
}

/** a copy of `ast` with every constant chain replaced by what it computed to */
function inlined(
  page: Page,
  value: Value,
  done: Map<Value, unknown>,
  ast: Node
): Node {
  return estraverse.replace(structuredClone(ast) as Node, {
    enter(node) {
      const dep = chainDep(node, value, page);
      if (!dep) return undefined;
      this.skip();
      const target = targetOf(value, dep, collectedFrom(done));
      if (!target || !done.has(target)) return undefined;
      return literal(done.get(target));
    },
  }) as Node;
}

/** the constants seen so far, keyed as `targetOf` expects */
function collectedFrom(done: Map<Value, unknown>): Map<Value, Value> {
  const m = new Map<Value, Value>();
  for (const v of done.keys()) m.set(v, v);
  return m;
}

function literal(v: unknown): Expression {
  if (v === undefined) {
    // `undefined` is an identifier rather than a literal, and the globals
    // list has it, so this reads back as itself
    return { type: 'Identifier', name: 'undefined' } as unknown as Expression;
  }
  return { type: 'Literal', value: v as string | number | boolean | null } as Expression;
}

/** rewrites every expression that reads a constant, and drops the dependency */
function substitute(page: Page, constants: Map<Value, Value>, done: Map<Value, unknown>) {
  for (const value of page.values.values()) {
    if (constants.has(value)) continue;
    const ast = value.value;
    if (!ast || typeof ast === 'string') continue;
    // resolved rather than pattern-matched: which values are constants is
    // something this stage knows, and asking the name was only ever a way
    // of re-deriving it from a spelling
    if (!value.deps.some(dep => targetOf(value, dep, constants))) continue;
    writeBack(value, inlined(page, value, done, ast as unknown as Node));
    // a constant is gone by the time the runtime exists, so nothing can
    // depend on it -- and stage7 would emit a thunk reaching for a value
    // that is not there
    value.deps = value.deps.filter(dep => !targetOf(value, dep, constants));
  }
}

/**
 * Puts a rewritten expression back where `Value.value` reads it from.
 *
 * Which differs by node: an attribute holds it in `value`, a text node in
 * `textContent`. Writing to the wrong one leaves the old expression in
 * place while the dependency on the constant is dropped -- so the reader
 * renders `undefined` and nothing says why.
 */
function writeBack(value: Value, ast: Node) {
  if (value.node.nodeType === NodeType.TEXT) {
    (value.node as { textContent: unknown }).textContent = ast;
    return;
  }
  (value.node as { value: unknown }).value = ast;
}

function addError(page: Page, msg: string, value: Value) {
  page.errors.push(new PageError('error', msg, value.node.loc || undefined));
}
