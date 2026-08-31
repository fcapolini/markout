import {
  Comment,
  Document,
  Element,
  Node,
  NodeList,
  NodeType,
  TemplateElement,
  Text,
} from '../../html/dom';
import { parseDeclarations } from '../../html/css';
import {
  CoreScope,
  CoreScopeProps,
  RT_FOR_DATA_VALUE,
  RT_FOR_EACH_VALUE,
  RT_IF_VALUE,
  cloneId,
} from '../core/core-scope';
import { CoreValue, CoreValueProps } from '../core/core-value';
import {
  DOM_ATOMIC_TEXT_TAGS,
  DOM_ID_ATTR,
  DOM_REGION_END_MARKER,
  DOM_REGION_MARKER,
  DOM_TEXT_MARKER1,
  WebContext,
  WebContextProps,
} from './web-context';

/**
 * Whatever holds a node: an element, or a `<template>`'s content fragment
 * for anything sitting inside a stencil. The DOM has no one name for the
 * two, and this code has to move nodes in both.
 */
type ContainerNode = Pick<Element, 'childNodes' | 'insertBefore' | 'removeChild'>;

/**
 * Where one scope's markup ends and the next scope's begins.
 *
 * An element for almost everything: a scope owns what is under its own
 * element, down to but never into another scope's. A group region has no
 * element, so its territory is the run of nodes between its markers -- and
 * a replica's is its own run, which is what keeps two replicas of one group
 * from finding each other's markers, the way two replicas of an element are
 * kept apart by having an element each.
 */
type Territory = Element | Node[];

export const RT_ATTR_VALUE_PREFIX = 'attr$';
/** `:prop-x`: the element's JS property, for what an attribute can't carry */
export const RT_PROP_VALUE_PREFIX = 'prop$';
/** `:attr-x`: presence of the attribute, not its value */
export const RT_PRESENCE_VALUE_PREFIX = 'flag$';
export const RT_CLASS_VALUE_PREFIX = 'class$';
export const RT_STYLE_VALUE_PREFIX = 'style$';
/**
 * `class+=` / `class-=` / `style+=` / `style-=`, the whole-set forms of the
 * two families above. Compiled under the attribute name exactly as written
 * (see SET_OPERATOR_ATTRS in the compiler's Page.ts, which these mirror).
 */
export const RT_CLASS_ADD_KEY = 'class+';
export const RT_CLASS_DEL_KEY = 'class-';
export const RT_STYLE_ADD_KEY = 'style+';
export const RT_STYLE_DEL_KEY = 'style-';
export const RT_TEXT_VALUE_PREFIX = 'text$';
export const RT_EVENT_VALUE_PREFIX = 'event$';
export const RT_HANDLE_VALUE_PREFIX = 'handle$';
// the lifecycle pairs, browser-only for the same reason a handler is: they
// run for their effect on a view a served page does not have
export const RT_DID_VALUE_PREFIX = 'did$';
export const RT_WILL_VALUE_PREFIX = 'will$';
/**
 * `$dom`: this scope's own element, for the imperative corner a projection
 * can't reach -- `focus()`, `showModal()`, `play()`. The only door from an
 * expression to the view, which is what keeps such access greppable.
 */
export const RT_DOM_VALUE_KEY = '$dom';

export class WebScope extends CoreScope {
  // `declare`: init() (invoked from within CoreScope's constructor, i.e.
  // during super()) sets these; a real class field would instead
  // re-initialize them to undefined right after super() returns
  declare dom: Element;
  /** interpolated text nodes of this scope's own territory, by marker id */
  declare texts: Map<number, Text>;
  declare domListeners?: { name: string; listener: EventListener }[];
  // A region's two halves, both set during init() and so needing the same
  // `declare` treatment as above: the marker comment standing where its
  // markup was written, which is the only thing that says WHERE, and the
  // relocated <template> holding the markup, which is the only thing that
  // says WHAT. One element used to be both, by sitting where the markup
  // belonged -- see docs/design/stencil-placement.md
  declare anchor?: Comment;
  declare stencil?: Element;
  // A group region's other half, and where its markup waits while hidden.
  // The holder is a detached element and never enters the document: it is
  // somewhere to keep nodes that child scopes can still be found inside,
  // which an array of loose nodes would not be
  declare endAnchor?: Comment;
  declare holder?: Element;
  // set by clone() right before constructing a new clone scope, so that
  // clone's own init() (running during its super()) can pick up the DOM
  // node clone() already resolved for it; not itself touched during any
  // super() call, so it needs no such declare treatment
  private pendingCloneDom?: Element;
  // an SSR-hydrating page has real elements pre-rendered for however many
  // replicas it rendered; a client-only mount never does. Since SSR always
  // renders a contiguous prefix, the first replica acquireCloneDom() can't
  // find already means every later one in this host's lifetime won't either
  // -- see acquireCloneDom for why that matters
  private noMoreHydratedClones = false;

  constructor(props: CoreScopeProps, context: WebContext, parent?: CoreScope) {
    super(props, context, parent);
  }

