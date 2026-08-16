import { WebContext } from "../runtime/web/web-context";
import type { CoreScopeProps } from "../runtime/core/core-scope";
import type { PageState, RuntimeError } from "../runtime/core/core-context";
import { STATE_GLOBAL } from "../runtime/core/core-context";
import type { Page } from "../compiler/ir/Page";
import { ServerText } from "../html/server-dom";
import { escapeScriptText, serialize, UnserializableError } from "./serialize";

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
  }
): Promise<RuntimeError[]> {
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
  if (await ctx.settle(props?.settle)) {
    // Everything reading one of those values was evaluated once BEFORE it had
    // a result -- against the promise itself. `${rows.length}` was undefined
    // there and `${rows.filter(...)}` threw outright, and neither says
    // anything about the page: they are a value asked too early. Reporting
    // them buries the real ones, and in dev replaces the page with them.
    //
    // So the whole first reading is discarded and taken again now that the
    // results are in. Only the `settle` failures survive the cut, being the
    // one kind nothing later can turn into an answer.
    const definite = errors.filter(e => e.phase === 'settle');
    errors.length = 0;
    errors.push(...definite);
    ctx.resetReported();
    ctx.refresh();
  }
  emitState(page, ctx.collectState(), errors);
  return errors;
}

/**
 * Writes the collected `:server-` results into the reserved `<script>`.
 *
 * Serialized one value at a time so that one unsendable result costs only
 * itself: the rest of the page's state still reaches the client, and only
 * the value that failed is `undefined` there. It is reported either way --
 * a page that silently sent less than it meant to would show the failure as
 * a binding that renders wrong, far from its cause.
 */
function emitState(page: Page, state: PageState, errors: RuntimeError[]) {
  const script = page.stateScript;
  if (!script) {
    return;
  }
  const scopes: string[] = [];
  for (const [uid, values] of Object.entries(state)) {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      try {
        parts.push(`${JSON.stringify(key)}:${serialize(value)}`);
      } catch (err) {
        errors.push({
          phase: 'transfer',
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
    parts.length && scopes.push(`${JSON.stringify(uid)}:{${parts.join(',')}}`);
  }
  if (!scopes.length) {
    // nothing to send: leave no empty script behind, which is the common
    // case for any page that declares no `:server-` value at all
    script.parentElement?.removeChild(script);
    return;
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
