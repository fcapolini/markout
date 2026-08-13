import {
  Comment,
  Document,
  Element,
  Node,
  NodeList,
  NodeType,
  TemplateElement,
  Text,
} from '../../html/dom';
import { CoreScope, CoreScopeProps, cloneId } from '../core/core-scope';
import { CoreValue, CoreValueProps } from '../core/core-value';
import {
  DOM_ATOMIC_TEXT_TAGS,
  DOM_ID_ATTR,
  DOM_TEXT_MARKER1,
  WebContext,
  WebContextProps,
} from './web-context';

export const RT_ATTR_VALUE_PREFIX = 'attr$';
/** `:prop-x`: the element's JS property, for what an attribute can't carry */
export const RT_PROP_VALUE_PREFIX = 'prop$';
/** `:attr-x`: presence of the attribute, not its value */
export const RT_PRESENCE_VALUE_PREFIX = 'flag$';
export const RT_CLASS_VALUE_PREFIX = 'class$';
export const RT_STYLE_VALUE_PREFIX = 'style$';
export const RT_TEXT_VALUE_PREFIX = 'text$';
export const RT_EVENT_VALUE_PREFIX = 'event$';
export const RT_HANDLE_VALUE_PREFIX = 'handle$';
/**
 * `$dom`: this scope's own element, for the imperative corner a projection
 * can't reach -- `focus()`, `showModal()`, `play()`. The only door from an
 * expression to the view, which is what keeps such access greppable.
 */
export const RT_DOM_VALUE_KEY = '$dom';

export class WebScope extends CoreScope {
  // `declare`: init() (invoked from within CoreScope's constructor, i.e.
  // during super()) sets these; a real class field would instead
  // re-initialize them to undefined right after super() returns
  declare dom: Element;
  /** interpolated text nodes of this scope's own territory, by marker id */
  declare texts: Map<number, Text>;
  declare domListeners?: { name: string; listener: EventListener }[];
  // the <template> this scope's stencil lives inside, if any -- also set
  // during init(), so it needs the same `declare` treatment as above
  declare templateEl?: Element;
  // set by clone() right before constructing a new clone scope, so that
  // clone's own init() (running during its super()) can pick up the DOM
  // node clone() already resolved for it; not itself touched during any
  // super() call, so it needs no such declare treatment
  private pendingCloneDom?: Element;
  // an SSR-hydrating page has real elements pre-rendered for however many
  // replicas it rendered; a client-only mount never does. Since SSR always
  // renders a contiguous prefix, the first replica acquireCloneDom() can't
  // find already means every later one in this host's lifetime won't either
  // -- see acquireCloneDom for why that matters
  private noMoreHydratedClones = false;

  constructor(props: CoreScopeProps, context: WebContext, parent?: CoreScope) {
    super(props, context, parent);
  }

  override init() {
    super.init();
    this.texts = new Map();
    const templateId = this.props.template;
    const view = this.cloned
      ? (this.parent as WebScope)?.pendingCloneDom
      : templateId
        ? this.acquireUsageDom(templateId)
        : this.lookupView(this.parent instanceof WebScope ? this.parent.dom : undefined);
    // set even when there is no element, and never inherited: answering with
    // an ANCESTOR's element would be the plausible-but-wrong kind of failure
    // that is hardest to notice (the same reason $id is unconditional).
    // Browser-only, like `:prop-`: a served page has no element to drive,
    // and a ServerElement would field method calls it does not have
    if (!(this.ctx.props as WebContextProps).server) {
      this.values[RT_DOM_VALUE_KEY] = new CoreValue({ val: view }, this, RT_DOM_VALUE_KEY);
    }
    if (!view) {
      // Root scope or other scopes without corresponding DOM elements
      // should not try to perform DOM operations
      return;
    }
    this.dom = view;
    // keyed by the id the marker carries, never by how many came before it:
    // a text node's binding must not depend on the document order of its
    // siblings, or anything that inserts or moves markup within a scope's
    // territory (slotted content, most of all) silently shifts every
    // binding after it onto the wrong node
    const f = (e: Element) => {
      const childNodes = [...e.childNodes];
      childNodes.forEach((n, i) => {
        if (n.nodeType === NodeType.ELEMENT && (n as Element).getAttribute(DOM_ID_ATTR) === null) {
          if (!DOM_ATOMIC_TEXT_TAGS.has((n as Element).tagName)) {
            f(n as Element);
          }
          return;
        }
        if (
          n.nodeType !== NodeType.COMMENT ||
          !(n as Comment).textContent.startsWith(DOM_TEXT_MARKER1)
        ) {
          return;
        }
        const id = Number.parseInt((n as Comment).textContent.slice(DOM_TEXT_MARKER1.length));
        const next = childNodes[i + 1];
        // an atomic-text container (<style>/<title>) can't hold the marker
        // inside it, so the marker sits just before the element and the
        // binding target is its one text child
        if (
          next?.nodeType === NodeType.ELEMENT &&
          DOM_ATOMIC_TEXT_TAGS.has((next as Element).tagName)
        ) {
          const target = (next as Element).childNodes[0];
          target?.nodeType === NodeType.TEXT && this.texts.set(id, target as Text);
          return;
        }
        // otherwise the interpolation's own text node sits between the two
        // markers -- except when there is none to sit there. An interpolation
        // that rendered empty serializes to nothing at all, so what the
        // browser parses back is the marker pair side by side. Every clone
        // stamped from a <template> stencil begins like that (a stencil is
        // never bound to data), which is why a `:for-each` that shrinks and
        // grows again comes back with dead text bindings. Materializing the
        // missing node costs one empty Text and keeps the binding live
        this.texts.set(
          id,
          next?.nodeType === NodeType.TEXT
            ? (next as Text)
            : (e.insertBefore(
                (this.ctx.props as WebContextProps).doc.createTextNode(''),
                next ?? null
              ) as Text)
        );
      });
    };
    f(this.dom);
  }

