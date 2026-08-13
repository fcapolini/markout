import * as acorn from 'acorn';
import {
  ServerElement,
  ServerAttribute,
  SourceLocation,
  ServerText,
  ServerComment,
  ServerTemplateElement,
  ServerNode,
  ServerContainerNode,
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
  HANDLE_VALUE_ATTR_PREFIX,
  CLASS_VALUE_PREFIX,
  STYLE_VALUE_PREFIX,
  ATTR_VALUE_PREFIX,
  EVENT_VALUE_PREFIX,
  DID_VALUE_PREFIX,
  WILL_VALUE_PREFIX,
  HANDLE_VALUE_PREFIX,
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
  SLOT_DIRECTIVE_TAG,
  SLOT_NAME_ATTR,
  SLOT_TARGET_ATTR,
  DEFAULT_SLOT_NAME,
  PRESENCE_VALUE_ATTR_PREFIX,
  PRESENCE_VALUE_PREFIX,
  PROP_VALUE_ATTR_PREFIX,
  PROP_VALUE_PREFIX,
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
  // after every usage has had its chance to clone a stencil with the slot
  // still in place. A directive tag isn't serialized -- children and all --
  // so an untouched <:slot> has to be replaced by its own content, which is
  // exactly the fallback a usage supplying nothing should get
  unwrapSlots(page.source.doc.documentElement!);
  return page;
}

