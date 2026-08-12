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
 * In dev mode the context paints any expression errors into the page as it
 * goes (see WebContext); either way they're returned, so the caller can log
 * them. Outside dev mode they never reach the served markup.
 */
export function renderPage(page: Page, dev = false): RuntimeError[] {
  if (!page.propsString) {
    return [];
  }
  const errors: RuntimeError[] = [];
  const root = new Function(`return (${page.propsString});`)() as CoreScopeProps;
  new WebContext({
    root,
    doc: page.source.doc,
    dev,
    onError: e => errors.push(e),
  }).refresh();
  return errors;
}
