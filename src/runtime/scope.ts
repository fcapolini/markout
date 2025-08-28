import { Context } from './context';
import { Value, ValueProps } from './value';

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
    if (props.values) {
      const vp = {
        ...props.values,
        $value: { val: (key: string) => this.lookup(key) },
      };
      for (const [key, valProps] of Object.entries(vp)) {
        this.values[key] = new Value(valProps, this);
      }
    }
    parent && this.link(parent);
    props.children?.forEach(p => new Scope(p, context, this));
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
}
