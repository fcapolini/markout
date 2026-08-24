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

export const RT_ATTR_VALUE_PREFIX = 'attr$';
/** `:prop-x`: the element's JS property, for what an attribute can't carry */
export const RT_PROP_VALUE_PREFIX = 'prop$';
/** `:attr-x`: presence of the attribute, not its value */
export const RT_PRESENCE_VALUE_PREFIX = 'flag$';
export const RT_CLASS_VALUE_PREFIX = 'class$';
export const RT_STYLE_VALUE_PREFIX = 'style$';
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
    super.init();
    this.texts = new Map();
    const templateId = this.props.template;
    const parentDom = this.parent instanceof WebScope ? this.parent.dom : undefined;
    const view = this.cloned
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
    if (!view) {
      // Root scope or other scopes without corresponding DOM elements
      // should not try to perform DOM operations
      return;
    }
    this.dom = view;
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
    const f = (e: Element) => {
      const childNodes = e.childNodes;
      for (let i = 0; i < childNodes.length; i++) {
        const n = childNodes[i];
        if (n.nodeType === NodeType.ELEMENT && (n as Element).getAttribute(DOM_ID_ATTR) === null) {
          if (!DOM_ATOMIC_TEXT_TAGS.has((n as Element).tagName)) {
            f(n as Element);
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
            : (e.insertBefore(
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
    if (DOM_ATOMIC_TEXT_TAGS.has(this.dom.tagName)) {
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
    f(this.dom);
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
  private acquireRegionDom(parentDom?: Element): Element | undefined {
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
  private acquireUsageDom(templateId: string, within?: Element): Element | undefined {
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
  private lookupView(parentView?: Element): Element | undefined {
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
  private lookupMarker(id: string, parentView?: Element): Comment | undefined {
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
    parentView: Element | undefined,
    match: (n: Node) => T | undefined
  ): T | undefined {
    const container: Element | Document | undefined =
      parentView ?? (this.ctx.props as WebContextProps).doc;
    if (!container) return undefined;
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
    return lookup(childNodesOf(container));
  }

  override dispose(): void {
    this.domListeners?.forEach(({ name, listener }) => {
      this.dom?.removeEventListener(name, listener);
    });
    this.domListeners = [];
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
    if (key.startsWith(RT_ATTR_VALUE_PREFIX)) {
      // verbatim, like class$/style$/on$: the key already holds the name the
      // author wrote, and an attribute name is element-facing rather than
      // JS-facing. Dash-casing it turned `viewBox` into `view-box` -- and an
      // SVG whose viewBox is spelled that way silently stops scaling, since
      // the DOM only honours the exact name. Nothing in HTML needs the
      // conversion: a dashed attribute is written dashed.
      const name = key.slice(RT_ATTR_VALUE_PREFIX.length);
      ret.setCB((_, val) => {
        if (!this.dom) return this.unbound(ret, `no element to set "${name}" on`);
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
        // empty string, not "true": an HTML boolean attribute means true by
        // being present at all, and that is the form every browser writes
        val ? this.dom.setAttribute(name, '') : this.dom.removeAttribute(name);
      });
      return ret;
    }
    if (key.startsWith(RT_CLASS_VALUE_PREFIX)) {
      const name = key.slice(RT_CLASS_VALUE_PREFIX.length);
      ret.setCB((_, val) => {
        if (!this.dom) return this.unbound(ret, `no element to toggle class "${name}" on`);
        if (val) {
          this.dom.classList.add(name);
        } else {
          this.dom.classList.remove(name);
        }
      });
      return ret;
    }
    if (key.startsWith(RT_STYLE_VALUE_PREFIX)) {
      const name = key.slice(RT_STYLE_VALUE_PREFIX.length);
      ret.setCB((_, val) => {
        if (!this.dom) return this.unbound(ret, `no element to set style "${name}" on`);
        this.dom.style.setProperty(name, val);
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
    const dom = this.dom as unknown as { parentNode?: { removeChild(n: unknown): void } };
    dom?.parentNode?.removeChild(this.dom);
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
