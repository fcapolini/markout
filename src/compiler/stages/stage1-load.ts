import {
  ServerElement,
  ServerAttribute,
  SourceLocation,
  ServerText,
  ServerComment,
  ServerTemplateElement,
  ServerNode,
} from '../../html/server-dom';
import { TEXT_VALUE_PREFIX } from '../ir/Page';
import { Value } from '../ir/Value';
import { Scope } from '../ir/Scope';
import {
  Page,
  SPECIAL_ATTR_PREFIX,
  SCOPE_NAME_ATTR,
  CLASS_VALUE_ATTR_PREFIX,
  STYLE_VALUE_ATTR_PREFIX,
  EVENT_VALUE_ATTR_PREFIX,
  DID_VALUE_ATTR_PREFIX,
  WILL_VALUE_ATTR_PREFIX,
  CLASS_VALUE_PREFIX,
  STYLE_VALUE_PREFIX,
  ATTR_VALUE_PREFIX,
  EVENT_VALUE_PREFIX,
  DID_VALUE_PREFIX,
  WILL_VALUE_PREFIX,
  FOR_EACH_ATTR,
  FOR_AS_ATTR,
  FOR_KEY_ATTR,
  FOR_EACH_VALUE,
  FOR_AS_VALUE,
  FOR_KEY_VALUE,
  FOR_DATA_DEFAULT_NAME,
  DEFINE_DIRECTIVE_TAG,
  DEFINE_TAG_ATTR,
  DEFINE_NAME_MARKER,
} from '../ir/Page';
import { NodeType } from '../../html/dom';
import { ATOMIC_TEXT_TAGS } from '../../html/parser';
import { DOM_ID_ATTR, DOM_TEXT_MARKER1, DOM_TEXT_MARKER2, DOM_USE_MARKER } from '../../runtime/web/web-context';

/**
 * Stage 1 loader: Transforms a DOM tree into scoped semantic IR.
 *
 * This is the first compilation stage that processes the parsed HTML document
 * and converts it into an intermediate representation (IR) with:
 * - Scope hierarchy based on special `:` attributes and standard HTML elements (html, head, body)
 * - Value extraction from special attributes (`:class-*`, `:style-*`, `:on-*` for events, `:aka` for naming)
 * - Dynamic text extraction into values
 * - Comment markers for text node positions in the DOM
 *
 * The process recursively walks the DOM tree, creating new scopes as needed when
 * elements have special attributes or are semantic containers (html/head/body).
 *
 * @param page - The Page object containing the parsed source document
 * @returns The same Page object with populated scope hierarchy and extracted values
 */

export function stage1load(page: Page) {
  page.main = load(page, page.global, page.source.doc.documentElement!, 'page');
  expandCustomTagUsages(page);
  return page;
}

