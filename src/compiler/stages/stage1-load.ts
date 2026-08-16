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
  FOR_DATA_ATTR,
  FOR_AS_ATTR,
  FOR_KEY_ATTR,
  IF_ATTR,
  IF_VALUE,
  WHEN_USED_ATTR,
  FOR_EACH_VALUE,
  FOR_DATA_VALUE,
  FOR_AS_VALUE,
  FOR_KEY_VALUE,
  FOR_DATA_DEFAULT_NAME,
  DEFINE_DIRECTIVE_TAG,
  LOGIC_DIRECTIVE_TAG,
  LOGIC_BASE_TAG,
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
  SERVER_VALUE_ATTR_PREFIX,
} from '../ir/Page';
import { COMPTIME_PREFIX } from './stage5-comptime';
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
  // expanding anything at all once a definition is based on another one
  // would work on a stencil that is about to be rewritten underneath it
  rejectDerivedDefines(page) || expandCustomTagUsages(page);
  checkLogicPlacement(page);
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

// the moments the runtime knows how to announce -- see CoreScope's lifecycle
const LIFECYCLE_SUFFIXES = new Set([
  `${DID_VALUE_ATTR_PREFIX}init`,
  `${DID_VALUE_ATTR_PREFIX}attach`,
  `${WILL_VALUE_ATTR_PREFIX}detach`,
  `${WILL_VALUE_ATTR_PREFIX}dispose`,
]);

// fixed attribute names that name something other than a declared value, so
// there is nothing for `:server-` to mark on one
const SERVER_REJECTED_ATTRS = new Set([
  IF_ATTR,
  WHEN_USED_ATTR,
  SLOT_TARGET_ATTR,
  SCOPE_NAME_ATTR,
  FOR_EACH_ATTR,
  FOR_DATA_ATTR,
  FOR_AS_ATTR,
  FOR_KEY_ATTR,
]);

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
      if (childEl.tagName === LOGIC_DIRECTIVE_TAG) {
        loadLogic(page, scope, childEl);
        continue;
      }
      if (childEl.tagName === DEFINE_DIRECTIVE_TAG) {
        // <:define> never itself becomes a live scope; expandDefine() moves
        // its content into an inert <template> stencil and returns the
        // (unwrapped) base-tag element, which we load() directly here since
        // template.content is invisible to this function's normal childNodes walk
        const inner = expandDefine(page, childEl);
        if (inner) load(page, scope, inner);
        continue;
      }
      // the stencil the runtime renders from: `:for-each` clones it once
      // per item, `:for-data` shows the one it already has. Neither
      // element is itself a live rendering
      if (needsStencil(childEl)) {
        const stencil = wrapInTemplate(childEl);
        // an OPTIONAL stencil is one whose element may be in the page: both
        // arities of "zero or one" park their element rather than clone it
        (hasAttr(childEl, FOR_DATA_ATTR) || hasAttr(childEl, IF_ATTR)) &&
          page.optionalStencils.add(stencil);
      }
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
    // `:slot` only says where this element goes, and `:when-used` only
    // whether it survives compilation; on their own neither is a reason to
    // give the element a scope (and a data-markout id) it would never use.
    // A `<style :when-used=...>` given one took its own text with it, so the
    // stylesheet rendered empty and its binding had nothing to write to
    if (attr.name === `${SPECIAL_ATTR_PREFIX}${SLOT_TARGET_ATTR}`) continue;
    if (attr.name === `${SPECIAL_ATTR_PREFIX}${WHEN_USED_ATTR}`) continue;
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

/**
 * The two attributes that name something at COMPILE time rather than
 * holding a value: `:aka` and `:slot`.
 *
 * Both are ordinary identifiers rather than reserved words, which is a
 * deliberate trade -- `:aka` and `:slot` say what they mean and no reserved
 * word does -- and the price is that a page cannot declare values of those
 * names. That price is only worth paying if taking the name is loud:
 * `:slot=${x}` used to stringify the expression into a slot target and
 * address `[object Object]`, which matched no slot and dropped the content
 * in silence.
 *
 * Neither could work as an expression anyway. A scope's name is resolved by
 * the compiler, and which slot content fills is decided while the tree is
 * being assembled -- long before anything is evaluated.
 */
function literalOnly(
  page: Page,
  attr: ServerAttribute,
  attrName: string,
  what: string
): boolean {
  if (!isDynamic(attr)) {
    return true;
  }
  addError(
    page,
    `"${SPECIAL_ATTR_PREFIX}${attrName}" takes a literal ${what}, not an ` +
      `expression: it is resolved when the page is compiled, so there is ` +
      `nothing to evaluate it against`,
    attr.valueLoc ?? attr.loc
  );
  return false;
}

