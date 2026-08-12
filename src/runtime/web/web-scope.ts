import {
  Comment,
  Document,
  Element,
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
export const RT_CLASS_VALUE_PREFIX = 'class$';
export const RT_STYLE_VALUE_PREFIX = 'style$';
export const RT_TEXT_VALUE_PREFIX = 'text$';
export const RT_EVENT_VALUE_PREFIX = 'event$';

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
        if (!next) return;
        // an atomic-text container (<style>/<title>) can't hold the marker
        // inside it, so the marker sits just before the element and the
        // binding target is its one text child
        const target =
          next.nodeType === NodeType.ELEMENT &&
          DOM_ATOMIC_TEXT_TAGS.has((next as Element).tagName)
            ? (next as Element).childNodes[0]
            : next;
        target?.nodeType === NodeType.TEXT && this.texts.set(id, target as Text);
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
    if (existing) return existing;

    const stencil = ctx.findElementById(templateId);
    const marker = ctx.findUseMarker(id, within);
    if (!stencil || !marker) return undefined;

    const node = stencil.cloneNode(true) as unknown as Element;
    node.setAttribute(DOM_ID_ATTR, id);
    for (const [name, value] of Object.entries(this.props.attributes ?? {})) {
      node.setAttribute(name, value);
    }
    const container = marker.parentElement!;
    container.insertBefore(node, marker);
    container.removeChild(marker);
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
        // a real zero-width space, not the `&#8203;` reference: text content
        // is escaped on serialization, so an entity written here would reach
        // the page as the literal characters `&#8203;`
        t.textContent = val == null ? "​" : String(val);
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

    const siblings = [...container.childNodes];
    const existing = siblings.find(
      n => n.nodeType === NodeType.ELEMENT && (n as Element).getAttribute(DOM_ID_ATTR) === id
    ) as Element | undefined;
    if (existing) return existing;

    const stencil = [...(anchor as unknown as TemplateElement).content.childNodes].find(
      n => n.nodeType === NodeType.ELEMENT
    ) as Element | undefined;
    if (!stencil) return undefined;

    const node = stencil.cloneNode(true) as unknown as Element;
    node.setAttribute(DOM_ID_ATTR, id);
    const prevClone = this.clones?.at(-1) as WebScope | undefined;
    const ref = prevClone?.dom ?? anchor;
    const refIndex = siblings.indexOf(ref);
    const insertBeforeNode = refIndex >= 0 ? siblings[refIndex + 1] ?? null : null;
    container.insertBefore(node, insertBeforeNode);
    return node;
  }
}