  override init() {
    // Before super.init(), which is where values are constructed -- and a
    // `:on-` binds its listener as it is constructed, so a mode that had not
    // found its element yet would report having none to bind on
    if (this.props.mode) {
      this.dom = this.borrowedDom() as typeof this.dom;
    }
    super.init();
    this.texts = new Map();
    const templateId = this.props.template;
    const parentDom =
      this.parent instanceof WebScope ? this.parent.childContainer() : undefined;
    const view = this.props.mode
      ? this.dom
      : this.props.group
      ? undefined
      : this.cloned
      ? (this.parent as WebScope)?.pendingCloneDom
      : this.isRegion()
        ? this.acquireRegionDom(parentDom)
        : templateId
          ? this.acquireUsageDom(templateId, parentDom)
          : this.lookupView(parentDom);
    // Declared even when there is no element, and never inherited: answering
    // with an ANCESTOR's element would be the plausible-but-wrong kind of
    // failure that is hardest to notice (the same reason $id is
    // unconditional). Declared even when SERVING, too, holding nothing --
    // browser-only is a property of the value, not of whether the name is
    // there. A dependency on `$dom` is perfectly ordinary once anything
    // reads it outside a callback, and the runtime treats one that resolves
    // to nothing as a compiler bug, so the name has to exist either way
    // $dom is built on demand, like the other names the runtime supplies --
    // see CoreScope.builtin(). The comment above still holds: the name has
    // to be answerable on every scope, holding nothing where there is no
    // element, and never inherited from an ancestor
    if (!view && !this.props.group) {
      // Root scope or other scopes without corresponding DOM elements
      // should not try to perform DOM operations
      return;
    }
    view && (this.dom = view);
    // keyed by the id the marker carries, never by how many came before it:
    // a text node's binding must not depend on the document order of its
    // siblings, or anything that inserts or moves markup within a scope's
    // territory (slotted content, most of all) silently shifts every
    // binding after it onto the wrong node
    // Walked live and by index rather than over a `[...e.childNodes]` copy.
    // The copy was there for two reasons, and neither needs it: the
    // `insertBefore` below is positioned by NODE, so it does not care what
    // the indices did, and the one lookahead is `i + 1`, which a live list
    // answers as well -- it just has to re-read `length`, since an insert
    // grows it. What follows an insert is the empty Text just added, which
    // is neither an element nor a marker and costs one idle turn of the
    // loop. The copy, meanwhile, was an array per element of every scope's
    // territory: millions of them on a 10k-row mount, and the GC to match
    const f = (childNodes: NodeList | Node[], container: ContainerNode) => {
      for (let i = 0; i < childNodes.length; i++) {
        const n = childNodes[i];
        if (n.nodeType === NodeType.ELEMENT && (n as Element).getAttribute(DOM_ID_ATTR) === null) {
          if (!DOM_ATOMIC_TEXT_TAGS.has((n as Element).tagName)) {
            f((n as Element).childNodes, n as Element);
          }
          continue;
        }
        if (
          n.nodeType !== NodeType.COMMENT ||
          !(n as Comment).textContent.startsWith(DOM_TEXT_MARKER1)
        ) {
          continue;
        }
        const id = Number.parseInt((n as Comment).textContent.slice(DOM_TEXT_MARKER1.length));
        const next = childNodes[i + 1];
        // an atomic-text container (<style>/<title>) can't hold the marker
        // inside it, so the marker sits just before the element and the
        // binding target is its one text child
        if (
          next?.nodeType === NodeType.ELEMENT &&
          DOM_ATOMIC_TEXT_TAGS.has((next as Element).tagName)
        ) {
          const target = (next as Element).childNodes[0];
          target?.nodeType === NodeType.TEXT && this.texts.set(id, target as Text);
          continue;
        }
        // otherwise the interpolation's own text node sits between the two
        // markers -- except when there is none to sit there. An interpolation
        // that rendered empty serializes to nothing at all, so what the
        // browser parses back is the marker pair side by side. Every clone
        // stamped from a <template> stencil begins like that (a stencil is
        // never bound to data), which is why a `:for-each` that shrinks and
        // grows again comes back with dead text bindings. Materializing the
        // missing node costs one empty Text and keeps the binding live
        this.texts.set(
          id,
          next?.nodeType === NodeType.TEXT
            ? (next as Text)
            : (container.insertBefore(
                (this.ctx.props as WebContextProps).doc.createTextNode(''),
                next ?? null
              ) as Text)
        );
      }
    };
    // An atomic-text element with a scope of ITS OWN (`<textarea :on-input=...>`)
    // is the one case the walk below cannot reach: its content marker sits
    // outside the element, among its parent's children, because a comment
    // written inside would be read back as literal text -- so the marker
    // belongs to the parent's territory while the text value belongs to
    // this scope. Bind it from the sibling side before walking.
    if (this.dom && DOM_ATOMIC_TEXT_TAGS.has(this.dom.tagName)) {
      const marker = this.dom.previousSibling;
      const target = this.dom.childNodes[0];
      if (
        marker?.nodeType === NodeType.COMMENT &&
        `${(marker as Comment).textContent}`.startsWith(DOM_TEXT_MARKER1)
      ) {
        const id = Number.parseInt(
          (marker as Comment).textContent.slice(DOM_TEXT_MARKER1.length)
        );
        // an interpolation that rendered empty serializes to nothing, so the
        // element comes back with no text child at all -- materialize one,
        // for the same reason the split-text case below does
        this.texts.set(
          id,
          target?.nodeType === NodeType.TEXT
            ? (target as Text)
            : (this.dom.appendChild(
                (this.ctx.props as WebContextProps).doc.createTextNode('')
              ) as Text)
        );
      }
    }
    if (this.props.group) {
      // A region with no element of its own: what it holds is every node
      // between its two markers, so there is no `dom` to set and nothing
      // for `$dom` to answer with. Its texts are bound over that run
      const within = this.acquireGroupRange(parentDom);
      const nodes = this.showing ? this.groupNodes() : this.holder?.childNodes;
      within && nodes && f(nodes, within);
      return;
    }
    this.dom && f(this.dom.childNodes, this.dom);
  }

  override builtin(key: string): CoreValue<any> | undefined {
    if (key !== RT_DOM_VALUE_KEY) return super.builtin(key);
    const already = this.values[key];
    if (already) return already;
    // Answered even where there is no element, holding nothing: a dependency
    // on `$dom` is ordinary once anything reads it outside a callback, and
    // the runtime treats one that resolves to nothing as a compiler bug --
    // so the name has to exist either way. Browser-only is a property of the
    // value, not of whether the name is there
    return (this.values[key] = this.newValue(key, {
      val: (this.ctx.props as WebContextProps).server ? undefined : this.dom,
    }));
  }

  /** whether this scope's markup comes and goes, or is stamped out */
  private isRegion(): boolean {
    const values = this.props.values;
    return !!(
      values?.[RT_FOR_EACH_VALUE] ||
      values?.[RT_FOR_DATA_VALUE] ||
      values?.[RT_IF_VALUE]
    );
  }

