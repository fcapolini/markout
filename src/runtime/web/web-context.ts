import { Document } from '../../html/dom';
import { CoreContext, CoreContextProps } from '../core/core-context';
import { CoreScope, CoreScopeProps } from '../core/core-scope';
import { WebScope } from './web-scope';

export const DOM_ID_ATTR = 'data-markout';
export const DOM_TEXT_MARKER1 = '-t';
export const DOM_TEXT_MARKER2 = '-/';

export interface WebContextProps extends CoreContextProps {
  doc: Document;
}

export class WebContext extends CoreContext {

  constructor(props: WebContextProps) {
    super(props);
  }

  override newScope(
    props: CoreScopeProps,
    ctx: CoreContext,
    parent?: CoreScope
  ): CoreScope {
    return new WebScope(props, ctx as WebContext, parent);
  }
}