function unwrapSlots(e: ServerElement): void {
  const children =
    e.tagName === 'TEMPLATE'
      ? [...(e as ServerTemplateElement).content.childNodes]
      : [...e.childNodes];
  for (const child of children) {
    if (child.nodeType !== NodeType.ELEMENT) continue;
    const el = child as ServerElement;
    unwrapSlots(el);
    if (el.tagName !== SLOT_DIRECTIVE_TAG) continue;
    const host = el.parentElement!;
    for (const inner of [...el.childNodes]) {
      el.removeChild(inner);
      host.insertBefore(inner, el);
    }
    host.removeChild(el);
  }
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
      // atomic-text containers (<style>/<title>) always hold exactly this one
      // text child (see parser.ts's parseAtomicText), and comments can't
      // survive inside them (raw text elements, HTML spec 13.2.5.1) -- so the
      // marker goes immediately BEFORE the container, in the same scope's
      // territory, and WebScope reads through to the child (see init())
      if (ATOMIC_TEXT_TAGS.has(e.tagName)) {
        e.parentElement?.insertBefore(
          new ServerComment(e.ownerDocument, `${DOM_TEXT_MARKER1}${id}`, text.loc),
          e
        );
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
    // `:slot` only says where this element goes; on its own it's no reason
    // to give it a scope (and a data-markout id) it would never use
    if (attr.name === `${SPECIAL_ATTR_PREFIX}${SLOT_TARGET_ATTR}`) continue;
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
  // a <template> holds either a :for-each stencil or a <:define> body, and
  // both get stamped out repeatedly. Its content is invisible to a plain
  // childNodes walk, which is how usages in there used to be skipped in
  // silence -- leaving the custom tag itself in the served markup, rendering
  // nothing, with no error to explain it
  const collect = (e: ServerElement) => {
    const container: ServerContainerNode =
      e.tagName === 'TEMPLATE' ? (e as ServerTemplateElement).content : e;
    for (const child of [...container.childNodes]) {
      if (child.nodeType !== NodeType.ELEMENT) continue;
      const el = child as ServerElement;
      if (page.customTags.has(el.tagName.toLowerCase())) {
        usages.push(el);
      }
      // descends into a usage site too: its children are slotted content,
      // which can name custom tags of its own. Document order matters -- an
      // outer usage is expanded first, moving these nodes into its stencil,
      // and the inner one is then found wherever they landed
      collect(el);
    }
  };
  collect(page.source.doc.documentElement!);

  for (const usageEl of usages) {
    const defScope = page.customTags.get(usageEl.tagName.toLowerCase())!;
    const loadedUsageScope = findScopeForElement(page.main, usageEl);
    // reuses the definition's own values/children by reference, and sits
    // where the usage physically sits -- so a usage inside a :for-each is
    // replicated with it, and one inside a <:define> comes along with every
    // instance of the outer tag, at no extra cost.
    //
    // Its own expressions still resolve from the page root, NOT from here:
    // scope.usesTemplate makes the runtime look names up lexically from
    // there (CoreScope.lexicalParent()), which is what keeps a definition
    // from reading whatever its call site happens to declare
    const scope = new Scope(page, enclosingScope(page, usageEl, loadedUsageScope));
    // the tag itself was written in someone else's slot: the instance
    // inherits that, so its usage-site values keep resolving out there
    // rather than against the instance it happens to sit inside
    const host = slottedHost(page, usageEl);
    if (loadedUsageScope?.slotted) {
      scope.slotted = true;
      scope.lexicalParent = loadedUsageScope.lexicalParent;
    } else if (host) {
      scope.slotted = true;
      scope.lexicalParent = host.slotted ? host.lexicalParent : host.parent;
    }
    scope.values = new Map(defScope.values);
    scope.textValues = defScope.textValues;
    // copied, not shared: a usage supplying slotted content adds its own
    // scopes here, and that must not reach the other instances
    scope.children = [...defScope.children];
    scope.usesTemplate = slotUsage(page, usageEl, defScope, scope, loadedUsageScope);
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
      // kept, not replaced: slotUsage() has already marked the instance's
      // slotted TEXT as call-site-resolved, and assigning a fresh set here
      // dropped that -- so a component with any `:` attribute on its usage
      // (the only thing that gives the usage a scope, and so brings us here)
      // silently resolved slotted text against its own values instead of the
      // call site's, which is the one thing slotting must never do
      scope.callSiteValues ??= new Set();
      for (const [name, value] of loadedUsageScope.values) {
        // deliberately NOT reassigned to `scope`: `value.scope` is what both
        // stage3/stage4 and the runtime resolve an expression against, and
        // this one was written at the usage site, so it keeps resolving
        // there -- `<my-card :title=${data.t} />` inside a :for-each has to
        // see that loop's `data`
        scope.values.set(name, value);
        scope.callSiteValues.add(name);
      }
      // spliced out of the tree (the instance scope stands in for it), but
      // its parent link stays intact -- that's the chain the values above
      // still resolve through
      const index = loadedUsageScope.parent!.children.indexOf(loadedUsageScope);
      loadedUsageScope.parent!.children.splice(index, 1);
    }

    // read now, not when the usage was collected: expanding an outer usage
    // moves its slotted content into that instance's stencil, so an inner
    // usage is very often no longer where it was found. `parentNode` rather than
    // `parentElement` because a `:for-each` usage has been wrapped in a
    // <template> by this point, and a fragment's children have no
    // parentElement -- which is where this used to throw
    const parent = usageEl.parentNode!;
    const marker = new ServerComment(
      usageEl.ownerDocument,
      `${DOM_USE_MARKER}${scope.id}`,
      usageEl.loc
    );
    parent.insertBefore(marker, usageEl);
    parent.removeChild(usageEl);
  }
}

/**
 * Wires a usage site's children into the definition's `<:slot>`, and returns
 * the id of the stencil the instance should be built from.
 *
 * A usage supplying no children just instantiates the definition's own
 * (shared) stencil, keeping whatever the `<:slot>` holds as fallback. One
 * that does gets a stencil of its own: a clone of the definition's, with the
 * children moved into the slot's place. Per usage site, not per replica --
 * a `:for-each` still stamps every replica out of that one stencil.
 *
 * The children are MOVED, not copied, so the scopes load() already built for
 * them stay attached to the very nodes that end up in the instance.
 */
