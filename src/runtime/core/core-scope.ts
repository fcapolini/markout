import { CoreContext } from './core-context';
import { CoreValue, CoreValueProps } from './core-value';

//TODO: make sure compiler rejects logic values with $ in name

export const RT_VALUE_FN_KEY = '$value';
export const RT_PARENT_VALUE_KEY = '$parent';
/** this scope's own compiler-assigned id, e.g. `s4` (`s4-0` for a replica) */
export const RT_ID_VALUE_KEY = '$id';

/**
 * A replica's scope id, derived from the id of the scope it replicates.
 *
 * The separator has to leave the result usable as an HTML id, because that's
 * what pages build out of `$id` (`id`, `aria-controls`, `data-bs-target`, a
 * label's `for`). The obvious `#` doesn't: it's legal in an id attribute but
 * starts a new id in a selector, so `document.querySelector('#s4#0')` never
 * matches the element -- a component that worked standalone would break
 * silently as soon as it was replicated.
 */
export function cloneId(baseId: string, index: number): string {
  return `${baseId}-${index}`;
}
export const RT_FOR_EACH_VALUE = 'for$each';
export const RT_FOR_OFFSET_VALUE = 'for$offset';
export const RT_FOR_LENGTH_VALUE = 'for$length';
export const RT_FOR_AS_VALUE = 'for$as';
// the per-item value's key defaults to this, same as compiler-side
// FOR_DATA_DEFAULT_NAME in ir/Page.ts (duplicated rather than imported: this
// is runtime code, kept independent of the compiler)
const FOR_DATA_DEFAULT_NAME = 'data';

export interface CoreScopeProps {
  id: string;
  name?: string;
  children?: CoreScopeProps[];
  values?: { [key: string]: CoreValueProps<any> };
  /** set by CoreScope.clone() on a replica's own props; read during init() */
  cloned?: boolean;
  /** a replica's index within its `:for-each`, set alongside `cloned` --
   * what makes `$id` unique for everything nested inside it */
  replicaIndex?: number;
  /** a custom-tag usage instance: the id of the <:define> scope/template it
   * instantiates its DOM from -- DOM-specific, so only WebScope acts on it */
  template?: string;
  /** plain attributes from a custom-tag usage site, applied to its stencil clone */
  attributes?: { [key: string]: string };
  /** markup written at a usage site and slotted into the instance: it lives
   * here but resolves names from outside (see lexicalParent()) */
  slotted?: boolean;
}

export class CoreScope {
  props: CoreScopeProps;
  ctx: CoreContext;
  parent?: CoreScope;
  children: CoreScope[];
  cache: Map<string | symbol, CoreValue>;
  values: { [key: string | symbol]: CoreValue<any> };
  proxy: { [key: string | symbol]: any };
  /**
   * Which replica this scope lives in, as a chain of `:for-each` indices
   * (`''` outside any, `-1` inside replica 1, `-0-2` once nested).
   *
   * Compiler-assigned ids are unique per page, but a replicated subtree
   * reuses the same props for every replica, so every scope inside one would
   * otherwise answer with the same id. Appending this makes `$id` unique
   * document-wide -- which is the whole point of it, since pages build HTML
   * ids out of it. DOM lookup deliberately keeps using the bare `props.id`:
   * it searches within one parent's subtree, where replicas can't collide.
   */
  replicaPath: string;
  /** `props.id` made unique across replicas; what `$id` answers */
  uid: string;