  /**
   * A usage instance sits where the tag was written, so its element and its
   * marker are looked for within its container's own subtree -- the same
   * containment rule lookupView() uses, and what lets one usage site inside
   * a `:for-each` become a separate instance per replica, each finding its
   * own marker rather than racing for one document-wide match.
   *
   * The <:define> stencil is the exception: it lives in <head>, nowhere near
   * the usage, so that lookup stays document-wide.
   */
  private acquireUsageDom(templateId: string): Element | undefined {
    const ctx = this.ctx as WebContext;
    const id = `${this.props.id}`;
    const within = this.parent instanceof WebScope ? this.parent.dom : undefined;
    const existing = ctx.findElementById(id, within);
    // a `:for-each` on the tag leaves this instance sitting in a stencil, and
    // acquireCloneDom needs to know which one. Undefined for an ordinary
    // usage, which is what it has always been
    if (existing) {
      this.templateEl = ctx.foundInTemplate;
      return existing;
    }

    const stencil = ctx.findElementById(templateId);
    const marker = ctx.findUseMarker(id, within);
    const inTemplate = ctx.foundInTemplate;
    if (!stencil || !marker) return undefined;

    const node = stencil.cloneNode(true) as unknown as Element;
    node.setAttribute(DOM_ID_ATTR, id);
    for (const [name, value] of Object.entries(this.props.attributes ?? {})) {
      node.setAttribute(name, value);
    }
    // parentNode, not parentElement: inside a stencil the marker's container
    // is the template's content fragment, which is no element
    const container = (marker as unknown as { parentNode: Element }).parentNode;
    container.insertBefore(node, marker);
    container.removeChild(marker);
    this.templateEl = inTemplate;
    return node;
  }

  /**
   * Finds this scope's own DOM element by searching only within
   * `parentView` (or the whole document, for a scope with no DOM parent),
   * stopping at any nested scope's element without descending into it. This
   * keeps ids unique only among a single parent's descendants rather than
   * document-wide, so repeated/list instances don't collide with each
   * other's ids.
   */
  private lookupView(parentView?: Element): Element | undefined {
    const id = `${this.props.id}`;
    const container: Element | Document | undefined =
      parentView ?? (this.ctx.props as WebContextProps).doc;
    if (!container) return undefined;
    const childNodesOf = (e: Element | Document): NodeList =>
      (e as Element).tagName === 'TEMPLATE'
        ? (e as unknown as TemplateElement).content.childNodes
        : e.childNodes;
    const lookup = (childNodes: NodeList, template?: Element): Element | undefined => {
      for (const n of childNodes) {
        if (n.nodeType !== NodeType.ELEMENT) continue;
        const e = n as Element;
        const v = e.getAttribute(DOM_ID_ATTR);
        if (v !== null) {
          if (v === id) {
            this.templateEl = template;
            return e;
          }
          continue;
        }
        const ret = lookup(childNodesOf(e), e.tagName === 'TEMPLATE' ? e : template);
        if (ret) return ret;
      }
      return undefined;
    };
    return lookup(childNodesOf(container));
  }

  override dispose(): void {
    this.domListeners?.forEach(({ name, listener }) => {
      this.dom?.removeEventListener(name, listener);
    });
    this.domListeners = [];
    // a stencil's own dom (inside a <template>) has no parentElement (a
    // DocumentFragment isn't an Element), so this is a no-op for it
    this.dom?.parentElement?.removeChild(this.dom);
    super.dispose();
  }

