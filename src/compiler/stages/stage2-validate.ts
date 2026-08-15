import * as estraverse from 'estraverse';
import type { Node } from 'estree';
import { PageError } from '../../html/parser';
import type { Page } from '../ir/Page';
import {
  ATTR_VALUE_PREFIX,
  PRESENCE_VALUE_PREFIX,
  PRESENCE_VALUE_ATTR_PREFIX,
  PROP_VALUE_PREFIX,
  PROP_VALUE_ATTR_PREFIX,
  CLASS_VALUE_ATTR_PREFIX,
  CLASS_VALUE_PREFIX,
  DID_VALUE_ATTR_PREFIX,
  DID_VALUE_PREFIX,
  EVENT_VALUE_ATTR_PREFIX,
  EVENT_VALUE_PREFIX,
  SPECIAL_ATTR_PREFIX,
  FOR_AS_VALUE,
  FOR_EACH_VALUE,
  FOR_DATA_VALUE,
  FOR_EACH_ATTR,
  FOR_DATA_ATTR,
  FOR_KEY_ATTR,
  FOR_KEY_VALUE,
  STYLE_VALUE_ATTR_PREFIX,
  STYLE_VALUE_PREFIX,
  TEXT_VALUE_PREFIX,
  WILL_VALUE_ATTR_PREFIX,
  WILL_VALUE_PREFIX,
  HANDLE_VALUE_ATTR_PREFIX,
  HANDLE_VALUE_PREFIX,
} from '../ir/Page';
import { Scope } from '../ir/Scope';
import { Value } from '../ir/Value';

// stage1 encodes `:class-*`/`:style-*`/`:on-*`/`:did-*`/`:will-*` attribute
// names using '$' as the prefix separator (e.g. `class$active`), so a plain
// `name.includes('$')` check would flag every one of those values as
// invalid; strip a known prefix (compiled or raw, the latter for values
// built outside of stage1) before checking for a user-introduced '$'.
const KNOWN_VALUE_PREFIXES = [
  ATTR_VALUE_PREFIX,
  PRESENCE_VALUE_PREFIX,
  PRESENCE_VALUE_ATTR_PREFIX,
  PROP_VALUE_PREFIX,
  PROP_VALUE_ATTR_PREFIX,
  CLASS_VALUE_PREFIX,
  STYLE_VALUE_PREFIX,
  EVENT_VALUE_PREFIX,
  DID_VALUE_PREFIX,
  WILL_VALUE_PREFIX,
  HANDLE_VALUE_PREFIX,
  FOR_EACH_VALUE,
  FOR_DATA_VALUE,
  FOR_AS_VALUE,
  FOR_KEY_VALUE,
  CLASS_VALUE_ATTR_PREFIX,
  STYLE_VALUE_ATTR_PREFIX,
  EVENT_VALUE_ATTR_PREFIX,
  DID_VALUE_ATTR_PREFIX,
  WILL_VALUE_ATTR_PREFIX,
];

// values whose expression must itself be an arrow function (callbacks)
const CALLBACK_VALUE_PREFIXES = [
  EVENT_VALUE_PREFIX,
  EVENT_VALUE_ATTR_PREFIX,
  DID_VALUE_PREFIX,
  DID_VALUE_ATTR_PREFIX,
  WILL_VALUE_PREFIX,
  WILL_VALUE_ATTR_PREFIX,
  HANDLE_VALUE_PREFIX,
  HANDLE_VALUE_ATTR_PREFIX,
];

function stripKnownPrefix(name: string): string {
  const prefix = KNOWN_VALUE_PREFIXES.find(p => name.startsWith(p));
  return prefix ? name.slice(prefix.length) : name;
}

/**
 * Stage 2: Validate reactive expressions:
 * - Callbacks (`:on-*`, `:did-*`, `:will-*`) must be arrow functions written
 *   at that spot -- not a reference to one, and not a classic function
 * - No function nested anywhere in any expression may be a classic function
 * - Declared identifier names (value names) must not include '$' (reserved for language features)
 *   Note: identifier accesses within expressions are unrestricted
 *
 * Recursively walks through all scopes and their values, validating that:
 * 1. Declared value names don't contain '$' (reserved for language features)
 *    Identifier accesses within expressions are allowed to use '$'
 * 2. Callback expressions (`:on-*`, `:did-*`, `:will-*`) are arrow functions
 * 3. No nested classic `function` shows up anywhere in a `${...}` expression
 *
 * A plain (non-`${...}`) attribute value is a static literal, not an
 * expression, so it's never parsed/validated as JS here.
 *
 * @param page - The Page object with the extracted values and scope hierarchy from stage 1
 * @returns The same Page object after validation
 */

