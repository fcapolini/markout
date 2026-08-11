import * as acorn from 'acorn';
import { PageError } from '../../html/parser';
import type { Page } from '../ir/Page';
import {
  CLASS_VALUE_ATTR_PREFIX,
  CLASS_VALUE_PREFIX,
  EVENT_VALUE_ATTR_PREFIX,
  EVENT_VALUE_PREFIX,
  STYLE_VALUE_ATTR_PREFIX,
  STYLE_VALUE_PREFIX,
  TEXT_VALUE_PREFIX,
} from '../ir/Page';
import { Scope } from '../ir/Scope';
import { Value } from '../ir/Value';

// stage1 encodes `:class-*`/`:style-*`/`:on-*` attribute names using '$' as
// the prefix separator (e.g. `class$active`), so a plain `name.includes('$')`
// check would flag every one of those values as invalid; strip a known
// prefix (compiled or raw, the latter for values built outside of stage1)
// before checking for a user-introduced '$'.
const KNOWN_VALUE_PREFIXES = [
  CLASS_VALUE_PREFIX,
  STYLE_VALUE_PREFIX,
  EVENT_VALUE_PREFIX,
  CLASS_VALUE_ATTR_PREFIX,
  STYLE_VALUE_ATTR_PREFIX,
  EVENT_VALUE_ATTR_PREFIX,
];

function stripKnownPrefix(name: string): string {
  const prefix = KNOWN_VALUE_PREFIXES.find(p => name.startsWith(p));
  return prefix ? name.slice(prefix.length) : name;
}

/**
 * Stage 2: Validate reactive expressions:
 * - Event handlers (in `:on-*` attributes) must be arrow functions
 * - Declared identifier names (value names) must not include '$' (reserved for language features)
 *   Note: identifier accesses within expressions are unrestricted
 *
 * Recursively walks through all scopes and their values, validating that:
 * 1. Declared value names don't contain '$' (reserved for language features)
 *    Identifier accesses within expressions are allowed to use '$'
 * 2. Event handler expressions are arrow functions
 *
 * @param page - The Page object with the extracted values and scope hierarchy from stage 1
 * @returns The same Page object after validation
 */

export function stage2validate(page: Page) {
  validateScope(page, page.global);
  return page;
}

function validateScope(page: Page, scope: Scope) {
  // Validate all user-defined values in this scope
  for (const [name, value] of scope.values) {
    validateValue(page, name, value);
  }

  // Text values are validated separately and are not treated as user-defined values
  for (const [name, value] of scope.textValues) {
    validateTextValue(name, value);
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

  const valueStr = value.value;
  if (!valueStr || typeof valueStr !== 'string') {
    return;
  }

  // Validate event handlers must be arrow functions
  if (name.startsWith(EVENT_VALUE_PREFIX) || name.startsWith(EVENT_VALUE_ATTR_PREFIX)) {
    validateEventHandler(page, name, valueStr, value.node.loc || undefined);
  }
}

function validateTextValue(name: string, value: Value) {
  if (!name.startsWith(TEXT_VALUE_PREFIX)) {
    return;
  }

  const valueStr = value.value;
  if (!valueStr || typeof valueStr !== 'string') {
    return;
  }

  // Generated text placeholders are internal and should not be treated as
  // user-declared identifiers.
  return;
}

function validateEventHandler(
  page: Page,
  name: string,
  expression: string,
  loc: any
) {
  try {
    const ast = acorn.parseExpressionAt(expression, 0, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
    });

    // Check if the expression is an arrow function
    if (ast.type !== 'ArrowFunctionExpression') {
      addError(
        page,
        `Event handler "${name}" must be an arrow function, got ${ast.type}`,
        loc
      );
    }
  } catch (err) {
    addError(
      page,
      `Invalid expression in event handler "${name}": ${err}`,
      loc
    );
  }
}

function addError(page: Page, msg: string, loc?: any) {
  page.errors.push(
    new PageError('error', msg, loc)
  );
}
