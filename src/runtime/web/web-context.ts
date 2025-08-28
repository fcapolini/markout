import { Context, ContextProps } from '../base/context';
import { Scope, ScopeProps } from '../base/scope';
import { WebScope } from './web-scope';
import { Document, Element, NodeType } from '../../html/dom';

export const DOM_ID_ATTR = 'data-markout';

export interface WebContextProps extends ContextProps {
  doc: Document;
}

export class WebContext extends Context {
  scopeElements!: Map<string, Element>;

  constructor(props: WebContextProps) {
    super(props, {
      //TODO
    });
  }

  override init() {
    this.scopeElements = new Map();
    const f = (e: Element) => {
      const id = e.getAttribute(DOM_ID_ATTR);
      if (id === null) return;
      this.scopeElements.set(id, e);
      e.childNodes.forEach(
        (n) => n.nodeType === NodeType.ELEMENT && f(n as Element)
      );
    }
    const docElement = (this.props as WebContextProps).doc.documentElement;
    docElement && f(docElement);
  }

  override newScope(props: ScopeProps, ctx: Context, parent?: Scope): Scope {
    return new WebScope(props, ctx as WebContext, parent);
  }
}
