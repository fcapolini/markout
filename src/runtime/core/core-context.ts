import { CoreGlobal } from './core-global';
import { CoreScope, CoreScopeProps } from './core-scope';
import { CoreValue, CoreValueProps } from './core-value';

export const PROPS_GLOBAL = '__MARKOUT_PROPS';
/** set alongside PROPS_GLOBAL when the page was compiled in dev mode */
export const DEV_GLOBAL = '__MARKOUT_DEV';

/** which part of the reactive cycle an error came out of */
export type RuntimeErrorPhase =
  | 'link'
  | 'update'
  | 'propagate'
  | 'callback'
  | 'refresh';

export interface RuntimeError {
  phase: RuntimeErrorPhase;
  /** id of the scope owning the value involved, when there is one */
  scope?: string;
  /** the value's key within that scope, when there is one */
  key?: string;
  message: string;
}

export function formatRuntimeError(e: RuntimeError): string {
  const where = e.scope ? ` ${e.scope}${e.key ? `.${e.key}` : ''}` : '';
  return `markout [${e.phase}]${where}: ${e.message}`;
}

export interface CoreContextProps {
  root: CoreScopeProps;
  addedGlobals?: { [key: string | symbol]: CoreValueProps<any> };
  /**
   * Receives every runtime error, replacing the default console logging.
   * Used by the server to collect them for the dev-mode overlay.
   */
  onError?: (e: RuntimeError) => void;
}

export class CoreContext {
  props: CoreContextProps;
  global: CoreScope;
  root: CoreScope;
  cycle = 0;
  refreshLevel = 0;
  pushLevel = 0;

  constructor(props: CoreContextProps) {
    this.props = props;
    this.global = new CoreGlobal(this, props.addedGlobals);
    this.init();
    this.root = this.newScope(props.root, this, this.global);
  }

  refresh(scope?: CoreScope, nextCycle = true): this {
    scope || (scope = this.root);
    this.refreshLevel++;
    try {
      nextCycle && this.cycle++;
      scope.unlinkValues();
      scope.linkValues();
      scope.updateValues();
    } catch (err) {
      this.onError('refresh', err);
    }
    if (--this.refreshLevel < 1) {
      this.applyPending();
    }
    return this;
  }

  /**
   * Called after Global is created but before scopes are.
   */
  init() {}

  newScope(
    props: CoreScopeProps,
    context: CoreContext,
    parent?: CoreScope
  ): CoreScope {
    return new CoreScope(props, context, parent);
  }

  // ===========================================================================
  // error reporting
  // ===========================================================================

  /**
   * Every runtime failure funnels through here, so there's exactly one place
   * deciding what "an error happened" means — the console by default, or
   * whatever `props.onError` wants (the dev overlay, a server log, a reporter).
   *
   * Nothing in the runtime may swallow an error instead of calling this. A
   * caught-and-ignored failure doesn't stop a page, it produces a binding that
   * renders once and is wrong forever, which is far harder to diagnose than a
   * message would have been.
   */
  onError(phase: RuntimeErrorPhase, err: unknown, value?: CoreValue): void {
    const e: RuntimeError = {
      phase,
      scope: value?.scope.props.id,
      key: value?.key,
      message: err instanceof Error ? err.message : `${err}`,
    };
    // a broken expression re-evaluates on every cycle, so report each
    // distinct problem once instead of once per cycle
    const seen = `${e.phase}|${e.scope}|${e.key}|${e.message}`;
    if (this.reported.has(seen)) {
      return;
    }
    // bounded: a page generating endless distinct messages shouldn't also
    // leak memory through the de-duplication set
    this.reported.size < 1000 && this.reported.add(seen);
    this.reportError(e);
  }

  /** where a (de-duplicated) error actually goes; WebContext extends this to
   * additionally paint it into the page when running in dev mode */
  protected reportError(e: RuntimeError): void {
    this.props.onError
      ? this.props.onError(e)
      : console.error(formatRuntimeError(e));
  }

  protected reported = new Set<string>();

  // ===========================================================================
  // changes batching
  // ===========================================================================
  pending = new Set<CoreValue>();
  /**
   * Scopes built since the last settled refresh, waiting to be told so.
   *
   * Drained after `pending`, so `:did-init` runs against a scope whose
   * values are evaluated and whose bindings have reached the DOM -- the
   * first moment at which "this scope exists" is actually true.
   */
  arrived = new Set<CoreScope>();

  applyPending() {
    try {
      this.pending.forEach(v => {
        try {
          v.cb!(v.scope, v.value);
        } catch (err) {
          // one failing callback must not cost the rest of the batch their
          // notification -- they're unrelated values that happened to change
          // in the same cycle
          this.onError('callback', err, v);
        }
      });
    } finally {
      this.pending.clear();
    }
    // after the bindings, and snapshotted: a `:did-init` may build more
    // scopes, and those belong to the next drain rather than to this one's
    // iteration
    const arrived = [...this.arrived];
    this.arrived.clear();
    arrived.forEach(s => s.settle());
  }
}
