import type { CoreScopeProps } from '../runtime/core/core-scope';
import type { ValueExp } from '../runtime/core/core-value';

/**
 * Reads the props a page carries back into the two things a context needs.
 *
 * They travel as two halves -- an array of the expressions, which have to be
 * JavaScript, and a tree of data referring to them by index (see stage7's
 * emitProps) -- and every loader outside the browser has to put them back
 * together the same way. One place that knows the shape, so a change to it
 * is a change to one function rather than to everything that ever wrote
 * `new Function('return (' + propsString + ')')`.
 *
 * Not what the BROWSER does: there the page's own `<script>` has already
 * evaluated them into `window.__MARKOUT_PROPS`, and the runtime never
 * evaluates source -- which is what lets a page be served under a policy
 * that does not say `unsafe-eval`.
 */
export function loadProps(propsString: string): {
  root: CoreScopeProps;
  exps: ValueExp<any>[];
} {
  const { e, p } = new Function(`return (${propsString});`)() as {
    e: ValueExp<any>[];
    p: CoreScopeProps;
  };
  return { root: p, exps: e };
}
