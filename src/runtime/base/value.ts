import { Scope } from "./scope";

export type ValueExp<T> = () => T;
export type ValueDep = () => Value<any>;
export type ValueCallback<T> = (
  s: Scope,
  v: T | undefined,
  old: T | undefined
) => void;

export interface ValueProps<T> {
  val?: T;
  exp?: () => T;
  deps?: ValueDep[];
}

export class Value<T = any> {
  props: ValueProps<T>;
  scope: Scope;
  cb?: ValueCallback<T>;
  src: Set<Value>;
  dst: Set<Value>;
  cycle: number;
  exp?: ValueExp<T>;
  value: T | undefined;

  constructor(props: ValueProps<T>, scope: Scope, cb?: ValueCallback<T>) {
    this.props = props;
    this.scope = scope;
    this.cb = cb;
    this.src = new Set();
    this.dst = new Set();
    this.cycle = 0;
    this.exp = props.exp;
    this.value = props.val;
  }

  setCB(cb: ValueCallback<T>): this {
    this.cb = cb;
    !this.exp && cb(this.scope, this.value, undefined);
    return this;
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
    if (this.exp && this.cycle !== this.scope.context.cycle) {
      if (!this.cycle || this.src.size) {
        this.update();
      }
      this.cycle = this.scope.context.cycle;
    }
    return this.value;
  }

  set(value: T) {
    const old = this.value;
    delete this.exp;
    this.src.clear();
    this.value = value;
    if (old == null ? value != null : value !== old) {
      this.cb && this.cb(this.scope, value, old);
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
      this.cb && this.cb(this.scope, this.value, old);
      this.dst.size && this.scope.context.refreshLevel < 1 && this.propagate();
    }
  }

  protected propagate() {
    const ctx = this.scope.context;
    if (ctx.pushLevel < 1) {
      ctx.cycle++;
    }
    ctx.pushLevel++;
    try {
      this.dst.forEach((v) => v.get());
    } catch (ignored) { }
    ctx.pushLevel--;
  }
}
