import * as estraverse from 'estraverse';
import type { Identifier, Node } from 'estree';
import { RT_SCOPE_PARAM } from './stage3-qualify';
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
  IF_VALUE,
  WHEN_USED_ATTR,
  DEFINE_DIRECTIVE_TAG,
  STYLE_VALUE_ATTR_PREFIX,
  STYLE_VALUE_PREFIX,
  TEXT_VALUE_PREFIX,
  WILL_VALUE_ATTR_PREFIX,
  WILL_VALUE_PREFIX,
  HANDLE_VALUE_ATTR_PREFIX,
  HANDLE_VALUE_PREFIX,
} from '../ir/Page';
import type { ServerAttribute } from '../../html/server-dom';
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
  IF_VALUE,
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
  validateWhenUsed(page);
  validateScope(page, page.global);
  return page;
}

/**
 * Every tag a `:when-used` waits on has to be one some `<:define>` declares.
 *
 * Otherwise a renamed component leaves its stylesheet waiting on a name
 * nothing will ever use, so the style is silently dropped from every page --
 * the drift this directive exists to survive, arriving as missing styling
 * with nothing to explain it.
 */
function validateWhenUsed(page: Page) {
  for (const [element, tags] of page.whenUsed) {
    for (const tag of tags) {
      if (page.customTags.has(tag)) continue;
      addError(
        page,
        `"${SPECIAL_ATTR_PREFIX}${WHEN_USED_ATTR}" names "${tag}", which no ` +
          `<${DEFINE_DIRECTIVE_TAG}> declares`,
        element.loc
      );
    }
  }
}

function validateScope(page: Page, scope: Scope) {
  // a scope named over a supplied global would shadow it by navigation --
  // `db.users` would find the scope, not the database -- so the name is
  // refused rather than allowed to quietly win
  if (scope.name && page.serverGlobals.has(scope.name)) {
    addError(
      page,
      `Cannot name a scope "${scope.name}": it is supplied to the server`,
      scope.values.values().next().value?.node.loc
    );
  }

  // the two replication arities are the same question -- how many times does
  // this render -- so an element may only answer it once. And a key is what
  // tells replicas apart, which is nothing to ask of a thing that is either
  // there or not
  // all three answer "how many times does this render", so an element may
  // answer once. `:if` and `:for-data` are the same arity by two different
  // tests, which is the pair most likely to be written together by accident
  const arity = [FOR_EACH_VALUE, FOR_DATA_VALUE, IF_VALUE].filter(k => scope.values.has(k));
  if (arity.length > 1 && scope.values.has(IF_VALUE)) {
    // named as it was written: `if$` is what all three branch spellings
    // compile to, and an author told their `:else` is an `:if` has to work
    // out which of the two names the compiler means
    const written = (scope.values.get(IF_VALUE)!.node as ServerAttribute).name;
    addError(
      page,
      `Cannot use "${written}" with ` +
        `"${SPECIAL_ATTR_PREFIX}${arity.find(k => k !== IF_VALUE) === FOR_EACH_VALUE
          ? FOR_EACH_ATTR : FOR_DATA_ATTR}" on the same element`,
      scope.values.get(IF_VALUE)!.node.loc
    );
  } else if (scope.values.has(FOR_EACH_VALUE) && scope.values.has(FOR_DATA_VALUE)) {
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

  // Validate all user-defined values in this scope, including the ones its
  // usage site declared rather than passed -- those are user-written too, and
  // the only scope holding them is this one
  for (const [name, value] of [...scope.values, ...(scope.usageValues ?? [])]) {
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
  // Declaring one of these would shadow it, since resolution reaches the
  // global scope only after walking the chain -- and shadowing a database
  // handle is not a thing anyone means to do. Unlike `Math`, which a page
  // may deliberately take over, these were put there by the host
  if (page.serverGlobals.has(name)) {
    addError(
      page,
      `Cannot declare "${name}": it is supplied to the server`,
      value.node.loc || undefined
    );
    return;
  }
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

  // A callback has to BE a function, written here. Not because of `this` any
  // more -- a compiled expression reaches its scope through a parameter, so
  // a classic function keeps it like anything else -- but because the
  // dependencies of a callback's body are extracted from what stands at this
  // spot. `${handler}` names one instead of being one, and there would be
  // nothing here to read.
  if (CALLBACK_VALUE_PREFIXES.some(p => name.startsWith(p))) {
    // `:handle-x` has already been desugared into a call that passes `x`, so
    // what the author actually wrote is the callee
    const fn =
      name.startsWith(HANDLE_VALUE_PREFIX) && ast.type === 'CallExpression'
        ? ((ast as unknown as { callee: Node }).callee)
        : ast;
    if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') {
      addError(
        page,
        `Callback "${name}" must be a function written here, got ${fn.type}`,
        value.node.loc || undefined
      );
    }
  }

  validateScopeParamFree(page, name, ast, value.node.loc || undefined);
}

function validateTextValue(page: Page, name: string, value: Value) {
  if (!name.startsWith(TEXT_VALUE_PREFIX)) {
    return;
  }

  const expression = value.value;
  if (!expression || typeof expression === 'string') {
    return;
  }

  validateScopeParamFree(page, name, expression as unknown as Node, value.node.loc || undefined);
}

/**
 * Refuses an expression that binds `$` to something of its own.
 *
 * `$` is how a compiled expression reaches its scope -- the parameter
 * stage7 wraps every one of them in -- and the qualifier deliberately
 * leaves locals alone, so a local of that name is not an error waiting to
 * happen but a silent one: in `${items.map($ => $.x + n)}`, `n` qualifies
 * to `$.n` and reads the item. A wrong answer, from a page that compiled
 * and ran.
 *
 * `$`-prefixed names were already the language's own, reserved so a system
 * value can never be shadowed. This is that rule reaching the other kind of
 * name -- one an expression declares rather than reads.
 */
function validateScopeParamFree(page: Page, name: string, ast: Node, loc: any) {
  const refuse = (node: Node) =>
    addError(
      page,
      `"${RT_SCOPE_PARAM}" is how an expression reaches its scope and cannot be ` +
        `declared in one (in "${name}"). Any other name works`,
      (node as any).loc ?? loc
    );
  const check = (node: Node | null | undefined) => {
    if (!node) return;
    switch (node.type) {
      case 'Identifier':
        (node as Identifier).name === RT_SCOPE_PARAM && refuse(node);
        return;
      case 'ObjectPattern':
        (node as any).properties.forEach((p: any) =>
          check(p.type === 'RestElement' ? p.argument : p.value)
        );
        return;
      case 'ArrayPattern':
        (node as any).elements.forEach((e: any) => check(e));
        return;
      case 'AssignmentPattern':
        check((node as any).left);
        return;
      case 'RestElement':
        check((node as any).argument);
        return;
    }
  };
  estraverse.traverse(ast, {
    enter(node: Node) {
      switch (node.type) {
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
          check((node as any).id);
          (node as any).params.forEach(check);
          return;
        case 'VariableDeclarator':
          check((node as any).id);
          return;
        case 'CatchClause':
          check((node as any).param);
          return;
      }
    },
  });
}

function addError(page: Page, msg: string, loc?: any) {
  page.addError(msg, loc);
}
