import { CoreGlobal, ORIGIN_GLOBAL, URL_GLOBAL, UrlValue } from './core-global';
import { CoreScope, CoreScopeProps } from './core-scope';
import { CoreValue, CoreValueProps, ValueExp } from './core-value';

export const PROPS_GLOBAL = '__MARKOUT_PROPS';
/**
 * Marks the `<script type="application/json">` carrying a page's scope tree.
 *
 * An attribute rather than an id, because an id would be a name taken out of
 * the page author's namespace -- the same reason everything else the
 * compiler leaves behind is a `data-markout` attribute or a comment.
 */
export const PROPS_DATA_ATTR = 'data-markout-props';
/** set alongside PROPS_GLOBAL when the page was compiled in dev mode */
export const DEV_GLOBAL = '__MARKOUT_DEV';
/**
 * Dev only: where each value was written, keyed `scopeId.key`.
 *
 * Set beside the props by a page compiled in dev mode, and absent from every
 * other page -- which is the point. See CompiledProps.locs.
 */
export const LOCS_GLOBAL = '__MARKOUT_LOCS';

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
  /**
   * Where the value was written -- `file:line:column` -- in dev mode.
   *
   * Absent outside it, because the map this is read from is dev only: a
   * served page must not describe its own sources. Absent too for a failure
   * that belongs to no value, which is what `phase: 'refresh'` is.
   */
  loc?: string;
  message: string;
  /**
   * Whether the value that failed was declared `:server-`.
   *
   * The difference is whether anything can still repair it. An ordinary value
   * that throws while rendering is re-derived in the browser, where it may
   * well succeed -- `${user.name}` before its datasource has answered is the
   * common case, and the served page is fine. A `:server-` value arrives
   * frozen, with a result and no expression, so nothing re-runs it: a failure
   * here is what the page will hold for as long as it exists.
   *
   * Which is why `markout build` fails on this one and warns about the other.
   * Recorded rather than inferred from `phase`, because both a rejected
   * promise (`settle`) and an expression that throws outright (`update`) are
   * this kind, and the phase cannot tell them from an ordinary value's.
   */
  serverOnly?: boolean;
}