function load(page: Page, parent: Scope, e: ServerElement, name?: string): Scope {
  const tagName = e.tagName.toUpperCase();
  if (tagName === 'HTML') name = 'page';
  if (tagName === 'HEAD') name = 'head';
  if (tagName === 'BODY') name = 'body';
  const isDefinition = e.getAttribute(DEFINE_NAME_MARKER) !== null;
  const scope = name || isDefinition || needsScope(e) ? new Scope(page, parent, e, name) : parent;
  if (scope.e === e) {
    // so WebScope.lookupView() can find this element's DOM node at runtime
    e.setAttribute(DOM_ID_ATTR, scope.id);
    const defineName = e.getAttribute(DEFINE_NAME_MARKER);
    if (defineName !== null) {
      // this scope is a <:define>'s own (never-live) template stencil, not
      // a normal element -- register it, stage7-generate excludes it from
      // its parent's compiled children (see page.definitionScopes)
      e.removeAttribute(DEFINE_NAME_MARKER);
      page.customTags.set(defineName, scope);
      page.definitionScopes.add(scope);
    }
  }
  extractValues(page, scope, e);
  let i = -1;
  for (const child of [...e.childNodes]) {
    i++;
    if (child.nodeType === NodeType.ELEMENT) {
      const childEl = child as ServerElement;
      if (childEl.tagName === DEFINE_DIRECTIVE_TAG) {
        // <:define> never itself becomes a live scope; expandDefine() moves
        // its content into an inert <template> stencil and returns the
        // (unwrapped) base-tag element, which we load() directly here since
        // template.content is invisible to this function's normal childNodes walk
        const inner = expandDefine(page, childEl);
        if (inner) load(page, scope, inner);
        continue;
      }
      // the stencil for each instance WebScope.clone() creates/reuses at
      // runtime; :for-each's element itself is never a live instance
      if (hasForEachAttr(childEl)) wrapInTemplate(childEl);
      load(page, scope, childEl);
      continue;
    }
    if (child.nodeType === NodeType.TEXT) {
      const text = child as ServerText;
      if (typeof text.textContent === 'string') {
        continue;
      }
      const id = scope.textCount++;
      const name = `${TEXT_VALUE_PREFIX}${id}`;
      scope.textValues.set(name, new Value(name, text, scope, page.createValueId()));
      // atomic-text containers (<style>/<title>) always hold exactly this
      // one text child (see parser.ts's parseAtomicText) -- comments can't
      // survive as siblings inside them (raw text elements, HTML spec
      // 13.2.5.1), so markers would corrupt the served content and desync
      // WebScope's marker-scanned text index; WebScope locates it directly
      // via the container instead (see web-scope.ts's init())
      if (ATOMIC_TEXT_TAGS.has(e.tagName)) {
        continue;
      }
      // `-` prefixed, like a triple-dash "private" comment (see
      // preprocessor.ts's removeTripleComments): those are already stripped
      // from user source before this stage ever runs, so these reserved
      // markers can never collide with anything the page author wrote
      e.insertBefore(
        new ServerComment(e.ownerDocument, `${DOM_TEXT_MARKER1}${id}`, text.loc),
        text
      );
      // recompute text's position instead of reusing the pre-insertion `i`:
      // it shifted by one when the start marker was just inserted before it
      const textIndex = e.childNodes.indexOf(text);
      const next = textIndex + 1 < e.childNodes.length ? e.childNodes[textIndex + 1] : null;
      e.insertBefore(
        new ServerComment(e.ownerDocument, DOM_TEXT_MARKER2, text.loc),
        next
      );
      continue;
    }
  }
  return scope;
}

function needsScope(e: ServerElement): boolean {
  for (const attr of e.attributes as ServerAttribute[]) {
    if (attr.name.startsWith(SPECIAL_ATTR_PREFIX)) return true;
    // a plain attribute with an interpolated value is reactive too, so its
    // element needs its own scope to hold the resulting attr$ value -- were
    // it to land on the enclosing scope instead (see load()), it would set
    // the attribute on that scope's element rather than on this one
    if (isDynamic(attr)) return true;
  }
  return false;
}

// a `${...}` attribute value is parsed into an expression; a plain one stays
// a string, and a valueless attribute (e.g. `disabled`) is null
function isDynamic(attr: ServerAttribute): boolean {
  return attr.value != null && typeof attr.value !== 'string';
}

function hasForEachAttr(e: ServerElement): boolean {
  const name = `${SPECIAL_ATTR_PREFIX}${FOR_EACH_ATTR}`;
  return (e.attributes as ServerAttribute[]).some(attr => attr.name === name);
}

function wrapInTemplate(e: ServerElement): void {
  const parent = e.parentElement!;
  const template = new ServerTemplateElement(e.ownerDocument, e.loc);
  parent.insertBefore(template, e);
  parent.removeChild(e);
  template.appendChild(e);
}

// <:define tag="custom-name:base-tag" ...special-attrs...>children</:define>
// becomes an inert <template data-markout="D"><base-tag ...>children</base-tag></template>,
// with the base-tag element registered under its custom name (page.customTags)
// once load() creates its scope for the returned inner element -- mirrors
// :for-each's wrapInTemplate, except the stencil here is never array-driven
function expandDefine(page: Page, defineEl: ServerElement): ServerElement | undefined {
  const tagAttr = defineEl.getAttribute(DEFINE_TAG_ATTR);
  const sep = tagAttr ? tagAttr.indexOf(':') : -1;
  const customName = sep > 0 ? tagAttr!.slice(0, sep).trim().toLowerCase() : '';
  const baseTag = sep > 0 ? tagAttr!.slice(sep + 1).trim() : '';
  if (!customName || !baseTag) {
    addError(
      page,
      `<${DEFINE_DIRECTIVE_TAG}> requires a "${DEFINE_TAG_ATTR}" attribute shaped "custom-name:base-tag"`,
      defineEl.loc
    );
    return undefined;
  }

  const doc = defineEl.ownerDocument;
  const inner = new ServerElement(doc, baseTag, defineEl.loc);
  for (const attr of [...(defineEl.attributes as ServerAttribute[])]) {
    if (attr.name === DEFINE_TAG_ATTR) continue;
    attr.clone(doc, inner);
  }
  inner.className = defineEl.className;
  for (const child of [...defineEl.childNodes]) {
    (child as ServerNode).clone(doc, inner);
  }
  // consumed by load() once it creates inner's own scope, then stripped
  inner.setAttribute(DEFINE_NAME_MARKER, customName);

  const template = new ServerTemplateElement(doc, defineEl.loc);
  const parent = defineEl.parentElement!;
  parent.insertBefore(template, defineEl);
  parent.removeChild(defineEl);
  template.appendChild(inner);
  return inner;
}