function slotUsage(
  page: Page,
  usageEl: ServerElement,
  defScope: Scope,
  scope: Scope,
  loadedUsageScope: Scope | undefined
): string {
  const children = [...usageEl.childNodes].filter(
    n => n.nodeType !== NodeType.TEXT || `${(n as ServerText).textContent}`.trim()
  );
  if (!children.length) return defScope.id;

  const defEl = defScope.e!;
  const defSlots = findSlots(defEl);
  // grouped by the slot each child addresses; anything unaddressed fills the
  // default one, which is also where every text node goes
  const groups = new Map<string, ServerNode[]>();
  for (const child of children) {
    const name =
      child.nodeType === NodeType.ELEMENT
        ? page.slotTargets.get(child as ServerElement) ?? DEFAULT_SLOT_NAME
        : DEFAULT_SLOT_NAME;
    groups.set(name, [...(groups.get(name) ?? []), child as ServerNode]);
  }

  let unusable = false;
  for (const name of groups.keys()) {
    const site = defSlots.get(name);
    if (site && !site.replicated) continue;
    unusable = true;
    addError(
      page,
      site?.replicated
        ? // the content would be spliced into a :for-each stencil and stamped
          // out per replica, but there is only one set of scopes for it --
          // every replica would fight over the same ones. Reported rather
          // than expanded wrong (see the note in slotUsage's doc comment)
          `<${usageEl.tagName.toLowerCase()}>'s ` +
            `${name === DEFAULT_SLOT_NAME ? 'slot' : `"${name}" slot`} ` +
            `is inside a :for-each and can't be filled yet`
        : name === DEFAULT_SLOT_NAME
          ? `<${usageEl.tagName.toLowerCase()}> was given content but its ` +
              `<${DEFINE_DIRECTIVE_TAG.toLowerCase()}> has no ` +
              `<${SLOT_DIRECTIVE_TAG.toLowerCase()}> to put it in`
          : `<${usageEl.tagName.toLowerCase()}> has no "${name}" slot`,
      usageEl.loc
    );
  }
  if (unusable) return defScope.id;

  const doc = usageEl.ownerDocument;
  const stencil = defEl.clone(doc, null) as ServerElement;
  // `${scope.id}t` rather than a scope id: this is a stencil, not a scope,
  // and it only has to be unique among data-markout values so
  // WebContext.findElementById() can tell it from the definition's own
  const stencilId = `${scope.id}t`;
  stencil.setAttribute(DOM_ID_ATTR, stencilId);

  const slots = findSlots(stencil);
  // the definition's own scopes inside a slot that got filled: their markup
  // was just replaced, so the instance must not carry values still pointing
  // at it (see rehomeSlottedText for the text half of the same problem)
  const filled = descendantsOf(
    [...groups.keys()].map(name => defSlots.get(name)!.el as unknown as ServerNode)
  );
  scope.children = scope.children.filter(child => !child.e || !filled.has(child.e));
  for (const [name, nodes] of groups) {
    const target = slots.get(name)!.el;
    const host = target.parentElement!;
    for (const child of nodes) {
      usageEl.removeChild(child);
      host.insertBefore(child, target);
      page.slottedInto.set(child, scope);
    }
    // only the ones that were filled: an untouched slot keeps its own
    // content, which unwrapSlots() leaves behind as the fallback
    host.removeChild(target);
  }

  const template = new ServerTemplateElement(doc, usageEl.loc);
  template.appendChild(stencil);
  (doc!.head ?? doc!.documentElement!).appendChild(template);

  // the slotted scopes move under the instance, where their DOM now lives,
  // but keep resolving against the scope the usage was written in
  for (const slotted of outermostScopesIn(page, children as ServerNode[])) {
    const index = slotted.parent!.children.indexOf(slotted);
    index >= 0 && slotted.parent!.children.splice(index, 1);
    slotted.parent = scope;
    // markup slotted into a REPLICATED usage resolves against the usage
    // scope, which is where that `:for-each` declared its per-item name --
    // slotted content is written at the usage site just like the attributes
    // beside it. Anything else resolves where the usage sits, as before
    slotted.lexicalParent = loadedUsageScope?.values.has(FOR_EACH_VALUE)
      ? loadedUsageScope
      : scope.parent;
    slotted.slotted = true;
    scope.children.push(slotted);
  }
  // whichever scope load() gave the usage element's own territory to: its
  // own, if the tag had attributes worth one, else the enclosing scope
  rehomeSlottedText(
    defScope,
    scope,
    loadedUsageScope ?? scope.parent!,
    stencil,
    children as ServerNode[]
  );
  return stencilId;
}

