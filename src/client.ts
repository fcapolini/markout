import { WebContext } from './runtime/web/web-context';
import { PROPS_GLOBAL } from './constants';

declare global {
  interface Window {
    __MARKOUT_PROPS: any;
    __markout_context: any;
    markout: any;
  }
}

const props = window[PROPS_GLOBAL] || {};
window.__markout_context = new WebContext({
  doc: document as any,
  root: props,
  addedGlobals: {
    console: { val: console },
    setTimeout: { val: setTimeout.bind(window) },
    clearTimeout: { val: clearTimeout.bind(window) },
    setInterval: { val: setInterval.bind(window) },
    clearInterval: { val: clearInterval.bind(window) },
    requestAnimationFrame: { val: requestAnimationFrame.bind(window) },
    cancelAnimationFrame: { val: cancelAnimationFrame.bind(window) },
  },
}).refresh();
window.markout = window.__markout_context.root;
