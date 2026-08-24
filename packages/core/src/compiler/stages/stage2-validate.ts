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

  validateDirtyValue(page, scope);

  // Validate all user-defined values in this scope, including the ones its
  // usage site declared rather than passed -- those are user-written too, and
  // the only scope holding them is this one
  for (const [name, value] of [...scope.values, ...(scope.usageValues ?? [])]) {
    validateValue(page, name, value);
  }

  // Text values are validated separately and are not treated as user-defined values
  for (const [name, value] of scope.textValues) {
    validateTextValue(page, name, value);
    validateDirtyText(page, scope, value);
  }

  // Recursively validate all child scopes
  for (const child of scope.children) {
    validateScope(page, child);
  }
}

/**
 * The attributes HTML gives a dirty flag to, per element that has one.
 *
 * `value` on a text-entry `<input>` and on a `<textarea>`, `checked` on a
 * checkbox or radio, `selected` on an `<option>`: from the user's first
 * keystroke or click the element's own state is independent of both the
 * content attribute and the content, and nothing written to either shows
 * again.
 */
const DIRTY_ATTRS: { [tagName: string]: string[] } = {
  INPUT: ['value', 'checked'],
  TEXTAREA: ['value'],
  OPTION: ['selected'],
};

/**
 * The `<input>` types whose `value` a user cannot dirty.
 *
 * `value` on a submit or a button is its label, on a hidden field it is data
 * the page put there, and on a checkbox or a radio it is what that control
 * SUBMITS -- none of them is the thing being typed in. HTML calls these the
 * "default" and "default/on" modes of operation: the property reflects the
 * attribute for as long as the element exists, so writing the attribute is
 * exactly right and saying otherwise would be noise on the one spelling that
 * works. `file` is here for the opposite reason -- its value is a filename
 * the page may not set at all, so `:prop-value` is not the advice either.
 *
 * `checked` on a checkbox or a radio IS dirtiable, and is checked separately:
 * this list is about `value` alone.
 */
const UNDIRTIABLE_VALUE_TYPES = new Set([
  'button',
  'checkbox',
  'file',
  'hidden',
  'image',
  'radio',
  'reset',
  'submit',
]);

/**
 * Says so when a page writes a value the user can take away from it.
 *
 * `value=${v}` reads as "this is the value" and behaves as "this was the
 * initial value": HTML's dirty-value flag makes an input's value independent
 * of its attribute and its content from the first keystroke, so `v = ''`
 * after a submit empties the model and leaves the typed text sitting in the
 * box. Confirmed in a browser rather than reasoned about, and it is a bug
 * this project shipped -- `bs-input` bound it this way.
 *
 * Not fixed by making `value=` write the property when it happens to be on an
 * input: that is the shape-guessing the two-spellings rule exists to prevent,
 * and it would make one attribute mean two things depending on where it sits.
 * `:prop-value=${v}` is already the spelling for "what it shows", and the
 * attribute stays what the element is SERVED with -- which a hydrating page
 * still needs. So both are right together, and the warning is what makes the
 * pair discoverable at the moment someone writes half of it.
 *
 * A warning rather than an error, for the reason the others here are: an
 * initial value that the user is then free to own is a thing someone may
 * well mean.
 */
function validateDirtyValue(page: Page, scope: Scope) {
  const el = scope.e;
  const names = el && DIRTY_ATTRS[el.tagName];
  if (!el || !names) return;
  for (const name of names) {
    // Only when the type is KNOWN to be dirtiable: absent, or a literal that
    // is not on the list. A computed type could be anything, and warning
    // about it was tried and was wrong -- `bs-check` writes `type=${_type}`
    // over checkbox/radio/switch and `value` there is what the control
    // submits, so the warning fired on the kit's own correct code with no
    // correct way to answer it. An unknown gets silence: a warning nobody can
    // act on teaches people to stop reading them, which costs more than the
    // computed-type case it would catch
    if (name === 'value' && el.tagName === 'INPUT') {
      // a computed type is a value on this scope rather than a literal on the
      // element, and it is the shape that has to stay quiet
      if (scope.values.has(`${ATTR_VALUE_PREFIX}type`)) continue;
      const type = el.getAttribute('type');
      if (typeof type === 'string' && UNDIRTIABLE_VALUE_TYPES.has(type.toLowerCase())) {
        continue;
      }
    }
    // both spellings of "the page decides this attribute": `value=${v}` sets
    // what it says, `:attr-checked=${v}` sets whether it is there at all, and
    // the flag defeats each of them the same way
    const written =
      scope.values.get(`${ATTR_VALUE_PREFIX}${name}`) ??
      scope.values.get(`${PRESENCE_VALUE_PREFIX}${name}`);
    if (!written) continue;
    if (scope.values.has(`${PROP_VALUE_PREFIX}${name}`)) continue;
    page.addWarning(
      `<${el.tagName.toLowerCase()}> keeps its own "${name}" once the user has ` +
        `changed it, so this stops showing -- did you mean to add ` +
        `"${SPECIAL_ATTR_PREFIX}${PROP_VALUE_ATTR_PREFIX}${name}=" beside it?`,
      written.node.loc
    );
  }
}

/**
 * The same warning for the other way a `<textarea>` is filled.
 *
 * `<textarea>${v}</textarea>` is the spelling most people reach for, and the
 * dirty flag defeats it exactly as it defeats the attribute -- the content is
 * the default value and stops being consulted from the first keystroke.
 *
 * It needs its own pass because a text interpolation does not give its
 * element a scope: the value lands on the nearest enclosing one, so the
 * textarea is reached through the node rather than through the tree.
 */
function validateDirtyText(page: Page, scope: Scope, value: Value) {
  const el = value.node.parentElement;
  if (el?.tagName !== 'TEXTAREA') return;
  // the textarea has a scope only if something else on it made one, and that
  // is where a `:prop-value` beside this content would be -- which is either
  // the scope holding this text or a child of it, since a `:` attribute on
  // the tag is exactly what makes the content land on the tag's own scope
  const own = scope.e === el ? scope : scope.children.find(c => c.e === el);
  if (own?.values.has(`${PROP_VALUE_PREFIX}value`)) return;
  page.addWarning(
    `<textarea> keeps its own "value" once the user has changed it, so this ` +
      `stops showing -- did you mean to add ` +
      `"${SPECIAL_ATTR_PREFIX}${PROP_VALUE_ATTR_PREFIX}value=" on the tag?`,
    value.node.loc
  );
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
