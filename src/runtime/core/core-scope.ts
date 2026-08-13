import { CoreContext } from './core-context';
import { CoreValue, CoreValueProps, ValueExp } from './core-value';

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
export const RT_FOR_KEY_VALUE = 'for$key';
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
    this.relocateLoopAlias();
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

  /**
   * Where THIS scope's own usage-site values resolve.
   *
   * Normally just callSiteScope(): the tag was written there, so that is what
   * its attributes see. A `:for-each` on the tag changes it, because that
   * DECLARES a name rather than passing a value, and declares it where the
   * instance scope is defined -- at the usage site. So in
   * `<my-card :for-each=${rows} :title=${data.n} />` both attributes are
   * written in one place, and the name one introduces is visible to the other.
   *
   * Only the loop's alias joins them. `:title=${title}` must go on meaning
   * "the title from out here" rather than resolving to itself, and the
   * definition's own names stay invisible from the call site as always.
   */
  usageSiteScope(): CoreScope {
    if (!this.props.values?.[RT_FOR_EACH_VALUE]) return this.callSiteScope() ?? this;
    return (this.loopSite ??= new LoopSiteScope(this));
  }
  private loopSite?: CoreScope;

  /** the per-item name this scope's `:for-each` introduces */
  aliasName(): string {
    return (this.values[RT_FOR_AS_VALUE]?.get() as string) || FOR_DATA_DEFAULT_NAME;
  }

  /** the CoreValue holding this replica's item, wherever it ended up living */
  aliasValue(): CoreValue<any> | undefined {
    const alias = this.aliasName();
    return this.values[alias] ?? this.loopSite?.values[alias];
  }

  /**
   * Moves a usage-site `:for-each`'s per-item value into that usage-site
   * scope, before any child of this one is built.
   *
   * Left in place it would sit in the instance's own namespace, which is what
   * the DEFINITION resolves against -- so a component whose body happened to
   * say `${data}` would read its caller's loop item instead of its own
   * scope's value. The name belongs to the usage site alone. A `:for-each` on
   * an ordinary element is untouched: there the alias is not a usage-site
   * value, and the scope's own namespace is exactly where it belongs.
   */
  private relocateLoopAlias(): void {
    if (!this.props.values?.[RT_FOR_EACH_VALUE]) return;
    const alias = this.aliasName();
    if (!this.props.values[alias]?.callSite) return;
    const value = this.values[alias];
    if (!value) return;
    this.usageSiteScope().values[alias] = value;
    delete this.values[alias];
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
    // `:for-key` describes how to derive an item's key; it is not a value
    // this scope has. Replication applies the expression itself, against the
    // item being considered -- so left live here it would evaluate the
    // per-item alias exactly where no current item exists (the host), which
    // at best wastes a pass and at worst reports a spurious error for markup
    // that is entirely correct
    if (key === RT_FOR_KEY_VALUE) {
      return new CoreValue({}, this, key);
    }
    const ret = new CoreValue(props, props.callSite ? this.usageSiteScope() : this, key);
    if (key === RT_FOR_EACH_VALUE) {
      // `this`, not the callback's own scope argument: those differ for a
      // usage-site value, whose CoreValue resolves against the call site
      // while the thing it acts on is still THIS scope -- the same split
      // WebScope's binding callbacks get by capturing `this`. Reading the
      // host off the value instead made `<my-tag :for-each=${...}>`
      // replicate whatever scope the tag was written in
      ret.setCB((_, vv) => CoreScope.foreachCB(this, vv));
      return ret;
    }
    return ret;
  }

  // ===========================================================================
  // replication
  // ===========================================================================
  cloned?: boolean;
  clones?: CoreScope[];
  /** replicas of a keyed `:for-each`: the key this one currently stands for,
   * which is what the next pass matches it by */
  replicaKey?: unknown;
  /**
   * Keyed replication hands out replica indices in creation order rather
   * than by position, so a replica keeps the id it was born with when the
   * list reorders. That is the whole point of the id: pages build HTML ids
   * out of `$id` (`aria-controls`, a label's `for`), and those must go on
   * pointing at the same item after a move. Only ever incremented, so a
   * replica created later can never collide with a live one.
   */
  private nextReplicaIndex = 0;
  /** guards against a nested pass over the same host: see foreachCB */
  private replicating = false;

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
    // Creating a replica refreshes it, and that refresh drains the pending
    // queue -- which still holds THIS callback, since applyPending only
    // clears once it returns. So a pass re-enters itself once per replica it
    // creates. Index replication happens to survive that (a nested pass
    // updates the same slots and creates the next one, so it converges), but
    // keyed replication cannot: each level captured its own "what existed
    // before" snapshot, and unwinding, every outer level would recreate what
    // a deeper one already made and dispose what it no longer recognises.
    // The outermost pass is the authoritative one and finishes the job
    if (that.replicating) return;
    that.replicating = true;
    try {
      CoreScope.replicate(that, vv);
    } finally {
      that.replicating = false;
    }
  }

  private static replicate(that: CoreScope, vv: any[]) {
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
    that.clones || (that.clones = []);
    // `:for-key` makes a replica belong to an ITEM rather than to a
    // position. Without it, replica N always shows item N and only the data
    // moves, which is cheaper and perfectly correct for a list that is
    // rendered from scratch -- but it means a reorder rewrites every replica
    // in place, so anything the DOM itself holds (focus, scroll offset, an
    // input's typed value, a running animation, a media element's playhead)
    // stays where it was while the data slides out from under it
    const keyExp = that.props.values?.[RT_FOR_KEY_VALUE]?.exp;
    keyExp
      ? CoreScope.replicateByKey(that, vv, offset, length, alias, keyExp)
      : CoreScope.replicateByIndex(that, vv, offset, length, alias);
  }

  private static replicateByIndex(
    that: CoreScope,
    vv: any[],
    offset: number,
    length: number,
    alias: string
  ) {
    let ci = 0, di = offset;
    for (; di < offset + length; ci++, di++) {
      if (ci < that.clones!.length) {
        // update
        that.clones![ci].aliasValue()?.set(vv[di]);
      } else {
        // create
        const clone = that.clone(ci);
        clone.aliasValue()?.set(vv[di]);
        that.ctx.refresh(clone);
      }
    }

    // remove excess clones
    CoreScope.removeExcessClones(that, length);
  }

  private static replicateByKey(
    that: CoreScope,
    vv: any[],
    offset: number,
    length: number,
    alias: string,
    keyExp: ValueExp<any>
  ) {
    // A key expression is written against the per-item alias
    // (`:for-key=${item.id}`), but it has to be evaluated for an INCOMING
    // item, before that item has a replica to be evaluated against. Hence a
    // probe: the alias answers with the item being considered, everything
    // else falls through to the host, so a key is free to mix in outer
    // values. One probe for the whole pass rather than one per item
    let probed: any;
    const probe = new Proxy({}, {
      get: (_target, prop) => (prop === alias ? probed : that.proxy[prop]),
    });
    const keyOf = (item: any) => {
      probed = item;
      try {
        return keyExp.apply(probe);
      } catch (err) {
        that.ctx.onError('update', err, that.values[RT_FOR_KEY_VALUE]);
        return undefined;
      }
    };

    // snapshot: clone() appends to that.clones as replicas are created, and
    // what still counts as "already there" must not grow underneath us
    const previous = [...that.clones!];
    const byKey = new Map<unknown, CoreScope>();
    previous.forEach(c => byKey.has(c.replicaKey) || byKey.set(c.replicaKey, c));

    const ordered: CoreScope[] = [];
    const reused = new Set<CoreScope>();
    // keys claimed by this pass: a duplicate is most often two copies of one
    // item in the SAME array, which `byKey` cannot see -- it only knows what
    // the previous pass left behind
    const claimed = new Set<unknown>();
    for (let di = offset; di < offset + length; di++) {
      const item = vv[di];
      const key = keyOf(item);
      let clone = claimed.has(key) ? undefined : byKey.get(key);
      if (claimed.has(key) || (clone && reused.has(clone))) {
        // two items claiming one identity: the second can't have the first's
        // replica, so it gets a fresh one and the list still renders. Worth
        // reporting even so -- with a duplicate key nothing keyed
        // reconciliation promises holds, and the symptom (one item's DOM
        // state following the wrong row) reads as a framework bug
        that.ctx.onError(
          'update',
          new Error(`duplicate :for-key ${JSON.stringify(key) ?? key}`),
          that.values[RT_FOR_KEY_VALUE]
        );
        clone = undefined;
      }
      claimed.add(key);
      if (clone) {
        reused.add(clone);
        clone.replicaKey = key;
        clone.aliasValue()?.set(item);
      } else {
        clone = that.clone(that.nextReplicaIndex++);
        // before the data lands and before the refresh: both propagate, and
        // a replica that is not yet answering for its key is a replica the
        // next pass would fail to recognise and would build a second time
        clone.replicaKey = key;
        clone.aliasValue()?.set(item);
        that.ctx.refresh(clone);
      }
      ordered.push(clone);
    }

    previous.forEach(c => reused.has(c) || c.dispose());
    that.clones = ordered;
    that.reorderClones();
  }

  /**
   * Puts the replicas' DOM back in array order after a keyed pass.
   * DOM-specific, so it does nothing here and WebScope overrides it -- and
   * nothing at all for index replication, where a replica never moves.
   */
  reorderClones() {}

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

