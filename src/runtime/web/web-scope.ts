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
    this.dom = (this.ctx as WebContext).scopeElements.get(this.props.id)!;
    this.texts = [];
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

  override newValue(key: string, props: BaseValueProps<any>) {
    const ret = super.newValue(key, props);
    if (key.startsWith(RT_ATTR_VALUE_PREFIX)) {
      const name = this.camelToDash(key.slice(RT_ATTR_VALUE_PREFIX.length));
      ret.setCB((_, val) => {
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
        this.dom.style.setProperty(name, val);
      });
      return ret;
    }
    if (key.startsWith(RT_TEXT_VALUE_PREFIX)) {
      const t = this.texts[parseInt(key.slice(RT_TEXT_VALUE_PREFIX.length))];
      ret.setCB((_, val) => {
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
