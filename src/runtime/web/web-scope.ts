import {
  Comment,
  Document,
  Element,
  NodeList,
  NodeType,
  TemplateElement,
  Text,
} from '../../html/dom';
import { CoreScope, CoreScopeProps } from '../core/core-scope';
import { CoreValueProps } from '../core/core-value';
import {
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

  constructor(props: CoreScopeProps, context: WebContext, parent?: CoreScope) {
    super(props, context, parent);
  }

  override init() {
    super.init();
    this.texts = [];
    const parentView =
      this.parent instanceof WebScope ? this.parent.dom : undefined;
    const view = this.lookupView(parentView);
    if (!view) {
      // Root scope or other scopes without corresponding DOM elements
      // should not try to perform DOM operations
      return;
    }
    this.dom = view;
    const f = (e: Element) => {
      const childNodes = [...e.childNodes];
      childNodes.forEach((n, i) => {
        if (
          n.nodeType === NodeType.ELEMENT &&
          (n as Element).getAttribute(DOM_ID_ATTR) === null
        ) {
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
    const lookup = (childNodes: NodeList): Element | undefined => {
      for (const n of childNodes) {
        if (n.nodeType !== NodeType.ELEMENT) continue;
        const e = n as Element;
        const v = e.getAttribute(DOM_ID_ATTR);
        if (v !== null) {
          if (v === id) return e;
          continue;
        }
        const ret = lookup(childNodesOf(e));
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
    super.dispose();
  }

  override newValue(key: string, props: CoreValueProps<any>) {
    const ret = super.newValue(key, props);
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
      const name = this.camelToDash(key.slice(RT_CLASS_VALUE_PREFIX.length));
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
      const name = this.camelToDash(key.slice(RT_STYLE_VALUE_PREFIX.length));
      ret.setCB((_, val) => {
        if (!this.dom) return;
        this.dom.style.setProperty(name, val);
      });
      return ret;
    }
    if (key.startsWith(RT_TEXT_VALUE_PREFIX)) {
      const suffix = key.slice(RT_TEXT_VALUE_PREFIX.length); // Remove "text$"
      const underscoreIndex = suffix.lastIndexOf('_');

      let t: Text | undefined;
      if (underscoreIndex >= 0) {
        // Splittable text: text$scopeId_index
        const textIndex = Number.parseInt(suffix.slice(underscoreIndex + 1));
        t = this.texts[textIndex];
      } else if (/^\d+$/.test(suffix)) {
        // Could be either legacy format (text$index) or atomic format (text$scopeId)
        // Try legacy format first - if we have texts array with this index, use it
        const textIndex = Number.parseInt(suffix);
        if (this.texts && textIndex < this.texts.length) {
          t = this.texts[textIndex];
        } else {
          // Fall back to atomic format - find first text child
          if (this.dom) {
            for (const child of this.dom.childNodes) {
              if (child.nodeType === NodeType.TEXT) {
                t = child as Text;
                break;
              }
            }
          }
        }
      } else {
        // Non-numeric suffix - shouldn't happen in current implementation
        console.warn(`Unexpected text key format: ${key}`);
      }

      //TODO: atomic text (<style>, <title> — see ATOMIC_TEXT_TAGS in
      //@markout/html) is parsed as a single node holding one concatenated
      //expression, so changing any interpolated value rewrites the whole
      //content. That's nothing for a title, but a reactive stylesheet
      //re-emits every rule when one binding changes. Splitting atomic text
      //per interpolation would be a compiler/parser change, not a language
      //one: the keys arriving here would just become finer-grained.
      ret.setCB((_, val) => {
        if (!t) return;
        // a real zero-width space, not the `&#8203;` reference: text content
        // is escaped on serialization, so an entity written here would reach
        // the page as the literal characters `&#8203;`
        t.textContent = val == null ? '​' : String(val);
      });
      return ret;
    }
    if (key.startsWith(RT_EVENT_VALUE_PREFIX)) {
      const name = key.slice(RT_EVENT_VALUE_PREFIX.length);
      if (typeof ret.exp?.apply(this.proxy) === 'function') {
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
    return s.replace(/([a-z][A-Z])/g, g => g[0] + '-' + g[1].toLowerCase());
  }
}
