import * as acorn from "acorn";
import * as dom from "../html/dom";
import { ATOMIC_TEXT_TAGS, PageError, Source } from '../html/parser';
import {
  ServerAttribute,
  ServerComment,
  ServerElement,
  ServerTemplateElement,
  ServerText,
  SourceLocation,
} from "../html/server-dom";
import { DOM_TEXT_MARKER1, DOM_TEXT_MARKER2 } from "../runtime/web/web-context";
import { RT_ATTR_VALUE_PREFIX, RT_CLASS_VALUE_PREFIX, RT_EVENT_VALUE_PREFIX, RT_STYLE_VALUE_PREFIX, RT_TEXT_VALUE_PREFIX } from "../runtime/web/web-scope";
import { CompilerScope, CompilerScopeType } from './compiler';
import * as k from "./const";

export function load(source: Source): CompilerScope {
  let id = 0;
  const definitions = new Map<string, CompilerScope>;

  const error = (loc: SourceLocation, msg: string) => {
    source.errors.push(new PageError('error', msg, loc))
  }

  const wrapSpecialTags = (e: ServerElement) => {
    let type: CompilerScopeType;
    let definesTag: string | undefined;
    let extendsTag: string | undefined;
    let extendsAttr: ServerAttribute | undefined;

    // is it a `define` scope?
    if (e.tagName === k.DEFINE_DIRECTIVE) {
      type = 'define';
      const tagAttr = e.getAttributeNode(k.DEFINE_TAG_ATTR) as ServerAttribute;
      const extAttr = e.getAttributeNode(k.DEFINE_EXTENDS_ATTR);
      if (!tagAttr) {
        error(e.loc, `missing "${k.DEFINE_TAG_ATTR}" attribute`);
        return { type, wrapper: null };
      }
      if (
        typeof tagAttr.value !== 'string' ||
        !k.DEFINE_TAG_RE.test(tagAttr.value)
      ) {
        error(tagAttr.valueLoc!, `invalid "${k.DEFINE_TAG_ATTR}" attribute`);
        return { type, wrapper: null };
      }
      if (e.getAttributeNode(k.NAME_ATTR)) {
        error(tagAttr.valueLoc!, `attribute "${k.NAME_ATTR}" now allowed in definitions`);
        return { type, wrapper: null };
      }
      e.delAttributeNode(tagAttr);
      if (extAttr) {
        if (
          typeof extAttr.value !== "string" ||
          !k.DEFINE_EXTENDS_RE.test(extAttr.value)
        ) {
          error(e.loc, `invalid "${k.DEFINE_EXTENDS_ATTR}" attribute`);
          return { type, wrapper: null };
        }
        e.delAttributeNode(extAttr);
        extendsAttr = extAttr as ServerAttribute;
      }
      definesTag = tagAttr?.value as string;
      extendsTag = extAttr?.value as string ?? 'div';
      e.tagName = extendsTag;
      // create wrapper <template> tag
      const t = new ServerTemplateElement(e.ownerDocument, e.loc);
      e.parentElement!.insertBefore(t, e);
      e.unlink();
      t.appendChild(e);
      e = t;
    }

    // is it a `foreach` scope?
    const foreachAttr = e.getAttributeNode(
      k.IN_VALUE_ATTR_PREFIX + k.FOREACH_ATTR
    );
    if (foreachAttr) {
      type = 'foreach';
      // create wrapper <template> tag
      const t = new ServerTemplateElement(e.ownerDocument, e.loc);
      e.parentElement!.insertBefore(t, e);
      // move 'foreach' attr to template with name 'data'
      e.delAttributeNode(foreachAttr);
      foreachAttr.name = k.IN_VALUE_ATTR_PREFIX + k.DATA_ATTR;
      t.attributes.push(foreachAttr);
      foreachAttr.parentElement = t;
      // move e into <template>
      e.unlink();
      t.appendChild(e);
      // add 'data' attr to tag
      e.setAttribute(k.IN_VALUE_ATTR_PREFIX + k.DATA_ATTR, '');
      // replace current element with the wrapper
      e = t;
    }

    return { type, wrapper: type ? e : null, definesTag, extendsTag, extendsAttr };
  }

  const load = (e: ServerElement, p: CompilerScope) => {
    let definition: CompilerScope | undefined;

    if (needsScope(e)) {
      const { type, wrapper, definesTag, extendsTag, extendsAttr } = wrapSpecialTags(e);
      if (wrapper) {
        // adopt the wrapper as current element
        e = wrapper;
      }

      const scope: CompilerScope = {
        parent: p,
        id: id++,
        type,
        defines: definesTag,
        children: [],
        loc: e.loc,
      };
      e.setAttribute(k.OUT_OBJ_ID_ATTR, `${scope.id}`);
      p.children.push(scope);

      if (definesTag) {
        scope.xtends = extendsTag?.includes('-')
          ? definitions.get(extendsTag.toUpperCase())
          : extendsTag;
        // if (!scope.xtends) {
        //   error(extendsAttr?.valueLoc!, `"${extendsTag}" is not defined`);
        // }
        if (scope.xtends && typeof scope.xtends !== 'string') {
          error(extendsAttr?.valueLoc!, `cannot extend another definition ("${extendsTag}")`);
        }
        definition = scope;
      }

      if (e.tagName.includes('-')) {
        const definition = definitions.get(e.tagName.toUpperCase());
        // if (!definition) {
        //   error(e.loc, `"${e.tagName.toLowerCase()}" is not defined`);
        // }
        if (definition) {
          scope.type = 'instance';
          scope.uses = e.tagName.toLowerCase();
        }
      }

      // attributes
      for (const a of [...(e as ServerElement).attributes]) {
        const attr = a as ServerAttribute;
        if (attr.name.startsWith(k.IN_VALUE_ATTR_PREFIX)) {
          const name = attr.name.substring(k.IN_VALUE_ATTR_PREFIX.length);
          e.removeAttribute(attr.name);
          // test attributes
          if (name.startsWith(k.TEST_ATTR)) {
            handleTestAttr(scope, name);
            continue;
          }
          // scope name attribute
          if (name === k.NAME_ATTR) {
            if (typeof attr.value !== 'string' || !k.ID_RE.test(attr.value)) {
              error(attr.valueLoc ?? attr.loc, 'invalid name');
              continue;
            }
            scope.name = {
              val: attr.value,
              keyLoc: attr.loc,
              valLoc: attr.valueLoc,
            }
            continue;
          }
          //TODO: special prefixes, e.g. 'on-'
          if (!k.ID_RE.test(name)) {
            error(attr.loc, 'invalid value name');
            continue;
          }
          // class attribute
          if (name.startsWith(k.CLASS_ATTR_PREFIX)) {
            const key = name.substring(k.CLASS_ATTR_PREFIX.length);
            scope.values || (scope.values = {});
            scope.values[RT_CLASS_VALUE_PREFIX + key] = {
              val: (attr as ServerAttribute).value,
              keyLoc: (attr as ServerAttribute).loc,
              valLoc: (attr as ServerAttribute).valueLoc
            };
            continue;
          }
          // style attribute
          if (name.startsWith(k.STYLE_ATTR_PREFIX)) {
            const key = name.substring(k.STYLE_ATTR_PREFIX.length);
            scope.values || (scope.values = {});
            scope.values[RT_STYLE_VALUE_PREFIX + key] = {
              val: (attr as ServerAttribute).value,
              keyLoc: (attr as ServerAttribute).loc,
              valLoc: (attr as ServerAttribute).valueLoc
            };
            continue;
          }
          // event attribute
          if (name.startsWith(k.EVENT_ATTR_PREFIX)) {
            const key = name.substring(k.EVENT_ATTR_PREFIX.length);
            scope.values || (scope.values = {});
            scope.values[RT_EVENT_VALUE_PREFIX + key] = {
              val: (attr as ServerAttribute).value,
              keyLoc: (attr as ServerAttribute).loc,
              valLoc: (attr as ServerAttribute).valueLoc
            };
            continue;
          }
          // value attribute
          scope.values || (scope.values = {});
          const attrValue = (attr as ServerAttribute).value;
          let valueToStore;
          
          // If it's a reactive attribute with a string value, convert to JavaScript AST
          if (typeof attrValue === 'string') {
            try {
              // Parse the string as a JavaScript string literal
              const quotedValue = JSON.stringify(attrValue);
              valueToStore = acorn.parseExpressionAt(quotedValue, 0, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                locations: false
              });
            } catch (err) {
              // If parsing fails, treat as literal string (fallback)
              valueToStore = attrValue;
            }
          } else {
            // Already an AST object or other value
            valueToStore = attrValue;
          }
          
          scope.values[name] = {
            val: valueToStore,
            keyLoc: (attr as ServerAttribute).loc,
            valLoc: (attr as ServerAttribute).valueLoc
          };
        } else if (attr.value && typeof attr.value === 'object') {
          // dynamic HTML attr
          e.removeAttribute(attr.name);
          scope.values || (scope.values = {});
          scope.values[RT_ATTR_VALUE_PREFIX + attr.name] = {
            val: (attr as ServerAttribute).value,
            keyLoc: (attr as ServerAttribute).loc,
            valLoc: (attr as ServerAttribute).valueLoc
          };
        }
      }

      // texts
      const texts = lookupDynamicTexts(e);
      if (
        ATOMIC_TEXT_TAGS.has(e.tagName) &&
        texts.length === 1 &&
        texts[0].parentElement === e
      ) {
        const text = texts[0];
        scope.values || (scope.values = {});
        scope.values[RT_TEXT_VALUE_PREFIX + scope.id] = {
          val: text.textContent as acorn.Expression,
          keyLoc: (text as ServerText).loc,
          valLoc: (text as ServerText).loc,
        };
        // For atomic text, preserve the text node with placeholder content
        const t = text as ServerText;
        t.textContent = '&#8203;';
      } else {
        texts.forEach((text, index) => {
          scope.values || (scope.values = {});
          scope.values[RT_TEXT_VALUE_PREFIX + scope.id + '_' + index] = {
            val: text.textContent as acorn.Expression,
            keyLoc: (text as ServerText).loc,
            valLoc: (text as ServerText).loc,
          };
          const t = text as ServerText;
          const p = t.parentElement!;
          const m1 = `${DOM_TEXT_MARKER1}${scope.id}_${index}`;
          const m2 = DOM_TEXT_MARKER2;
          const c1 = new ServerComment(e.ownerDocument, m1, t.loc);
          const c2 = new ServerComment(e.ownerDocument, m2, t.loc);
          
          // Insert first marker before the text node
          p.insertBefore(c1, t);
          
          // Find next sibling and insert second marker after the text node
          const childIndex = p.childNodes.indexOf(t);
          const nextSibling = childIndex + 1 < p.childNodes.length ? p.childNodes[childIndex + 1] : null;
          if (nextSibling) {
            p.insertBefore(c2, nextSibling);
          } else {
            p.appendChild(c2);
          }
          
          // Replace text content with zero-width space placeholder (don't remove the node)
          t.textContent = '&#8203;';
        });
      }

      p = scope;
    }
    const childNodes = e.tagName === 'TEMPLATE'
      ? (e as ServerTemplateElement).content.childNodes
      : e.childNodes;
    childNodes.forEach(n => {
      if (n.nodeType === dom.NodeType.ELEMENT) {
        load(n as ServerElement, p);
      }
    });

    if (definition) {
      addSlotMap(definition, e as ServerTemplateElement, source);
      definitions.set(definition.defines!.toUpperCase(), definition);
    }
  }

  // Process the document element directly as the root scope
  // Start with a temporary container to collect the root scope
  const tempContainer = {
    id: -1,
    type: undefined,
    children: [],
    loc: source.doc.loc,
  };
  load(source.doc.documentElement!, tempContainer);
  
  // Return the first child as the root (the <html> element scope)
  // If no scope was created, return the container
  return tempContainer.children.length > 0 ? tempContainer.children[0] : tempContainer;
}