/**
 * Re-keys the interpolated text of an instance that received slotted content.
 *
 * Text is bound by POSITION: WebScope.init() collects the marker-delimited
 * nodes of a scope's own territory in document order, and `text$K` is the Kth
 * of them. Bare `${...}` written between a custom tag's tags belongs to the
 * scope containing the usage, but its node ends up inside the instance --
 * where that scope's own scan can't reach it, since the scan stops at any
 * element bearing a scope id. Left alone it silently renders nothing.
 *
 * So the instance takes over those values, interleaved with the definition's
 * own in the order they now appear, and the call-site scope re-keys what it
 * has left. Marking them in `callSiteValues` keeps them evaluating where they
 * were written, exactly like a usage-site attribute.
 */
function rehomeSlottedText(
  defScope: Scope,
  scope: Scope,
  callScope: Scope,
  stencil: ServerElement,
  moved: ServerNode[]
): void {
  const within = descendantsOf(moved);
  const movedText = new Map<ServerText, string>();
  for (const [name, value] of callScope.textValues) {
    const node = value.node as ServerText;
    if (node.nodeType === NodeType.TEXT && within.has(node)) {
      movedText.set(node, name);
    }
  }

  // rebuilt unconditionally, not just when the usage brought text of its own:
  // filling a slot REMOVES its fallback, and the definition's values for that
  // fallback would otherwise stay on the instance pointing at markup this
  // stencil no longer has
  const textValues = new Map<string, Value>();
  scope.callSiteValues ??= new Set();
  let index = 0;
  for (const { marker, text } of orderedTexts(stencil)) {
    // the definition's ids and the call site's are allocated from separate
    // counters and would collide here, so the instance gets its own run of
    // them -- and the marker is rewritten to match, since that id is what
    // the runtime binds by (see WebScope.init())
    const id = index++;
    const key = `${TEXT_VALUE_PREFIX}${id}`;
    const fromCallSite = movedText.get(text);
    const value =
      fromCallSite !== undefined
        ? callScope.textValues.get(fromCallSite)
        : defScope.textValues.get(
            // a clone of one of the definition's own still carries the id it
            // had there, which is the key it kept in defScope
            `${TEXT_VALUE_PREFIX}${marker.textContent.slice(DOM_TEXT_MARKER1.length)}`
          );
    if (!value) continue;
    marker.textContent = `${DOM_TEXT_MARKER1}${id}`;
    textValues.set(key, value);
    if (fromCallSite !== undefined) {
      scope.callSiteValues.add(key);
      callScope.textValues.delete(fromCallSite);
    }
  }
  scope.textValues = textValues;
}

/**
 * The marker/text pairs of an element's own territory, found the way
 * WebScope.init() finds them -- descending only into elements that don't
 * carry a scope id of their own, and reading through an atomic-text
 * container to the child its preceding marker stands for.
 */
function orderedTexts(e: ServerElement): { marker: ServerComment; text: ServerText }[] {
  const out: { marker: ServerComment; text: ServerText }[] = [];
  const walk = (host: ServerElement) => {
    const children = [...host.childNodes];
    children.forEach((n, i) => {
      if (n.nodeType === NodeType.ELEMENT) {
        const el = n as ServerElement;
        el.getAttribute(DOM_ID_ATTR) === null &&
          !ATOMIC_TEXT_TAGS.has(el.tagName) &&
          walk(el);
        return;
      }
      if (
        n.nodeType !== NodeType.COMMENT ||
        !`${(n as ServerComment).textContent}`.startsWith(DOM_TEXT_MARKER1)
      ) {
        return;
      }
      const next = children[i + 1];
      const text =
        next?.nodeType === NodeType.ELEMENT &&
        ATOMIC_TEXT_TAGS.has((next as ServerElement).tagName)
          ? (next as ServerElement).childNodes[0]
          : next;
      text?.nodeType === NodeType.TEXT &&
        out.push({ marker: n as ServerComment, text: text as ServerText });
    });
  };
  walk(e);
  return out;
}

