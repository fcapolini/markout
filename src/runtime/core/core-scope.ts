import { CoreContext } from './core-context';
import { CoreValue, CoreValueProps } from './core-value';

//TODO: make sure compiler rejects logic values with $ in name

export const RT_VALUE_FN_KEY = '$value';
export const RT_PARENT_VALUE_KEY = '$parent';

export interface CoreScopeProps {
  id: string;
  name?: string;
  children?: CoreScopeProps[];
  values?: { [key: string]: CoreValueProps<any> };
}

export class CoreScope {
  props: CoreScopeProps;
  ctx: CoreContext;
  parent?: CoreScope;
  children: CoreScope[];
  cache: Map<string | symbol, CoreValue>;
  values: { [key: string | symbol]: CoreValue<any> };
  proxy: { [key: string | symbol]: any };

  constructor(props: CoreScopeProps, context: CoreContext, parent?: CoreScope) {
    this.props = props;
    this.ctx = context;
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
    parent && this.link(parent);
    // parent must be linked before init() so subclasses can rely on it
    // (e.g. to locate a scope's DOM element within its parent's own)
    this.init();
    if (props.values) {
      for (const [key, valProps] of Object.entries(props.values)) {
        this.values[key] = this.newValue(key, valProps);
      }
      this.values[RT_VALUE_FN_KEY] = this.newValue(RT_VALUE_FN_KEY, {
        val: (key: string) => this.lookup(key),
      });
      this.values[RT_PARENT_VALUE_KEY] = this.newValue(RT_PARENT_VALUE_KEY, {
        val: () => this.parent?.proxy,
      });
    }
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

  link(parent: CoreScope) {
    this.parent = parent;
    parent.children.push(this);
    if (this.props.name) {
      parent.values[this.props.name] = new CoreValue(
        { val: this.proxy },
        parent
      );
    }
  }

  lookup(prop: string | symbol): CoreValue<any> | undefined {
    let scope: CoreScope | undefined = this;
    let value = scope.cache.get(prop);
    while (scope && !value) {
      value = scope.values[prop];
      value && this.cache.set(prop, value);
      scope = scope.parent;
    }
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

  newValue(_key: string, props: CoreValueProps<any>) {
    return new CoreValue(props, this);
  }
}