// runs after load() so page.customTags is fully populated regardless of
// whether a <:define> appears before or after its usage sites in source
function expandCustomTagUsages(page: Page): void {
  if (page.customTags.size === 0 || !page.main) return;
  const usages: ServerElement[] = [];
  const collect = (e: ServerElement) => {
    for (const child of [...e.childNodes]) {
      if (child.nodeType !== NodeType.ELEMENT) continue;
      const el = child as ServerElement;
      if (page.customTags.has(el.tagName.toLowerCase())) {
        usages.push(el);
        continue; // usage sites don't (yet) support light-DOM children
      }
      collect(el);
    }
  };
  collect(page.source.doc.documentElement!);

  for (const usageEl of usages) {
    const defScope = page.customTags.get(usageEl.tagName.toLowerCase())!;
    const loadedUsageScope = findScopeForElement(page.main, usageEl);
    // reuses the definition's own values/children by reference: every
    // instance is parented at the root 'page' scope (not wherever its
    // usage physically sits), so a definition's own expressions can only
    // ever see page/global, by construction -- no special runtime
    // provisions needed for that, since it's just normal scope-tree nesting
    const scope = new Scope(page, page.main);
    scope.values = new Map(defScope.values);
    scope.textValues = defScope.textValues;
    scope.children = defScope.children;
    scope.usesTemplate = defScope.id;
    scope.attributes = new Map();
    // only static ones are left to carry over: extractValues() already
    // turned any `${...}` attribute here into an attr$ value on
    // loadedUsageScope, merged in below like every other usage-site value
    for (const name of usageEl.getAttributeNames()) {
      if (name.startsWith(SPECIAL_ATTR_PREFIX) || name === DOM_ID_ATTR) continue;
      scope.attributes.set(name, usageEl.getAttribute(name));
    }
    if (loadedUsageScope) {
      scope.name = loadedUsageScope.name;
      for (const [name, value] of loadedUsageScope.values) {
        value.scope = scope;
        scope.values.set(name, value);
      }
      const index = loadedUsageScope.parent!.children.indexOf(loadedUsageScope);
      loadedUsageScope.parent!.children.splice(index, 1);
    }

    const parent = usageEl.parentElement!;
    const marker = new ServerComment(
      usageEl.ownerDocument,
      `${DOM_USE_MARKER}${scope.id}`,
      usageEl.loc
    );
    parent.insertBefore(marker, usageEl);
    parent.removeChild(usageEl);
  }
}

function findScopeForElement(scope: Scope | undefined, e: ServerElement): Scope | undefined {
  if (!scope) return undefined;
  if (scope.e === e) return scope;
  for (const child of scope.children) {
    const found = findScopeForElement(child, e);
    if (found) return found;
  }
  return undefined;
}

