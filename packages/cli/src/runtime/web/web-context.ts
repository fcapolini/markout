import { Comment, Document, Element, Node, NodeList, NodeType, TemplateElement } from '../../html/dom';
import {
  CoreContext,
  CoreContextProps,
  RuntimeError,
  formatRuntimeError,
} from '../core/core-context';
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
export const DOM_ATOMIC_TEXT_TAGS = new Set(['STYLE', 'TITLE', 'TEXTAREA']);

/** id of the dev-mode error panel the browser runtime paints into */
export const DOM_ERRORS_ID = 'markout-errors';

export interface WebContextProps extends CoreContextProps {
  doc: Document;
  /** dev mode: also paint runtime errors into the page itself */
  dev?: boolean;
  /**
   * Server rendering rather than the browser.
   *
   * Only property bindings care: a property is object state, not markup, so
   * there is nothing for a served page to carry. Skipping them here is the
   * correct outcome rather than a failure, which is why it can't be left to
   * the unbound-binding report.
   */
  server?: boolean;
}

export class WebContext extends CoreContext {

  constructor(props: WebContextProps) {
    super(props);
  }

  // ===========================================================================
  // dev-mode error panel
  // ===========================================================================

  protected override reportError(e: RuntimeError): void {
    super.reportError(e);
    (this.props as WebContextProps).dev && this.showError(e);
  }

  /**
   * Appends an error to a panel at the end of `<body>`, creating it on first
   * use.
   *
   * This is the browser's half of dev-mode reporting: errors hit while
   * server rendering never get here, because the server serves a dedicated
   * error page for those instead of the broken page. So the panel only ever
   * collects failures that happen after hydration -- and since onError() has
   * already de-duplicated by then, each row is distinct by construction.
   */
  private showError(e: RuntimeError): void {
    try {
      const doc = (this.props as WebContextProps).doc;
      const host = this.findBody() ?? doc.documentElement;
      if (!host) {
        return;
      }
      const panel = this.findErrorPanel() ?? this.createErrorPanel(host);
      const row = doc.createElement('li');
      row.appendChild(doc.createTextNode(formatRuntimeError(e)));
      panel.appendChild(row);
    } catch (ignored) {
      // the panel is a diagnostic aid: if painting it fails (an exotic
      // document, a detached tree), the error has already been reported
      // through the normal channel and that has to be good enough
    }
  }

  private findBody(): Element | undefined {
    return this.searchDocument(n =>
      n.nodeType === NodeType.ELEMENT && (n as Element).tagName === 'BODY'
        ? (n as Element)
        : undefined
    );
  }

  private findErrorPanel(): Element | undefined {
    return this.searchDocument(n =>
      n.nodeType === NodeType.ELEMENT &&
      (n as Element).getAttribute('id') === DOM_ERRORS_ID
        ? (n as Element)
        : undefined
    );
  }

  private createErrorPanel(host: Element): Element {
    const doc = (this.props as WebContextProps).doc;
    const panel = doc.createElement('ul');
    panel.setAttribute('id', DOM_ERRORS_ID);
    // inline styles rather than a stylesheet: the panel has to look the same
    // whether it arrived via SSR or was added live, without depending on the
    // page's own CSS having loaded (or on it not overriding us)
    panel.setAttribute(
      'style',
      'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;margin:0;' +
        'padding:8px 12px;max-height:40vh;overflow:auto;list-style:none;' +
        'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;' +
        'color:#fff;background:#8b1a1a;white-space:pre-wrap'
    );
    host.appendChild(panel);
    return panel;
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

  /**
   * The `<template>` the last successful find*() matched inside, if any.
   *
   * A `:for-each` on a custom tag leaves the instance in a stencil, and the
   * scope has to know which one to stamp replicas out of. The node cannot be
   * asked: a template's content is a DocumentFragment, and no DOM links one
   * back to its template. The walk down does know, so it records it here --
   * read it straight after the call that set it.
   */
  foundInTemplate?: Element;

  private searchDocument<T>(
    match: (n: Node) => T | undefined,
    within?: Element
  ): T | undefined {
    const doc = (this.props as WebContextProps).doc;
    const childNodesOf = (e: Element): NodeList =>
      e.tagName === 'TEMPLATE'
        ? (e as unknown as TemplateElement).content.childNodes
        : e.childNodes;
    const search = (childNodes: NodeList, template?: Element): T | undefined => {
      for (const n of childNodes) {
        const found = match(n);
        if (found !== undefined) {
          this.foundInTemplate = template;
          return found;
        }
        if (n.nodeType === NodeType.ELEMENT) {
          const e = n as Element;
          const deeper = search(childNodesOf(e), e.tagName === 'TEMPLATE' ? e : template);
          if (deeper !== undefined) return deeper;
        }
      }
      return undefined;
    };
    this.foundInTemplate = undefined;
    return search(within ? childNodesOf(within) : doc.childNodes);
  }

  /** finds an element bearing the given data-markout id, descending into
   * <template> content -- across the whole document, or within `within` when
   * one instance per container is what's wanted (see acquireUsageDom) */
  findElementById(id: string, within?: Element): Element | undefined {
    return this.searchDocument(
      n =>
        n.nodeType === NodeType.ELEMENT && (n as Element).getAttribute(DOM_ID_ATTR) === id
          ? (n as Element)
          : undefined,
      within
    );
  }

  /** finds a custom-tag usage site's marker comment, if it hasn't been
   * replaced with a real instantiated element yet (e.g. by SSR) */
  findUseMarker(scopeId: string, within?: Element): Comment | undefined {
    const marker = `${DOM_USE_MARKER}${scopeId}`;
    return this.searchDocument(
      n =>
        n.nodeType === NodeType.COMMENT && (n as Comment).textContent === marker
          ? (n as Comment)
          : undefined,
      within
    );
  }
}
