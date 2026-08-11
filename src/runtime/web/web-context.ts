import { Document } from '../../html/dom';
import { CoreContext, CoreContextProps } from '../core/core-context';
import { CoreScope, CoreScopeProps } from '../core/core-scope';
import { WebScope } from './web-scope';

export const DOM_ID_ATTR = 'data-markout';
// `-` prefixed so these read as triple-dash "private" comments (see
// html/preprocessor.ts's removeTripleComments), which are stripped from
// page/fragment source during preprocessing, before the compiler ever
// inserts its own markers -- guaranteeing these reserved sequences can
// never collide with anything a page author wrote
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
