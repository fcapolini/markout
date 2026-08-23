import { CoreScope } from './core-scope';

export type ValueExp<T> = () => T;
/**
 * A dependency, as the path to it: `[...via, key]`.
 *
 * Data rather than a thunk, which is what it used to be -- one
 * `function () { return this.$value('total'); }` per edge, to say what
 * `'total'` says. On a page of any size those closures were the single
 * largest thing the props shipped, and every one of them was allocated at
 * mount to be called once. The runtime already knew how to walk a
 * scope path; now it walks this one.
 *
 * Every segment before the last is a property of the scope proxy --
 * `$parent`, `$host`, or a named scope's `:aka` -- and the last is the
 * value's key on whatever that arrives at.
 */
export type ValueDep = string[];
export type ValueCallback<T> = (s: CoreScope, v: T | undefined) => void;

/** the scope property a dependency may legitimately arrive nowhere through */
const RT_HOST_KEY = '$host';

export interface CoreValueProps<T> {
  val?: T;
  exp?: () => T;
  deps?: ValueDep[];
  /**
   * Dependencies the runtime is allowed to find nothing for.
   *
   * The one exception to the compiler contract's rule that every dep resolves
   * (see RUNTIME.md). A reference that walks into a region -- `:if`, `:else`,
   * `:for-data` -- names a scope that does not exist while that region is
   * away, and the page said so by writing `?.` at the crossing. Absent, the
   * edge is simply not made; `CoreContext.relinkMaybes` makes it when the
   * region comes back, and takes it away again when it goes.
   */
  maybeDeps?: ValueDep[];
  /**
   * This value belongs to a custom-tag instance but was written at the usage
   * site, so it evaluates against the scope containing that site rather than
   * against the instance -- an expression resolves where it was written. It
   * still LIVES on the instance, so the definition can read it.
   */
  callSite?: boolean;
  /**
   * Declared `:server-name`: this expression runs on the server only. The
   * server collects the result once the render has settled and sends it
   * alongside the props; the client builds the value from that result
   * instead, with no `exp` and no `deps` (see CoreContext.collectState and
   * CoreScope's constructor).
   */
  serverOnly?: boolean;
}

export class CoreValue<T = any> {
  props: CoreValueProps<T>;
  scope: CoreScope;
  /** this value's key in its scope -- carried purely so errors can name it */
  key?: string;
  cb?: ValueCallback<T>;
  src: Set<CoreValue>;
  dst: Set<CoreValue>;
  cycle: number;
  exp?: ValueExp<T>;
  value: T | undefined;
  /**
   * A `:server-` expression's promise, while it is in flight.
   *
   * Held HERE rather than in `value`, so a promise is never something a page
   * can see. Everything downstream is written against data -- `${rows.length}`,
   * `${user ? ... : null}` -- and a promise standing in for the data it will
   * become is the wrong shape for all of it: it is truthy, so guards pass; it
   * has no `.length`; and `${'' + it}` renders "[object Promise]". Kept aside,
   * a value that hasn't arrived reads as `undefined`, which is what "not there"
   * already means everywhere else in this language.
   *
   * The server drains these (CoreContext.settle); nothing else looks at them.
   */
  pending?: PromiseLike<unknown>;
  /**
   * What this value's sources held when its in-flight request was built.
   *
   * Only kept while `pending` is set, and only for a server value, so an
   * ordinary value carries none of this: it exists to answer one question,
   * asked once per re-read of a value that is already waiting.
   */
  private srcSnapshot?: unknown[];

  private snapshotSources() {
    const seen: unknown[] = [];
    this.src.forEach(o => seen.push(o.value));
    this.srcSnapshot = seen;
  }

  private sourcesMoved(): boolean {
    const was = this.srcSnapshot;
    if (!was || was.length !== this.src.size) {
      return true;
    }
    let i = 0;
    let moved = false;
    this.src.forEach(o => {
      moved = moved || o.value !== was[i++];
    });
    return moved;
  }

  /** longest path from a value with no sources; see depthNow() */
  depth = 0;
  private depthVersion = -1;

  constructor(
    props: CoreValueProps<T>,
    scope: CoreScope,
    key?: string,
    cb?: ValueCallback<T>
  ) {
    this.props = props;
    this.scope = scope;
    this.key = key;
    this.cb = cb;
    this.src = new Set();
    this.dst = new Set();
    this.cycle = 0;
    this.exp = props.exp;
    this.value = props.val;
  }

  setCB(cb: ValueCallback<T>) {
    this.cb = cb;
    !this.exp && this.scope.ctx.pending.add(this);
  }

