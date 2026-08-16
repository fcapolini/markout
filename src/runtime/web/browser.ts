import { DEV_GLOBAL, PROPS_GLOBAL, STATE_GLOBAL } from '../core/core-context';
import type { PageState } from '../core/core-context';
import type { CoreScopeProps } from '../core/core-scope';
import type { Document as MarkoutDocument } from '../../html/dom';
import { WebContext } from './web-context';

// bundled standalone for the browser (see scripts/build-runtime.mjs), so
// this deliberately avoids depending on the project's Node-oriented lib.dom-less
// tsconfig: declare just the globals actually used, instead of pulling in "DOM"
declare const window: Record<string, unknown>;
declare const location: { origin: string };
declare const document: {
  readyState: string;
  addEventListener(type: string, listener: () => void): void;
} & Record<string, unknown>;

/** Reads `window[PROPS_GLOBAL]` and boots a `WebContext` from it, if present. */
export function init(): WebContext | undefined {
  const root = window[PROPS_GLOBAL] as CoreScopeProps | undefined;
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
    doc: document as unknown as MarkoutDocument,
    dev,
    // results of the server's `:server-` values, absent on a page that declared
    // none. A value named here is built from its result instead of from its
    // expression, which for a server-only expression is the only way it can
    // exist in the browser at all
    state: window[STATE_GLOBAL] as PageState | undefined,
    // the same fact the server rendered with, arrived at the other way round.
    // Not carried in the state: each side knows its own, and a mismatch would
    // mean the page is being served from somewhere it doesn't think it is
    origin: typeof location === 'undefined' ? undefined : location.origin,
  });
  context.refresh();
  return context;
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
