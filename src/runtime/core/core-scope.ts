import { CoreContext } from './core-context';
import { CoreValue, CoreValueProps } from './core-value';

//TODO: make sure compiler rejects logic values with $ in name

export const RT_VALUE_FN_KEY = '$value';
export const RT_PARENT_VALUE_KEY = '$parent';
export const RT_FOR_EACH_VALUE = 'for$each';
export const RT_FOR_OFFSET_VALUE = 'for$offset';
export const RT_FOR_LENGTH_VALUE = 'for$length';
export const RT_FOR_AS_VALUE = 'for$as';
export const RT_FOR_DATA_VALUE = 'for$data';

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
        this.values[key] = this.newValue(key, valProps, props.values);
      }
      this.values[RT_VALUE_FN_KEY] = this.newValue(RT_VALUE_FN_KEY, {
        val: (key: string) => this.lookup(key),
      });
      this.values[RT_PARENT_VALUE_KEY] = this.newValue(RT_PARENT_VALUE_KEY, {
        val: () => this.parent?.proxy,
      });
    }
    props.children?.forEach((p) => context.newScope(p, context, this));
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
        parent,
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
    Object.keys(this.values).forEach((key) => this.values[key].link());
    recur && this.children.forEach((scope) => scope.linkValues());
  }

  unlinkValues(recur = true) {
    this.cache.clear();
    Object.keys(this.values).forEach((key) => this.values[key].unlink());
    recur && this.children.forEach((scope) => scope.unlinkValues());
  }

  updateValues(recur = true) {
    Object.keys(this.values).forEach((key) => this.values[key].get());
    recur && this.children.forEach((scope) => scope.updateValues());
  }

  init() {}

  newValue(
    key: string,
    props: CoreValueProps<any>,
    allValues?: { [key: string]: CoreValueProps<any> },
  ): CoreValue<any> {
    const ret = new CoreValue(props, this);
    if (key === RT_FOR_EACH_VALUE) {
      ret.setCB(CoreScope.foreachCB);
      return ret;
    }
    return ret;
  }

  // ===========================================================================
  // replication
  // ===========================================================================
  cloned?: boolean;
  clones?: CoreScope[];

  static foreachCB(that: CoreScope, vv?: any[]) {
    if (!Array.isArray(vv)) {
      if (that.clones && that.clones.length) {
        CoreScope.removeExcessClones(that, 0);
      }
      return;
    }
    // value is an array
    if (that.cloned) {
      // clones ignore array data
      return;
    }

    let offset = 0, length = vv.length;
    try {
      if (that.values[RT_FOR_OFFSET_VALUE]) {
        offset = that.proxy[RT_FOR_OFFSET_VALUE] - 0;
      }
    } catch (ignored: any) {}
    try {
      if (that.values[RT_FOR_LENGTH_VALUE]) {
        length = that.proxy[RT_FOR_LENGTH_VALUE] - 0;
      }
    } catch (ignored: any) {}
    offset < 0 && (offset = 0);
    offset > vv.length && (offset = vv.length);
    length < 0 && (length = vv.length);
    (offset + length) >= vv.length && (length = vv.length - offset);

    // create/update clones
    let ci = 0, di = offset;
    that.clones || (that.clones = []);
    for (; di < (offset + length - 1); ci++, di++) {
      if (ci < that.clones.length) {
        // update
        that.clones[ci].proxy[RT_FOR_DATA_VALUE] = vv[di];
      } else {
        // create
        const clone = that.clone(ci);
        clone.values[RT_FOR_DATA_VALUE].props.val = vv[di];
        that.ctx.refresh(clone);
      }
    }

    // remove excess clones
    CoreScope.removeExcessClones(that, Math.max(0, length - 1));
    // refine data for the original scope
    if (di < (offset + length)) {
      that.values[RT_FOR_DATA_VALUE].props.val = vv[di];
    } else {
      that.values[RT_FOR_DATA_VALUE].props.val = null;
    }
  }

  static removeExcessClones(that: CoreScope, i: number) {
    while (that.clones!.length > i) {
      const clone = that.clones!.pop();
      clone?.dispose();
    }
  }

  clone(index: number): CoreScope {
    const clone = this.ctx.newScope({
      id: `${this.props.id}#${index}`,
      // name: this.props.name,
      children: this.props.children,
      values: this.props.values,
    }, this.ctx, this);
    clone.cloned = true;
    this.clones!.push(clone);
    return clone;
  }
}
