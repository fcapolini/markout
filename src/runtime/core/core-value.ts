import { CoreScope } from './core-scope';

export type ValueExp<T> = () => T;
export type ValueDep = () => CoreValue<any>;
export type ValueCallback<T> = (s: CoreScope, v: T | undefined) => void;

export interface CoreValueProps<T> {
  val?: T;
  exp?: () => T;
  deps?: ValueDep[];
}

export class CoreValue<T = any> {
  props: CoreValueProps<T>;
  scope: CoreScope;
  cb?: ValueCallback<T>;
  src: Set<CoreValue>;
  dst: Set<CoreValue>;
  cycle: number;
  exp?: ValueExp<T>;
  value: T | undefined;

  constructor(
    props: CoreValueProps<T>,
    scope: CoreScope,
    cb?: ValueCallback<T>
  ) {
    this.props = props;
    this.scope = scope;
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
        o.dst.add(this);
        this.src.add(o);
      } catch (ignored) {}
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
    if (this.exp && this.cycle !== this.scope.ctx.cycle) {
      if (!this.cycle || this.src.size) {
        this.update();
      }
      this.cycle = this.scope.ctx.cycle;
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
      console.error(err);
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
    } catch (ignored) {}
    if (--ctx.pushLevel < 1) {
      ctx.applyPending();
    }
  }
}
