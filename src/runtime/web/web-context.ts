import { BaseContext, BaseContextProps } from '../base/base-context';
import { BaseScope, BaseScopeProps } from '../base/base-scope';
import { WebScope } from './web-scope';
import { Comment, Document, Element, NodeType, Text } from '../../html/dom';

export const DOM_ID_ATTR = 'data-markout';
export const DOM_TEXT_MARKER = '-t';

export interface WebContextProps extends BaseContextProps {
  doc: Document;
}

export class WebContext extends BaseContext {
  scopeElements!: Map<string, Element>;

  constructor(props: WebContextProps) {
    super(props, {
      //TODO
    });
  }

  //TODO: revert to domaze's technique where each scope looks up DOM IDs
  //locally, it's needed for replication as IDs won't be globally unique
  override init() {
    this.scopeElements = new Map();
    const f = (e: Element) => {
      const id = e.getAttribute(DOM_ID_ATTR);
      if (id === null) return;
      this.scopeElements.set(id, e);
      e.childNodes.forEach(
        n => n.nodeType === NodeType.ELEMENT && f(n as Element)
      );
    }
    const docElement = (this.props as WebContextProps).doc.documentElement;
    docElement && f(docElement);
  }

  override newScope(props: BaseScopeProps, ctx: BaseContext, parent?: BaseScope): BaseScope {
    return new WebScope(props, ctx as WebContext, parent);
  }
}