function handleTestAttr(scope: CompilerScope, name: string) {
  if (name === k.TEST_CLOSED_ATTR) {
    scope.closed = true;
    return;
  }
}

function needsScope(e: dom.Element): boolean {
  // is a <:define> directive
  if (e.tagName === k.DEFINE_DIRECTIVE) {
    return true;
  }

  // is a component instance
  if (e.tagName.includes('-')) {
    return true;
  }

  // has a name
  const defName = k.DEF_SCOPE_NAMES[e.tagName];
  if (defName) {
    if (!e.getAttribute(k.IN_VALUE_ATTR_PREFIX + 'name')) {
      e.setAttribute(k.IN_VALUE_ATTR_PREFIX + 'name', defName);
    }
    return true;
  }

  // is root
  if (!e.parentElement) {
    return true;
  }

  // has dynamic attributes
  for (const attr of (e as ServerElement).attributes) {
    if (
      attr.name.startsWith(k.IN_VALUE_ATTR_PREFIX) ||
      typeof attr.value === 'object'
    ) {
      return true;
    }
  }

  // is an "atomic text tag" and has dynamic content
  if (ATOMIC_TEXT_TAGS.has(e.tagName)) {
    const t = e.childNodes.length === 1 ? e.childNodes[0] as ServerText : null;
    if (t?.nodeType === dom.NodeType.TEXT && typeof t.textContent === 'object') {
      return true;
    }
  }

  // none of the above
  return false;
}

