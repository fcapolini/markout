import { BaseScope } from "./base-scope";

export type ValueExp<T> = () => T;
export type ValueDep = () => BaseValue<any>;
export type ValueCallback<T> = (
  s: BaseScope,
  v: T | undefined
) => void;

export interface BaseValueProps<T> {
  val?: T;
  exp?: () => T;
  deps?: ValueDep[];
}

export class BaseValue<T = any> {
  props: BaseValueProps<T>;
  scope: BaseScope;
  cb?: ValueCallback<T>;
  src: Set<BaseValue>;
  dst: Set<BaseValue>;
  cycle: number;
  exp?: ValueExp<T>;
  value: T | undefined;

  constructor(props: BaseValueProps<T>, scope: BaseScope, cb?: ValueCallback<T>) {
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
    // !this.exp && cb(this.scope, this.value);
    !this.exp && this.scope.ctx.pending.add(this);
  }

  link() {
    this.props.deps?.forEach((dep) => {
      try {
        const o = dep.apply(this.scope.proxy);
        o.dst.add(this);
        this.src.add(o);
      } catch (ignored) {}
    });
  }

  unlink() {
    this.src.forEach((o) => o.dst.delete(this));
    this.dst.forEach((o) => o.src.delete(this));
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
    this.src.clear();
    this.value = value;
    if (old == null ? value != null : value !== old) {
      // this.cb && this.cb(this.scope, value);
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
      // this.cb && this.cb(this.scope, this.value);
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
      this.dst.forEach((v) => v.get());
    } catch (ignored) { }
    if (--ctx.pushLevel < 1) {
      ctx.applyPending();
    }
  }
}
