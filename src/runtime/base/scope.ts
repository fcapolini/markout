import { Context } from './context';
import { Value, ValueProps } from './value';

//TODO: make sure compiler rejects logic values with $ in name

export interface ScopeProps {
  id: string;
  name?: string;
  closed?: boolean;
  children?: ScopeProps[];
  values?: { [key: string]: ValueProps<any> };
}

export class Scope {
  props: ScopeProps;
  context: Context;
  parent?: Scope;
  children: Scope[];
  cache: Map<string | symbol, Value>;
  values: { [key: string | symbol]: Value<any> };
  proxy: { [key: string | symbol]: any };

  constructor(props: ScopeProps, context: Context, parent?: Scope) {
    this.props = props;
    this.context = context;
    this.children = [];
    this.cache = new Map();
    this.values = {};
    this.proxy = new Proxy(this.values, {
      get: (_target, prop) => {
        const v = this.lookup(prop);
        return v?.get();
      },
      set: (_target, prop, value) => {
        const v = this.lookup(prop);
        if (v) {
          v.set(value);
          return true;
        }
        return false;
      },
    });
    this.init();
    if (props.values) {
      const vp = {
        ...props.values,
        $value: { val: (key: string) => this.lookup(key) },
      };
      for (const [key, valProps] of Object.entries(vp)) {
        this.values[key] = this.newValue(key, valProps);
      }
    }
    parent && this.link(parent);
    props.children?.forEach(p => context.newScope(p, context, this));
  }

  dispose() {
    if (!this.parent) return;
    this.unlinkValues();
    const i = this.parent.children.indexOf(this);
    i >= 0 && this.parent.children.splice(i, 1);
    if (!this.props.name) return;
    const value = this.parent.values[this.props.name];
    if (!value) return;
    value.unlink();
    this.parent.cache.delete(this.props.name);
    delete this.parent.values[this.props.name];
  }

  link(parent: Scope) {
    this.parent = parent;
    parent.children.push(this);
    if (this.props.name) {
      parent.values[this.props.name] = new Value({ val: this.proxy }, parent);
    }
  }

  lookup(prop: string | symbol): Value<any> | undefined {
    let scope: Scope | undefined = this;
    let value = scope.cache.get(prop);
    while (scope && !value) {
      value = scope.values[prop];
      value && scope.cache.set(prop, value);
      scope = scope.props.closed ? undefined : scope.parent;
    };
    return value;
  }

  linkValues(recur = true) {
    Object.keys(this.values).forEach(key => this.values[key].link());
    recur && this.children.forEach((scope: Scope) => scope.linkValues());
  }

  unlinkValues(recur = true) {
    this.cache.clear();
    Object.keys(this.values).forEach(key => this.values[key].unlink());
    recur && this.children.forEach((scope: Scope) => scope.unlinkValues());
  }

  updateValues(recur = true) {
    Object.keys(this.values).forEach(key => this.values[key].get());
    recur && this.children.forEach((scope: Scope) => scope.updateValues());
  }

  init() {}

  newValue(_key: string, props: ValueProps<any>) {
    return new Value(props, this);
  }
}
