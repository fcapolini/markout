import { Scope } from "./scope";

export type ValueExp<T> = () => T;
export type ValueDep = () => Value<any>;

export interface ValueProps<T> {
  val?: T;
  exp?: () => T;
  deps?: ValueDep[];
}

export class Value<T = any> {
  props: ValueProps<T>;
  scope: Scope;
  value: T | undefined;
  cycle = 0;

  constructor(props: ValueProps<T>, scope: Scope) {
    this.props = props;
    this.scope = scope;
    this.value = props.val;
  }

  get(): T | undefined {
    if (this.props.exp && this.cycle !== this.scope.context.cycle) {
      this.update();
      this.cycle = this.scope.context.cycle;
    }
    return this.value;
  }

  set(value: T) {
    this.value = value;
  }

  update() {

  }
}
