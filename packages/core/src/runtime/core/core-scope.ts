import { CoreContext } from './core-context';
import { CoreValue, CoreValueProps, ValueExp } from './core-value';

//TODO: make sure compiler rejects logic values with $ in name

export const RT_VALUE_FN_KEY = '$value';
/**
 * `scope.$set('name', v)`: assign to a value by name, as a CALL.
 *
 * Assignment already works -- `panel.count = 1` -- and this exists for the
 * one place it cannot go. A name inside a region is read with `?.`, because
 * the scope is there only while the region is showing; a write has no such
 * spelling, since `a?.b = c` is not JavaScript. But `a?.b(c)` is, so a write
 * spelled as a call inherits the guard for free:
 *
 *     panel.field?.$set('text', v)
 *
 * It answers whether it landed, which is the other half of the objection to
 * `a?.b = c`. With the `?.` the whole expression is `undefined` when the
 * region is away and `true` when the write went through, so a caller that
 * needs to know can ask -- and one that doesn't can ignore it, which is the
 * common case.
 */
export const RT_SET_FN_KEY = '$set';
export const RT_PARENT_VALUE_KEY = '$parent';
/** this scope's own compiler-assigned id, e.g. `s4` (`s4-0` for a replica) */
export const RT_ID_VALUE_KEY = '$id';
export const RT_HOST_VALUE_KEY = '$host';
// The four lifecycle callbacks, in two pairs answering different questions.
// `did$init`/`will$dispose` bracket the SCOPE: what it set up when it came
// into being and has to let go of when it stops existing -- a timer, a
// subscription. `did$attach`/`will$detach` bracket its MARKUP: what has to
// exist while the element is in the page and be taken apart when it leaves,
// which is not the same thing, since a `:for-data` region leaves and comes
// back without its scope ever going away.
export const RT_DID_INIT_VALUE = 'did$init';
export const RT_DID_ATTACH_VALUE = 'did$attach';
export const RT_WILL_DETACH_VALUE = 'will$detach';
export const RT_WILL_DISPOSE_VALUE = 'will$dispose';

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
export const RT_FOR_DATA_VALUE = 'for$data';
export const RT_IF_VALUE = 'if$';
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
  /**
   * This scope is an `:else`/`:else-if`: the id of the branch before it in
   * the chain, and (on every branch but the last) the one after.
   *
   * Ids rather than references, resolved among this scope's siblings, which
   * is what makes a chain inside a `:for-each` work: a replica shares its
   * host's child props verbatim, so every replica's branches carry the same
   * ids and each finds its neighbour in its own copy.
   *
   * Absent on a lone `:if`, and that absence is load-bearing: it is how
   * `ifCB` tells the ordinary case from a chain without looking further.
   */
  elseOf?: string;
  elseNext?: string;
  /** plain attributes from a custom-tag usage site, applied to its stencil clone */
  attributes?: { [key: string]: string };
  /** markup written at a usage site and slotted into the instance: it lives
   * here but resolves names from outside (see lexicalParent()) */
  slotted?: boolean;
  /**
   * This scope took over TEXT written at a usage site, without being slotted
   * markup itself.
   *
   * Text between a custom tag's tags lands wherever the definition's slot
   * put it, which can be inside one of the definition's own scopes -- and a
   * binding belongs to the scope whose territory holds its node, so that
   * scope has to take the value. It resolves where it was WRITTEN all the
   * same, which is out at the instance's call site rather than here.
   *
   * Only `callSite` values are affected; everything this scope declares for
   * itself goes on resolving against the definition, which is why this
   * cannot just be `slotted`.
   */
  slottedText?: boolean;
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
      // what the server produced for this scope's `:server-` values, if this is
      // a client rehydrating a served page
      const state = this.ctx.props.state?.[this.uid];
      for (const [key, valProps] of Object.entries(props.values)) {
        // a replica shares the host's props.values (so it gets its own
        // CoreValues from the same declarations), but for$each is the
        // host's OWN array to iterate, not the replica's -- foreachCB
        // already no-ops for a cloned scope (see replicate()), so building
        // this here just means every one of N replicas gets a needless
        // CoreValue wired into the (possibly huge) source array's `dst`
        // set: N wasted links, N wasted re-evaluations on every change of
        // that array, purely additive cost that made a 10k-row mount OOM
        if (key === RT_FOR_EACH_VALUE && this.cloned) continue;
        // a `:server-` value the server already produced: built frozen, with
        // the result and neither `exp` nor `deps` -- the inert shape
        // CoreGlobal uses, for the same reason. Dropping `deps` matters:
        // kept, they would leave sources enqueuing a value whose get()
        // returns immediately, which is edges and propagation for nothing.
        //
        // Absent from the state, it is `undefined`: stage7 does not send the
        // browser these expressions at all, so there is nothing here to fall
        // back TO -- which is the wanted outcome, since an expression that
        // reaches for something only the server has could only throw
        const frozen =
          valProps.serverOnly && state && key in state ? { val: state[key] } : undefined;
        this.values[key] = this.newValue(key, frozen ?? valProps, props.values);
      }
      this.values[RT_VALUE_FN_KEY] = this.newValue(RT_VALUE_FN_KEY, {
        val: (key: string) => this.lookup(key),
      });
      this.values[RT_SET_FN_KEY] = this.newValue(RT_SET_FN_KEY, {
        // `lookup`, so it writes where a plain assignment would: the proxy's
        // own set trap resolves the same way, and the two must not disagree
        // about which scope holds the name
        val: (key: string, value: unknown) => {
          const found = this.lookup(key);
          found?.set(value);
          return !!found;
        },
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
    // The custom-tag instance this scope ended up INSIDE, structurally --
    // where `$parent` is where it was WRITTEN. The two are the same thing
    // until slotting separates them, and then they answer the two different
    // questions markup slotted into a component actually has: what did I
    // come from, and what am I part of.
    //
    // Deliberately not reachable by a bare name: a definition sees its
    // container only where it says so, which is what keeps `$host` from
    // reopening the isolation lookup() maintains.
    this.values[RT_HOST_VALUE_KEY] = this.newValue(RT_HOST_VALUE_KEY, {
      // fixed once linked, like $parent; undefined outside any instance,
      // which is what lets a component fall back to standing on its own
      val: this.enclosingInstance()?.proxy,
    });
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
    // told once the refresh it was built in has settled, so `:did-init` sees
    // a scope whose values are evaluated and whose bindings have landed
    this.ctx.arrived.add(this);
    // A `:for-each` host is a stencil, not a rendering: its element is
    // compiled into an inert <template> and every visible item is a clone
    // built from these same props. Building its subtree anyway gave those
    // scopes a life of their own -- evaluating against an item that is
    // never set, writing into markup nobody sees, and (worst) running
    // `:handle-` callbacks for an element that is not in the page
    if (!this.isStencil()) {
      props.children?.forEach((p) => context.newScope(p, context, this));
    }
  }

  /**
   * Builds the subtree a stencil skipped, once it stops being one.
   *
   * A `:for-data` region is a stencil until it has something to show, so at
   * construction its children are not built -- and nothing built them
   * later. A `:for-each` inside one still worked, because replicas are
   * cloned from props on demand and never needed the prototype; an ordinary
   * child scope did not exist at all, so `<div :for-data=${true}><i
   * :n=${1}>${n}</i></div>` rendered an empty `<i>`.
   *
   * Only ever grows a subtree that was never there: hiding a region keeps
   * its scopes, since showing and hiding are meant to preserve what the DOM
   * was holding.
   */
  protected buildSubtree() {
    if (this.children.length || !this.props.children?.length) return;
    this.props.children.forEach(p => this.ctx.newScope(p, this.ctx, this));
  }

  dispose() {
    if (!this.parent) return;
    // detaching before disposing, deepest first: a scope takes apart what it
    // built for its element before it stops existing, which is the order it
    // built them in, reversed
    this.detachSubtree();
    this.disposeSubtree();
    this.unlinkValues();
    const i = this.parent.children.indexOf(this);
    i >= 0 && this.parent.children.splice(i, 1);
    if (!this.props.name || !this.nameHost) return;
    const value = this.nameHost.values[this.props.name];
    if (!value) return;
    value.unlink();
    this.nameHost.cache.delete(this.props.name);
    delete this.nameHost.values[this.props.name];
  }

  // ===========================================================================
  // lifecycle
  // ===========================================================================
  /** whether this scope's markup is currently in the page */
  attached = false;
  private inited = false;

  /**
   * Runs a lifecycle callback, if this scope declares one.
   *
   * The value holds the arrow itself -- unlike `:handle-`, which stage1
   * desugars into a call -- and it was compiled with `this` already bound
   * here, so evaluating it hands back something callable that reads the
   * right names. Server-side the value is inert and there is nothing to
   * call, which is how these stay browser-only.
   */
  private fire(key: string): void {
    const value = this.values[key];
    if (!value) return;
    try {
      const fn = value.get();
      typeof fn === 'function' && (fn as () => void)();
    } catch (err) {
      // one failing callback is a page bug, not a reason to abandon the
      // rest of a teardown that still has DOM to release
      this.ctx.onError('callback', err, value);
    }
  }

  /**
   * Announces this scope's arrival: once for the scope itself, then for its
   * markup if that markup is actually in the page.
   *
   * Called per scope rather than by walking a subtree, because every scope
   * queues itself as it is built -- so a ten-thousand-row list costs one
   * check each rather than one walk each.
   */
  settle(): void {
    // a stencil is a prototype rather than a rendering, so it announces
    // nothing -- the same reason it evaluates nothing. A `:for-data` region
    // stops being one when it shows, which is when its scopes come into
    // being as far as anything watching is concerned
    if (this.isStencil()) return;
    if (!this.inited) {
      this.inited = true;
      this.fire(RT_DID_INIT_VALUE);
    }
    this.attachSelf();
  }

  /** whether this scope's element is in the document; browser-only */
  protected domAttached(): boolean {
    return false;
  }

  private attachSelf(): void {
    if (this.attached || !this.domAttached()) return;
    this.attached = true;
    this.fire(RT_DID_ATTACH_VALUE);
  }

  /** parents first, in the order things came into being */
  attachSubtree(): void {
    this.settle();
    this.children.forEach(c => c.attachSubtree());
  }

  /** children first, in the order things are taken apart */
  detachSubtree(): void {
    this.children.forEach(c => c.detachSubtree());
    if (!this.attached) return;
    this.attached = false;
    this.fire(RT_WILL_DETACH_VALUE);
  }

  private disposeSubtree(): void {
    this.children.forEach(c => c.disposeSubtree());
    // paired with init: a scope that never announced it existed has nothing
    // to announce about ceasing to
    if (!this.inited) return;
    this.fire(RT_WILL_DISPOSE_VALUE);
  }

  link(parent: CoreScope) {
    this.parent = parent;
    parent.children.push(this);
    if (this.props.name) {
      const host = this.nameHost = this.nameSiteScope();
      const region = this.regionHost();
      host.values[this.props.name] = region
        ? this.regionName(host)
        : new CoreValue({ val: this.proxy }, host, this.props.name);
    }
  }

  /**
   * The value a name registers when its scope lives inside a region.
   *
   * It answers with this scope only while the region is showing, and with
   * `undefined` while it is away. That is what makes the `?.` the compiler
   * insists on at such a reference mean what it says: the scope really is not
   * there, so the read really is undefined -- rather than the last thing it
   * saw, which is the stale-and-silent answer this exists to avoid.
   *
   * Re-evaluated by the toggle rather than by a dependency on the region's
   * own condition, which was the obvious way and does not work: this value
   * lives on the region's HOST and is not among the keys a hidden region
   * keeps live, so `unlinkInert` takes its edges away on the way down and it
   * never hears that it went. It is registered with the context instead, and
   * the toggle walks that -- see CoreContext.relinkMaybes.
   */
  private regionName(host: CoreScope): CoreValue<unknown> {
    const value = new CoreValue<unknown>(
      { exp: () => (this.rendered() ? this.proxy : undefined) },
      host,
      this.props.name
    );
    this.ctx.regionNames.add(value);
    return value;
  }

  /**
   * The nearest enclosing region whose markup comes and goes, if any.
   *
   * `:for-each` is not one of them: a replica is built when it exists and
   * disposed when it does not, so there is no scope sitting there answering
   * for markup that is away -- and a name inside a loop is refused at compile
   * time anyway, being as many scopes as there are items.
   */
  private regionHost(): CoreScope | undefined {
    for (let s: CoreScope | undefined = this.parent; s; s = s.parent) {
      const values = s.props.values;
      if (values?.[RT_IF_VALUE] || values?.[RT_FOR_DATA_VALUE]) {
        return s;
      }
    }
    return undefined;
  }

  /** whether this scope's markup is in the page, rather than parked in a stencil */
  private rendered(): boolean {
    for (let s: CoreScope | undefined = this; s; s = s.parent) {
      if (s.isStencil()) {
        return false;
      }
    }
    return true;
  }

  /**
   * The scope an `:aka` name belongs to: the nearest enclosing NAMED scope
   * in the markup this tag was written in.
   *
   * A name nests the way the markup nests, everywhere -- `<div
   * :aka="ui"><span :aka="pane">` is `ui.pane`, and bare `pane` is not a
   * name at all. This is that one rule. It used to be the immediate parent,
   * which meant a name landed on whatever scope came next: an anonymous
   * `<div :n=${1}>` in between made it reachable from nowhere, and for
   * slotted markup the name skipped out to the call site, so `<my-box
   * :aka="toasts"><span :aka="shipped">` gave `shipped` and refused
   * `toasts.shipped` -- the nesting the author wrote.
   *
   * Two things stop the walk before it finds a name.
   *
   * An instance is a wall from the INSIDE: its definition's `:aka`s are how
   * that markup refers to its own controls, and walking past would publish
   * them to whatever page used the tag. Reached from outside -- from
   * slotted markup, which the page wrote -- it is an ordinary enclosing
   * scope: it takes the name if it has one of its own, and is transparent
   * if it does not. That transparency is what keeps `<bs-toast
   * :aka="saved">` inside an unnamed container reachable as `saved`.
   *
   * See lexicalParent(), which answers the other question -- where a lookup
   * CONTINUES -- and gives a different chain for the same scope.
   */
  private nameSiteScope(): CoreScope {
    // whether the walk is currently in markup the PAGE wrote, as opposed to
    // a definition's own. It cannot be re-read at each level: only the
    // outermost slotted scope carries the flag, and a component may slot
    // content into a position inside its own markup, so the levels in
    // between belong to the definition while the name does not
    let outside = !!this.props.slotted;
    let scope: CoreScope | undefined = this.parent;
    // never past the page: `window` is a scope carrying a name like any
    // other, and a walk that did not stop here put page names on it -- out
    // of reach of the dispose that is supposed to take them away again
    while (scope && scope !== this.ctx.global) {
      const instance = !!scope.props.template;
      // an instance reached from INSIDE is where a name stops, named or
      // not: a definition's `:aka`s are how its markup refers to its own
      // controls, and publishing them would make every one of them part of
      // the interface
      if (instance && !outside) return scope;
      if (scope.props.name) return scope;
      if (instance) outside = false;
      else if (scope.props.slotted) outside = true;
      scope = scope.parent;
    }
    return this.parent!;
  }

  /** where link() registered this scope's name, so dispose() can remove it */
  private nameHost?: CoreScope;

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
    // usageSiteScope, not callSiteScope: markup slotted into a REPLICATED
    // tag was written beside that `:for-each`, so it sees the name it
    // declares. Identical to callSiteScope for every other instance
    return instance ? instance.usageSiteScope() : this.parent;
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
    if (!this.replicates()) return this.callSiteScope() ?? this;
    return (this.loopSite ??= new LoopSiteScope(this));
  }

  /** whether this scope binds a per-item name of its own, at either arity */
  private replicates(): boolean {
    return !!(
      this.props.values?.[RT_FOR_EACH_VALUE] || this.props.values?.[RT_FOR_DATA_VALUE]
    );
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
    if (!this.replicates()) return;
    const alias = this.aliasName();
    if (!this.props.values?.[alias]?.callSite) return;
    const value = this.values[alias];
    if (!value) return;
    this.usageSiteScope().values[alias] = value;
    delete this.values[alias];
  }

  private enclosingInstance(): CoreScope | undefined {
    // A replica's parent is its own stencil host, which is the same ELEMENT
    // rather than a containing one -- and it carries `template`, since a
    // replica of a custom-tag usage has to read as an instance itself. So a
    // walk starting there stops immediately and answers with the replica's
    // own kind: `<my-item :for-each=${rows} />` inside `<my-list>` reported
    // its host as another `my-item`, and every component that coordinates
    // with its container went quietly back to standing alone.
    let scope: CoreScope | undefined = this.cloned ? this.parent?.parent : this.parent;
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
    this.liveKeys().forEach((key) => this.values[key].link());
    recur && this.children.forEach((scope) => scope.linkValues());
  }

  unlinkValues(recur = true) {
    this.cache.clear();
    this.liveKeys().forEach((key) => this.values[key].unlink());
    recur && this.children.forEach((scope) => scope.unlinkValues());
  }

  updateValues(recur = true) {
    this.liveKeys().forEach((key) => {
      const value = this.values[key];
      // a refresh has just rebuilt the graph under here, so everything with
      // sources is asked again -- `get()` on its own would now decline,
      // having been told only about sources that MOVED, and this walk is
      // the one caller that means "recompute" rather than "read".
      //
      // Sourceless expressions are left alone, which is what the cycle
      // check did before dirty tracking: `:rows=${[]}` re-evaluated here
      // would hand back a different empty array and wake every reader of it
      value.src.size && (value.dirty = true);
      value.get();
    });
    recur && this.children.forEach((scope) => scope.updateValues());
  }

  /**
   * Unlinks what this scope has just stopped evaluating, and only that.
   *
   * A `:for-data` going away keeps the one value that decides whether it
   * comes back; everything else, here and below, is dropped.
   */
  private unlinkInert() {
    const live = new Set(this.liveKeys());
    this.cache.clear();
    Object.keys(this.values).forEach((key) => live.has(key) || this.values[key].unlink());
    this.children.forEach((scope) => scope.unlinkValues());
  }

  /**
   * Whether this scope's markup is a stencil at the moment rather than a
   * rendering. Two ways to be one, and the same consequence either way.
   *
   * A `:for-each` host: its element is only ever cloned, so it has exactly
   * one job -- say what the items are -- and its remaining values are
   * prototypes for the clones rather than bindings of its own.
   *
   * A `:for-data` with nothing to show: this is the whole point of the
   * directive rather than an optimisation. `:for-data=${user}` exists so the
   * body can say `data.name`; if the body evaluated while there is no user,
   * the guard would have done nothing at all.
   */
  isStencil(): boolean {
    if (this.cloned) return false;
    if (this.props.values?.[RT_FOR_EACH_VALUE]) return true;
    if (this.props.values?.[RT_IF_VALUE]) return !this.showing;
    return !!this.props.values?.[RT_FOR_DATA_VALUE] && !this.showing;
  }

  /**
   * An expression, however the props name it.
   *
   * A page's expressions are lifted into one array and referred to by index
   * (see CoreContextProps.exps); props built by hand carry the function
   * itself. CoreValue does this for every value it builds -- this is for the
   * one expression that never becomes a value.
   */
  expressionOf<T>(exp: ValueExp<T> | number | undefined): ValueExp<T> | undefined {
    return typeof exp === 'number'
      ? (this.ctx.props.exps as ValueExp<T>[] | undefined)?.[exp]
      : exp;
  }

  /** whether a `:for-data` scope currently has something to show */
  showing = false;

  /**
   * The values worth evaluating on this scope.
   *
   * Everything, except on a stencil: there, only what drives replication and
   * what the runtime supplies. Evaluating the rest used to fill markup
   * nobody sees with values read against an item that is never set --
   * harmless-looking until a component's `:handle-` ran for a `<template>`'s
   * element, or an expression that is perfectly safe per item (`item.badge.name`)
   * threw because there is no item here.
   */
  private liveKeys(): string[] {
    const keys = Object.keys(this.values);
    if (!this.isStencil()) return keys;
    const alias = this.aliasName();
    return keys.filter(
      (key) =>
        key.startsWith('$') ||
        key.startsWith('for$') ||
        key === RT_IF_VALUE ||
        key === alias
    );
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
    const ret = new CoreValue(props, this.hostFor(props), key);
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
    if (key === RT_FOR_DATA_VALUE) {
      // `this` for the same reason as above: a usage-site value resolves at
      // the call site while what it acts on is still this scope
      ret.setCB((_, v) => CoreScope.fordataCB(this, v));
      return ret;
    }
    if (key === RT_IF_VALUE) {
      ret.setCB((_, v) => CoreScope.ifCB(this, v));
      return ret;
    }
    return ret;
  }

  /**
   * The scope a value evaluates against.
   *
   * Its own, unless it was written at a usage site. `usageSiteScope()` is
   * the right answer for an instance, which sits at that site -- and the
   * wrong one for a definition scope that merely took the text over, whose
   * parent is the instance rather than the caller. That one goes out
   * through the instance, the same path slotted markup takes, and for the
   * same reason.
   */
  private hostFor(props: CoreValueProps<any>): CoreScope {
    if (!props.callSite) return this;
    if (!this.props.slottedText) return this.usageSiteScope();
    return this.enclosingInstance()?.usageSiteScope() ?? this.usageSiteScope();
  }

  /**
   * Zero or one, which is `:for-each`'s arity minus the copies.
   *
   * Nothing is cloned: the scope owns one element for its whole life and
   * that element is moved between the document and the stencil it came in.
   * So showing and hiding preserve whatever the DOM was holding -- focus, a
   * scroll offset, a playing video -- which a rebuild would throw away.
   *
   * `!= null` rather than truthiness, deliberately: `:for-each` already says
   * null and undefined mean nothing renders, and this is the same rule at
   * arity one. `0` and `''` are data, and a page that means "if" wants a
   * directive that says so.
   */
  /**
   * Showing or hiding the one element this scope owns.
   *
   * Shared by `:for-data` and `:if`, which are the same arity asked two
   * different questions. Nothing is cloned either way: the element moves
   * between the document and the stencil it arrived in, so showing and
   * hiding preserve whatever the DOM was holding -- focus, a scroll offset,
   * a playing video -- which a rebuild would throw away.
   */
  private static toggle(
    that: CoreScope,
    show: boolean,
    beforeShow?: () => void,
    afterHide?: () => void
  ) {
    if (show) {
      // before the early return, so an item that CHANGES while the region
      // is already showing still reaches the body
      beforeShow?.();
      if (that.showing) return;
      // set before refreshing: liveKeys() answers with everything only once
      // this scope counts as rendering
      that.showing = true;
      that.showView();
      // after showView, so anything built here finds its element in the
      // page rather than parked in the template
      that.buildSubtree();
      that.ctx.refresh(that);
      // the markup is back in the page without any scope having been built,
      // so nothing queued itself; the region says so on their behalf
      that.attachSubtree();
      // and anything OUTSIDE reading into here can finally resolve: its
      // dependency named a scope that did not exist a moment ago
      that.ctx.relinkMaybes();
      return;
    }
    if (!that.showing) return;
    // before the markup goes, so a callback still has an element in the page
    that.detachSubtree();
    that.showing = false;
    // NOT unlinkValues(): the directive's own value has to stay linked to
    // whatever it reads, or nothing will ever notice it coming back and the
    // region is hidden for good. Everything liveKeys() no longer covers
    // goes, which is exactly the body
    that.unlinkInert();
    afterHide?.();
    that.hideView();
    // the other half, and the one that matters more: a reader outside still
    // holds the edge it made when this appeared, and would go on answering
    // with what it last saw
    that.ctx.relinkMaybes();
  }

  /**
   * Zero or one, which is `:for-each`'s arity minus the copies.
   *
   * `!= null` rather than truthiness, deliberately: `:for-each` already says
   * null and undefined mean nothing renders, and this is the same rule at
   * arity one. `0` and `''` are data, and a page that means "if" has `:if`.
   */
  static fordataCB(that: CoreScope, v: any) {
    const alias = that.aliasValue();
    CoreScope.toggle(
      that,
      v != null,
      () => alias?.set(v),
      () => alias?.set(undefined)
    );
  }

  /**
   * The same arity, asked as a condition.
   *
   * Truthiness, so `${count}` and `${name}` mean what they look like, and no
   * item binding: a condition is not something the body wants, and `data`
   * inside an `:if` keeps meaning whatever it meant outside.
   *
   * Deliberately its own value key rather than compiling down to `for$data`
   * with a `|| null` wrapper, which would have needed no runtime change at
   * all -- that binds the condition as the region's item, which is the wart
   * this directive exists to remove.
   */
  static ifCB(that: CoreScope, v: any) {
    if (!that.props.elseOf && !that.props.elseNext) {
      CoreScope.toggle(that, !!v);
      return;
    }
    CoreScope.decideBranch(that);
  }

  /**
   * Shows the first branch of a chain whose condition holds, and hides the
   * rest.
   *
   * Re-decided in full from whichever branch's condition moved, rather than
   * handed along the chain. The branches are not dependencies of one
   * another -- an `:else` reads nothing, and an `:else-if` reads only its
   * own condition -- so a change in the first would wake none of the
   * others, and the branch that has to give up its position is exactly the
   * one that did not change. Every condition stays linked while its branch
   * is hidden (liveKeys keeps `if$`), which is what makes reading all of
   * them here answer with this pass's values rather than the last pass's.
   *
   * Cheap enough to do every time: a chain is as long as the author wrote
   * it, and each read is of a value already evaluated for this cycle.
   */
  private static decideBranch(that: CoreScope) {
    const chain = that.branchChain();
    const taken = chain.find((s) => !!s.values[RT_IF_VALUE]?.get());
    // hidden before shown, so two alternatives are never in the page at
    // once -- a CSS sibling rule, or a measurement taken from a lifecycle
    // callback, would read that intermediate state as the real one
    chain.forEach((s) => s !== taken && CoreScope.toggle(s, false));
    taken && CoreScope.toggle(taken, true);
  }

  /**
   * The whole `:if`/`:else-if`/`:else` chain this scope belongs to, in the
   * order it was written.
   *
   * Walked from the links rather than read off `parent.children` in order,
   * because document order is not something that array promises: a custom
   * tag used as a branch is compiled into an instance appended when its
   * usage is expanded, long after its plainer neighbours were loaded.
   */
  private branchChain(): CoreScope[] {
    const siblings = this.parent?.children ?? [this];
    const byId = (id?: string) =>
      id ? siblings.find((s) => s.props.id === id) : undefined;
    let head: CoreScope = this;
    for (let prev = byId(head.props.elseOf); prev; prev = byId(head.props.elseOf)) {
      head = prev;
    }
    const chain = [head];
    for (let next = byId(head.props.elseNext); next; next = byId(next.props.elseNext)) {
      chain.push(next);
    }
    return chain;
  }

  /** puts this scope's element back in the document; DOM-side, so a no-op here */
  showView() {}
  /** parks it back in the stencil it came in; likewise */
  hideView() {}

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
    // read off the props rather than through a CoreValue, because `:for-key`
    // never becomes one (see newValue) -- so this is the one place that has
    // to resolve an expression index itself
    const keyExp = that.expressionOf(that.props.values?.[RT_FOR_KEY_VALUE]?.exp);
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
        return keyExp(probe);
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
      // carried so a replica of a usage still reads as an INSTANCE: markup
      // slotted into it looks for the enclosing instance to resolve against,
      // and must find THIS replica rather than walk past it to the host and
      // read the host's unset item. init() checks `cloned` first, so the DOM
      // still comes from the stencil rather than from here
      template: this.props.template,
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
  private owner?: CoreScope;

  constructor(owner: CoreScope) {
    // no parent: linking would put it in someone's children and give it a
    // life cycle it has no use for
    super({ id: `${owner.props.id}$site`, values: {} }, owner.ctx);
    this.owner = owner;
    // this shim is not a scope a page can see: $id and $parent must go on
    // meaning the call site's, so they fall through rather than answering
    // for a thing with no element and no place in the tree. $value stays
    // ours -- the compiler emits every dependency as `this.$value(name)`,
    // and those have to start resolving HERE to reach the alias
    delete this.values[RT_ID_VALUE_KEY];
    delete this.values[RT_PARENT_VALUE_KEY];
  }

  /**
   * Resolution continues at the scope the tag was written in.
   *
   * lexicalParent rather than a lookup() override, because that is what
   * CoreScope.lookup() walks: it reads `values` and `lexicalParent()` off
   * each scope in turn and never calls the next one's lookup(). Slotted
   * markup resolves THROUGH this scope, so an override would be skipped.
   */
  override lexicalParent(): CoreScope | undefined {
    const owner = this.owner;
    // super() resolves `$parent` before this subclass's fields are assigned
    // (the ordering WebScope handles with `declare`), so this runs once with
    // no owner yet -- and the value it would compute is deleted above anyway
    if (!owner) return undefined;
    // a replica's structural parent is the HOST instance, not a call site.
    // Resolving from there would continue through the host's own
    // lexicalParent -- the page root, for an instance -- losing everything
    // declared in between, `<body>` included. The tag was written where the
    // host was
    return owner.cloned ? owner.parent?.callSiteScope() : owner.callSiteScope();
  }
}