/**
 * Whether this element's own markup has to be kept out of the live tree.
 *
 * True of both replication families, for the same reason and with different
 * arities: `:for-each` renders zero or more copies of it, `:for-data` zero
 * or one. Either way what the compiler emits is a stencil rather than a
 * rendering, and the runtime decides how many times it appears.
 */
function needsStencil(e: ServerElement): boolean {
  return hasAttr(e, FOR_EACH_ATTR) || hasAttr(e, FOR_DATA_ATTR) || hasAttr(e, IF_ATTR);
}

function hasAttr(e: ServerElement, name: string): boolean {
  const full = `${SPECIAL_ATTR_PREFIX}${name}`;
  return (e.attributes as ServerAttribute[]).some(attr => attr.name === full);
}

function wrapInTemplate(e: ServerElement): ServerElement {
  const parent = e.parentElement!;
  const template = new ServerTemplateElement(e.ownerDocument, e.loc);
  parent.insertBefore(template, e);
  parent.removeChild(e);
  template.appendChild(e);
  return template;
}

/** attribute families that need an element, and so cannot go on `<:logic>` */
const LOGIC_FORBIDDEN_PREFIXES: [string, string][] = [
  [CLASS_VALUE_ATTR_PREFIX, 'a class to put it on'],
  [STYLE_VALUE_ATTR_PREFIX, 'a style to put it on'],
  [EVENT_VALUE_ATTR_PREFIX, 'an element to listen to'],
  [PRESENCE_VALUE_ATTR_PREFIX, 'an attribute to set'],
  [PROP_VALUE_ATTR_PREFIX, 'a DOM property to set'],
];
const LOGIC_FORBIDDEN_ATTRS: [string, string][] = [
  [FOR_EACH_ATTR, 'nothing to replicate'],
  [FOR_DATA_ATTR, 'nothing to show or hide'],
  [FOR_AS_ATTR, 'nothing to replicate'],
  [FOR_KEY_ATTR, 'nothing to replicate'],
  [IF_ATTR, 'nothing to show or hide'],
  [SLOT_TARGET_ATTR, 'no markup to put in a slot'],
  [WHEN_USED_ATTR, 'nothing to keep or drop'],
];

/**
 * `<:logic>`: values, and nothing else.
 *
 * It becomes a scope like any other and then its element goes, which is the
 * whole point -- the runtime has always allowed a scope with no DOM (see
 * WebScope.init, which returns early for exactly this), so nothing about
 * being live requires one. What required one was the compiler, which only
 * knew how to hang values off markup.
 *
 * A name is optional. Its values are then reachable from nowhere, which
 * sounds useless and is not: `:did-init` and `:handle-` are declarations of
 * behaviour rather than of data, and a block that starts a timer or reacts
 * to a value elsewhere has no reason to be referred to by anyone.
 */
function loadLogic(page: Page, parent: Scope, e: ServerElement): void {
  rejectElementish(page, e, `<${LOGIC_DIRECTIVE_TAG.toLowerCase()}>`);
  const scope = new Scope(page, parent, e);
  // taken down now, while the element is still in the tree: what it was
  // written inside is the one thing removing it destroys
  const ancestors: string[] = [];
  for (let up = e.parentElement; up; up = up.parentElement) {
    ancestors.push(up.tagName.toLowerCase());
  }
  page.logicScopes.set(scope, ancestors);
  extractValues(page, scope, e);
  e.parentElement?.removeChild(e);
}

/**
 * Refuses everything that needs an element to apply to, and any content.
 *
 * Shared by `<:logic>` and by a `tag="x:logic"` definition, which are the
 * same construct at two scales -- one a scope with no element, the other a
 * tag whose instances are. A rule that held for one and not the other would
 * be a rule about spelling rather than about what these things are.
 */