  /**
   * Resolves a region's marker and its stencil, and gets it an element.
   *
   * Three ways to end up with one, in the order they are tried:
   *
   * - **Already in the page.** A server-rendered region that was showing,
   *   met again on hydration. Adopted as it stands, and `showing` says so --
   *   nothing is cloned and no markup moves, which is the whole point of
   *   rendering it there in the first place.
   * - **The stencil's own element, for a `:for-each` host.** Its element is
   *   never a rendering (see CoreScope.isStencil), so it keeps the one
   *   inside the stencil and every replica is a clone of that.
   * - **A clone of it, for anything optional.** A stencil is a source and
   *   never a parking spot: one may serve every replica of an enclosing
   *   `:for-each`, so a region that wrote itself back into it would be
   *   writing into what its siblings are about to stamp out. The clone is
   *   held detached until `showView` puts it after the marker.
   */
  private acquireRegionDom(parentDom?: Territory): Element | undefined {
    const ctx = this.ctx as WebContext;
    const id = `${this.props.id}`;
    const marker = this.lookupMarker(id, parentDom);
    if (!marker) return undefined;
    this.anchor = marker;
    // resolved even when the element turns out to be standing in the page
    // already: what a rendering has spent is asked of the scopes afterwards
    // (see render.ts's dropSpentStencils), and a scope that never looked
    // would answer that it had spent nothing
    const text = `${marker.textContent}`;
    const stencil = ctx.findStencil(text.slice(text.indexOf('.') + 1));
    this.stencil = stencil;
    const replicates = !!this.props.values?.[RT_FOR_EACH_VALUE];
    if (!replicates) {
      // the node after the marker, rather than a search for the id: showView
      // puts it exactly there and the server rendered it exactly there, so
      // one look answers what a walk of the whole container would -- which
      // matters per replica, where a second walk is a second pass over the
      // same subtree for every row on the page
      const next = marker.nextSibling;
      if (
        next?.nodeType === NodeType.ELEMENT &&
        (next as Element).getAttribute(DOM_ID_ATTR) === id
      ) {
        this.showing = true;
        return next as Element;
      }
    }
    if (!stencil) return undefined;
    const proto = this.props.template
      ? // a custom tag: what the stencil holds is the usage marker, and the
        // instance is stamped into it there, once, whoever gets there first
        this.acquireUsageDom(this.props.template, stencil)
      : // by id rather than "the first element in there", because markup
        // written inside `<svg>` travels with an `<svg>` around it: a
        // `<circle>` alone in a stencil is an unknown HTML element, and a
        // clone of that renders nothing (see relocateStencils)
        ctx.findElementById(id, stencil);
    if (!proto || replicates) return proto;
    const node = proto.cloneNode(true) as unknown as Element;
    node.setAttribute(DOM_ID_ATTR, id);
    return node;
  }

  /**
   * Where a child scope of THIS one should be looked for.
   *
   * Its own element, except for a group region, which has none: there the
   * markup is either standing between the two markers -- so the marker's
   * container is where to look -- or waiting in the holder.
   */
  private childContainer(): Territory | undefined {
    if (!this.props.group) return this.dom;
    // the run, not the container it sits in: two replicas of one group are
    // siblings under the same element, and a search over that element would
    // hand the second replica the first one's markers
    return this.showing || this.stampsPerItem() ? this.groupNodes() : this.holder;
  }

  /** whether this scope stamps its markup out per item */
  private stampsPerItem(): boolean {
    return !!this.props.values?.[RT_FOR_EACH_VALUE];
  }

  /** the stencil key this region's markers carry, for making a replica's */
  private stencilKey(): string {
    const text = `${this.anchor?.textContent ?? ''}`;
    return text.slice(text.indexOf('.') + 1);
  }

  /**
   * Puts a replica's marker pair, and the run between them, in the page.
   *
   * The element form clones one node and stamps the clone id on it. A run
   * has no node to stamp, so each replica gets markers of its own carrying
   * that id -- which is what the replica's own init() then finds, through
   * the same lookup an unreplicated region uses. Nothing else about it is
   * special: what lies between the two is its markup, and it moves and goes
   * as a unit.
   *
   * Server-rendered replicas are already there, markers and all, and are
   * left standing. The prefix scan stops for good once it misses, for the
   * reason acquireCloneDom gives: it is O(n) per replica otherwise.
   */
  private prepareCloneRange(id: string): void {
    const container = this.anchorContainer();
    const anchor = this.anchor;
    if (!container || !anchor) return;
    const prefix = `${DOM_REGION_MARKER}${id}.`;
    if (!this.noMoreHydratedClones) {
      const found = [...container.childNodes].some(
        n =>
          n.nodeType === NodeType.COMMENT &&
          `${(n as Comment).textContent}`.startsWith(prefix)
      );
      if (found) return;
      this.noMoreHydratedClones = true;
    }
    const doc = (this.ctx.props as WebContextProps).doc;
    const prev = this.clones?.at(-1) as WebScope | undefined;
    const ref = (prev?.endAnchor ?? anchor) as unknown as Node;
    const start = doc.createComment(`${prefix}${this.stencilKey()}`);
    const end = doc.createComment(`${DOM_REGION_END_MARKER}${id}`);
    container.insertBefore(end, ref.nextSibling);
    container.insertBefore(start, end);
    const content = (this.stencil as unknown as TemplateElement | undefined)?.content;
    for (const child of [...(content?.childNodes ?? [])]) {
      container.insertBefore(child.cloneNode(true), end);
    }
  }

  /**
   * Resolves a group region: both its markers, its stencil, and whether the
   * markup between them is standing.
   *
   * The end marker is what an ordinary region gets from its element -- a
   * way to say "this much is mine". Anything between the two means the
   * server rendered it showing and it is adopted where it stands; an empty
   * pair means hidden, and the stencil is stamped into the holder so that
   * showing it later is a move rather than a build.
   */
  private acquireGroupRange(parentDom?: Territory): ContainerNode | undefined {
    const ctx = this.ctx as WebContext;
    const id = `${this.props.id}`;
    const marker = this.lookupMarker(id, parentDom);
    if (!marker) return undefined;
    this.anchor = marker;
    const text = `${marker.textContent}`;
    this.stencil = ctx.findStencil(text.slice(text.indexOf('.') + 1));
    const endText = `${DOM_REGION_END_MARKER}${id}`;
    let n = marker.nextSibling as Node | null;
    let showing = false;
    while (
      n &&
      !(n.nodeType === NodeType.COMMENT && `${(n as Comment).textContent}` === endText)
    ) {
      showing = true;
      n = n.nextSibling as Node | null;
    }
    // no end marker is nothing this can act on: leave the markup alone
    // rather than take a guess at where it stops
    if (!n) return undefined;
    this.endAnchor = n as Comment;
    this.showing = showing;
    const holder = (this.ctx.props as WebContextProps).doc.createElement('div');
    this.holder = holder;
    // a replicating host renders nothing of its own: the stencil is what
    // its replicas are stamped from, and filling a holder here would leave
    // a spare copy of the run in the page. The same rule acquireRegionDom
    // keeps for an element host, which hands back the stencil's element
    if (!showing && !this.stampsPerItem()) {
      const content = (this.stencil as unknown as TemplateElement | undefined)?.content;
      for (const child of [...(content?.childNodes ?? [])]) {
        holder.appendChild(child.cloneNode(true));
      }
    }
    return showing
      ? ((marker as unknown as { parentNode: Element }).parentNode)
      : holder;
  }

  /**
   * The nodes standing between the two markers.
   *
   * Always the live run rather than "wherever the markup is": `toggle`
   * clears `showing` before it calls `hideView`, so a reading that went by
   * that flag would look in the holder at the one moment the page is what
   * has to be emptied.
   */
  private rangeWithMarkers(): Node[] {
    if (!this.anchor || !this.endAnchor) return [];
    return [
      this.anchor as unknown as Node,
      ...this.groupNodes(),
      this.endAnchor as unknown as Node,
    ];
  }

