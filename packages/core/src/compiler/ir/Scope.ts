import { ServerElement } from '../../html/server-dom';
import type { Page } from './Page';
import type { Value } from './Value';

/** what `copyForUsage` carries from the scope it copies */
type Carried =
  | 'id'
  | 'name'
  | 'values'
  | 'textCount'
  | 'usesTemplate'
  | 'attributes'
  | 'callSiteValues'
  | 'usageValues'
  | 'parameters'
  | 'slotted'
  | 'lexicalParent';

/**
 * What it deliberately does not, each for its own reason.
 *
 * `page` and `parent` and `e` are what a copy is FOR -- it belongs to another
 * parent and stands in front of another element. `children` and
 * `slottedText` are filled by the caller, which is the only party that knows
 * where the clone put the markup. `textValues` is rebuilt with them, since a
 * text binding is bound by position in markup this usage has changed.
 * `lexicalChildren` is built later, in stage4, from whatever the tree is by
 * then. `detachedUsageSite` marks the one scope a usage leaves behind, which
 * is never one of these. And `elseOf`/`elseNext` are decided after every
 * usage has been expanded -- later than this runs -- so they reach the copies
 * through page.rehomedScopes instead.
 */
type Fresh =
  | 'page'
  | 'parent'
  | 'children'
  | 'e'
  | 'textValues'
  | 'slottedText'
  | 'lexicalChildren'
  | 'detachedUsageSite'
  | 'elseOf'
  | 'elseNext';

/** behaviour rather than state, so a copy inherits it */
type Methods = 'copyForUsage' | 'lexical' | 'nameSite' | 'resolvesVia';

/**
 * Every field of Scope is sorted into exactly one of the three above.
 *
 * Adding one lands here and fails to compile until it is, which is the whole
 * mechanism: the alternative is a copy silently missing it, and a scope
 * missing a field is a valid object that goes wrong somewhere else entirely.
 * The tuples are not decoration -- a bare `X extends never` distributes over
 * a union and answers `never` rather than `false`.
 */
type Unaccounted = Exclude<keyof Scope, Carried | Fresh | Methods>;
const accountedFor: [Unaccounted] extends [never] ? true : false = true;
void accountedFor;

export class Scope {
  page: Page;
  id: string;
  parent?: Scope;
  children: Scope[];
  values: Map<string, Value>;
  textValues: Map<string, Value>;
  textCount: number;
  e?: ServerElement;
  name?: string;
  /**
   * A definition's interface: the names its root marked `::`.
   *
   * Set on a `<:define>`'s own scope and read at every usage of that tag.
   * What is not in here is the component's own -- a `:_cls` on the same root
   * is private, settable from no usage site, and free to share a name with
   * whatever a caller declares for itself.
   */
  parameters?: Set<string>;
  /** set for a custom-tag usage scope: the id of the <:define> scope it instantiates from */
  usesTemplate?: string;
  /**
   * Set on the scope a usage ELEMENT was loaded into, once its values have
   * been handed to the instance and it has been spliced out of the tree.
   *
   * It keeps its parent link, and its values keep pointing at it, because an
   * expression written at a usage site resolves there -- and what is left in
   * its own `values` is exactly what the usage DECLARED rather than passed
   * (see `usageValues`), so a name written beside another is found here and
   * an argument goes on meaning what it means out there.
   */
  detachedUsageSite?: boolean;
  /** plain attributes supplied at a custom-tag usage site */
  attributes?: Map<string, string | null>;
  /**
   * Names in `values` that were written at the usage site rather than in the
   * <:define> body (`<my-card ::title=${data.t} />`). They live here so the
   * definition can read them, but an expression evaluates where it was
   * written -- this one has to see the call site's `data`, while the
   * definition's own expressions must not see the call site at all.
   */
  callSiteValues?: Set<string>;
  /**
   * What a usage site DECLARES rather than passes: the names the tag's
   * definition has no parameter for, plus the per-item alias a `:for-each`
   * on the tag introduces.
   *
   * A usage site is two things at once -- a call, and an element in the
   * caller's markup -- and these belong to the second. Deliberately a map of
   * their own rather than entries in `values`: that one is the INSTANCE's
   * namespace, and a local landing in it would take the place of whatever
   * the definition declared under the same name. Which is not hypothetical
   * -- the alias is forced local whatever the tag accepts, so
   * `<std-data :for-each=${urls} />` used to leave `std-data` with no `data`
   * of its own at all.
   *
   * The runtime builds these on the instance's usage-site scope, where the
   * caller's own markup resolves and the definition cannot reach.
   */
  usageValues?: Map<string, Value>;
  /**
   * Set on markup slotted into a custom tag: it lives under the instance
   * (that's where its DOM ends up) but was WRITTEN at the usage site, so it
   * resolves names from there -- the same rule `callSiteValues` applies to a
   * single value, applied to a whole subtree.
   */
  slotted?: boolean;
  /**
   * Took over text written at a usage site without being slotted markup
   * itself -- see rehomeNestedScopes, and CoreScopeProps.slottedText for
   * what the runtime does with it.
   */
  slottedText?: boolean;
  /** where name resolution continues; the structural parent unless slotted */
  lexicalParent?: Scope;
  /**
   * This scope carries an `:else`/`:else-if`: the branch immediately before
   * it, and the one after, once stage1 has linked the chain.
   *
   * Both directions are kept because the runtime needs both and can derive
   * neither: it finds a branch's neighbours among its parent's children by
   * id, so the head of a chain has no way back to its followers and a
   * follower no way to the head. Absent on a lone `:if`, which is what lets
   * that case cost nothing at all.
   */
  elseOf?: Scope;
  elseNext?: Scope;
  /**
   * Scopes whose `lexical()` is this one -- i.e. whose `:aka` name was
   * WRITTEN here, whatever subtree their DOM ended up in.
   *
   * The two differ only for slotted markup, which stage1-load moves under
   * the instance it fills. Its name still belongs out here, so resolution
   * has to be able to find it from out here; `children` alone can't say so.
   * Built once, at the start of stage4.
   */
  lexicalChildren?: Scope[];