  constructor(props: CoreScopeProps, context: CoreContext, parent?: CoreScope) {
    this.props = props;
    this.ctx = context;
    this.cloned = !!props.cloned;
    // a replica's own props.id already carries its index (see cloneId), so
    // both cases are the same expression: it's what a scope contributes to
    // its DESCENDANTS that differs
    const inherited = parent?.replicaPath ?? '';
    this.uid = `${props.id}${inherited}`;
    this.replicaPath =
      props.replicaIndex !== undefined ? `${inherited}-${props.replicaIndex}` : inherited;
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
        // a direct value, not `exp`/a callable: parent is already fixed by
        // this point (linked above, before init()) and never changes again.
        // The LEXICAL one: `$parent` reaching into a component's call site
        // would hand back through the front door the isolation lookup() is
        // careful to keep
        val: this.lexicalParent()?.proxy,
      });
    }
    // unconditionally, unlike the two above: lookup() walks up the scope
    // chain, so a scope missing its own $id wouldn't fail -- it would
    // silently answer with an ancestor's, which is exactly the kind of
    // quietly-wrong binding that's hardest to notice
    this.values[RT_ID_VALUE_KEY] = this.newValue(RT_ID_VALUE_KEY, {
      // rooted in the id stage1 stamped into the element as `data-markout`,
      // which the browser reads back out of the compiled props: it comes
      // from the page, so server and client can't disagree on it
      val: this.uid,
    });
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
        this.props.name,
      );
    }
  }

  /**
   * Where name resolution continues when this scope doesn't have the value.
   *
   * Normally the structural parent -- scopes nest lexically, so that's the
   * same thing. A custom-tag instance is the exception: it sits wherever it
   * was used (so `:for-each` replicates it, and its DOM is found inside its
   * container) while resolving names from the page root, because a
   * definition must see only what was visible where it was DEFINED. Without
   * the split, a component would silently read a value the call site
   * happened to declare -- compiling clean, and reactive, but wrong.
   */
  lexicalParent(): CoreScope | undefined {
    // an instance's OWN values come from its definition, so they resolve
    // from the root whether or not the tag itself sits in someone's slot
    if (this.props.template) return this.rootScope();
    // markup slotted into a custom tag: its DOM is inside the instance, but
    // it was written OUTSIDE it, so it resolves from there -- skipping the
    // instance entirely rather than reading the definition's values
    if (this.props.slotted) return this.callSiteScope();
    return this.parent;
  }

  /**
   * The scope this one was WRITTEN in, which is where its call-site values
   * evaluate (see newValue). Normally the structural parent; for anything
   * slotted, the scope the enclosing instance's own tag was written in --
   * recursively, so a component slotted into a component slotted into a
   * page still reads the page.
   */
  callSiteScope(): CoreScope | undefined {
    if (!this.props.slotted) return this.parent;
    const instance = this.enclosingInstance();
    return instance ? instance.callSiteScope() : this.parent;
  }

  private enclosingInstance(): CoreScope | undefined {
    let scope: CoreScope | undefined = this.parent;
    while (scope && !scope.props.template) scope = scope.parent;
    return scope;
  }

  private rootScope(): CoreScope | undefined {
    let scope: CoreScope | undefined = this;
    while (scope.parent && scope.parent !== this.ctx.global) {
      scope = scope.parent;
    }
    return scope === this ? this.parent : scope;
  }

  lookup(prop: string | symbol): CoreValue<any> | undefined {
    let scope: CoreScope | undefined = this;
    let value = scope.cache.get(prop);
    while (scope && !value) {
      value = scope.values[prop];
      value && this.cache.set(prop, value);
      scope = scope.lexicalParent();
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
    // a usage-site value evaluates against the scope the custom tag was
    // written in -- `this.parent`, since an instance sits where it was used.
    // Its callbacks still act on THIS scope: WebScope.newValue's closures
    // capture the instance, so `<my-card id=${x}/>` sets the attribute on
    // the instance's element while reading `x` from the call site
    const ret = new CoreValue(props, props.callSite ? this.callSiteScope() ?? this : this, key);
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

    const alias = (that.values[RT_FOR_AS_VALUE]?.get() as string) || FOR_DATA_DEFAULT_NAME;

    let offset = 0, length = vv.length;
    try {
      if (that.values[RT_FOR_OFFSET_VALUE]) {
        offset = that.proxy[RT_FOR_OFFSET_VALUE] - 0;
      }
    } catch (err: any) {
      that.ctx.onError('update', err, that.values[RT_FOR_OFFSET_VALUE]);
    }
    try {
      if (that.values[RT_FOR_LENGTH_VALUE]) {
        length = that.proxy[RT_FOR_LENGTH_VALUE] - 0;
      }
    } catch (err: any) {
      that.ctx.onError('update', err, that.values[RT_FOR_LENGTH_VALUE]);
    }
    offset < 0 && (offset = 0);
    offset > vv.length && (offset = vv.length);
    length < 0 && (length = vv.length);
    (offset + length) >= vv.length && (length = vv.length - offset);

    // every item becomes a clone -- the host scope's own element lives
    // inside an inert <template> stencil (see WebScope), so it can never
    // itself be a visible instance; this also means an empty/absent array
    // naturally results in zero visible replicas, with no separate
    // "hide the host" step needed
    let ci = 0, di = offset;
    that.clones || (that.clones = []);
    for (; di < offset + length; ci++, di++) {
      if (ci < that.clones.length) {
        // update
        that.clones[ci].proxy[alias] = vv[di];
      } else {
        // create
        const clone = that.clone(ci);
        clone.values[alias].set(vv[di]);
        that.ctx.refresh(clone);
      }
    }

    // remove excess clones
    CoreScope.removeExcessClones(that, length);
  }

  static removeExcessClones(that: CoreScope, i: number) {
    while (that.clones!.length > i) {
      const clone = that.clones!.pop();
      clone?.dispose();
    }
  }

  clone(index: number): CoreScope {
    const clone = this.ctx.newScope({
      id: cloneId(this.props.id, index),
      // name: this.props.name,
      children: this.props.children,
      values: this.props.values,
      cloned: true,
      replicaIndex: index,
    }, this.ctx, this);
    this.clones!.push(clone);
    return clone;
  }
}