  private groupNodes(): Node[] {
    const ret: Node[] = [];
    let n = this.anchor?.nextSibling as Node | null;
    while (n && n !== (this.endAnchor as unknown as Node)) {
      ret.push(n);
      n = n.nextSibling as Node | null;
    }
    return ret;
  }

  /**
   * A usage instance sits where the tag was written, so its element and its
   * marker are looked for within its container's own subtree -- the same
   * containment rule lookupView() uses, and what lets one usage site inside
   * a `:for-each` become a separate instance per replica, each finding its
   * own marker rather than racing for one document-wide match.
   *
   * `within` is that container, except for a usage that is also a region:
   * there the marker was moved to <head> with the stencil around it, so the
   * instance is stamped out in there and the region does the rest.
   *
   * The <:define> stencil is the exception to the exception: it lives in
   * <head> and is nowhere near either, so that lookup stays document-wide.
   */
  private acquireUsageDom(templateId: string, within?: Territory): Element | undefined {
    const ctx = this.ctx as WebContext;
    const id = `${this.props.id}`;
    const existing = ctx.findElementById(id, within);
    if (existing) return existing;

    const stencil = ctx.findElementById(templateId);
    const marker = ctx.findUseMarker(id, within);
    if (!stencil || !marker) return undefined;

    const node = stencil.cloneNode(true) as unknown as Element;
    node.setAttribute(DOM_ID_ATTR, id);
    for (const [name, value] of Object.entries(this.props.attributes ?? {})) {
      node.setAttribute(name, value);
    }
    // parentNode, not parentElement: inside a stencil the marker's container
    // is the template's content fragment, which is no element
    const container = (marker as unknown as { parentNode: Element }).parentNode;
    container.insertBefore(node, marker);
    container.removeChild(marker);
    return node;
  }

  /**
   * Finds this scope's own DOM element by searching only within
   * `parentView` (or the whole document, for a scope with no DOM parent),
   * stopping at any nested scope's element without descending into it. This
   * keeps ids unique only among a single parent's descendants rather than
   * document-wide, so repeated/list instances don't collide with each
   * other's ids.
   */
  private lookupView(parentView?: Territory): Element | undefined {
    const id = `${this.props.id}`;
    return this.lookupWithin(parentView, n =>
      n.nodeType === NodeType.ELEMENT && (n as Element).getAttribute(DOM_ID_ATTR) === id
        ? (n as Element)
        : undefined
    );
  }

  /**
   * Finds this region's marker comment, under the same containment rule.
   *
   * One marker is written per region and replication copies it along with
   * everything else, so the same scope id stands in every replica -- and
   * which one is mine is answered by whose territory it is in, exactly as
   * lookupView answers it for an element.
   */
  private lookupMarker(id: string, parentView?: Territory): Comment | undefined {
    const prefix = `${DOM_REGION_MARKER}${id}.`;
    return this.lookupWithin(parentView, n =>
      n.nodeType === NodeType.COMMENT &&
      `${(n as Comment).textContent}`.startsWith(prefix)
        ? (n as Comment)
        : undefined
    );
  }

  /**
   * Walks a scope's own territory: everything under `parentView` down to,
   * but never into, the next scope's element.
   *
   * That boundary is what keeps ids unique only among a single parent's
   * descendants rather than document-wide, so repeated instances don't
   * collide with each other's -- and it is what makes both of the searches
   * above cost the subtree they are asking about rather than the document.
   */
  private lookupWithin<T>(
    parentView: Territory | undefined,
    match: (n: Node) => T | undefined
  ): T | undefined {
    const roots = Array.isArray(parentView) ? parentView : undefined;
    const container: Element | Document | undefined = roots
      ? undefined
      : (parentView as Element | undefined) ?? (this.ctx.props as WebContextProps).doc;
    if (!container && !roots) return undefined;
    const childNodesOf = (e: Element | Document): NodeList =>
      (e as Element).tagName === 'TEMPLATE'
        ? (e as unknown as TemplateElement).content.childNodes
        : e.childNodes;
    // indexed, for the reason WebContext.searchDocument gives: a live
    // NodeList walked with `for...of` allocates an iterator per element,
    // and this walk is entered once per scope per mount
    const lookup = (childNodes: NodeList): T | undefined => {
      for (let i = 0, len = childNodes.length; i < len; i++) {
        const n = childNodes[i];
        const found = match(n);
        if (found !== undefined) return found;
        if (n.nodeType !== NodeType.ELEMENT) continue;
        const e = n as Element;
        if (e.getAttribute(DOM_ID_ATTR) !== null) continue;
        const ret = lookup(childNodesOf(e));
        if (ret !== undefined) return ret;
      }
      return undefined;
    };
    return lookup(roots ?? childNodesOf(container!));
  }

  override dispose(): void {
    this.domListeners?.forEach(({ name, listener }) => {
      this.dom?.removeEventListener(name, listener);
    });
    this.domListeners = [];
    // A mode is disposed rather than disarmed when it has children, since
    // then it is a replica and goes away outright -- so the paint has to come
    // off here as well as in `lifetimeEnded`, or a modality with markup
    // leaves its class behind on an element it no longer has anything to do
    // with. Everything else removes the element itself and takes its classes
    // with it
    if (this.props.mode) {
      this.withdrawPaint();
      this.releaseOwned();
    }
    if (this.props.group) {
      // markers included: they carry this replica's id, and a pair left
      // behind would be found again by whatever takes that id next
      const container = (this.anchor as unknown as { parentNode?: ContainerNode })
        ?.parentNode;
      this.rangeWithMarkers().forEach(node => container?.removeChild(node));
      super.dispose();
      return;
    }
    // Listeners go, the element stays. What follows removes the DOM a scope
    // OWNS, and a mode owns none of it -- below the group branch, because a
    // mode WITH children owns its range and has to take that with it
    if (this.props.mode) {
      super.dispose();
      return;
    }
    // a stencil's own dom (inside a <template>) has no parentElement (a
    // DocumentFragment isn't an Element), so this is a no-op for it
    this.dom?.parentElement?.removeChild(this.dom);
    super.dispose();
  }