/**
 * The resolution scope for the usage-site values of a REPLICATED custom tag:
 * the loop's alias, then the scope the tag was written in.
 *
 * A scope of its own rather than a rule on the instance, because the instance
 * also holds the definition's values and those must stay invisible from the
 * call site. Only the alias crosses over -- see usageSiteScope().
 */
class LoopSiteScope extends CoreScope {
  private owner: CoreScope;

  constructor(owner: CoreScope) {
    // no parent: linking would put it in someone's children and give it a
    // life cycle it has no use for
    super({ id: `${owner.props.id}$site`, values: {} }, owner.ctx);
    this.owner = owner;
  }

  override lookup(prop: string | symbol): CoreValue<any> | undefined {
    const owner = this.owner;
    // the compiler emits every dependency as `this.$value(name)`, so this has
    // to be OUR $value: delegated away, deps would resolve against the call
    // site and the alias would come back unresolved. $id and $parent still
    // mean what they mean out there
    if (prop === RT_VALUE_FN_KEY) return this.values[RT_VALUE_FN_KEY];
    // read per lookup rather than cached: a replica's alias holds whatever
    // the current pass just set, and `:for-as` is itself a value
    if (prop === owner.aliasName()) return owner.aliasValue();
    // a replica's structural parent is the HOST instance, not a call site.
    // Resolving from there would continue through the host's own
    // lexicalParent -- the page root, for an instance -- losing everything
    // declared in between, `<body>` included. The tag was written where the
    // host was
    const site = owner.cloned ? owner.parent?.callSiteScope() : owner.callSiteScope();
    return (site ?? owner).lookup(prop);
  }
}