  override newValue(
    key: string,
    props: CoreValueProps<any>,
    allValues?: { [key: string]: CoreValueProps<any> },
  ) {
    // a handler runs for its effect on the view, and a served page has no
    // view to drive -- `$dom` is not there either. Inert rather than merely
    // unbound: evaluating it is the whole point, so there is nothing to
    // report, only nothing to do. Anything a handler would derive belongs in
    // a value instead, or server and browser render different markup
    if (
      key.startsWith(RT_HANDLE_VALUE_PREFIX) &&
      (this.ctx.props as WebContextProps).server
    ) {
      return new CoreValue({}, this, key);
    }
    const ret = super.newValue(key, props, allValues);
    if (ret.cb) return ret;
    if (key.startsWith(RT_ATTR_VALUE_PREFIX)) {
      const name = this.camelToDash(key.slice(RT_ATTR_VALUE_PREFIX.length));
      ret.setCB((_, val) => {
        if (!this.dom) return this.unbound(ret, `no element to set "${name}" on`);
        if (val == null) {
          this.dom.removeAttribute(name);
        } else {
          this.dom.setAttribute(name, `${val}`);
        }
      });
      return ret;
    }
    if (key.startsWith(RT_PROP_VALUE_PREFIX)) {
      const name = key.slice(RT_PROP_VALUE_PREFIX.length);
      ret.setCB((_, val) => {
        // nothing to serialize: a property is state on an element instance,
        // so a server-rendered page can't carry one and skipping is right
        if ((this.ctx.props as WebContextProps).server) return;
        if (!this.dom) return this.unbound(ret, `no element to set property "${name}" on`);
        (this.dom as unknown as Record<string, unknown>)[name] = val;
      });
      return ret;
    }
    if (key.startsWith(RT_PRESENCE_VALUE_PREFIX)) {
      const name = key.slice(RT_PRESENCE_VALUE_PREFIX.length);
      ret.setCB((_, val) => {
        if (!this.dom) return this.unbound(ret, `no element to toggle "${name}" on`);
        // empty string, not "true": an HTML boolean attribute means true by
        // being present at all, and that is the form every browser writes
        val ? this.dom.setAttribute(name, '') : this.dom.removeAttribute(name);
      });
      return ret;
    }
    if (key.startsWith(RT_CLASS_VALUE_PREFIX)) {
      const name = key.slice(RT_CLASS_VALUE_PREFIX.length);
      ret.setCB((_, val) => {
        if (!this.dom) return this.unbound(ret, `no element to toggle class "${name}" on`);
        if (val) {
          this.dom.classList.add(name);
        } else {
          this.dom.classList.remove(name);
        }
      });
      return ret;
    }
    if (key.startsWith(RT_STYLE_VALUE_PREFIX)) {
      const name = key.slice(RT_STYLE_VALUE_PREFIX.length);
      ret.setCB((_, val) => {
        if (!this.dom) return this.unbound(ret, `no element to set style "${name}" on`);
        this.dom.style.setProperty(name, val);
      });
      return ret;
    }
    if (key.startsWith(RT_TEXT_VALUE_PREFIX)) {
      const textIndex = Number.parseInt(key.slice(RT_TEXT_VALUE_PREFIX.length));
      const t = this.texts.get(textIndex);

      //TODO: atomic text (<style>, <title>) is parsed as a single node
      //holding one concatenated expression, so changing any interpolated
      //value rewrites the whole content. That's nothing for a title, but a
      //reactive stylesheet re-emits every rule when one binding changes.
      //Splitting atomic text per interpolation would be a compiler/parser
      //change, not a language one: the keys arriving here would just become
      //finer-grained.
      ret.setCB((_, val) => {
        if (!t) return this.unbound(ret, 'no text node carrying that marker id');
        // nothing, not a zero-width space: a ZWSP used to be what kept the
        // text node alive through serialization, but init() now materializes
        // a missing one at hydration, so the placeholder has no job left --
        // and it was never free. U+200B isn't whitespace, so it survives
        // `.trim()`, and component slot-detection (Shoelace's, among others)
        // decides a slot has content with exactly that test: an "empty"
        // binding could silently switch on a card's header or footer
        t.textContent = val == null ? '' : String(val);
      });
      return ret;
    }
    if (key.startsWith(RT_EVENT_VALUE_PREFIX)) {
      // the compiler keeps dash-case event names (e.g. custom events like
      // "item-selected") verbatim in the compiled key, same as class$/style$
      const name = key.slice(RT_EVENT_VALUE_PREFIX.length);
      if (typeof ret.exp?.apply(this.proxy) === "function") {
        const listener: EventListener = (e: Event) => this.proxy[key]?.(e);
        this.domListeners ||= [];
        this.domListeners.push({ name, listener });
        this.dom
          ? this.dom.addEventListener(name, listener)
          : this.unbound(ret, `no element to bind "${name}" on`);
      }
      return ret;
    }
    return ret;
  }