  link() {
    // may resolve to nothing, and that is not an error: the region it reaches
    // into is away. Registered either way, so relinkMaybes can come back to it
    if (this.props.maybeDeps?.length) {
      this.scope.ctx.maybes.add(this);
      this.props.maybeDeps.forEach(dep => {
        try {
          const o = this.resolveDep(dep, true);
          if (o) {
            o.dst.add(this);
            this.src.add(o);
          }
        } catch (err) {
          this.scope.ctx.onError('link', err, this);
        }
      });
    }
    this.props.deps?.forEach(dep => {
      try {
        const o = this.resolveDep(dep, false);
        if (!o) {
          // the compiler guarantees every dep resolves to a real value (see
          // RUNTIME.md's compiler contract). Reaching here means it emitted one
          // pointing at nothing -- a markout bug, not a page bug. Left silent,
          // its only symptom is a binding that never updates again
          throw new Error('unresolved dependency');
        }
        o.dst.add(this);
        this.src.add(o);
      } catch (err) {
        this.scope.ctx.onError('link', err, this);
      }
    });
  }

  /**
   * Walks a dependency's path from this value's own scope.
   *
   * `maybe` says the scopes along the way are allowed not to be there: the
   * page wrote `?.` at a crossing into a region, and while that region is
   * away the path simply arrives nowhere. Otherwise only the last step is
   * forgiving, and answering nothing there is the compiler bug link()
   * reports -- a path that cannot be walked at all still throws, which is
   * how it always behaved.
   *
   * `$host` is the one navigation that legitimately arrives nowhere even
   * outside a region: a component standing on its own has no enclosing
   * instance. It falls back to `$host` itself, which is on every scope and
   * never changes -- so inside a host the value depends on what it reads,
   * and outside one it depends on a constant, which is what "there is
   * nothing there to watch" should cost.
   */
  private resolveDep(dep: ValueDep, maybe: boolean): CoreValue<any> | undefined {
    const last = dep.length - 1;
    let scope: any = this.scope.proxy;
    for (let i = 0; i < last && scope != null; i++) {
      scope = maybe || dep[i] === RT_HOST_KEY ? scope?.[dep[i]] : scope[dep[i]];
    }
    const found = scope?.$value(dep[last]);
    return !found && !maybe && dep.indexOf(RT_HOST_KEY) >= 0
      ? (this.scope.proxy as any).$value(RT_HOST_KEY)
      : found;
  }

  /**
   * Resolve this value's dependencies again, because what they name has come
   * or gone.
   *
   * Only ever called for a value with `maybeDeps`, and only when a region has
   * toggled: the edge into it cannot be made before the scopes exist, and has
   * to be dropped again when they stop existing -- otherwise a reader keeps
   * whatever it last saw, which is the stale-and-silent failure this whole
   * feature exists to avoid.
   */
  relink() {
    this.unlink();
    this.link();
    this.exp && this.update();
  }

  unlink() {
    this.src.forEach(o => o.dst.delete(this));
    this.dst.forEach(o => o.src.delete(this));
    // without these, whether a link survives depends on the order values are
    // unlinked in: a dependency unlinked first empties its dependent's `src`,
    // so the dependent can no longer remove itself from the dependency's
    // `dst`, which then keeps pointing at it
    this.src.clear();
    this.dst.clear();
  }

  get(): T | undefined {
    const ctx = this.scope.ctx;
    if (this.exp && this.cycle !== ctx.cycle) {
      const first = !this.cycle;
      // marked BEFORE evaluating, not after. update() can propagate straight
      // into a value whose own expression reads this one back -- `:fmt=${(n)
      // => n + suffix}` with `${fmt(count)}` is the everyday shape of it --
      // and arriving here with a stale cycle would evaluate this value a
      // second time, mid-flight. For an ordinary value that lands on the
      // same result and stops; for one that builds something new every time,
      // a function or an object literal, every pass differs from the last,
      // so each propagates again and the recursion only ends at the stack
      this.cycle = ctx.cycle;
      if (first || this.src.size) {
        this.update();
      }
    }
    return this.value;
  }

  set(value: T) {
    const old = this.value;
    // whatever was in flight is answered for now, one way or another
    this.pending = undefined;
    delete this.exp;
    // an expression value becoming static drops every edge into it, which
    // moves this value's depth and its dependents'. Rare, and the only way
    // the graph changes outside a refresh -- an ordinary `set()` on a value
    // that never had sources leaves the shape alone and must not invalidate
    // what the whole page's depths are memoized against
    this.src.size && this.scope.ctx.graphVersion++;
    this.src.forEach(o => o.dst.delete(this));
    this.src.clear();
    this.value = value;
    if (old == null ? value != null : value !== old) {
      this.cb && this.scope.ctx.pending.add(this);
      this.propagate();
    }
    return true;
  }