interface SlotSite {
  el: ServerElement;
  /** inside a `:for-each` stencil within the definition (see inLoop below) */
  replicated: boolean;
}

/**
 * Every `<:slot>` in a definition body, by name (the default one is `''`).
 *
 * Descends into `<template>` content, which is where load() has already moved
 * any `:for-each` element -- a slot in there is reported rather than missed,
 * so a usage trying to fill it gets told what's actually wrong.
 */
function findSlots(
  e: ServerElement,
  into = new Map<string, SlotSite>(),
  inLoop = false
): Map<string, SlotSite> {
  const isStencil = e.tagName === 'TEMPLATE';
  const children = isStencil
    ? [...(e as ServerTemplateElement).content.childNodes]
    : [...e.childNodes];
  for (const child of children) {
    if (child.nodeType !== NodeType.ELEMENT) continue;
    const el = child as ServerElement;
    if (el.tagName === SLOT_DIRECTIVE_TAG) {
      // first one wins, so a duplicate name can't silently steal content
      const name = `${el.getAttribute(SLOT_NAME_ATTR) ?? DEFAULT_SLOT_NAME}`;
      into.has(name) || into.set(name, { el, replicated: inLoop || isStencil });
      continue;
    }
    findSlots(el, into, inLoop || isStencil);
  }
  return into;
}

/** the scopes rooted inside `nodes`, without descending past the first one found */
function outermostScopesIn(page: Page, nodes: ServerNode[]): Scope[] {
  const within = descendantsOf(nodes);
  const found: Scope[] = [];
  const visit = (scope: Scope) => {
    if (scope.e && within.has(scope.e)) {
      found.push(scope);
      return;
    }
    [...scope.children].forEach(visit);
  };
  page.main && visit(page.main);
  return found;
}

/**
 * Everything inside `nodes`, themselves included, descending into
 * `<template>` content.
 *
 * Membership rather than a walk up from the element: ServerTemplateElement
 * severs parentElement when it takes a child, so an element inside a
 * `:for-each` stencil has no way back up to the subtree it belongs to. A
 * scope missed here keeps a parent outside the instance its DOM ends up in,
 * and then can't find that DOM at all.
 */
function descendantsOf(nodes: ServerNode[]): Set<object> {
  const found = new Set<object>();
  const walk = (n: ServerNode) => {
    if (found.has(n)) return;
    found.add(n);
    const children =
      (n as ServerElement).tagName === 'TEMPLATE'
        ? (n as ServerTemplateElement).content.childNodes
        : (n as ServerElement).childNodes;
    for (const child of children ?? []) walk(child as ServerNode);
  };
  nodes.forEach(walk);
  return found;
}

/**
 * The scope a usage site physically sits in -- its own loaded scope's
 * parent when the usage element got one (it had `:` or interpolated
 * attributes), otherwise the nearest ancestor element that has one.
 *
 * Walking ancestors stops naturally at a stencil boundary: a `<template>`
 * severs parentElement, so a usage inside a `:for-each` lands on that
 * `:for-each`'s own scope rather than escaping to the page root.
 */
/** the custom-tag instance whose slot this element was moved into, if any */
function slottedHost(page: Page, e: ServerElement): Scope | undefined {
  let n: ServerElement | null = e;
  while (n) {
    const host = page.slottedInto.get(n);
    if (host) return host;
    n = n.parentElement;
  }
  return undefined;
}