  override newValue(
    key: string,
    props: CoreValueProps<any>,
    allValues?: { [key: string]: CoreValueProps<any> },
  ) {
    // a handler runs for its effect on the view, and a served page has no
    // view to drive -- `$dom` is not there either. Inert rather than merely
    // unbound: evaluating it is the whole point, so there is nothing to
    // report, only nothing to do. Anything a handler would derive belongs in
    // a value instead, or server and browser render different markup
    if (
      (key.startsWith(RT_HANDLE_VALUE_PREFIX) ||
        key.startsWith(RT_DID_VALUE_PREFIX) ||
        key.startsWith(RT_WILL_VALUE_PREFIX)) &&
      (this.ctx.props as WebContextProps).server
    ) {
      return new CoreValue({}, this, key);
    }
    const ret = super.newValue(key, props, allValues);
    if (ret.cb) return ret;
    if (key === RT_CLASS_ADD_KEY || key === RT_CLASS_DEL_KEY) {
      const add = key === RT_CLASS_ADD_KEY;
      ret.setCB((_, val) => {
        const names = this.nameSet(ret, key, val);
        add ? (this.classAdd = names) : (this.classDel = names);
        this.applyClasses(ret);
      });
      return ret;
    }
    if (key === RT_STYLE_ADD_KEY) {
      ret.setCB((_, val) => {
        this.styleAdd = this.declarationMap(ret, key, val);
        this.applyStyles(ret);
      });
      return ret;
    }
    if (key === RT_STYLE_DEL_KEY) {
      ret.setCB((_, val) => {
        this.styleDel = this.nameSet(ret, key, val);
        this.applyStyles(ret);
      });
      return ret;
    }
    if (key.startsWith(RT_ATTR_VALUE_PREFIX)) {
      // verbatim, like class$/style$/on$: the key already holds the name the
      // author wrote, and an attribute name is element-facing rather than
      // JS-facing. Dash-casing it turned `viewBox` into `view-box` -- and an
      // SVG whose viewBox is spelled that way silently stops scaling, since
      // the DOM only honours the exact name. Nothing in HTML needs the
      // conversion: a dashed attribute is written dashed.
      const name = key.slice(RT_ATTR_VALUE_PREFIX.length);
      // `class` and `style` are the composed ones: what they resolve to is
      // the BASE the contributions sit on, not the attribute's final text.
      //
      // Claimed before any callback runs, and nothing is applied until it has
      // arrived. Both matter: the first keeps the base from being mistaken
      // for whatever the markup happened to carry (see applyClasses), and the
      // second keeps a contribution from landing in front of it
      if (name === 'class') {
        this.classPending = true;
        ret.setCB((_, val) => {
          this.classBase = val == null ? [] : tokens(`${val}`);
          this.classPending = false;
          this.applyClasses(ret);
        });
        return ret;
      }
      if (name === 'style') {
        this.stylePending = true;
        ret.setCB((_, val) => {
          this.styleBase = new Map(val == null ? [] : parseDeclarations(`${val}`));
          this.stylePending = false;
          this.applyStyles(ret);
        });
        return ret;
      }
      ret.setCB((_, val) => {
        if (!this.dom) return this.unbound(ret, `no element to set "${name}" on`);
        if (!this.claim(key)) return;
        if (val == null) {
          this.dom.removeAttribute(name);
        } else {
          this.dom.setAttribute(name, `${val}`);
        }
      });
      return ret;
    }
    if (key.startsWith(RT_PROP_VALUE_PREFIX)) {
      const name = key.slice(RT_PROP_VALUE_PREFIX.length);
      ret.setCB((_, val) => {
        // nothing to serialize: a property is state on an element instance,
        // so a server-rendered page can't carry one and skipping is right
        if ((this.ctx.props as WebContextProps).server) return;
        if (!this.dom) return this.unbound(ret, `no element to set property "${name}" on`);
        (this.dom as unknown as Record<string, unknown>)[name] = val;
      });
      return ret;
    }
    if (key.startsWith(RT_PRESENCE_VALUE_PREFIX)) {
      const name = key.slice(RT_PRESENCE_VALUE_PREFIX.length);
      ret.setCB((_, val) => {
        if (!this.dom) return this.unbound(ret, `no element to toggle "${name}" on`);
        if (!this.claim(key)) return;
        // empty string, not "true": an HTML boolean attribute means true by
        // being present at all, and that is the form every browser writes
        val ? this.dom.setAttribute(name, '') : this.dom.removeAttribute(name);
      });
      return ret;
    }
    if (key.startsWith(RT_CLASS_VALUE_PREFIX)) {
      const name = key.slice(RT_CLASS_VALUE_PREFIX.length);
      ret.setCB((_, val) => {
        (this.classOn ??= new Map()).set(name, !!val);
        this.applyClasses(ret);
      });
      return ret;
    }
    if (key.startsWith(RT_STYLE_VALUE_PREFIX)) {
      const name = key.slice(RT_STYLE_VALUE_PREFIX.length);
      ret.setCB((_, val) => {
        if (!this.claim(key)) return;
        (this.styleOn ??= new Map()).set(name, val == null || val === '' ? null : `${val}`);
        this.applyStyles(ret);
      });
      return ret;
    }
    if (key.startsWith(RT_TEXT_VALUE_PREFIX)) {
      const textIndex = Number.parseInt(key.slice(RT_TEXT_VALUE_PREFIX.length));
      const t = this.texts.get(textIndex);

      //TODO: atomic text (<style>, <title>) is parsed as a single node
      //holding one concatenated expression, so changing any interpolated
      //value rewrites the whole content. That's nothing for a title, but a
      //reactive stylesheet re-emits every rule when one binding changes.
      //Splitting atomic text per interpolation would be a compiler/parser
      //change, not a language one: the keys arriving here would just become
      //finer-grained.
      ret.setCB((_, val) => {
        if (!t) return this.unbound(ret, 'no text node carrying that marker id');
        // nothing, not a zero-width space: a ZWSP used to be what kept the
        // text node alive through serialization, but init() now materializes
        // a missing one at hydration, so the placeholder has no job left --
        // and it was never free. U+200B isn't whitespace, so it survives
        // `.trim()`, and component slot-detection (Shoelace's, among others)
        // decides a slot has content with exactly that test: an "empty"
        // binding could silently switch on a card's header or footer
        t.textContent = val == null ? '' : String(val);
      });
      return ret;
    }
    if (key.startsWith(RT_EVENT_VALUE_PREFIX)) {
      // the compiler keeps dash-case event names (e.g. custom events like
      // "item-selected") verbatim in the compiled key, same as class$/style$
      const name = key.slice(RT_EVENT_VALUE_PREFIX.length);
      // A replication HOST is a prototype and listens to nothing: its
      // replicas do. Harmless where the host's element is the one inside its
      // `<template>`, and not harmless at all for a `<:mode>` with children,
      // whose host borrows the SAME element its replica does -- both would
      // bind, and the page would see every event twice.
      //
      // Asked of `:for-each` rather than of `isStencil()`, which is also true
      // of a region that is merely not showing yet -- and a childless mode is
      // its own region host, so that reading bound nothing at all
      if (this.props.values?.[RT_FOR_EACH_VALUE] && !this.cloned) {
        return ret;
      }
      if (typeof ret.exp?.(this.proxy) === "function") {
        const listener: EventListener = (e: Event) => this.proxy[key]?.(e);
        this.domListeners ||= [];
        this.domListeners.push({ name, listener });
        this.dom
          ? this.dom.addEventListener(name, listener)
          : this.unbound(ret, `no element to bind "${name}" on`);
      }
      return ret;
    }
    return ret;
  }

