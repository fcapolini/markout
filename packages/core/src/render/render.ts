import { DOM_STENCIL_ONCE_ATTR, WebContext } from "../runtime/web/web-context";
import { WebScope } from "../runtime/web/web-scope";
import type { CoreScope, CoreScopeProps } from "../runtime/core/core-scope";
import type { PageState, RuntimeError } from "../runtime/core/core-context";
import { STATE_GLOBAL } from "../runtime/core/core-context";
import type { Page } from "../compiler/ir/Page";
import { ServerText, type ServerElement, type ServerNode } from "../html/server-dom";
import { escapeScriptText, quote, serialize, UnserializableError } from "./serialize";

/**
 * Server-side render: evaluates the compiled propsString into real
 * functions -- the same code the browser runtime would eventually run --
 * and runs one WebContext refresh against the page's own ServerDocument,
 * so the served markup reflects each value's initial computed output
 * instead of shipping empty interpolation gaps for the client to fill in.
 *
 * Then fills the `<script>` stage7 reserved with whatever the page's
 * `:server-` values produced, so the client can use those results rather than
 * deriving them again -- which for a server-only expression it could not do
 * at all. See docs/design/value-transfer.md.
 *
 * Any expression that failed is returned rather than painted into the page:
 * the caller decides what to do with them (log them, and in dev mode serve
 * an error page instead of this one).
 */
export async function renderPage(
  page: Page,
  props?: {
    origin?: string;
    /** what the host supplied, by name -- see Compiler's serverGlobals */
    globals?: { [name: string]: unknown };
    settle?: { timeoutMs?: number; maxRounds?: number };
    /**
     * A Content-Security-Policy nonce for this response, stamped on the
     * scripts markout injected so a page can be served under a policy that
     * does not say `unsafe-inline`.
     *
     * Supplied per render rather than per compile because that is what a
     * nonce IS: reused across responses it stops being one. The compiled
     * page is cached and this writes to it, which is the same arrangement
     * the state script already lives with -- see emitState on why that has
     * to land in the same shape every time rather than accumulate.
     */
    nonce?: string;
  }
): Promise<RuntimeError[]> {
  // before the early return: a page with no props still carries whatever
  // scripts stage7 gave it, and one served under a policy needs them stamped
  applyNonce(page, props?.nonce);
  restoreStencils(page);
  if (!page.propsString) {
    return [];
  }
  const errors: RuntimeError[] = [];
  const root = new Function(`return (${page.propsString});`)() as CoreScopeProps;
  const ctx = new WebContext({
    root,
    doc: page.source.doc,
    onError: e => errors.push(e),
    // property bindings have nothing to write into a served page (see
    // WebContextProps.server); everything else renders as usual
    server: true,
    origin: props?.origin,
    // `val`, not `exp`: a supplied object is fixed for the life of the
    // render, so it links as an inert source the way the built-in globals do
    addedGlobals: props?.globals
      ? Object.fromEntries(Object.entries(props.globals).map(([k, v]) => [k, { val: v }]))
      : undefined,
  });
  ctx.refresh();
  // async is what the server has that the browser doesn't: a `:server-` value
  // may produce a promise, and this is where the page waits for it. Nothing
  // is serialized until it has, or has given up
  // Settling already brought the page up to date. `settle()` hands each
  // result to `CoreValue.set()`, which propagates -- so everything reading
  // one has re-evaluated and every binding it feeds has been written, which
  // is the same thing that happens in a browser when data arrives. There is
  // no second render for the MARKUP's sake.
  //
  // There is one for the ERRORS' sake, and only when the first pass
  // reported something. Everything reading a server value was evaluated
  // once before it had a result: `${rows.length}` was undefined there and
  // `${rows.filter(...)}` threw outright, and neither says anything about
  // the page -- they are a value asked too early. Those cannot simply be
  // dropped, because an expression that still fails would go unreported:
  // `set()` does not propagate when a value settles to what it already held
  // (a source that resolves to `undefined`), so the dependent never
  // re-evaluates and never speaks again. So the whole reading is taken
  // afresh, with only the `settle` failures carried over -- the one kind
  // nothing later can turn into an answer.
  //
  // A page whose expressions are guarded -- `${src.data ?? []}`, which is
  // what a datasource asks for -- reports nothing on that first pass and
  // skips this entirely: 61ms to 55ms on Orbit, about a tenth of its
  // render. Not more, because this was never a second render's worth of
  // work: refresh() re-evaluates values, it does not rebuild the scope
  // tree or relink the graph, and most of what it recomputes lands on the
  // value it already held and writes nothing.
  if (await ctx.settle(props?.settle) && errors.some(e => e.phase !== 'settle')) {
    const definite = errors.filter(e => e.phase === 'settle');
    errors.length = 0;
    errors.push(...definite);
    ctx.resetReported();
    ctx.refresh();
  }
  dropSpentStencils(ctx);
  emitState(page, ctx.collectState(), errors);
  return errors;
}

