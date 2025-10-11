import { Comment, Element, NodeType, Text } from "../../html/dom";
import { BaseScope, BaseScopeProps } from "../base/base-scope";
import { BaseValueProps } from "../base/base-value";
import { DOM_ID_ATTR, DOM_TEXT_MARKER1, WebContext } from "./web-context";

export const RT_ATTR_VALUE_PREFIX = 'attr$';
export const RT_CLASS_VALUE_PREFIX = 'class$';
export const RT_STYLE_VALUE_PREFIX = 'style$';
export const RT_TEXT_VALUE_PREFIX = 'text$';
export const RT_EVENT_VALUE_PREFIX = 'event$';

export class WebScope extends BaseScope {
  dom!: Element;
  texts!: Text[];

  constructor(props: BaseScopeProps, context: WebContext, parent?: BaseScope) {
    super(props, context, parent);
  }

  override init() {
    super.init();
    this.texts = [];
    const domElement = (this.ctx as WebContext).scopeElements.get(`${this.props.id}`);
    if (!domElement) {
      // Root scope or other scopes without corresponding DOM elements
      // should not try to perform DOM operations
      return;
    }
    this.dom = domElement;
    if (this.dom) {
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
      }
      f(this.dom);
    }
  }

  override newValue(key: string, props: BaseValueProps<any>) {
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
        const textIndex = parseInt(suffix.slice(underscoreIndex + 1));
        t = this.texts[textIndex];
      } else if (/^\d+$/.test(suffix)) {
        // Could be either legacy format (text$index) or atomic format (text$scopeId)
        // Try legacy format first - if we have texts array with this index, use it
        const textIndex = parseInt(suffix);
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
      
      ret.setCB((_, val) => {
        if (!t) return;
        t.textContent = val == null ? '&#8203' : val;
      });
      return ret;
    }
    return ret;
  }

  camelToDash(s: string): string {
    return s.replace(/([a-z][A-Z])/g, (g) => g[0] + '-' + g[1].toLowerCase());
  }
}