  protected update() {
    // One request per set of inputs.
    //
    // A value with sources re-evaluates whenever it is read in a new cycle,
    // and settling anything opens one -- so a server value whose request is
    // still in the air gets asked again, and again, for exactly the same
    // thing. On a page with ten sources that was twenty-one requests, every
    // duplicate's answer discarded because the loop settles each with the
    // first promise it saw.
    //
    // But it must NOT hold when an input actually moved: that is the case
    // where the request in flight was built from something that has since
    // arrived, and asking again is the whole point. So the test is whether
    // anything it reads has changed, not merely whether a cycle has passed.
    if (this.pending && !this.sourcesMoved()) {
      return;
    }
    const old = this.value;
    try {
      const next = this.exp!.apply(this.scope.proxy) as unknown;
      // a server expression may answer with a promise; the promise is not
      // the value, and never becomes one. See `pending`
      const thenable =
        this.props.serverOnly &&
        !!next &&
        typeof (next as { then?: unknown }).then === 'function';
      this.pending = thenable ? (next as PromiseLike<unknown>) : undefined;
      this.value = thenable ? undefined : (next as T);
      this.pending && this.snapshotSources();
    } catch (err) {
      // a failed expression yields `undefined`, always -- never whatever it
      // happened to hold before. Keeping the old value would make the result
      // depend on which evaluations previously succeeded, and would show
      // stale data as though it were current
      this.value = undefined;
      this.scope.ctx.onError('update', err, this);
    }
    if (old == null ? this.value != null : this.value !== old) {
      this.cb && this.scope.ctx.pending.add(this);
      this.dst.size && this.scope.ctx.refreshLevel < 1 && this.propagate();
    }
  }

  /**
   * How far this value is from the nearest value that depends on nothing.
   *
   * It is what orders a propagation. A value's sources are all strictly
   * shallower than it is -- reading something is what makes it a source --
   * so working outwards from the shallowest pending value means every input
   * a value has has already settled by the time it is evaluated.
   *
   * Memoized against the graph rather than the cycle. Keying it per cycle
   * looked harmless and cost 3x on the benchmark's twenty rapid mutations:
   * every push opens a new cycle, so each one re-walked the sources of
   * everything it touched -- O(edges) per click, on a graph whose edges grow
   * with the rows on screen. The graph only moves when values are linked or
   * unlinked, which is what `graphVersion` counts.
   */
  depthNow(): number {
    const ctx = this.scope.ctx;
    if (this.depthVersion === ctx.graphVersion) {
      return this.depth;
    }
    // marked before recursing: the compiler rejects a value that reads
    // itself, but the runtime must not hang if one ever reaches it, and a
    // back edge counting as zero keeps the rest of the ordering sane
    this.depthVersion = ctx.graphVersion;
    this.depth = 0;
    let depth = 0;
    this.src.forEach(o => {
      const d = o.depthNow();
      d >= depth && (depth = d + 1);
    });
    return (this.depth = depth);
  }

  /**
   * Hands this value's dependents to the context's queue, and drains it if
   * this is the outermost push.
   *
   * It used to call `get()` on each dependent directly, which is depth-first
   * and evaluates a value the moment one of its sources changes -- before
   * its other sources have caught up. A diamond is where that shows:
   *
   *   pageNo -> page -> shown        rows -> shown
   *
   * a change to `rows` reaches `shown` down the short arm while `page` is
   * still mid-evaluation on the long one, and `shown` then marks itself
   * current for the cycle, so the settled `page` never revisits it. The page
   * showed the previous page's rows under the new page's number, with
   * nothing reported anywhere: the value was not stale, it was WRONG, and
   * only for the one cycle in which it changed.
   *
   * Draining by depth removes the shape of the problem rather than that
   * instance of it.
   */
  protected propagate() {
    const ctx = this.scope.ctx;
    if (ctx.pushLevel < 1) {
      ctx.cycle++;
    }
    ctx.pushLevel++;
    try {
      this.dst.forEach(v => ctx.enqueue(v));
      // a nested propagation adds to the same queue and lets this one keep
      // draining it, so the whole cascade is ordered together
      ctx.pushLevel === 1 && ctx.drain();
    } catch (err) {
      // get() already handles a failing expression, so this is a backstop for
      // internal breakage rather than user code -- report it rather than
      // swallow it, and keep pushLevel balanced either way
      ctx.onError('propagate', err, this);
    } finally {
      if (--ctx.pushLevel < 1) {
        ctx.applyPending();
      }
    }
  }
}