  // ==========================================================================
  // class and style: composed, not assigned
  // ==========================================================================

  /**
   * What each of the two composite attributes is built from.
   *
   * `class` and `style` have more than one author. A definition sets the
   * attribute, a usage site adds to it with `class+=` and takes from it with
   * `class-=`, `:class-x` toggles one name, and -- for the components that
   * hand their element to somebody else's JS -- Bootstrap puts `show` on a
   * modal while nobody is looking. Writing the whole attribute is how each of
   * those used to destroy the others: a reactive `class=${...}` re-running
   * turned `box box-red mine` into `box box-green`, silently, and only once
   * the variant happened to change.
   *
   * So nothing here writes the attribute. Each input records what it
   * contributes, the four together say what the element's set SHOULD be, and
   * `apply` moves the difference -- which leaves a class this scope never put
   * on exactly where it was.
   */
  declare private classBase?: string[];
  declare private classAdd?: string[];
  declare private classDel?: string[];
  declare private classOn?: Map<string, boolean>;
  declare private classApplied?: Set<string>;
  /** a `class=${...}` is on its way: hold off until it lands */
  declare private classPending?: boolean;
  declare private styleBase?: Map<string, string>;
  declare private styleAdd?: Map<string, string>;
  declare private styleDel?: string[];
  declare private styleOn?: Map<string, string | null>;
  declare private styleApplied?: Map<string, string>;
  declare private stylePending?: boolean;

  /**
   * Base, then every addition, then every removal -- in that order whatever
   * order they were written in.
   *
   * By kind rather than by position, so `class-="fade"` at a usage site means
   * the same thing whether it stands before or after the `class+=` in the
   * definition it is arguing with. A falsy `:class-x` is a removal like any
   * other, which is what it always was.
   */
  /** `applyClasses` without a value to blame an unbound element on */
  private applyClassesFor(value: CoreValue<any> | undefined): void {
    value ? this.applyClasses(value) : this.dom && this.applyClasses(undefined as never);
  }

  private applyClasses(value: CoreValue<any>): void {
    if (!this.dom) return this.unbound(value, 'no element to set classes on');
    if (this.classPending) return;
    // what stands on the element the first time round is the markup's own
    // class -- the stencil's, plus whatever a usage site wrote over it. It is
    // the base when no `class=${...}` claims that job, and either way it is
    // what the first pass is a difference FROM, so a `class` the definition
    // computes still replaces the one written at the usage site.
    //
    // Afterwards the difference is from what we last applied, which is the
    // whole point: a class this scope never put on -- Bootstrap's `show` on a
    // modal it was handed -- is in neither set and so is never touched.
    const on = tokens(this.dom.className);
    const had = this.classApplied ?? new Set(this.props.mode ? [] : on);
    // A mode's base is EMPTY, where an element's own scope starts from what
    // the markup wrote. The element is borrowed: everything already on it
    // belongs to whoever owns it, so a mode that took it as a base would
    // adopt those classes -- and then hand them back or take them away as its
    // own set moved. Starting from nothing, its want-set is exactly what it
    // declared, and it can neither claim nor lose anybody else's
    this.classBase ??= this.props.mode ? [] : on;
    const want = new Set(this.classBase);
    this.classAdd?.forEach(n => want.add(n));
    this.classOn?.forEach((yes, n) => yes && want.add(n));
    this.classOn?.forEach((yes, n) => yes || want.delete(n));
    this.classDel?.forEach(n => want.delete(n));
    had.forEach(n => want.has(n) || this.dom.classList.remove(n));
    want.forEach(n => had.has(n) || this.dom.classList.add(n));
    this.classApplied = want;
  }

  private applyStyles(value: CoreValue<any>): void {
    if (!this.dom) return this.unbound(value, 'no element to set styles on');
    if (this.stylePending) return;
    const on = new Map(parseDeclarations(this.dom.style.cssText));
    // empty for a mode, for the reason `applyClasses` gives: the element is
    // borrowed, so everything already declared on it belongs to whoever owns
    // it, and a base taken from there would be adopted and then handed back
    const base = this.props.mode ? new Map<string, string>() : on;
    const had = this.styleApplied ?? base;
    this.styleBase ??= base;
    const want = new Map(this.styleBase);
    this.styleAdd?.forEach((v, k) => want.set(k, v));
    this.styleOn?.forEach((v, k) => (v == null ? want.delete(k) : want.set(k, v)));
    this.styleDel?.forEach(k => want.delete(k));
    had.forEach((_, k) => want.has(k) || this.dom.style.setProperty(k, null));
    want.forEach((v, k) => had.get(k) === v || this.dom.style.setProperty(k, v));
    this.styleApplied = want;
  }

  /**
   * A `string[]`, or a reported mistake.
   *
   * The compiler names the two shapes someone reaches for by accident -- an
   * interpolation and a string expression -- and cannot see a string arrived
   * at any other way, so the last word is here. Silence would be the bad
   * answer: a string is iterable, and `[...'mb-0']` is five classes named `m`,
   * `b`, `-` and `0`.
   */
  private nameSet(value: CoreValue<any>, key: string, val: unknown): string[] {
    if (val == null) return [];
    if (Array.isArray(val) && val.every(v => typeof v === 'string')) return val;
    this.ctx.onError(
      'callback',
      new Error(
        `"${key}" takes a string[], and was given ${describe(val)}. ` +
          `A quoted value is read as a list of names; an expression carries the array itself`
      ),
      value
    );
    return [];
  }

