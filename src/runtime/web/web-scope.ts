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
import { CoreValueProps } from '../core/core-value';
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
  declare texts: Text[];
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
    this.texts = [];
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
    const f = (e: Element) => {
      const childNodes = [...e.childNodes];
      childNodes.forEach((n, i) => {
        if (n.nodeType === NodeType.ELEMENT && (n as Element).getAttribute(DOM_ID_ATTR) === null) {
          if (DOM_ATOMIC_TEXT_TAGS.has((n as Element).tagName)) {
            // holds its whole interpolated content as one marker-less text
            // child (see stage1-load.ts's load()); push it directly, in the
            // same document-order position a marker-delimited entry would
            // occupy, so text$N indices stay aligned either way
            const only = (n as Element).childNodes[0];
            only?.nodeType === NodeType.TEXT && this.texts.push(only as Text);
            return;
          }
          return f(n as Element);
        }
        if (
          n.nodeType === NodeType.COMMENT &&
          (n as Comment).textContent.startsWith(DOM_TEXT_MARKER1)
        ) {
          this.texts.push(childNodes[i + 1] as Text);
        }
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
        if (!this.dom) return;
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
        if (!this.dom) return;
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
        if (!this.dom) return;
        this.dom.style.setProperty(name, val);
      });
      return ret;
    }
    if (key.startsWith(RT_TEXT_VALUE_PREFIX)) {
      const textIndex = Number.parseInt(key.slice(RT_TEXT_VALUE_PREFIX.length));
      const t = this.texts[textIndex];

      //TODO: atomic text (<style>, <title>) is parsed as a single node
      //holding one concatenated expression, so changing any interpolated
      //value rewrites the whole content. That's nothing for a title, but a
      //reactive stylesheet re-emits every rule when one binding changes.
      //Splitting atomic text per interpolation would be a compiler/parser
      //change, not a language one: the keys arriving here would just become
      //finer-grained.
      ret.setCB((_, val) => {
        if (!t) return;
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
        this.dom?.addEventListener(name, listener);
      }
      return ret;
    }
    return ret;
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
