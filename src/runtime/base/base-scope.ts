import { BaseContext } from './base-context';
import { BaseValue, BaseValueProps } from './base-value';

//TODO: make sure compiler rejects logic values with $ in name

export const RT_VALUE_FN_KEY = '$value';
export const RT_PARENT_VALUE_KEY = '$parent';

export interface BaseScopeProps {
  id: string;
  name?: string;
  children?: BaseScopeProps[];
  values?: { [key: string]: BaseValueProps<any> };
}

export class BaseScope {
  props: BaseScopeProps;
  context: BaseContext;
  parent?: BaseScope;
  children: BaseScope[];
  cache: Map<string | symbol, BaseValue>;
  values: { [key: string | symbol]: BaseValue<any> };
  proxy: { [key: string | symbol]: any };

  constructor(props: BaseScopeProps, context: BaseContext, parent?: BaseScope) {
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

  link(parent: BaseScope) {
    this.parent = parent;
    parent.children.push(this);
    if (this.props.name) {
      parent.values[this.props.name] = new BaseValue(
        { val: this.proxy },
        parent
      );
    }
  }

  lookup(prop: string | symbol): BaseValue<any> | undefined {
    let scope: BaseScope | undefined = this;
    let value = scope.cache.get(prop);
    while (scope && !value) {
      value = scope.values[prop];
      value && scope.cache.set(prop, value);
      scope = scope.parent;
    };
    return value;
  }

  linkValues(recur = true) {
    Object.keys(this.values).forEach(key => this.values[key].link());
    recur && this.children.forEach(scope => scope.linkValues());
  }

  unlinkValues(recur = true) {
    this.cache.clear();
    Object.keys(this.values).forEach(key => this.values[key].unlink());
    recur && this.children.forEach(scope => scope.unlinkValues());
  }

  updateValues(recur = true) {
    Object.keys(this.values).forEach(key => this.values[key].get());
    recur && this.children.forEach(scope => scope.updateValues());
  }

  init() {}

  newValue(_key: string, props: BaseValueProps<any>) {
    return new BaseValue(props, this);
  }
}