export function stage2validate(page: Page) {
  validateScope(page, page.global);
  return page;
}

function validateScope(page: Page, scope: Scope) {
  // the two replication arities are the same question -- how many times does
  // this render -- so an element may only answer it once. And a key is what
  // tells replicas apart, which is nothing to ask of a thing that is either
  // there or not
  if (scope.values.has(FOR_EACH_VALUE) && scope.values.has(FOR_DATA_VALUE)) {
    addError(
      page,
      `Cannot use "${SPECIAL_ATTR_PREFIX}${FOR_EACH_ATTR}" and ` +
        `"${SPECIAL_ATTR_PREFIX}${FOR_DATA_ATTR}" on the same element`,
      scope.values.get(FOR_DATA_VALUE)!.node.loc
    );
  } else if (scope.values.has(FOR_DATA_VALUE) && scope.values.has(FOR_KEY_VALUE)) {
    addError(
      page,
      `"${SPECIAL_ATTR_PREFIX}${FOR_KEY_ATTR}" means nothing on ` +
        `"${SPECIAL_ATTR_PREFIX}${FOR_DATA_ATTR}": there is only ever one`,
      scope.values.get(FOR_KEY_VALUE)!.node.loc
    );
  }

  // Validate all user-defined values in this scope
  for (const [name, value] of scope.values) {
    validateValue(page, name, value);
  }

  // Text values are validated separately and are not treated as user-defined values
  for (const [name, value] of scope.textValues) {
    validateTextValue(page, name, value);
  }

  // Recursively validate all child scopes
  for (const child of scope.children) {
    validateScope(page, child);
  }
}

function validateValue(page: Page, name: string, value: Value) {
  // Check that value names don't contain '$' (reserved for language features)
  if (stripKnownPrefix(name).includes('$')) {
    addError(
      page,
      `Declared identifiers cannot include "$" (reserved for language features): "${name}"`,
      value.node.loc || undefined
    );
    return;
  }

  const expression = value.value;
  // a plain (non-`${}`) string is a static literal, not an expression
  if (!expression || typeof expression === 'string') {
    return;
  }
  const ast = expression as unknown as Node;

  // event and lifecycle callbacks must themselves be arrow functions: a
  // classic one would rebind `this`, which is how the scope is reached
  if (CALLBACK_VALUE_PREFIXES.some(p => name.startsWith(p))) {
    // `:handle-x` has already been desugared into a call that passes `x`, so
    // what the author actually wrote is the callee
    const fn =
      name.startsWith(HANDLE_VALUE_PREFIX) && ast.type === 'CallExpression'
        ? ((ast as unknown as { callee: Node }).callee)
        : ast;
    if (fn.type !== 'ArrowFunctionExpression') {
      addError(
        page,
        `Callback "${name}" must be an arrow function, got ${fn.type}`,
        value.node.loc || undefined
      );
    }
  }

  validateNoClassicFunctions(page, name, ast, value.node.loc || undefined);
}

function validateTextValue(page: Page, name: string, value: Value) {
  if (!name.startsWith(TEXT_VALUE_PREFIX)) {
    return;
  }

  const expression = value.value;
  if (!expression || typeof expression === 'string') {
    return;
  }

  validateNoClassicFunctions(page, name, expression as unknown as Node, value.node.loc || undefined);
}

function validateNoClassicFunctions(page: Page, name: string, ast: Node, loc: any) {
  estraverse.traverse(ast, {
    enter(node: Node) {
      if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') {
        addError(
          page,
          `Nested functions must be arrow functions, found a classic function in "${name}"`,
          (node as any).loc ?? loc
        );
      }
    },
  });
}

function addError(page: Page, msg: string, loc?: any) {
  page.errors.push(
    new PageError('error', msg, loc)
  );
}