function lookupDynamicTexts(e: dom.Element) {
  const ret: dom.Text[] = [];

  const lookup = (e: dom.Element) => {
    for (const n of e.childNodes) {
      if (n.nodeType === dom.NodeType.ELEMENT) {
        if (!needsScope(n as dom.Element)) {
          lookup(n as dom.Element);
        }
      } else if (n.nodeType === dom.NodeType.TEXT) {
        if (typeof (n as dom.Text).textContent === 'object') {
          ret.push(n as dom.Text);
        }
      }
    }
  }
  lookup(e);

  return ret;
}

function addSlotMap(definition: CompilerScope, template: dom.TemplateElement, source: Source) {
  const slots = new Array<dom.Element>();
  const map: { [key: string]: number } = {};

  const lookupSlots = (p: dom.Element | dom.DocumentFragment) => {
    for (const n of p.childNodes) {
      if (n.nodeType !== dom.NodeType.ELEMENT) continue;
      if ((n as dom.Element).tagName === 'SLOT') {
        slots.push(n as dom.Element);
      } else {
        lookupSlots(n as dom.Element);
      }
    }
  }

  const lookupSlotScopeId = (s: dom.Element) => {
    // Navigate up the DOM tree until we find a scope ID or reach the template content root
    while (s && s.parentElement) {
      s = s.parentElement!;
      if (s.getAttribute(k.OUT_OBJ_ID_ATTR)) {
        break;
      }
      // Stop if we've reached the template element itself
      if (s === template) {
        break;
      }
    }
    return parseInt(s.getAttribute(k.OUT_OBJ_ID_ATTR) ?? '0');
  }

  lookupSlots(template.content);
  slots.forEach(slot => {
    const name = slot.getAttribute('name');
    if (name && /^[\w_][\w0-9\-_]*$/.test(name)) {
      const scopeId = lookupSlotScopeId(slot);
      map[name] = scopeId;
    } else {
      source.errors.push(
        new PageError(
          "error",
          'bad/missing "name" attribute in slot',
          (slot as ServerElement).loc
        )
      );
    }
  });

  if (Object.keys(map).length) {
    definition.slotmap = map;
  }
}