function rejectElementish(page: Page, e: ServerElement, what: string): void {
  for (const [prefix, why] of LOGIC_FORBIDDEN_PREFIXES) {
    const found = e.getAttributeNames().find(n => n.startsWith(`${SPECIAL_ATTR_PREFIX}${prefix}`));
    found && addError(page, `${what} has no element, so "${found}" has ${why}`, e.loc);
  }
  for (const [attr, why] of LOGIC_FORBIDDEN_ATTRS) {
    hasAttr(e, attr) && addError(page, `${what} has no element, so ":${attr}" has ${why}`, e.loc);
  }
  for (const name of e.getAttributeNames()) {
    name.startsWith(SPECIAL_ATTR_PREFIX) ||
      name === DEFINE_TAG_ATTR ||
      addError(page, `${what} has no element, so the plain attribute "${name}" has nowhere to go`, e.loc);
  }
  // Nothing inside it. Markup would need an element to live in and there is
  // none; nesting would work and is deliberately left out, since a construct
  // is easier to open up later than to close down
  const child = e.childNodes.find(
    n =>
      n.nodeType === NodeType.ELEMENT ||
      typeof (n as ServerText).textContent !== 'string' ||
      `${(n as ServerText).textContent}`.trim() !== ''
  );
  child && addError(page, `${what} holds values, not markup -- it cannot have content`, e.loc);
}

/**
 * Where a `<:logic>` may sit.
 *
 * Not in anything replicated or conditional, and not inside a definition or
 * a slot. Each of those makes a declaration that reads as one-per-page into
 * one-per-item, one-per-instance, or one that comes and goes -- and a timer
 * started per row, or a name registered by twenty instances at once, is not
 * something to discover at runtime. Every one of them is a coherent feature
 * on its own; none of them is this one.
 *
 * Checked here rather than in loadLogic because none of it is known yet
 * while loading: a usage site is expanded afterwards, and a definition's
 * body is loaded before the page that uses it.
 */
function checkLogicPlacement(page: Page): void {
  for (const [scope, ancestors] of page.logicScopes) {
    let s: Scope | undefined = scope.parent;
    let why = ancestors.some(tag => page.customTags.has(tag))
      ? 'inside a custom tag, where it would belong to the call site'
      : undefined;
    while (s && !why) {
      if (s.values.has(FOR_EACH_VALUE)) why = 'inside a ":for-each", which would declare it once per item';
      else if (s.values.has(FOR_DATA_VALUE)) why = 'inside a ":for-data", which would take it away again';
      else if (s.values.has(IF_VALUE)) why = 'inside an ":if", which would take it away again';
      else if (page.definitionScopes.has(s)) why = 'inside a "<:define>", which would declare it once per instance';
      else if (s.slotted) why = 'inside a slot, where it would belong to the call site';
      s = s.parent;
    }
    why && addError(page, `<${LOGIC_DIRECTIVE_TAG.toLowerCase()}> cannot go ${why}`, scope.e?.loc);
  }
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

  // A definition is a kind of tag, not a thing on the page, so there is
  // nothing here for a name to refer to. Left alone it was copied onto the
  // base element and then dropped -- so `:aka` on a <:define> named nothing,
  // every use of that name failed to resolve, and the attribute that caused
  // it looked like the one thing that should have worked. Instances are
  // named where they are USED, which is also the only place a name can mean
  // one of them rather than all of them
  if (defineEl.getAttribute(`${SPECIAL_ATTR_PREFIX}${SCOPE_NAME_ATTR}`) !== null) {
    addError(
      page,
      `<${DEFINE_DIRECTIVE_TAG.toLowerCase()}> cannot carry ":${SCOPE_NAME_ATTR}": a ` +
        `definition is a tag rather than an element on the page, and every ` +
        `instance of it would answer to the one name. Put ":${SCOPE_NAME_ATTR}" on a ` +
        `usage site instead`,
      defineEl.loc
    );
    return undefined;
  }

  // `tag="x:logic"`: the instances have no element, so there is nothing to
  // stamp them out of. The base element is still built -- it is what carries
  // the declarations into extractValues -- but it is never put anywhere, so
  // the runtime's stencil lookup finds nothing and WebScope.init takes the
  // same no-DOM path a `<:logic>` scope takes (acquireUsageDom already
  // answers `undefined`, which is why none of this needed runtime changes)
  const elementless = baseTag.toLowerCase() === LOGIC_BASE_TAG;
  // against the SOURCE element, before the base tag is built: that copy
  // carries a class attribute and the name marker this stage adds itself,
  // and refusing the compiler's own bookkeeping would be an odd way to
  // greet someone who wrote nothing wrong
  elementless &&
    rejectElementish(
      page,
      defineEl,
      `<${DEFINE_DIRECTIVE_TAG.toLowerCase()} ${DEFINE_TAG_ATTR}="${customName}:${LOGIC_BASE_TAG}">`
    );
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

  if (elementless) {
    page.elementlessTags.add(customName);
    defineEl.parentElement?.removeChild(defineEl);
    // no template, so nothing for stage6 to drop and nothing in the served
    // page; `inner` stays detached, purely as the carrier of the values
    return inner;
  }

  const template = new ServerTemplateElement(doc, defineEl.loc);
  const parent = defineEl.parentElement!;
  parent.insertBefore(template, defineEl);
  parent.removeChild(defineEl);
  template.appendChild(inner);
  // noted now because it cannot be found later: appendChild on a template
  // moves the child onto its content fragment and nulls its parentElement
  page.defineStencils.set(customName, template);
  return inner;
}