  /**
   * A binding whose DOM target isn't there.
   *
   * Every one of these used to be an early `return`, which is the quietest
   * possible failure: the page renders, nothing throws, and one binding is
   * simply dead forever. Reporting it costs nothing when everything is
   * wired correctly, and turns a whole class of silent breakage -- markup
   * relocated by a slot, replicated by `:for-each`, cloned from a stencil --
   * into a message naming the scope and key at fault.
   */
  private unbound(value: CoreValue<any>, why: string): void {
    this.ctx.onError('callback', new Error(`unbound binding: ${why}`), value);
  }

  camelToDash(s: string): string {
    return s.replace(/([a-z][A-Z])/g, (g) => g[0] + "-" + g[1].toLowerCase());
  }

  override clone(index: number): WebScope {
    // resolved before construction, so the clone's own init() (running
    // during super()) can pick it up via pendingCloneDom
    this.pendingCloneDom = this.acquireCloneDom(cloneId(this.props.id, index));
    const clone = super.clone(index) as WebScope;
    this.pendingCloneDom = undefined;
    return clone;
  }

  /**
   * Puts the replicas' elements back in array order after a keyed pass.
   *
   * Only what is actually out of place moves. `insertBefore` on a node that
   * already sits where it belongs is still a remove-and-reinsert, and the
   * DOM state keyed replication exists to protect -- focus, a running
   * transition, an <iframe>'s document, a playing video -- is exactly what
   * that destroys, so reordering everything unconditionally would defeat
   * the feature while appearing to work.
   */
  override reorderClones(): void {
    const anchor = this.templateEl;
    const container = anchor?.parentElement;
    if (!anchor || !container || !this.clones?.length) return;
    // walks forward from the anchor comparing `nextSibling` directly, rather
    // than mirroring childNodes into an array and doing indexOf()/splice()
    // per replica -- those are O(n) each, which made a full reorder O(n^2)
    // and measurably fell over past ~1k replicas
    let ref: Node = anchor;
    for (const clone of this.clones as WebScope[]) {
      const node = clone.dom;
      if (!node) continue;
      if (ref.nextSibling !== node) {
        container.insertBefore(node, ref.nextSibling);
      }
      ref = node;
    }
  }

  /**
   * Finds an already-existing element for a clone id (e.g. one SSR already
   * rendered) among the template's siblings, reusing it if present; failing
   * that, stamps out a new one from the template's stencil and inserts it
   * right after the last existing clone (or the template itself, if this is
   * the first). Returns undefined if this scope has no template to clone
   * from at all (e.g. a scope with no matching DOM element in the first
   * place, or one whose :for-each host never resolved one).
   */
  private acquireCloneDom(id: string): Element | undefined {
    const anchor = this.templateEl;
    const container = anchor?.parentElement;
    if (!anchor || !container) return undefined;

    // re-snapshotting and scanning all of container's children here, once
    // per NEW clone, made mounting n replicas O(n^2) (each scan costs O(n)
    // of its own, since the container keeps growing). Skipping the scan
    // once it has ever missed removes it from the hot path entirely for a
    // pure client-side mount, leaving only the (small, fixed) hydration
    // prefix actually scanned
    if (!this.noMoreHydratedClones) {
      const existing = [...container.childNodes].find(
        n => n.nodeType === NodeType.ELEMENT && (n as Element).getAttribute(DOM_ID_ATTR) === id
      ) as Element | undefined;
      if (existing) return existing;
      this.noMoreHydratedClones = true;
    }

    const stencil = [...(anchor as unknown as TemplateElement).content.childNodes].find(
      n => n.nodeType === NodeType.ELEMENT
    ) as Element | undefined;
    if (!stencil) return undefined;

    const node = stencil.cloneNode(true) as unknown as Element;
    node.setAttribute(DOM_ID_ATTR, id);
    // the previous clone's own element is the insertion point directly --
    // no need to find its index in a snapshot of the container's children
    const prevClone = this.clones?.at(-1) as WebScope | undefined;
    const ref = prevClone?.dom ?? anchor;
    container.insertBefore(node, ref.nextSibling);
    return node;
  }
}
