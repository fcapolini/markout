import { WebContext } from "../runtime/web/web-context";
import type { CoreScopeProps, } from "../runtime/core/core-scope";
import type { RuntimeError } from "../runtime/core/core-context";
import type { Page } from "../compiler/ir/Page";

/**
 * Server-side render: evaluates the compiled propsString into real
 * functions -- the same code the browser runtime would eventually run --
 * and runs one WebContext refresh against the page's own ServerDocument,
 * so the served markup reflects each value's initial computed output
 * instead of shipping empty interpolation gaps for the client to fill in.
 *
 * Any expression that failed is returned rather than painted into the page:
 * the caller decides what to do with them (log them, and in dev mode serve
 * an error page instead of this one).
 */
export function renderPage(page: Page): RuntimeError[] {
  if (!page.propsString) {
    return [];
  }
  const errors: RuntimeError[] = [];
  const root = new Function(`return (${page.propsString});`)() as CoreScopeProps;
  new WebContext({
    root,
    doc: page.source.doc,
    onError: e => errors.push(e),
    // property bindings have nothing to write into a served page (see
    // WebContextProps.server); everything else renders as usual
    server: true,
  }).refresh();
  return errors;
}