function extractValues(page: Page, scope: Scope, e: ServerElement) {
  for (const attr of e.attributes as ServerAttribute[]) {
    if (!attr.name.startsWith(SPECIAL_ATTR_PREFIX)) {
      // `href=${...}` and the like: no `:` needed, since the attribute is
      // already named by the HTML author -- the expression alone is what
      // makes it reactive, exactly as in text and CSS
      if (isDynamic(attr)) {
        const attrName = `${ATTR_VALUE_PREFIX}${attr.name}`;
        scope.values.set(attrName, new Value(attrName, attr, scope, page.createValueId()));
      }
      continue;
    }
    let name = attr.name.slice(SPECIAL_ATTR_PREFIX.length);
    if (name === SCOPE_NAME_ATTR) {
      if (scope.name) {
        addError(page, `Cannot redefine scope name: "${scope.name}"`, attr.loc);
        continue;
      }
      scope.name = validateName(page, attr.value, attr.valueLoc);
      continue;
    }
    if (name === FOR_EACH_ATTR) {
      scope.values.set(FOR_EACH_VALUE, new Value(FOR_EACH_VALUE, attr, scope, page.createValueId()));
      continue;
    }
    if (name === FOR_AS_ATTR) {
      scope.values.set(FOR_AS_VALUE, new Value(FOR_AS_VALUE, attr, scope, page.createValueId()));
      continue;
    }
    if (name === FOR_KEY_ATTR) {
      scope.values.set(FOR_KEY_VALUE, new Value(FOR_KEY_VALUE, attr, scope, page.createValueId()));
      continue;
    }
    let prefix = '';
    let compiledPrefix = '';
    // class-/style-/on- suffixes may be multi-word (CSS properties, class
    // names, custom event names are conventionally dash-case) -- allowed
    // here "for expressiveness" and kept dash-case verbatim in the
    // compiled name (stage7-generate quotes value keys, so a dash is fine)
    let allowDash = false;
    if (name.startsWith(CLASS_VALUE_ATTR_PREFIX)) {
      prefix = CLASS_VALUE_ATTR_PREFIX;
      compiledPrefix = CLASS_VALUE_PREFIX;
      allowDash = true;
    } else if (name.startsWith(STYLE_VALUE_ATTR_PREFIX)) {
      prefix = STYLE_VALUE_ATTR_PREFIX;
      compiledPrefix = STYLE_VALUE_PREFIX;
      allowDash = true;
    } else if (name.startsWith(EVENT_VALUE_ATTR_PREFIX)) {
      prefix = EVENT_VALUE_ATTR_PREFIX;
      compiledPrefix = EVENT_VALUE_PREFIX;
      allowDash = true;
    } else if (name.startsWith(DID_VALUE_ATTR_PREFIX)) {
      prefix = DID_VALUE_ATTR_PREFIX;
      compiledPrefix = DID_VALUE_PREFIX;
    } else if (name.startsWith(WILL_VALUE_ATTR_PREFIX)) {
      prefix = WILL_VALUE_ATTR_PREFIX;
      compiledPrefix = WILL_VALUE_PREFIX;
    }
    const loc = {
      ...attr.loc,
      start: {
        line: attr.loc.start.line,
        column: attr.loc.start.column + prefix.length,
      },
    };
    const suffix = validateName(page, name.slice(prefix.length), loc, allowDash);
    name = compiledPrefix + suffix;
    scope.values.set(name, new Value(name, attr, scope, page.createValueId()));
  }
  // both families are now scope values: leaving them behind would serialize
  // an expression object as an empty attribute, which the runtime would then
  // immediately overwrite anyway
  e.attributes = e.attributes.filter(
    attr => !attr.name.startsWith(SPECIAL_ATTR_PREFIX) && !isDynamic(attr as ServerAttribute)
  );
  if (scope.values.has(FOR_EACH_VALUE)) {
    // ordinary value, not a for$-prefixed one: stage3-qualify already turns
    // any bare identifier into `this.<name>` with no scope-aware special
    // casing, so the per-item binding only resolves correctly if it's keyed
    // under the exact name authors reference (`data`, or :for-as's choice)
    const alias = (scope.values.get(FOR_AS_VALUE)?.value as string) || FOR_DATA_DEFAULT_NAME;
    const dataAttr = new ServerAttribute(e.ownerDocument, null, alias, null, e.loc);
    scope.values.set(alias, new Value(alias, dataAttr, scope, page.createValueId()));
  }
}

// a plain (non-prefixed) value or scope name must be a clean JS identifier:
// no dash (reserved for our own class-/style-/on- families, for
// expressiveness there), no dollar sign (reserved for system values)
function validateName(
  page: Page,
  name: any,
  loc?: SourceLocation,
  allowDash = false
): string {
  name = name ? `${name}` : '';
  const invalid = allowDash ? /[^a-zA-Z0-9_-]/ : /[^a-zA-Z0-9_]/;
  if (!name || invalid.test(name)) {
    addError(page, `Invalid name: "${name}"`, loc);
    throw new Error(`Invalid name: ${name}`);
  }
  return name;
}

function addError(page: Page, msg: string, loc?: SourceLocation) {
  page.errors.push({ type: 'error', msg, loc });
}
