import { DEV_GLOBAL, LOCS_GLOBAL, PROPS_GLOBAL, STATE_GLOBAL } from '../core/core-context';
import type { PageState } from '../core/core-context';
import type { CoreScopeProps } from '../core/core-scope';
import type { Document as MarkoutDocument } from '../../html/dom';
import { WebContext } from './web-context';

// bundled standalone for the browser (see scripts/build-runtime.mjs), so
// this deliberately avoids depending on the project's Node-oriented lib.dom-less
// tsconfig: declare just the globals actually used, instead of pulling in "DOM"
declare const window: Record<string, unknown> & {
  addEventListener(type: string, listener: () => void): void;
  navigation?: { addEventListener(type: string, listener: () => void): void };
};
declare const location: { origin: string; href: string };
declare const document: {
  readyState: string;
  addEventListener(type: string, listener: () => void): void;
} & Record<string, unknown>;

/** Reads `window[PROPS_GLOBAL]` and boots a `WebContext` from it, if present. */
export function init(): WebContext | undefined {
  // two halves: the expressions, which have to be JavaScript, and the tree
  // that refers to them by index, which the page hands over already parsed
  // out of JSON. See stage7-generate's emitProps
  const props = window[PROPS_GLOBAL] as
    | { e: ((scope: unknown) => unknown)[]; p: CoreScopeProps }
    | undefined;
  const root = props?.p;
  if (!root) {
    console.error(`markout: window.${PROPS_GLOBAL} not found, nothing to initialize`);
    return undefined;
  }
  // set by the compiler alongside the props when the page was built in dev
  // mode: keep surfacing errors in the page after hydration, the same way
  // SSR already did
  const dev = window[DEV_GLOBAL] === true;
  const context = new WebContext({
    root,
    exps: props!.e,
    doc: document as unknown as MarkoutDocument,
    dev,
    // results of the server's `:server-` values, absent on a page that declared
    // none. A value named here is built from its result instead of from its
    // expression, which for a server-only expression is the only way it can
    // exist in the browser at all
    state: window[STATE_GLOBAL] as PageState | undefined,
    // dev only, and absent from every other page: what lets a failure name
    // the line it was written on rather than the scope uid it compiled to
    locs: window[LOCS_GLOBAL] as { [key: string]: string } | undefined,
    // the same fact the server rendered with, arrived at the other way round.
    // Not carried in the state: each side knows its own, and a mismatch would
    // mean the page is being served from somewhere it doesn't think it is.
    // `$origin` is taken from the url when one is given, so this passes the
    // whole address and lets the context split it
    url: typeof location === 'undefined' ? undefined : location.href,
  });
  context.refresh();
  watchAddress(context);
  return context;
}

/**
 * Keeps `$url` on whatever address the document actually has.
 *
 * `navigatesuccess` is the whole story where the Navigation API is
 * there -- it fires for a traversal, a form submission and an intercepted
 * navigation alike, which is exactly the set of ways a document's address
 * changes without a new document. `popstate` is the same story told worse,
 * and is here for browsers without the API; where both exist the second
 * call finds the value already right and does nothing.
 *
 * Reading `location.href` rather than the event: the address bar is the
 * fact, and anything else is a description of how it got there.
 */
function watchAddress(context: WebContext): void {
  if (typeof location === 'undefined') return;
  const update = () => context.adoptUrl(location.href);
  const nav = window.navigation;
  if (typeof nav?.addEventListener === 'function') {
    nav.addEventListener('navigatesuccess', update);
    return;
  }
  // guarded like the document is above: somewhere without a real window
  // (a test harness, an accidental non-browser bundle) has no address to
  // follow, and nothing here should be what says so
  typeof window.addEventListener === 'function' &&
    window.addEventListener('popstate', update);
}

function autoInit() {
  // guards against being imported somewhere without a real DOM (e.g. tests,
  // or an accidental non-browser bundle) rather than assuming document exists
  if (typeof document === 'undefined') {
    return;
  }
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
}

autoInit();
