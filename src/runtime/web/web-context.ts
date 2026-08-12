import { Comment, Document, Element, Node, NodeList, NodeType, TemplateElement } from '../../html/dom';
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
// marks a custom-tag usage site (see stage1-load.ts's expandCustomTagUsages):
// `${DOM_USE_MARKER}${scopeId}`, e.g. `-us5` -- replaced in place by
// WebScope with a real, cloned-from-template element the first time no
// already-instantiated element (e.g. from SSR) is found for that scope id
export const DOM_USE_MARKER = '-u';
// duplicated from html/parser.ts's ATOMIC_TEXT_TAGS rather than imported --
// runtime code stays independent of the compiler/parser (same convention as
// core-scope.ts's FOR_DATA_DEFAULT_NAME); <style>/<title> hold their whole
// interpolated content as one node, so comment markers can't (and don't
// need to) surround it -- see stage1-load.ts's load() and WebScope.init()
export const DOM_ATOMIC_TEXT_TAGS = new Set(['STYLE', 'TITLE']);

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

  // ===========================================================================
  // custom-tag template lookup
  // ===========================================================================
  // unlike WebScope.lookupView() (scoped to a single parent's own subtree,
  // so repeated instances' ids don't need to be globally unique), a custom
  // tag's <:define> template and its usage sites aren't siblings under any
  // common scoped parent -- these searches cover the whole document instead

  private searchDocument<T>(match: (n: Node) => T | undefined): T | undefined {
    const doc = (this.props as WebContextProps).doc;
    const childNodesOf = (e: Element): NodeList =>
      e.tagName === 'TEMPLATE'
        ? (e as unknown as TemplateElement).content.childNodes
        : e.childNodes;
    const search = (childNodes: NodeList): T | undefined => {
      for (const n of childNodes) {
        const found = match(n);
        if (found !== undefined) return found;
        if (n.nodeType === NodeType.ELEMENT) {
          const deeper = search(childNodesOf(n as Element));
          if (deeper !== undefined) return deeper;
        }
      }
      return undefined;
    };
    return search(doc.childNodes);
  }

  /** finds an element anywhere in the document (descending into <template>
   * content) bearing the given data-markout id -- used to find a <:define>
   * stencil to clone from */
  findElementById(id: string): Element | undefined {
    return this.searchDocument(n =>
      n.nodeType === NodeType.ELEMENT && (n as Element).getAttribute(DOM_ID_ATTR) === id
        ? (n as Element)
        : undefined
    );
  }

  /** finds a custom-tag usage site's marker comment, if it hasn't been
   * replaced with a real instantiated element yet (e.g. by SSR) */
  findUseMarker(scopeId: string): Comment | undefined {
    const marker = `${DOM_USE_MARKER}${scopeId}`;
    return this.searchDocument(n =>
      n.nodeType === NodeType.COMMENT && (n as Comment).textContent === marker
        ? (n as Comment)
        : undefined
    );
  }
}
