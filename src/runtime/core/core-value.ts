import { CoreScope } from './core-scope';

export type ValueExp<T> = () => T;
export type ValueDep = () => CoreValue<any>;
export type ValueCallback<T> = (s: CoreScope, v: T | undefined) => void;

export interface CoreValueProps<T> {
  val?: T;
  exp?: () => T;
  deps?: ValueDep[];
  /**
   * This value belongs to a custom-tag instance but was written at the usage
   * site, so it evaluates against the scope containing that site rather than
   * against the instance -- an expression resolves where it was written. It
   * still LIVES on the instance, so the definition can read it.
   */
  callSite?: boolean;
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
    this.props.deps?.forEach(dep => {
      try {
        const o = dep.apply(this.scope.proxy);
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
    delete this.exp;
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
    const old = this.value;
    try {
      this.value = this.exp!.apply(this.scope.proxy);
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

  protected propagate() {
    const ctx = this.scope.ctx;
    if (ctx.pushLevel < 1) {
      ctx.cycle++;
    }
    ctx.pushLevel++;
    try {
      this.dst.forEach(v => v.get());
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
