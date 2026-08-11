import { WebContext } from "../runtime/web/web-context";
import type { CoreScopeProps } from "../runtime/core/core-scope";
import type { Page } from "../compiler/ir/Page";

/**
 * Server-side render: evaluates the compiled propsString into real
 * functions -- the same code the browser runtime would eventually run --
 * and runs one WebContext refresh against the page's own ServerDocument,
 * so the served markup reflects each value's initial computed output
 * instead of shipping empty interpolation gaps for the client to fill in.
 */
export function renderPage(page: Page): void {
  if (!page.propsString) {
    return;
  }
  const root = new Function(`return (${page.propsString});`)() as CoreScopeProps;
  new WebContext({ root, doc: page.source.doc }).refresh();
}
