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
  | 'refresh'
  // a `:server-` value's promise that never usefully arrived
  | 'settle'
  // a `:server-` result the server could not send to the client
  | 'transfer';

/** how long a whole render may wait for its `:server-` values, in total */
export const DEFAULT_SETTLE_TIMEOUT_MS = 5000;
/**
 * How deep a chain of server values feeding each other may go. Small on
 * purpose: two or three links is a real page, and more usually means a value
 * feeding its own input, which would otherwise stall until the deadline on
 * every single request while reporting nothing but slowness.
 */
export const DEFAULT_SETTLE_MAX_ROUNDS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    // Node keeps the process alive for a pending timer, and this one loses
    // its race whenever the work finishes first -- which is the normal case
    (timer as unknown as { unref?: () => void }).unref?.();
  });
}

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

/**
 * What the server collected from `:server-` values once its render settled,
 * keyed by scope uid and then by value key.
 *
 * Deliberately a second artifact rather than part of the props: the props are
 * a function of the source and could be cached, while this is a function of
 * the request and never can be. See docs/design/value-transfer.md.
 */
export type PageState = { [uid: string]: { [key: string]: unknown } };

export const STATE_GLOBAL = '__MARKOUT_STATE';

export interface CoreContextProps {
  root: CoreScopeProps;
  addedGlobals?: { [key: string | symbol]: CoreValueProps<any> };
  /**
   * Receives every runtime error, replacing the default console logging.
   * Used by the server to collect them for the dev-mode overlay.
   */
  onError?: (e: RuntimeError) => void;
  /**
   * Results of the server's `:server-` values, if this is a client rehydrating
   * a served page. A value found here is built frozen -- with the result and
   * no expression -- instead of being derived again.
   */
  state?: PageState;
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

  /**
   * Every `:server-` value's result, for the server to send to the client.
   *
   * Call once the render has settled: it reads each value's current contents
   * rather than `get()`ting it, so a value still mid-flight would be
   * collected half-done rather than completed.
   *
   * A scope contributes under its `uid` (props.id plus replica path), which
   * is what makes a server-only value inside a `:for-each` land on the right
   * replica. A replica the client builds that the server never rendered
   * simply finds no entry and falls back to its expression.
   */
  collectState(): PageState {
    const state: PageState = {};
    this.eachServerValue((scope, key, value) => {
      (state[scope.uid] ??= {})[key] = value.value;
    });
    return state;
  }

  /**
   * Visits every live `:server-` value in the tree.
   *
   * A stencil's values are prototypes for its replicas rather than bindings
   * of its own, and nothing below one is evaluated either (see isStencil and
   * unlinkInert). Visiting there would treat `undefined` as a result when it
   * only means "never ran" -- and a `:for-data` guarding an absent item would
   * produce one for every page that doesn't show it. Its REPLICAS are
   * children too, and those are live, which is why this skips the prototype
   * markup rather than the whole subtree.
   *
   * Walked fresh on each call rather than cached: settling a value can add or
   * remove replicas, and a datasource that drives a `:for-each` brings whole
   * new subtrees -- with server values of their own -- into being.
   */
  private eachServerValue(
    visit: (scope: CoreScope, key: string, value: CoreValue) => void
  ): void {
    const walk = (scope: CoreScope) => {
      const stencil = scope.isStencil();
      const declared = stencil ? undefined : scope.props.values;
      if (declared) {
        for (const [key, valProps] of Object.entries(declared)) {
          if (!valProps.serverOnly) continue;
          const value = scope.values[key];
          value && visit(scope, key, value);
        }
      }
      for (const child of scope.children) {
        (!stencil || child.cloned) && walk(child);
      }
    };
    walk(this.root);
  }