export function formatRuntimeError(e: RuntimeError): string {
  // the location when there is one, because a scope uid is the compiler's
  // name for something and a file and a line is the author's. The key stays
  // either way: it is the one part of the pair they wrote
  const where = e.loc
    ? ` ${e.loc}${e.key ? ` (${e.key})` : ''}`
    : e.scope
      ? ` ${e.scope}${e.key ? `.${e.key}` : ''}`
      : '';
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
  /**
   * The page's expressions, which its values refer to by index.
   *
   * Props are data with holes in them: everything a scope carries is JSON
   * except the expressions, which have to be JavaScript. Lifting them out
   * lets the tree be `JSON.parse`d rather than evaluated as a JavaScript
   * object literal -- about five times faster, since the structure never
   * reaches the JavaScript parser -- and lets the identical ones be shared,
   * which most of a page's are once a component has more than one instance.
   *
   * Absent for props built by hand, where a value's `exp` is the function
   * itself. See CoreValue's constructor.
   */
  exps?: ValueExp<any>[];
  addedGlobals?: { [key: string | symbol]: CoreValueProps<any> };
  /**
   * Receives every runtime error, replacing the default console logging.
   * Used by the server to collect them for the dev-mode overlay.
   */
  onError?: (e: RuntimeError) => void;
  /**
   * Dev only: where each value was written, keyed `scopeId.key`.
   *
   * Compiled by stage7 and carried to the browser beside the props. Passing
   * it is what turns `s12.total` into `index.html:47:13 (total)` in every
   * report -- the console, the dev overlay, the server log -- since all of
   * them go through `formatRuntimeError`.
   */
  locs?: { [key: string]: string };
  /**
   * Results of the server's `:server-` values, if this is a client rehydrating
   * a served page. A value found here is built frozen -- with the result and
   * no expression -- instead of being derived again.
   */
  state?: PageState;
  /**
   * The page's own origin (`https://example.test`), as `$origin`.
   *
   * Supplied rather than discovered, because the two sides discover it
   * differently -- from the request while rendering, from `location.origin`
   * in the browser -- and the whole value of the name is that they agree.
   * Absent, `$origin` is `undefined`, which is what a page compiled outside
   * any server should see.
   */
  origin?: string;
  /**
   * The whole address, as `$url` -- `location.href` in the browser, and
   * what the request asked for on the server.
   *
   * Supplied as a string and built into a `URL` here, so a caller passes
   * the one thing it has rather than constructing a value the runtime
   * would have to validate anyway. An unparseable one is treated as none:
   * a page whose address cannot be read is a page rendering without one,
   * not a render that fails.
   *
   * Given this and no `origin`, `$origin` is taken from it -- the two are
   * one fact, and a caller that knows the address knows the origin.
   */
  url?: string;
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
  /**
   * Values holding a dependency that may not exist -- see
   * CoreValueProps.maybeDeps.
   *
   * Kept as a set rather than found by walking, because what has to happen
   * when a region toggles is bounded by how many references reach into one,
   * and a page has few of those and a great many scopes.
   */
  maybes = new Set<CoreValue>();
  /**
   * The name values of scopes that live inside a region -- see
   * CoreScope.regionName.
   *
   * Kept here for the same reason as `maybes`: what has to be re-asked when a
   * region toggles is bounded by how many names reach into one, and the walk
   * that would find them is the whole tree.
   */
  regionNames = new Set<CoreValue>();

  constructor(props: CoreContextProps) {
    this.props = props;
    const url = parseUrl(props.url);
    // `$origin` is the document's, and a same-document navigation cannot
    // change it -- so it is taken once, here, and never follows `$url`
    const origin = props.origin ?? url?.origin;
    this.global = new CoreGlobal(this, {
      ...(origin === undefined ? {} : { [ORIGIN_GLOBAL]: { val: origin } }),
      ...(url === undefined ? {} : { [URL_GLOBAL]: { val: this.guarded(url) } }),
      ...props.addedGlobals,
    });
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
   * Re-resolve every dependency that reaches into a region, because one has
   * just appeared or gone.
   *
   * The edge into a region cannot be made before its scopes exist, and has to
   * be dropped again when they stop existing. Without the second half a
   * reader keeps whatever it last saw while the region was up -- which is
   * worse than the error this feature replaced, being both wrong and silent.
   *
   * Called from the toggle rather than from a refresh: `refresh(scope)` walks
   * the subtree it is given, and the values that need this are OUTSIDE the
   * region, which is the one place that walk does not reach.
   */
  relinkMaybes() {
    if (!this.maybes.size && !this.regionNames.size) {
      return;
    }
    // the graph really has changed shape, and a depth memoized against the
    // old one would order the drain by edges that are no longer there
    this.graphVersion++;
    // names first: a reader is about to evaluate `panel.field?.x`, and what
    // `field` answers has to be current before it does
    this.regionNames.forEach(value => value.relink());
    this.maybes.forEach(value => value.relink());
    this.applyPending();
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
   * simply finds no entry, and is `undefined` there.
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
      // and what this scope's usage site declared, which lives on a scope of
      // its own (see CoreScope.usageSiteScope) and would otherwise be
      // evaluated here and collected nowhere -- leaving the browser a
      // `:server-` value with no expression and no result, which is the one
      // shape that fails in silence
      const site = stencil ? undefined : scope.usageSite;
      if (site) {
        for (const [key, valProps] of Object.entries(scope.props.usageValues!)) {
          if (!valProps.serverOnly) continue;
          const value = site.values[key];
          value && visit(site, key, value);
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
   *
   * Answers whether anything was actually waited for, which tells the caller
   * that everything reading one of these evaluated once too early and has to
   * be judged again -- see renderPage.
   */
  async settle(props?: { timeoutMs?: number; maxRounds?: number }): Promise<boolean> {
    const timeoutMs = props?.timeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;
    const maxRounds = props?.maxRounds ?? DEFAULT_SETTLE_MAX_ROUNDS;
    const deadline = Date.now() + timeoutMs;
    this.settledAny = false;
    await this.settleRounds(deadline, timeoutMs, maxRounds);
    return this.settledAny;
  }

  /** whether anything actually needed waiting for */
  private settledAny = false;

  /**
   * Forgets which errors have already been reported.
   *
   * `onError` reports each distinct problem once, which is right for a page
   * that keeps re-evaluating a broken expression -- and wrong for the one
   * pass that has to be allowed to say the same thing again, after settling,
   * having had its first attempt discarded.
   */
  resetReported() {
    this.reported.clear();
  }

  private async settleRounds(
    deadline: number,
    timeoutMs: number,
    maxRounds: number
  ): Promise<void> {
    for (let round = 0; ; round++) {
      const pending: { value: CoreValue; promise: PromiseLike<unknown> }[] = [];
      this.eachServerValue((_scope, _key, value) => {
        // `pending`, not `value`: a promise is never the value. What a page
        // reads while one is in flight is `undefined`
        value.pending && pending.push({ value, promise: value.pending });
      });
      if (!pending.length) {
        return;
      }
      if (round >= maxRounds) {
        pending.forEach(p =>
          this.abandon(p.value, `still pending after ${maxRounds} rounds: ` +
            `a server value's result feeds another's input too deeply, ` +
            `or two of them wait on each other`)
        );
        return;
      }

      // Only the values whose own sources have arrived.
      //
      // A guarded chain no longer needs this -- `${a ? f(a) : null}` sees
      // `undefined` while `a` is in flight and declines, since a promise is
      // never a value. An UNGUARDED one still does: `${Promise.resolve(a * 10)}`
      // computes `NaN` from that same `undefined` and asks for it in earnest.
      // Settling that freezes the answer, because settling drops the
      // expression, and `NaN` is then what the page renders -- with nothing
      // reported, which is the one outcome this language does not produce.
      // Skipped instead, the value keeps its expression, and its source
      // landing re-evaluates it against the real thing.
      //
      // Nothing rescues a batch where every pending value waits on another
      // -- two server values each holding a promise of the other, which
      // compiles. Settling them anyway would hand the page whatever garbage
      // they computed from each other's absence; leaving them alone costs a
      // few empty rounds and then says so.
      const waiting = new Set(pending.map(p => p.value));
      const batch = pending.filter(p => ![...p.value.src].some(src => waiting.has(src)));

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
        this.settledAny = true;
      }
      // a settled value may have failed and become `undefined`, which can
      // itself change what depends on it; the next pass sees whatever that
      // produced
    }
  }

  /** a server value that will never arrive: `undefined`, and reported */
  private abandon(value: CoreValue, message: string) {
    value.set(undefined);
    this.settledAny = true;
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
  /**
   * Where a page goes when it writes `$url`.
   *
   * A write is a request, not a fact: the browser decides what it costs,
   * and `$url` changes when it says the address changed (see
   * WebContext.navigate and browser.ts). Nothing to navigate here -- a
   * render has one address for its whole life -- so the base is a no-op,
   * which is also the right answer while serving.
   */
  navigate(_href: string | URL): void {}

  /**
   * Takes the address the browser now has.
   *
   * The only way `$url` changes. Called by whatever heard the navigation,
   * so the value and the address bar cannot disagree -- a redirected or
   * refused navigation simply never arrives here.
   */
  adoptUrl(href: string): void {
    const url = parseUrl(href);
    const value = this.global.values[URL_GLOBAL];
    if (!url || !(value instanceof UrlValue)) return;
    // by href, since a fresh URL is never `===` the last one and every
    // navigation would otherwise wake every reader
    if (`${(value.get() as URL | undefined)?.href}` === url.href) return;
    // adopt(), not set(): a set IS the page asking to navigate, and this is
    // the answer coming back
    value.adopt(this.guarded(url));
    this.refresh();
  }

  /**
   * A `URL` that says so when a page writes to its parts.
   *
   * `$url.pathname = '/x'` changes the object and tells nobody: markout
   * notices a value being SET, not a member of one being written, so the
   * page would go on showing the old address while holding the new one.
   * Assignment is the write that means something (`$url = '/x'`), and this
   * is what says so instead of failing quietly.
   *
   * Reads are forwarded with the real URL as the receiver, which host
   * objects require -- a `URL` keeps its parts in internal slots, and
   * calling `toString()` with a proxy as `this` throws.
   */
  private guarded(url: URL): URL {
    return new Proxy(url, {
      get: (target, prop) => {
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
      set: (_target, prop) => {
        this.onError(
          'update',
          new Error(
            `$url.${String(prop)} cannot be written: assign to $url itself ` +
              `($url = '/somewhere') to navigate, which is what tells the ` +
              `page it moved`
          )
        );
        return true;
      },
    });
  }

  onError(phase: RuntimeErrorPhase, err: unknown, value?: CoreValue): void {
    const scope = value?.scope.props.id;
    const key = value?.key;
    const e: RuntimeError = {
      phase,
      scope,
      key,
      loc:
        scope && key !== undefined ? this.props.locs?.[`${scope}.${key}`] : undefined,
      message: err instanceof Error ? err.message : `${err}`,
      serverOnly: value?.props.serverOnly,
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

/** a `URL` from what a caller had, or nothing if it was not an address */
function parseUrl(href?: string): URL | undefined {
  if (!href) return undefined;
  try {
    return new URL(href);
  } catch {
    return undefined;
  }
}