  /**
   * A copy of this scope, for one usage site's own stencil.
   *
   * A usage that fills a slot gets a clone of the definition's markup, and
   * every scope whose element holds that slot has to come with it -- see
   * stage1-load's rehomeNestedScopes, which is the only caller and which
   * fills in the two things that depend on where the clone put the markup.
   *
   * The field-by-field sorting below is the point of having this here rather
   * than at the call site. It used to be a list of assignments over there,
   * and a field added to this class after it was written was simply not on
   * that list -- so `elseOf` was dropped, every branch of an adaptive
   * component came out unlinked, and an `:else` rendered alongside the
   * branch it was an alternative to. Nothing said anything, because a copy
   * that is missing a field is a perfectly good object.
   *
   * `accountedFor` below is what makes that impossible now: every key of
   * this class has to appear in one of the three lists, so adding a field
   * fails to compile until somebody decides which it is.
   */
  copyForUsage(parent: Scope, e: ServerElement): Scope {
    const copy = new Scope(this.page, undefined, e, this.name);
    // the same id, deliberately: the runtime finds a scope's DOM by it, and
    // an `:else` link between two copies is written as one
    copy.id = this.id;
    copy.parent = parent;
    // shared, not copied: a Value resolves against the scope it was WRITTEN
    // in, which is still the definition's
    copy.values = this.values;
    copy.textCount = this.textCount;
    copy.usesTemplate = this.usesTemplate;
    copy.attributes = this.attributes;
    copy.callSiteValues = this.callSiteValues && new Set(this.callSiteValues);
    copy.usageValues = this.usageValues;
    copy.parameters = this.parameters;
    copy.slotted = this.slotted;
    copy.lexicalParent = this.lexicalParent;
    return copy;
  }

  /** the scope this one's expressions resolve against */
  lexical(): Scope | undefined {
    return this.lexicalParent ?? this.parent;
  }

  /**
   * The scope this one's `:aka` name belongs to -- the compile-time mirror
   * of CoreScope.nameSiteScope().
   *
   * The nearest enclosing NAMED scope in the markup this tag was written
   * in. Everywhere in the language a name nests the way the markup nests:
   * `<div :aka="ui"><span :aka="pane">` is `ui.pane`, and bare `pane` is an
   * error. This is that rule, stated once, rather than the immediate parent
   * -- which registered a name on whatever scope happened to be next, so an
   * anonymous `<div :n=${1}>` in between left the name reachable from
   * nowhere, and slotted markup, whose name jumped out to the call site,
   * was flat when the markup said it was nested.
   *
   * Two things stop the walk short of a name. A definition's own markup
   * ends at the definition: its `:aka`s are how it refers to its controls,
   * not part of its interface, so they must not reach the page even through
   * the instance's own name. And an instance reached from OUTSIDE -- the
   * `child.slotted` test -- is markup the page wrote, so it is an enclosing
   * scope like any other: it takes the name when it has one of its own, and
   * is transparent when it does not, which is what keeps `<bs-toast
   * :aka="saved">` inside an unnamed container reachable as `saved`.
   */
  nameSite(): Scope | undefined {
    // see CoreScope.nameSiteScope() for why this is carried rather than
    // re-read at each level
    let outside = !!this.slotted;
    let s = this.parent;
    while (s && s !== this.page.global) {
      const instance = s.usesTemplate !== undefined;
      if (instance && !outside) return s;
      // the runtime has no definition scopes -- a definition's markup only
      // exists as instances -- so this is the compile-time spelling of the
      // same wall
      if (this.page.definitionScopes.has(s)) return s;
      if (s.name) return s;
      if (instance) outside = false;
      else if (s.slotted) outside = true;
      s = s.parent;
    }
    return this.parent;
  }

  /**
   * Where a lookup that STARTED here carries on -- the compile-time mirror
   * of CoreScope.lexicalParent().
   *
   * The runtime keeps two questions apart that `lexical()` answers with one.
   * Where a scope's `:aka` name is registered is the scope its tag was
   * WRITTEN in (CoreScope.nameSiteScope), and that is what `lexical()`
   * models -- correctly, since it is how a name is found at all. Where a
   * lookup CONTINUES is a different chain, and for a custom-tag instance it
   * is the page root: a definition must see only what was visible where it
   * was defined, never what its call site happens to declare.
   *
   * Conflating them let `outer.inner` resolve by walking out of an instance
   * into the markup around it -- a path the runtime has no edge for. So
   * `<my-box :aka="toasts"><bs-toast :aka="shipped" /></my-box>` accepted
   * `toasts.shipped` at compile time and failed at link time, two scopes
   * from anything naming either of them. `shipped` is registered at the
   * call site (its tag was written there, in a slot) and reachable as
   * itself; through the instance it is reachable from nowhere.
   */
  resolvesVia(): Scope | undefined {
    return this.usesTemplate !== undefined ? this.page.main : this.lexical();
  }

  constructor(page: Page, parent?: Scope, e?: ServerElement, name?: string) {
    this.page = page;
    this.id = page.createScopeId();
    this.parent = parent;
    this.children = [];
    this.values = new Map();
    this.textValues = new Map();
    this.textCount = 0;
    this.e = e;
    this.name = name;
    parent && parent.children.push(this);
  }
}