  /**
   * Waits for every `:server-` value that produced a promise, replacing each
   * with what it resolved to.
   *
   * Async is allowed exactly where the result can be sent. A plain value's
   * promise would have to resolve in the browser too, and hydration is
   * synchronous, so there is nothing to wait with -- but a `:server-` value
   * is settled here and travels as its result, which is what lets a
   * datasource be an ordinary component:
   *
   *   <:define tag="std-data:span" :server-data=${fetch(src).then(r => r.json())} />
   *
   * This loops rather than awaiting once. One datasource's result can feed
   * another's URL, and settling propagates, so a value that was `null` while
   * its input was missing produces a promise of its own on the next pass.
   * Waiting a single time would serialize the page with the second request
   * still in flight.
   *
   * Two separate limits, because they mean different things. The deadline
   * bounds how long a visitor waits for a slow network. `maxRounds` bounds
   * how DEEP the waterfall may be, and a page that exceeds it has a bug --
   * a value feeding its own input would otherwise stall every render until
   * the deadline, reporting nothing but slowness.
   *
   * A value that rejects, times out, or is still pending at the cap becomes
   * `undefined` and is reported -- the same rule an expression that throws
   * already follows, and for the same reason: one fixed outcome beats a
   * result you have to reconstruct from what happened to finish.
   */
  async settle(props?: { timeoutMs?: number; maxRounds?: number }): Promise<void> {
    const timeoutMs = props?.timeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;
    const maxRounds = props?.maxRounds ?? DEFAULT_SETTLE_MAX_ROUNDS;
    const deadline = Date.now() + timeoutMs;

    for (let round = 0; ; round++) {
      const pending: { value: CoreValue; promise: PromiseLike<unknown> }[] = [];
      this.eachServerValue((_scope, _key, value) => {
        const held = value.value as PromiseLike<unknown> | undefined;
        if (held && typeof (held as { then?: unknown }).then === 'function') {
          pending.push({ value, promise: held });
        }
      });
      if (!pending.length) {
        return;
      }
      if (round >= maxRounds) {
        pending.forEach(p =>
          this.abandon(p.value, `still pending after ${maxRounds} rounds: ` +
            `a server value's result feeds another's input too deeply`)
        );
        return;
      }

      // Only the values whose own sources have settled. A promise is truthy,
      // so a dependent guarded on one -- `${a ? fetch(a.next) : null}` -- has
      // already run against the promise ITSELF and produced a result built
      // from it. Freezing that is the same wrong answer the propagation queue
      // is depth-ordered to avoid: it isn't stale, it's built from an input
      // that was mid-flight. Left alone, the value keeps its expression, and
      // settling its source re-evaluates it against the real thing.
      const waiting = new Set(pending.map(p => p.value));
      let batch = pending.filter(p => ![...p.value.src].some(src => waiting.has(src)));
      if (!batch.length) {
        // every pending value waits on another: nothing could be ordered
        // first, so take them all and let the round cap bound it rather than
        // spinning here reporting nothing
        batch = pending;
      }

      const settled = new Map<CoreValue, { ok: true; v: unknown } | { ok: false; e: unknown }>();
      await Promise.race([
        Promise.all(
          batch.map(p =>
            Promise.resolve(p.promise).then(
              v => void settled.set(p.value, { ok: true, v }),
              e => void settled.set(p.value, { ok: false, e })
            )
          )
        ),
        sleep(Math.max(0, deadline - Date.now())),
      ]);

      for (const { value } of batch) {
        const result = settled.get(value);
        if (!result) {
          // the deadline passed with this one still in flight. Reported and
          // dropped rather than waited on: the page is what the visitor is
          // here for, and a value that missed it can be produced again on a
          // later request
          this.abandon(value, `timed out after ${timeoutMs}ms`);
          continue;
        }
        if (!result.ok) {
          this.abandon(value, result.e instanceof Error ? result.e.message : `${result.e}`);
          continue;
        }
        // `set()` rather than a plain assignment: it propagates, which is how
        // the next link of a waterfall gets to run at all. It also discards
        // the expression, which is right here -- the expression's job was to
        // start the work, and re-running it would start it again
        value.set(result.v);
      }
      // a settled value may have failed and become `undefined`, which can
      // itself change what depends on it; the next pass sees whatever that
      // produced
    }
  }

  /** a server value that will never arrive: `undefined`, and reported */
  private abandon(value: CoreValue, message: string) {
    value.set(undefined);
    this.onError('settle', new Error(message), value);
  }

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
