import { Element } from "../../html/dom";
import { Scope, ScopeProps } from "../base/scope";
import { ValueProps } from "../base/value";
import { WebContext } from "./web-context";

export const ATTR_VALUE_PREFIX = 'attr$';

export class WebScope extends Scope {
  dom?: Element;

  constructor(props: ScopeProps, context: WebContext, parent?: Scope) {
    super(props, context, parent);
  }

  override init() {
    super.init();
    this.dom = (this.context as WebContext).scopeElements.get(this.props.id);
  }

  override newValue(key: string, props: ValueProps<any>) {
    const ret = super.newValue(key, props);
    if (key.startsWith(ATTR_VALUE_PREFIX)) {
      const name = this.camelToDash(key.slice(ATTR_VALUE_PREFIX.length));
      return ret.setCB((_, val) => {
        if (val == null) {
          this.dom?.removeAttribute(name);
        } else {
          this.dom?.setAttribute(name, `${val}`);
        }
      });
    }
    return ret;
  }

  camelToDash(s: string): string {
    return s.replace(/([a-z][A-Z])/g, (g) => g[0] + '-' + g[1].toLowerCase());
  }
}