/**
 * Refuses a `<:define>` whose base tag is another definition.
 *
 * `tag="my-card:my-box"` reads like specialization, and markout has no such
 * thing: a definition's base tag has to be a real element. What it did
 * instead was worse than refusing it. `expandDefine` leaves the base tag as
 * an ELEMENT inside the new stencil, so `<my-box>` in there is an ordinary
 * usage site -- expandCustomTagUsages finds it, expands it, and replaces the
 * very element `page.customTags` had just registered `my-card` against. The
 * page then compiled clean, rendered clean, and showed nothing where the
 * usages were.
 *
 * Reported here rather than in expandDefine because that runs mid-load,
 * when `customTags` holds only the definitions seen so far -- and a
 * definition may be written after its base, or imported from another file.
 *
 * @returns whether anything was refused
 */
function rejectDerivedDefines(page: Page): boolean {
  let found = false;
  for (const [name, scope] of page.customTags) {
    const base = scope.e?.tagName.toLowerCase();
    if (!base || !page.customTags.has(base)) continue;
    found = true;
    addError(
      page,
      `<${DEFINE_DIRECTIVE_TAG.toLowerCase()} ${DEFINE_TAG_ATTR}="${name}:${base}"> is ` +
        `based on <${base}>, which is itself a definition -- a base tag has to be a ` +
        `real element. Define <${name}> on a plain tag and put <${base}> inside it`,
      scope.e?.loc
    );
  }
  return found;
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
    const tagName = usageEl.tagName.toLowerCase();
    page.usedTags.add(tagName);
    const defScope = page.customTags.get(tagName)!;
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
    // rather than against the instance it happens to sit inside.
    //
    // Only when it sits DIRECTLY in that slot, though -- `scope.parent`
    // is the host itself exactly when nothing in between has a scope of its
    // own. Slotted content is a whole subtree, and a scope inside it is
    // already relocated (see slotUsage), so a usage nested under one resolves
    // against THAT, normally. Marking it slotted too made it skip straight
    // past to the outer call site, losing everything the slotted markup
    // declared on the way -- `<my-box><div :total=${x}><my-probe
    // :count=${total}/></div></my-box>` compiled clean and then failed to
    // link `total` at runtime
    const host = slottedHost(page, usageEl);
    if (loadedUsageScope?.slotted) {
      scope.slotted = true;
      scope.lexicalParent = loadedUsageScope.lexicalParent;
    } else if (host && scope.parent === host) {
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
      loadedUsageScope.detachedUsageSite = true;
    }

    // read now, not when the usage was collected: expanding an outer usage
    // moves its slotted content into that instance's stencil, so an inner
    // usage is very often no longer where it was found. `parentNode` rather than
    // `parentElement` because a `:for-each` usage has been wrapped in a
    // <template> by this point, and a fragment's children have no
    // parentElement -- which is where this used to throw
    const parent = usageEl.parentNode!;
    if (page.elementlessTags.has(tagName)) {
      // a marker is a place for an element to arrive; this instance has
      // none, so leaving one would litter the page with comments nothing
      // ever replaces
      parent.removeChild(usageEl);
      continue;
    }
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
  const slotOf = (n: ServerNode): string =>
    n.nodeType === NodeType.ELEMENT
      ? page.slotTargets.get(n as ServerElement) ?? DEFAULT_SLOT_NAME
      : DEFAULT_SLOT_NAME;

  // Each child paired with the slot it fills, blank text included where it
  // is doing work.
  //
  // Blank text used to be filtered out wholesale, which is right for the
  // indentation around a usage site and wrong for the space BETWEEN two
  // pieces that end up side by side in the same slot: that one is rendered,
  // and dropping it ran `<span>a</span> <span>b</span>` together. So a blank
  // node travels only when the nearest non-blank nodes on either side of it
  // address the same slot. Leading and trailing blanks stay behind (a
  // container doesn't render those), and a blank between differently-
  // addressed pieces separates two nodes that are about to be pulled apart
  // anyway.
  const addressed: [ServerNode, string][] = [];
  let pending: ServerNode[] = [];
  let prev: string | undefined;
  for (const child of [...usageEl.childNodes] as ServerNode[]) {
    if (isBlankText(child)) {
      prev !== undefined && pending.push(child);
      continue;
    }
    const name = slotOf(child);
    prev === name && addressed.push(...pending.map(n => [n, name] as [ServerNode, string]));
    pending = [];
    prev = name;
    addressed.push([child, name]);
  }
  if (!addressed.length) return defScope.id;
  const children = addressed.map(([child]) => child);

  const defEl = defScope.e!;
  const defSlots = findSlots(page, defEl);
  // grouped by the slot each child addresses; anything unaddressed fills the
  // default one, which is also where every text node goes
  const groups = new Map<string, ServerNode[]>();
  for (const [child, name] of addressed) {
    groups.set(name, [...(groups.get(name) ?? []), child]);
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

  // the PAGE's document, not `usageEl.ownerDocument`. A usage site written
  // inside an imported file still belongs to that file's document, whose
  // root is its `<lib>` and which has no <head> at all -- so the append
  // below dropped the stencil into a document nobody serves, and the
  // instance came up with no DOM: "unbound binding: no element to set ... on"
  // at runtime, with the element simply missing from the page. Everything
  // else here inserts relative to a node already spliced into the page
  // (expandDefine's insertBefore, the markers), which is why this is the one
  // place the owning document could differ and matter
  const doc = page.source.doc;
  const stencil = defEl.clone(doc, null) as ServerElement;
  // `${scope.id}t` rather than a scope id: this is a stencil, not a scope,
  // and it only has to be unique among data-markout values so
  // WebContext.findElementById() can tell it from the definition's own
  const stencilId = `${scope.id}t`;
  stencil.setAttribute(DOM_ID_ATTR, stencilId);

  const slots = findSlots(page, stencil);
  // the definition's own scopes inside a slot that got filled: their markup
  // was just replaced, so the instance must not carry values still pointing
  // at it (see rehomeSlottedText for the text half of the same problem)
  const slotEls = [...groups.keys()].map(
    name => defSlots.get(name)!.el as unknown as ServerNode
  );
  const filled = descendantsOf(slotEls);
  // A usage written in a slot's FALLBACK was expanded before this ran, so
  // what stands in the markup is its `-u<id>` marker rather than its tag,
  // and the scope it left behind is matched by that marker or not at all.
  // Missed, it stayed on an instance whose fallback had just been replaced:
  // a component with nothing to render, reporting every one of its bindings
  // unbound -- while the same component in the next instance, which took the
  // fallback, worked.
  const usages = new Set<string>();
  filled.forEach(n => {
    const node = n as ServerComment;
    if (node.nodeType !== NodeType.COMMENT) return;
    const text = `${node.textContent}`;
    text.startsWith(DOM_USE_MARKER) && usages.add(text.slice(DOM_USE_MARKER.length));
  });
  const dropped = (s: Scope): boolean =>
    (!!s.e && filled.has(s.e)) || usages.has(s.id);
  scope.children = scope.children.filter(child => !dropped(child));
  const slotHosts = new Map<string, ServerElement>();
  for (const [name, nodes] of groups) {
    const target = slots.get(name)!.el;
    const host = target.parentElement!;
    slotHosts.set(name, host);
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
  const callScope = loadedUsageScope ?? scope.parent!;
  rehomeSlottedText(defScope, scope, callScope, stencil, children as ServerNode[]);
  // and the same for any definition scope BETWEEN the instance and a slot
  // this usage filled: its territory changed too, and it is shared with
  // every other usage until this gives this one a copy of its own
  scope.children = rehomeNestedScopes(
    page,
    scope.children,
    slotEls,
    dropped,
    scope,
    stencil,
    callScope,
    children as ServerNode[]
  );
  // last, because it is the copies above that slotted markup lands inside
  adoptSlottedScopes(page, scope, stencilId, groups, slotHosts);
  return stencilId;
}

/**
 * Re-parents each slotted scope to the scope whose ELEMENT now contains it.
 *
 * The scope tree is what the runtime searches to find a scope's element: it
 * looks within its parent's element and stops at any nested scope's, so a
 * scope has to sit under whichever one owns the markup around it. Slotted
 * content went under the instance regardless, which is right only while the
 * `<:slot>` sits in the definition's outermost element.
 *
 * Put anything between them -- and one `:class-` is enough to make an
 * element a scope -- and the search reached that element, declined to
 * descend into another scope's territory, and came back with nothing. Every
 * binding in the slotted markup then reported itself unbound, which is loud,
 * and a `:for-each` in there rendered no replicas at all, which is not: the
 * region simply came out empty.
 *
 * Resolution is untouched. `lexicalParent` still points at the call site, so
 * what moves is only where the markup is looked for, never what its names
 * mean.
 */
function adoptSlottedScopes(
  page: Page,
  scope: Scope,
  stencilId: string,
  groups: Map<string, ServerNode[]>,
  slotHosts: Map<string, ServerElement>
): void {
  const byId = (from: Scope, id: string): Scope | undefined => {
    for (const child of from.children) {
      if (child.id === id) return child;
      const found = byId(child, id);
      if (found) return found;
    }
    return undefined;
  };
  for (const [name, nodes] of groups) {
    // the element the slot's content was inserted into, which is where the
    // markup now lives -- not the slotted node's own parent, which for a
    // replicated one is a <template>'s content and no element at all
    let owner = slotHosts.get(name) as ServerElement | null | undefined;
    while (owner && owner.getAttribute(DOM_ID_ATTR) === null) {
      owner = owner.parentElement as ServerElement | null;
    }
    const id = owner?.getAttribute(DOM_ID_ATTR);
    // the stencil's own root carries the instance's stencil id, which means
    // the markup landed directly in the instance -- where it already is
    if (id == null || `${id}` === stencilId) continue;
    const target = byId(scope, `${id}`);
    if (!target) continue;
    for (const child of outermostScopesIn(page, nodes)) {
      if (child.parent === target) continue;
      const index = child.parent!.children.indexOf(child);
      index >= 0 && child.parent!.children.splice(index, 1);
      child.parent = target;
      target.children.push(child);
    }
  }
}

/**
 * Text that is nothing but the whitespace HTML uses for formatting.
 *
 * The ASCII whitespace set rather than `.trim()`, which also strips U+00A0:
 * an author's deliberate `&nbsp;` is content, and reading it as blank threw
 * it away along with the indentation.
 */
function isBlankText(n: ServerNode): boolean {
  if (n.nodeType !== NodeType.TEXT) return false;
  return !/[^ \t\n\r\f]/.test(`${(n as ServerText).textContent}`);
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
  fromScope: Scope,
  scope: Scope,
  callScope: Scope,
  stencil: ServerElement,
  moved: ServerNode[],
): boolean {
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
  // whether any of what this scope took over was written at the usage site
  let claimed = false;
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
        : fromScope.textValues.get(
            // a clone of one of the definition's own still carries the id it
            // had there, which is the key it kept in the definition
            `${TEXT_VALUE_PREFIX}${marker.textContent.slice(DOM_TEXT_MARKER1.length)}`
          );
    if (!value) {
      // renumbered even so: the ids this scope hands out have to stay unique
      // within its own territory whether or not every marker gets a value
      marker.textContent = `${DOM_TEXT_MARKER1}${id}`;
      continue;
    }
    marker.textContent = `${DOM_TEXT_MARKER1}${id}`;
    claimed ||= fromCallSite !== undefined;
    textValues.set(key, value);
    if (fromCallSite !== undefined) {
      scope.callSiteValues.add(key);
      callScope.textValues.delete(fromCallSite);
    }
  }
  scope.textValues = textValues;
  return claimed;
}

/**
 * Per-usage copies of the definition scopes whose markup this usage changed.
 *
 * An instance's children start out as the definition's own scope objects,
 * shared with every other instance -- which is right exactly as long as the
 * markup is shared too. Filling a slot ends that: the scope CONTAINING the
 * slot keeps text values pointing at a fallback this stencil no longer has,
 * and rebuilding them on the shared scope would rewrite it for every other
 * usage as well. Left alone it is the quietest kind of failure -- the page
 * compiles, and one binding reports "no text node carrying that marker id"
 * at runtime while a sibling usage of the same component works fine.
 *
 * So each such scope is copied, and its text rehomed against this stencil,
 * exactly as the instance's own is. The id is deliberately kept: the
 * stencil's element still carries it, and the runtime finds a scope's
 * element by searching its parent's subtree, so two instances holding the
 * same id never collide.
 *
 * Only scopes around a filled slot are copied. Everything else goes on being
 * shared, which is what keeps a component with many usages cheap.
 */
function rehomeNestedScopes(
  page: Page,
  children: Scope[],
  slotEls: ServerNode[],
  dropped: (s: Scope) => boolean,
  parent: Scope,
  stencil: ServerElement,
  callScope: Scope,
  moved: ServerNode[]
): Scope[] {
  return children.map(child => {
    if (!child.e) return child;
    const within = descendantsOf([child.e as unknown as ServerNode]);
    if (!slotEls.some(el => within.has(el))) return child;
    const el = findByScopeId(stencil, child.id);
    if (!el) return child;

    const copy = new Scope(page, undefined, el, child.name);
    copy.id = child.id;
    copy.parent = parent;
    copy.lexicalParent = child.lexicalParent;
    copy.slotted = child.slotted;
    copy.usesTemplate = child.usesTemplate;
    copy.attributes = child.attributes;
    copy.callSiteValues = child.callSiteValues && new Set(child.callSiteValues);
    // shared: a Value resolves against the scope it was WRITTEN in, which is
    // still the definition's. Only the text, which is bound by position in
    // markup this usage has changed, has to be rebuilt
    copy.values = child.values;
    copy.textCount = child.textCount;
    copy.children = rehomeNestedScopes(
      page,
      child.children.filter(c => !dropped(c)),
      slotEls,
      dropped,
      copy,
      stencil,
      callScope,
      moved
    );
    // text written between the tag's tags can land in here, and a binding
    // belongs to the scope whose territory holds its node. It still
    // resolves out at the call site, which is what the flag says
    copy.slottedText = rehomeSlottedText(child, copy, callScope, el, moved);
    return copy;
  });
}

/** an element in this stencil by the scope id it carries */
function findByScopeId(root: ServerElement, id: string): ServerElement | undefined {
  if (root.getAttribute(DOM_ID_ATTR) === id) return root;
  const children =
    root.tagName === 'TEMPLATE'
      ? (root as ServerTemplateElement).content.childNodes
      : root.childNodes;
  for (const child of children) {
    if (child.nodeType !== NodeType.ELEMENT) continue;
    const found = findByScopeId(child as ServerElement, id);
    if (found) return found;
  }
  return undefined;
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
 * both replication families -- a slot in there is reported rather than
 * missed, so a usage trying to fill it gets told what's actually wrong.
 *
 * Only a `:for-each` stencil counts as replicated. A `:for-data` one holds
 * the single copy it will ever have and never clones it, so the scopes
 * behind a slot inside it have nobody to fight with.
 */
function findSlots(
  page: Page,
  e: ServerElement,
  into = new Map<string, SlotSite>(),
  inLoop = false
): Map<string, SlotSite> {
  const isStencil = e.tagName === 'TEMPLATE' && !page.optionalStencils.has(e);
  const children =
    e.tagName === 'TEMPLATE'
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
    findSlots(page, el, into, inLoop || isStencil);
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
    const scope = e !== usageEl ? findScopeForElement(page.main, e) : undefined;
    if (scope) return scope;
    // after the scope lookup, not before it: a slotted element can have a
    // scope of its own (`<my-box><div :total=${x}>...`), and that scope is
    // the enclosing one for anything under it. Falling back to the host
    // instead skipped it entirely. Still needed as a fallback, since a node
    // with no scope of its own now lives in a stencil clone that no scope's
    // element points at, so the lookup above can't reach it
    const host = page.slottedInto.get(e);
    if (host) return host;
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
    // `:server-` is a modifier, not a family of its own: strip it up front so
    // the rest of the name parses exactly as it would without it, and what it
    // marks stays an ordinary value
    let serverOnly = false;
    if (name.startsWith(SERVER_VALUE_ATTR_PREFIX)) {
      serverOnly = true;
      name = name.slice(SERVER_VALUE_ATTR_PREFIX.length);
    }
    // the fixed attribute names below don't declare values at all, so there
    // is nothing for "runs on the server only" to mean on one
    if (serverOnly && SERVER_REJECTED_ATTRS.has(name)) {
      addError(
        page,
        `"${SPECIAL_ATTR_PREFIX}${SERVER_VALUE_ATTR_PREFIX}${name}" is not a value: ` +
          `"${SPECIAL_ATTR_PREFIX}${SERVER_VALUE_ATTR_PREFIX}" marks a declared value ` +
          `as server-only`,
        attr.loc
      );
      continue;
    }
    if (name === SLOT_TARGET_ATTR) {
      // addressed to a slot, not a value of its own: kept aside here because
      // the `:` attributes are stripped at the end of this function, long
      // before expandCustomTagUsages() gets to read it
      if (!literalOnly(page, attr, SLOT_TARGET_ATTR, 'slot name')) continue;
      page.slotTargets.set(e, `${attr.value ?? ''}`);
      continue;
    }
    if (name === SCOPE_NAME_ATTR) {
      if (scope.name) {
        addError(page, `Cannot redefine scope name: "${scope.name}"`, attr.loc);
        continue;
      }
      if (!literalOnly(page, attr, SCOPE_NAME_ATTR, 'name')) continue;
      scope.name = validateName(page, attr.value, attr.valueLoc, NAME_CHARS.plain, true);
      continue;
    }
    if (name === FOR_EACH_ATTR) {
      scope.values.set(FOR_EACH_VALUE, new Value(FOR_EACH_VALUE, attr, scope, page.createValueId()));
      continue;
    }
    if (name === WHEN_USED_ATTR) {
      // recorded here, before the family dispatch would read `when-` as a
      // prefix and refuse `used` for the dash. Build-time only: stage6 keeps
      // or drops the element and nothing of this reaches the runtime
      if (!literalOnly(page, attr, WHEN_USED_ATTR, 'list of tag names')) continue;
      const tags = `${attr.value ?? ''}`.split(/\s+/).filter(t => t).map(t => t.toLowerCase());
      tags.length
        ? page.whenUsed.set(e, tags)
        : addError(page, `"${SPECIAL_ATTR_PREFIX}${WHEN_USED_ATTR}" needs at least one tag name`, attr.loc);
      continue;
    }
    if (name === IF_ATTR) {
      // before the family dispatch, which would send it through
      // validateName and refuse it for being a reserved word -- which is
      // exactly why the name was free to take
      scope.values.set(IF_VALUE, new Value(IF_VALUE, attr, scope, page.createValueId()));
      continue;
    }
    if (name === FOR_DATA_ATTR) {
      scope.values.set(FOR_DATA_VALUE, new Value(FOR_DATA_VALUE, attr, scope, page.createValueId()));
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
    const before = page.errors.length;
    const suffix = validateName(page, name.slice(prefix.length), loc, extra, referenced);
    const named = page.errors.length === before;
    // the lifecycle families are closed, unlike the element-facing ones:
    // their suffixes name moments the runtime knows about rather than
    // anything out in the DOM, so a misspelling has nothing to attach to.
    // Left open it would compile and simply never run, which is the worst
    // way for a callback to fail
    if (
      named &&
      (prefix === DID_VALUE_ATTR_PREFIX || prefix === WILL_VALUE_ATTR_PREFIX) &&
      !LIFECYCLE_SUFFIXES.has(`${prefix}${suffix}`)
    ) {
      addError(
        page,
        `Unknown lifecycle callback "${SPECIAL_ATTR_PREFIX}${prefix}${suffix}": ` +
          `expected one of ${[...LIFECYCLE_SUFFIXES]
            .map(n => `"${SPECIAL_ATTR_PREFIX}${n}"`)
            .join(', ')}`,
        loc
      );
      continue;
    }
    // every family here either derives from a value (`:attr-`, `:class-`,
    // `:style-`, `:prop-`) or holds a function (`:on-`, `:did-`, `:will-`,
    // `:handle-`). The first four re-derive correctly on the client once the
    // value they read is marked, so marking them too would send the same fact
    // twice; the last four don't serialize and are browser-only besides
    if (serverOnly && compiledPrefix) {
      addError(
        page,
        `"${SPECIAL_ATTR_PREFIX}${SERVER_VALUE_ATTR_PREFIX}" cannot be combined with ` +
          `"${SPECIAL_ATTR_PREFIX}${prefix}": mark the value it reads instead`,
        loc
      );
      continue;
    }
    // a `k_` value is substituted into its readers by stage5 and never
    // reaches the runtime as a cell, so there is nothing left for the
    // server to send
    if (serverOnly && suffix.startsWith(COMPTIME_PREFIX)) {
      addError(
        page,
        `"${SPECIAL_ATTR_PREFIX}${SERVER_VALUE_ATTR_PREFIX}${suffix}" is both ` +
          `compile-time and server-only: a "${COMPTIME_PREFIX}" value is ` +
          `substituted into its readers, so nothing of it exists to send`,
        loc
      );
      continue;
    }
    name = compiledPrefix + suffix;
    prefix === HANDLE_VALUE_ATTR_PREFIX && desugarHandler(attr, suffix);
    const value = new Value(name, attr, scope, page.createValueId());
    value.serverOnly = serverOnly;
    scope.values.set(name, value);
  }
  // both families are now scope values: leaving them behind would serialize
  // an expression object as an empty attribute, which the runtime would then
  // immediately overwrite anyway
  e.attributes = e.attributes.filter(
    attr => !attr.name.startsWith(SPECIAL_ATTR_PREFIX) && !isDynamic(attr as ServerAttribute)
  );
  if (scope.values.has(FOR_EACH_VALUE) || scope.values.has(FOR_DATA_VALUE)) {
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
