import * as acorn from 'acorn';
import * as estraverse from 'estraverse';
import type { Identifier, Node, Pattern } from 'estree';
import { NodeType } from '../../html/dom';
import { ServerAttribute, ServerText } from '../../html/server-dom';
import { FOR_AS_VALUE, FOR_DATA_DEFAULT_NAME, FOR_DATA_VALUE, FOR_EACH_VALUE } from '../ir/Page';
import type { Page } from '../ir/Page';
import type { Scope } from '../ir/Scope';
import type { Value } from '../ir/Value';

const RT_PARENT_VALUE_KEY = '$parent';

/**
 * The name a compiled expression reaches its scope through.
 *
 * A parameter rather than `this`, which is what this used to be, and the
 * difference is a language rule rather than an encoding: `this` is rebound
 * by every classic `function`, so one written anywhere inside an expression
 * would have lost the scope -- and the language refused them outright for
 * that reason alone. A parameter is an ordinary closure variable, captured
 * the same way through any kind of function, so the refusal has nothing
 * left to protect and is gone.
 *
 * One character because every qualified reference pays for it, and `this.`
 * was five. Which is also why it needs the guard in stage2: `$` is the most
 * takeable identifier in JavaScript, the qualifier deliberately leaves
 * locals alone, and `${items.map($ => $.x + n)}` would otherwise qualify
 * `n` against the item -- a wrong answer rather than an error.
 */
export const RT_SCOPE_PARAM = '$';

/**
 * Stage 3: Qualify value references:
 * - references to values in expressions must be qualified with the appropriate scope prefix
 * - references to local variables inside expressions are not qualified
 *
 * @param page - The Page object with the validated scope hierarchy from stage 2
 * @returns The same Page object after references qualification
 */

export function stage3qualify(page: Page) {
  // see stage4-resolve: `page.main` is already among `page.global`'s children,
  // so walking it separately just qualified everything twice
  for (const child of page.global.children) {
    qualifyScope(child);
  }
  return page;
}

function qualifyScope(scope: Scope) {
  // `usageValues` alongside the rest: they are declared at the usage site
  // rather than held by the instance, and an expression is qualified the same
  // way wherever it was written
  for (const [name, value] of [...scope.values, ...(scope.usageValues ?? [])]) {
    // A value written at a usage site does not shadow-skip.
    //
    // The rule below turns a value that reads its OWN name into a read of
    // the enclosing one, which is what `<div :n=${n + 1}>` means. But a
    // usage-site value only lives on this instance -- it resolves at the
    // CALL SITE, where its name is not declared and there is nothing to
    // skip. Applying it there sent `<x-tag :items=${items} />` looking one
    // scope too far up, so it reported `link: unresolved dependency` at
    // runtime and rendered blank, for the most natural thing to write.
    qualifyValue(
      scope.callSiteValues?.has(name) ? '' : shadowKeyFor(scope, name),
      value
    );
  }
  for (const [name, value] of scope.textValues) {
    qualifyValue(name, value);
  }

  for (const child of scope.children) {
    qualifyScope(child);
  }
}

// :for-each's own array expression (and :for-data's value) logically runs
// in the OUTER scope --
// the per-item alias (e.g. `data`) it's about to bind doesn't exist yet, so
// a bare reference to that same name inside it must shadow-skip to
// whatever the parent already has, exactly like a value referencing its
// own name would. Keying the shadow-check on the raw 'for$each' name
// wouldn't trigger this (it never collides with a user-chosen alias), so
// the alias itself has to be used as the qualification key instead.
function shadowKeyFor(scope: Scope, name: string): string {
  if (name === FOR_EACH_VALUE || name === FOR_DATA_VALUE) {
    return (scope.values.get(FOR_AS_VALUE)?.value as string) || FOR_DATA_DEFAULT_NAME;
  }
  return name;
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
      // the scope parameter this walk itself introduces. estraverse.replace
      // descends into what it just substituted, and `$` used to be a
      // ThisExpression -- which no Identifier branch could reach. As a name
      // it is reachable, and qualifying it would produce `$.$`, then
      // `$.$.$`, without ever coming back
      if (node.name === RT_SCOPE_PARAM) {
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
      // `({ n } = o)` becomes `({ n: this.n } = o)`: once the target is an
      // expression rather than the bare name, the shorthand cannot say it
      if (parent?.type === 'Property' && parent.shorthand && parent.value === node) {
        parent.shorthand = false;
      }
      if (key === node.name && !inFunctionBody(stack)) {
        return {
          type: 'MemberExpression',
          object: {
            type: 'MemberExpression',
            object: { type: 'Identifier', name: RT_SCOPE_PARAM },
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
        object: { type: 'Identifier', name: RT_SCOPE_PARAM },
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

// the `b` in `a.b` is a property name, already resolved by the member access
// itself. The `b` in `a[b]`, though, is an ordinary reference that still needs
// qualifying -- without the `computed` check it silently stays bare, becoming
// an undeclared global at runtime and contributing no dependency
function isQualified(id: Node, parent: Node | null | undefined) {
  return parent?.type === 'MemberExpression' && !parent.computed && parent.property === id;
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
      // `{ v: n }` -- `v` names the property being read out of the object
      // and is never a reference; `n` is the target. In the shorthand
      // `{ n }` they are the SAME node, and it is the target
      if (!parent.computed && parent.key === id && parent.value !== id) {
        return true;
      }
      return binds(stack, stack.length - 3);
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
    return parent.left === id && binds(stack, stack.length - 2);
  }
  if (parent.type === 'ArrayPattern' || parent.type === 'RestElement') {
    return binds(stack, stack.length - 2);
  }
  return false;
}

/**
 * Whether the pattern at `i` introduces names, or writes to existing ones.
 *
 * The same shapes serve both: `const [a] = xs` and `({ a } = o)` are spelled
 * alike and mean opposite things -- one declares `a`, the other assigns to
 * whatever `a` already is. Treating every pattern member as a binding left
 * the second kind unqualified, so `[a] = [5]` compiled to `[a] = [5]` and
 * wrote an undeclared global while the value it was aimed at never moved,
 * with nothing reported at any stage.
 *
 * Answered by walking out through the enclosing patterns to the first thing
 * that is not one, and asking what IT is doing with them.
 */
function binds(stack: Node[], i: number): boolean {
  let child: Node = stack[i];
  for (let k = i - 1; k >= 0; k--) {
    const n = stack[k];
    if (
      n.type === 'ArrayPattern' ||
      n.type === 'ObjectPattern' ||
      n.type === 'Property' ||
      n.type === 'AssignmentPattern' ||
      n.type === 'RestElement'
    ) {
      child = n;
      continue;
    }
    // `[a] = xs` and `for ([a] of xs)`: the pattern is a target, and its
    // members are references to values that already exist
    if (n.type === 'AssignmentExpression') return n.left !== child;
    if (n.type === 'ForOfStatement' || n.type === 'ForInStatement') return n.left !== child;
    // a declarator, a parameter list, a catch clause: a binding
    return true;
  }
  return true;
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
