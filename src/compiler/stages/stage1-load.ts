import {
  ServerElement,
  ServerAttribute,
  SourceLocation,
  ServerText,
  ServerComment,
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
  EVENT_VALUE_PREFIX,
  DID_VALUE_PREFIX,
  WILL_VALUE_PREFIX,
  FOR_EACH_ATTR,
  FOR_AS_ATTR,
  FOR_KEY_ATTR,
  FOR_EACH_VALUE,
  FOR_AS_VALUE,
  FOR_KEY_VALUE,
} from '../ir/Page';
import { NodeType } from '../../html/dom';
import { DOM_ID_ATTR, DOM_TEXT_MARKER1, DOM_TEXT_MARKER2 } from '../../runtime/web/web-context';

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
  load(page, page.global, page.source.doc.documentElement!, 'page');
  return page;
}

function load(page: Page, parent: Scope, e: ServerElement, name?: string) {
  const tagName = e.tagName.toUpperCase();
  if (tagName === 'HTML') name = 'page';
  if (tagName === 'HEAD') name = 'head';
  if (tagName === 'BODY') name = 'body';
  const scope = name || needsScope(e) ? new Scope(page, parent, e, name) : parent;
  if (scope.e === e) {
    // so WebScope.lookupView() can find this element's DOM node at runtime
    e.setAttribute(DOM_ID_ATTR, scope.id);
  }
  extractValues(page, scope, e);
  let i = -1;
  for (const child of [...e.childNodes]) {
    i++;
    if (child.nodeType === NodeType.ELEMENT) {
      load(page, scope, child as ServerElement);
      continue;
    }
    if (child.nodeType === NodeType.TEXT) {
      const text = child as ServerText;
      if (!text.textContent || text.textContent instanceof String) {
        continue;
      }
      const id = scope.textCount++;
      const name = `${TEXT_VALUE_PREFIX}${id}`;
      scope.textValues.set(name, new Value(name, text, scope, page.createValueId()));
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
}

function needsScope(e: ServerElement): boolean {
  for (const attr of e.attributes as ServerAttribute[]) {
    if (attr.name.startsWith(SPECIAL_ATTR_PREFIX)) return true;
  }
  return false;
}

function extractValues(page: Page, scope: Scope, e: ServerElement) {
  for (const attr of e.attributes as ServerAttribute[]) {
    if (!attr.name.startsWith(SPECIAL_ATTR_PREFIX)) continue;
    let name = attr.name.slice(SPECIAL_ATTR_PREFIX.length);
    if (name === SCOPE_NAME_ATTR) {
      if (scope.name) {
        addError(page, `Cannot redefine scope name: "${scope.name}"`, attr.loc);
        continue;
      }
      scope.name = validateName(page, attr.value, attr.valueLoc);
      //TODO: this is probably wrong
      page.defines.set(scope.name, scope);
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
    // here "for expressiveness", then camelized to a plain JS identifier
    // for the compiled name, mirroring how WebScope.camelToDash() turns it
    // back into the real dash-case name when writing to the DOM
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
    name = compiledPrefix + (allowDash ? dashToCamel(suffix) : suffix);
    scope.values.set(name, new Value(name, attr, scope, page.createValueId()));
  }
  e.attributes = e.attributes.filter(
    attr => !attr.name.startsWith(SPECIAL_ATTR_PREFIX)
  );
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

function dashToCamel(name: string): string {
  return name.replace(/-([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
}

function addError(page: Page, msg: string, loc?: SourceLocation) {
  page.errors.push({ type: 'error', msg, loc });
}