  /** a `{ property: value }` map, or a reported mistake */
  private declarationMap(
    value: CoreValue<any>,
    key: string,
    val: unknown
  ): Map<string, string> {
    if (val == null) return new Map();
    if (typeof val === 'object' && !Array.isArray(val)) {
      return new Map(
        Object.entries(val as Record<string, unknown>)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, `${v}`])
      );
    }
    this.ctx.onError(
      'callback',
      new Error(
        `"${key}" takes a { property: value } map, and was given ${describe(val)}. ` +
          `A quoted value is read as declarations; an expression carries the map itself`
      ),
      value
    );
    return new Map();
  }

  /**
   * A binding whose DOM target isn't there.
   *
   * Every one of these used to be an early `return`, which is the quietest
   * possible failure: the page renders, nothing throws, and one binding is
   * simply dead forever. Reporting it costs nothing when everything is
   * wired correctly, and turns a whole class of silent breakage -- markup
   * relocated by a slot, replicated by `:for-each`, cloned from a stencil --
   * into a message naming the scope and key at fault.
   */
  private unbound(value: CoreValue<any>, why: string): void {
    this.ctx.onError('callback', new Error(`unbound binding: ${why}`), value);
  }

  /**
   * Puts this scope's element where its markup was written.
   *
   * Immediately after the marker, which is exactly where the element stood
   * before the stencil around it was moved out of the way -- so the
   * rendered position is the written position, and a page's structural CSS
   * counts what its author wrote and nothing else.
   */
  override showView(): void {
    if (this.props.group) {
      // insertBefore takes them one at a time, which is what keeps their
      // order: the holder is emptied from the front as they go
      const into = (this.endAnchor as unknown as { parentNode?: ContainerNode })
        ?.parentNode;
      if (!into || !this.holder) return;
      for (const node of [...this.holder.childNodes]) {
        into.insertBefore(node, this.endAnchor as unknown as Node);
      }
      return;
    }
    // Borrowed: the element is someone else's and was never taken out. Below
    // the group branch rather than above it, because a mode WITH children has
    // a range of its own to move even though its element is not its to touch
    if (this.props.mode) return;
    const container = this.anchorContainer();
    if (!this.dom || !container || !this.anchor) return;
    container.insertBefore(this.dom, this.anchor.nextSibling);
  }

  /**
   * Takes it out of the page, and keeps it.
   *
   * Detached rather than parked back in the stencil, which is what makes
   * the element stable across any number of hide/show cycles: one stencil
   * serves every replica of an enclosing `:for-each`, so a region writing
   * itself back into it would be writing into what its siblings stamp out.
   * The scope holds the node, which is all "not rebuilt when it comes back"
   * ever needed.
   */
  override hideView(): void {
    if (this.props.group) {
      // back into the holder rather than dropped, for the reason the
      // element form gives below: what comes back has to be what went away
      const holder = this.holder;
      if (!holder || !this.anchor || !this.endAnchor) return;
      for (const node of this.groupNodes()) {
        holder.appendChild(node);
      }
      return;
    }
    if (this.props.mode) return;
    const dom = this.dom as unknown as { parentNode?: { removeChild(n: unknown): void } };
    dom?.parentNode?.removeChild(this.dom);
  }

  /**
   * The nearest element above this scope: what a `<:mode>` acts on.
   *
   * Walked rather than taken from the immediate parent, because the scope
   * above may have no element of its own -- another mode, or a `<:logic>` --
   * and a modality is about the nearest real element either way.
   */
  /**
   * A mode's handlers go on with it and come off with it.
   *
   * The list is kept rather than emptied, because the values that built it
   * are not rebuilt when the mode returns -- they are re-evaluated, and the
   * branch that calls `addEventListener` runs once, when a value is first
   * constructed. So re-arming re-adds what is already known instead of
   * waiting for a construction that will not happen again.
   */
  /** what a mode painted on somebody else's element, taken back off it */
  private withdrawPaint(): void {
    if (!this.dom || !this.classApplied?.size) return;
    this.classApplied.forEach(n => this.dom.classList.remove(n));
    // not cleared: `applyClasses` diffs against it, and the modality coming
    // back wants the same difference it made last time
    this.classApplied = new Set();
  }

  protected override lifetimeBegun(): void {
    // Only what this actually took off. A mode with CHILDREN is a replica,
    // rebuilt from scratch each time its condition comes back, so its values
    // are constructed afresh and bind as they go -- re-adding here would bind
    // a second time and the page would see every event twice. A childless one
    // is the case this exists for: the same scope returns, its values are
    // re-evaluated rather than rebuilt, and the branch that binds runs only
    // at construction
    if (!this.disarmed) return;
    this.disarmed = false;
    this.domListeners?.forEach(({ name, listener }) =>
      this.dom?.addEventListener(name, listener)
    );
    this.classOn?.size && this.applyClassesFor(undefined);
  }

  protected override lifetimeEnded(): void {
    if (!this.props.mode || this.disarmed) return;
    this.disarmed = true;
    this.domListeners?.forEach(({ name, listener }) =>
      this.dom?.removeEventListener(name, listener)
    );
    this.withdrawPaint();
    this.releaseOwned();
  }

  /** whether `lifetimeEnded` took this mode's handlers off the element */
  private disarmed = false;

  private borrowedDom(): Element | undefined {
    for (let s = this.parent; s; s = s.parent) {
      const dom = (s as WebScope).dom;
      if (dom) {
        // kept, because handing an attribute back means asking whoever owns
        // the element to say again what it should be
        this.borrowedFrom = s as WebScope;
        return dom;
      }
    }
    return undefined;
  }

  /** the scope a mode borrowed its element from */
  declare private borrowedFrom?: WebScope;
  /** the value keys a mode has written on that element */
  declare private owned?: Set<string>;

  /**
   * Gives an attribute back to whoever owns the element.
   *
   * Nothing is remembered and nothing is restored from a snapshot: what an
   * element's `title` is, is whatever the innermost live declaration says, and
   * the one underneath has been live the whole time a mode was over it --
   * evaluating as its own dependencies changed, simply not the one writing. So
   * handing back is asking it to say again. Where there is nobody underneath,
   * the attribute existed only because the mode did, and goes.
   */
  private releaseOwned(): void {
    if (!this.owned?.size || !this.dom) return;
    const owner = this.borrowedFrom;
    const wake = new Set<WebScope>();
    for (const key of this.owned) {
      const list = owner?.claimants?.get(key);
      const i = list?.indexOf(this) ?? -1;
      i >= 0 && list!.splice(i, 1);
      // off first, in every case: what the mode wrote is the mode's, and if
      // nobody says otherwise it was there only because the mode was
      const name = key.slice(key.indexOf('$') + 1);
      if (key.startsWith(RT_STYLE_VALUE_PREFIX)) {
        this.styleOn?.delete(name);
        this.styleApplied?.delete(name);
        this.dom.style.setProperty(name, null);
        // and the owner's record of having written it, or its re-say lands on
        // a diff that says nothing changed -- true of what it last APPLIED,
        // and not of the element, which no longer has the property at all
        owner?.styleApplied?.delete(name);
      } else {
        this.dom.removeAttribute(name);
      }
      // the next claim down, if a lower-ranked mode was waiting under this
      // one, and the element's own declaration otherwise
      const next = list?.[0];
      if (next && WebScope.resay(next, key)) {
        wake.add(next);
        continue;
      }
      owner && WebScope.resay(owner, key) && wake.add(owner);
    }
    this.owned.clear();
    wake.forEach(scope => this.ctx.refresh(scope));
  }

  /**
   * Whether this scope may write `key`, and a note that it wants to.
   *
   * The claimants on one key live on the scope that OWNS the element, sorted
   * by rank, and only the first of them writes. Two at the same rank were
   * refused at compile time, so the order is total and nothing here has to
   * guess. A scope that is not a mode owns its own element and answers yes
   * without bookkeeping.
   */
  private claim(key: string): boolean {
    if (!this.props.mode) return true;
    const owner = this.borrowedFrom;
    if (!owner) return true;
    (this.owned ??= new Set()).add(key);
    const list: WebScope[] = (owner.claimants ??= new Map()).get(key) ?? [];
    if (!list.includes(this)) {
      list.push(this);
      list.sort((a, b) => (b.props.priority ?? 0) - (a.props.priority ?? 0));
      owner.claimants.set(key, list);
    }
    return list[0] === this;
  }

  /** modes currently claiming each key, highest rank first; on the owner */
  declare private claimants?: Map<string, WebScope[]>;

  /**
   * Makes a value say again what it already says.
   *
   * A value only announces itself when it CHANGES, so the one being handed an
   * attribute back would re-evaluate to what it already held and tell nobody.
   * Clearing what it holds is what makes saying it again a change.
   */
  private static resay(scope: WebScope, key: string): boolean {
    const value = scope.values[key];
    if (!value) return false;
    (value as unknown as { value?: unknown }).value = undefined;
    value.dirty = true;
    return true;
  }

  /**
   * Whatever holds this region's marker -- an element, or a stencil's
   * content fragment for a region nested inside another one's markup.
   *
   * `parentNode` rather than `parentElement` for exactly that second case:
   * a fragment is not an element, so the element answer is null there, in
   * this DOM as much as in a browser.
   */
  private anchorContainer(): ContainerNode | undefined {
    return (this.anchor as unknown as { parentNode?: ContainerNode } | undefined)?.parentNode;
  }

  /**
   * Whether this scope's element is in the document.
   *
   * Asked of the DOM rather than tracked, because everything that can move
   * an element -- a `:for-data` showing, a replica being stamped out, a
   * usage materialising from its stencil -- already leaves the answer right
   * there, and a bookkeeping copy could only ever disagree with it.
   */
  protected override domAttached(): boolean {
    return !!this.dom?.isConnected;
  }


  override clone(index: number): WebScope {
    if (this.props.group) {
      // in the page before construction, for the reason pendingCloneDom is
      // resolved first: the replica's init() runs during super(), and the
      // markers it looks for have to be there by then
      this.prepareCloneRange(cloneId(this.props.id, index));
      return super.clone(index) as WebScope;
    }
    // resolved before construction, so the clone's own init() (running
    // during super()) can pick it up via pendingCloneDom
    this.pendingCloneDom = this.acquireCloneDom(cloneId(this.props.id, index));
    const clone = super.clone(index) as WebScope;
    this.pendingCloneDom = undefined;
    return clone;
  }

  /**
   * Puts the replicas' elements back in array order after a keyed pass.
   *
   * Only what is actually out of place moves. `insertBefore` on a node that
   * already sits where it belongs is still a remove-and-reinsert, and the
   * DOM state keyed replication exists to protect -- focus, a running
   * transition, an <iframe>'s document, a playing video -- is exactly what
   * that destroys, so reordering everything unconditionally would defeat
   * the feature while appearing to work.
   */
  override reorderClones(): void {
    const anchor = this.anchor;
    const container = this.anchorContainer();
    if (!anchor || !container || !this.clones?.length) return;
    if (this.props.group) {
      // a run at a time, markers included, under the same rule: only what
      // is out of place moves, asked of the replica's first marker
      let at: Node = anchor;
      for (const clone of this.clones as WebScope[]) {
        const start = clone.anchor as unknown as Node | undefined;
        if (!start || !clone.endAnchor) continue;
        if (at.nextSibling !== start) {
          for (const node of clone.rangeWithMarkers()) {
            container.insertBefore(node, at.nextSibling);
            at = node;
          }
        } else {
          at = clone.endAnchor as unknown as Node;
        }
      }
      return;
    }
    // walks forward from the anchor comparing `nextSibling` directly, rather
    // than mirroring childNodes into an array and doing indexOf()/splice()
    // per replica -- those are O(n) each, which made a full reorder O(n^2)
    // and measurably fell over past ~1k replicas
    let ref: Node = anchor;
    for (const clone of this.clones as WebScope[]) {
      const node = clone.dom;
      if (!node) continue;
      if (ref.nextSibling !== node) {
        container.insertBefore(node, ref.nextSibling);
      }
      ref = node;
    }
  }

  /**
   * Finds an already-existing element for a clone id (e.g. one SSR already
   * rendered) among the marker's siblings, reusing it if present; failing
   * that, stamps out a new one from the host's own element -- which is the
   * one the stencil holds, never a rendering -- and inserts it right after
   * the last existing clone (or the marker itself, if this is the first).
   * Returns undefined if this scope has nothing to clone from at all (e.g.
   * a scope with no matching DOM element in the first place, or one whose
   * :for-each host never resolved one).
   */
  private acquireCloneDom(id: string): Element | undefined {
    const anchor = this.anchor;
    const container = this.anchorContainer();
    if (!anchor || !container) return undefined;

    // re-snapshotting and scanning all of container's children here, once
    // per NEW clone, made mounting n replicas O(n^2) (each scan costs O(n)
    // of its own, since the container keeps growing). Skipping the scan
    // once it has ever missed removes it from the hot path entirely for a
    // pure client-side mount, leaving only the (small, fixed) hydration
    // prefix actually scanned
    if (!this.noMoreHydratedClones) {
      const existing = [...container.childNodes].find(
        n => n.nodeType === NodeType.ELEMENT && (n as Element).getAttribute(DOM_ID_ATTR) === id
      ) as Element | undefined;
      if (existing) return existing;
      this.noMoreHydratedClones = true;
    }

    const stencil = this.dom;
    if (!stencil) return undefined;

    const node = stencil.cloneNode(true) as unknown as Element;
    node.setAttribute(DOM_ID_ATTR, id);
    // the previous clone's own element is the insertion point directly --
    // no need to find its index in a snapshot of the container's children
    const prevClone = this.clones?.at(-1) as WebScope | undefined;
    const ref = prevClone?.dom ?? anchor;
    container.insertBefore(node, ref.nextSibling);
    return node;
  }
}

/** what a value IS, for a message about what it should have been */
function describe(val: unknown): string {
  if (Array.isArray(val)) return 'an array holding something other than strings';
  return typeof val === 'string' ? `the string "${val}"` : `a ${typeof val}`;
}

/** a space-separated attribute value, as the names it holds */
function tokens(s: string): string[] {
  return s.split(/\s+/).filter(t => t.length > 0);
}
