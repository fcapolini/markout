import type { CompiledProps } from '../compiler/ir/Page';
import type { CoreScopeProps } from '../runtime/core/core-scope';
import type { ValueExp } from '../runtime/core/core-value';

/**
 * Reads the props a page carries back into the two things a context needs.
 *
 * They travel as two halves -- an array of the expressions, which have to be
 * JavaScript, and a tree of data referring to them by index (see stage7's
 * emitProps) -- and every loader outside the browser has to put them back
 * together the same way. One place that knows the shape, so a change to it
 * is a change to one function rather than to everything that ever loaded a
 * page's props by hand.
 *
 * Only the expressions go near `new Function`. The tree is JSON and is
 * parsed as JSON, which is both faster and the reason it can be carried as
 * text rather than escaped into a string literal.
 *
 * Not what the BROWSER does: there the page's own `<script>` has already
 * evaluated them into `window.__MARKOUT_PROPS`, and the runtime never
 * evaluates source -- which is what lets a page be served under a policy
 * that does not say `unsafe-eval`.
 */
export function loadProps(props: CompiledProps): {
  root: CoreScopeProps;
  exps: ValueExp<any>[];
} {
  return {
    root: JSON.parse(props.data) as CoreScopeProps,
    exps: new Function(`return (${props.exps});`)() as ValueExp<any>[],
  };
}
