import { ServerElement } from '../../html/server-dom';
import type { Page } from './Page';
import type { Value } from './Value';

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
  /** set for a custom-tag usage scope: the id of the <:define> scope it instantiates from */
  usesTemplate?: string;
  /**
   * Set on the scope a usage ELEMENT was loaded into, once its values have
   * been handed to the instance and it has been spliced out of the tree.
   *
   * It keeps its parent link, and its values keep pointing at it, because an
   * expression written at a usage site resolves there. But it does not exist
   * at runtime -- those values live on the instance and resolve against the
   * call site -- so resolution has to start one level up, at the scope this
   * one stood in front of. See stage4's `resolvesFrom`.
   */
  detachedUsageSite?: boolean;
  /** plain attributes supplied at a custom-tag usage site */
  attributes?: Map<string, string | null>;
  /**
   * Names in `values` that were written at the usage site rather than in the
   * <:define> body (`<my-card :title=${data.t} />`). They live here so the
   * definition can read them, but an expression evaluates where it was
   * written -- this one has to see the call site's `data`, while the
   * definition's own expressions must not see the call site at all.
   */
  callSiteValues?: Set<string>;
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