function enclosingScope(
  page: Page,
  usageEl: ServerElement,
  loadedUsageScope: Scope | undefined
): Scope {
  if (loadedUsageScope?.parent) return loadedUsageScope.parent;
  let e: ServerElement | null = usageEl;
  while (e) {
    // checked first: once a node has been slotted into an instance it lives
    // in a stencil clone, which no scope's element ever points at, so the
    // lookup below can't see it
    const host = page.slottedInto.get(e);
    if (host) return host;
    const scope = e !== usageEl ? findScopeForElement(page.main, e) : undefined;
    if (scope) return scope;
    e = e.parentElement;
  }
  return page.main!;
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
    if (name === SLOT_TARGET_ATTR) {
      // addressed to a slot, not a value of its own: kept aside here because
      // the `:` attributes are stripped at the end of this function, long
      // before expandCustomTagUsages() gets to read it
      page.slotTargets.set(e, `${attr.value ?? ''}`);
      continue;
    }
    if (name === SCOPE_NAME_ATTR) {
      if (scope.name) {
        addError(page, `Cannot redefine scope name: "${scope.name}"`, attr.loc);
        continue;
      }
      scope.name = validateName(page, attr.value, attr.valueLoc, NAME_CHARS.plain, true);
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
    // what a family's suffix may hold beyond letters, digits and `_`.
    // These name things OUTSIDE markout -- CSS properties, class names,
    // attributes, event types -- so the charset is theirs, not ours, and is
    // kept verbatim in the compiled name (stage7-generate quotes value keys)
    let extra = NAME_CHARS.plain;
    if (name.startsWith(PROP_VALUE_ATTR_PREFIX)) {
      prefix = PROP_VALUE_ATTR_PREFIX;
      compiledPrefix = PROP_VALUE_PREFIX;
      extra = NAME_CHARS.dashed;
    } else if (name.startsWith(PRESENCE_VALUE_ATTR_PREFIX)) {
      prefix = PRESENCE_VALUE_ATTR_PREFIX;
      compiledPrefix = PRESENCE_VALUE_PREFIX;
      extra = NAME_CHARS.dom;
    } else if (name.startsWith(CLASS_VALUE_ATTR_PREFIX)) {
      prefix = CLASS_VALUE_ATTR_PREFIX;
      compiledPrefix = CLASS_VALUE_PREFIX;
      extra = NAME_CHARS.dashed;
    } else if (name.startsWith(STYLE_VALUE_ATTR_PREFIX)) {
      prefix = STYLE_VALUE_ATTR_PREFIX;
      compiledPrefix = STYLE_VALUE_PREFIX;
      extra = NAME_CHARS.dashed;
    } else if (name.startsWith(EVENT_VALUE_ATTR_PREFIX)) {
      prefix = EVENT_VALUE_ATTR_PREFIX;
      compiledPrefix = EVENT_VALUE_PREFIX;
      extra = NAME_CHARS.dom;
    } else if (name.startsWith(DID_VALUE_ATTR_PREFIX)) {
      prefix = DID_VALUE_ATTR_PREFIX;
      compiledPrefix = DID_VALUE_PREFIX;
    } else if (name.startsWith(WILL_VALUE_ATTR_PREFIX)) {
      prefix = WILL_VALUE_ATTR_PREFIX;
      compiledPrefix = WILL_VALUE_PREFIX;
    } else if (name.startsWith(HANDLE_VALUE_ATTR_PREFIX)) {
      prefix = HANDLE_VALUE_ATTR_PREFIX;
      compiledPrefix = HANDLE_VALUE_PREFIX;
    }
    const loc = {
      ...attr.loc,
      start: {
        line: attr.loc.start.line,
        column: attr.loc.start.column + prefix.length,
      },
    };
    // a `:handle-x` suffix names the value being handled, so unlike the
    // element-facing families it has to be something an expression can say
    const referenced = prefix === '' || prefix === HANDLE_VALUE_ATTR_PREFIX;
    const suffix = validateName(page, name.slice(prefix.length), loc, extra, referenced);
    name = compiledPrefix + suffix;
    prefix === HANDLE_VALUE_ATTR_PREFIX && desugarHandler(attr, suffix);
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
/**
 * Rewrites `:handle-x=${(v) => ...}` into `((v) => ...)(x)`.
 *
 * That is the whole feature. The wrapped call is an ordinary expression, so
 * the dependency on `x` comes out of the normal extraction, `x` is resolved
 * like any other reference -- `:handle-typo` is a compile error rather than
 * a handler that never runs -- and the runtime needs to know nothing about
 * it: a value is re-evaluated when what it depends on changes, and this one
 * happens to be evaluated for its effect rather than its result.
 */
function desugarHandler(attr: ServerAttribute, target: string): void {
  const exp = attr.value;
  // a plain string isn't an expression; stage2 reports it as no arrow
  if (!exp || typeof exp === 'string') return;
  const node = exp as unknown as acorn.Expression;
  attr.value = {
    type: 'CallExpression',
    callee: node,
    arguments: [
      { type: 'Identifier', name: target, start: node.start, end: node.end, loc: node.loc },
    ],
    optional: false,
    start: node.start,
    end: node.end,
    loc: node.loc,
  } as unknown as acorn.Expression;
}

/**
 * Whether `name` can be written as a bare reference in an expression.
 *
 * Asked of the expression parser rather than answered from a keyword list:
 * these names are read back as `${name}`, so the only authority on what
 * works is the thing that parses that -- and it keeps agreeing with the
 * language as the language moves. `${if}` doesn't parse, `${9lives}` doesn't
 * parse, `${true}` parses as a literal and never reaches the name.
 */
/**
 * What each family's suffix may contain beyond letters, digits and `_`.
 *
 * `plain` is the strict one, because those names are read back as
 * `${name}`. The rest name things markout doesn't own, so the rule is only
 * that the name survives being a compiled value key -- and that `$` stays
 * out, since that prefix is the runtime's.
 */
const NAME_CHARS = {
  plain: '',
  /** CSS class and property names, JS property names */
  dashed: '-',
  /**
   * attribute names and event types, which reach setAttribute and
   * addEventListener exactly as written -- so the charset is the DOM's, and
   * it is wider than dash-case. `data-x.y` and `xlink:href` are legal
   * attributes; Bootstrap fires `shown.bs.modal`, and namespaced
   * `click.mine` is a long-standing convention
   */
  dom: '.:-',
};

function isReferenceable(name: string): boolean {
  try {
    const exp = acorn.parseExpressionAt(name, 0, {
      ecmaVersion: 'latest',
      // the same mode expressions are parsed in, so a name is judged by
      // exactly the rules that will apply where it's used
      sourceType: 'script',
    });
    return exp.type === 'Identifier' && exp.end === name.length;
  } catch (ignored) {
    return false;
  }
}

function validateName(
  page: Page,
  name: any,
  loc?: SourceLocation,
  extra = NAME_CHARS.plain,
  referenced = false
): string {
  name = name ? `${name}` : '';
  // `extra` is one of NAME_CHARS, written so `-` lands last and stays a
  // literal rather than starting a range
  const invalid = new RegExp(`[^a-zA-Z0-9_${extra}]`);
  if (name && !invalid.test(name) && referenced && !isReferenceable(name)) {
    // the character check passes for plenty of things JS won't take as a
    // reference: every reserved word, and anything starting with a digit.
    // They used to declare a value in good order that no expression could
    // ever name -- `:if=${...}` above all, which is what someone arriving
    // from another framework writes first and gets no word about
    addError(
      page,
      `Invalid name: "${name}" is a reserved word or not a JS identifier, ` +
        `so no expression could reference it`,
      loc
    );
    return name;
  }
  if (!name || invalid.test(name)) {
    // recorded, not thrown: an exception escapes the compiler entirely, so
    // the server answers a bad name with a 500 and a stack trace instead of
    // the error page it already knows how to build from page.errors. Loading
    // continues so a page with several bad names reports all of them at
    // once; nothing downstream runs, since the later stages are skipped
    // while page.errors is non-empty
    addError(page, `Invalid name: "${name}"`, loc);
  }
  return name;
}

function addError(page: Page, msg: string, loc?: SourceLocation) {
  page.errors.push({ type: 'error', msg, loc });
}