/**
 * Puts every region stencil back in `<head>`, in the order stage7 made them.
 *
 * A compiled page is cached and rendered once per request, and the previous
 * render may have dropped a stencil it had proved spent -- against data that
 * says nothing about this request's. Unlinked and re-appended wholesale
 * rather than only where one is missing, so that two responses to the same
 * page are byte-for-byte alike whatever either one dropped: a stencil put
 * back would otherwise land after the ones that stayed.
 */
function restoreStencils(page: Page) {
  const doc = page.source.doc;
  const head = doc.head ?? doc.documentElement;
  if (!head || !page.regionStencils.length) return;
  for (const template of page.regionStencils) {
    template.unlink();
    head.appendChild(template);
  }
}

/**
 * Drops the stencils this rendering has spent.
 *
 * A stencil marked `once` has at most one live scope -- an `:if`, `:else`,
 * `:else-if` or `:for-data` outside anything replicated -- so once that
 * scope's element is standing in the page there is nothing left to stamp
 * out of it: the region hides by detaching its element and shows by putting
 * that same element back. Serving the markup twice would be the one cost
 * this whole arrangement was not supposed to add.
 *
 * Asked of the scopes rather than of the markup, because the scope is what
 * knows: `dom` is the element and `isConnected` is the question, and both
 * are already the same two facts the runtime shows and hides by.
 */
function dropSpentStencils(ctx: WebContext) {
  const walk = (scope: CoreScope) => {
    const { dom, stencil } = scope as WebScope;
    stencil &&
      dom?.isConnected &&
      (stencil as unknown as ServerElement)
        .getAttributeNames()
        .includes(DOM_STENCIL_ONCE_ATTR) &&
      (stencil as unknown as ServerElement).unlink();
    scope.children.forEach(walk);
  };
  walk(ctx.root);
}

/**
 * Stamps this response's CSP nonce on the scripts markout injected.
 *
 * Removed rather than left alone when there is none, for the same reason
 * emitState clears the state script before writing it: the document is
 * cached and reused, so anything a render leaves behind is the PREVIOUS
 * request's answer -- and a stale nonce is worse than no nonce, since it is
 * the one value that must never outlive the response it was minted for.
 */
function applyNonce(page: Page, nonce?: string) {
  for (const script of page.bootstrapScripts) {
    nonce ? script.setAttribute('nonce', nonce) : script.removeAttribute('nonce');
  }
}

/**
 * Writes the collected `:server-` results into the reserved `<script>`.
 *
 * Serialized one value at a time so that one unsendable result costs only
 * itself: the rest of the page's state still reaches the client, and only
 * the value that failed is `undefined` there. It is reported either way --
 * a page that silently sent less than it meant to would show the failure as
 * a binding that renders wrong, far from its cause.
 *
 * Idempotent, which the rest of a render already was: a compiled page is
 * cached and rendered once per request, so everything here has to land in
 * the same shape every time rather than accumulate. Writing the markup is
 * naturally repeatable -- the second render overwrites what the first one
 * wrote, which is the same thing hydration does in the browser -- and this
 * was the one place that was not: it APPENDED, so a page served twice
 * carried two `window.__MARKOUT_STATE = ...` assignments, and served ten
 * times carried ten.
 */
function emitState(page: Page, state: PageState, errors: RuntimeError[]) {
  const script = page.stateScript;
  if (!script) {
    return;
  }
  // whatever a previous render left here answers for the previous request
  [...script.childNodes].forEach(n => script.removeChild(n));
  const scopes: string[] = [];
  for (const [uid, values] of Object.entries(state)) {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      try {
        // `quote`, not `JSON.stringify`: a JSON string is not a JS string
        // literal, and the difference is exactly the characters that matter
        // here -- it leaves `<` and the two line-terminator code points
        // alone. Names are the compiler's own and hold none of that, but
        // this is the one place data reached the output without passing
        // through the serializer's escaper, and one escaper is the property
        // worth having
        parts.push(`${quote(key)}:${serialize(value)}`);
      } catch (err) {
        errors.push({
          phase: 'transfer',
          // only a `:server-` value is ever transferred, so this is always
          // the unrepairable kind: the client gets no result and no
          // expression to derive one from
          serverOnly: true,
          scope: uid,
          key,
          message:
            err instanceof UnserializableError
              ? err.message
              : err instanceof Error
                ? err.message
                : `${err}`,
        });
      }
    }
    parts.length && scopes.push(`${quote(uid)}:{${parts.join(',')}}`);
  }
  if (!scopes.length) {
    // nothing to send: leave no empty script behind, which is the common
    // case for any page that declares no `:server-` value at all. Where it
    // stood is remembered, because a later render of this same page may
    // have something to send and would otherwise have nowhere to put it
    if (script.parentNode) {
      page.stateScriptAt = {
        parent: script.parentNode,
        before: (script.nextSibling as ServerNode | null) ?? undefined,
      };
      script.parentNode.removeChild(script);
    }
    return;
  }
  if (!script.parentNode && page.stateScriptAt) {
    const { parent, before } = page.stateScriptAt;
    before ? parent.insertBefore(script, before) : parent.appendChild(script);
  }
  script.appendChild(
    new ServerText(
      page.source.doc,
      escapeScriptText(`window.${STATE_GLOBAL} = {${scopes.join(',')}};`),
      script.loc,
      false
    )
  );
}
