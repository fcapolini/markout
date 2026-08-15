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
  /**
   * Bumped whenever the dependency graph's shape changes, which is what
   * CoreValue.depthNow() memoizes against. Linking and unlinking are the
   * only things that move it, and both happen inside a refresh -- plus
   * `set()` discarding an expression, which drops that value's own edges.
   */
  graphVersion = 0;

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
      this.graphVersion++;
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
  // propagation order
  // ===========================================================================

  /**
   * The values a push still has to re-evaluate, bucketed by their distance
   * from the values they depend on (see CoreValue.depthNow()).
   *
   * Shallowest first, one at a time: whichever value comes out next has no
   * source left in here, since a source is always strictly shallower. That
   * is what keeps a value from being evaluated against inputs that are
   * half-way through the same change.
   *
   * An array indexed by depth, holding arrays. Depths are small integers, so
   * indexing beats hashing, and the buckets are kept between pushes rather
   * than reallocated. Duplicates are left in rather than deduplicated: a
   * value evaluates at most once per cycle whatever arrives here (get()
   * checks), so a Set would only be buying uniqueness the cycle already
   * guarantees -- and at a cost paid on every edge. The benchmark's twenty
   * cart clicks push 800k values through this on a 10k-row page.
   */
  private queue: CoreValue[][] = [];
  private minDepth = Infinity;
  private maxDepth = -1;

  enqueue(value: CoreValue): void {
    const depth = value.depthNow();
    (this.queue[depth] ??= []).push(value);
    depth < this.minDepth && (this.minDepth = depth);
    depth > this.maxDepth && (this.maxDepth = depth);
  }

  drain(): void {
    while (this.minDepth <= this.maxDepth) {
      const bucket = this.queue[this.minDepth];
      if (!bucket || !bucket.length) {
        // nothing left this shallow: evaluating what was here can only have
        // enqueued deeper, so the front never moves backwards
        this.minDepth++;
        continue;
      }
      // the whole level in one pass. Evaluating a value at this depth can
      // only enqueue deeper -- its dependents read it, so they are strictly
      // below -- which is what makes it safe to walk the bucket by index
      // and empty it at the end rather than re-checking the front each time
      for (let i = 0; i < bucket.length; i++) {
        const value = bucket[i];
        try {
          value.get();
        } catch (err) {
          // one value's internal breakage must not strand the rest of the
          // queue: those are unrelated bindings that happened to change in
          // the same push
          this.onError('propagate', err, value);
        }
      }
      bucket.length = 0;
      this.minDepth++;
    }
    this.minDepth = Infinity;
    this.maxDepth = -1;
  }

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
