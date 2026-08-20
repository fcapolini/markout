/**
 * The DOM surface shared by every Markout runtime.
 *
 * `Node`, `Text`, `Element`, `Document` etc. deliberately reuse the names of
 * their `lib.dom` counterparts: server-side rendering swaps this DOM in for
 * the browser's, so isomorphic code (compiler output, runtime scopes) is
 * written once against these interfaces and runs against a `ServerDocument`
 * on the server and real DOM nodes in the browser.
 *
 * The collision with `lib.dom` globals is therefore intended. Consumers that
 * also include the DOM lib should import this module as a namespace
 * (`import * as dom from '@markout-lang/html/dom'`) to keep the two apart.
 *
 * Members here are the intersection of what both implementations provide;
 * anything server-only (`loc`, `unlink()`) is optional, so real DOM nodes
 * satisfy these structurally and need no cast. `test/dom-conformance.ts`
 * asserts exactly that and is compiled by `pnpm typecheck:dom`, so widening
 * the contract past what browsers offer fails the build.
 *
 * `Element` here corresponds to the browser's `HTMLElement`: the runtime
 * styles the elements it touches, and `style` lives on `HTMLElement`.
 */

export const DIRECTIVE_TAG_PREFIX = ':';

export const NodeType = {
  ELEMENT: 1,
  ATTRIBUTE: 2,
  TEXT: 3,
  COMMENT: 8,
  DOCUMENT: 9,
  DOCUMENT_TYPE: 10,
  DOCUMENT_FRAGMENT: 11,
};

/**
 * A list of child nodes: an array on the server, a `NodeList` in the browser.
 * `forEach` is included because both sides have it — indexing, iteration and
 * that one method are the whole shared surface. Anything else (`indexOf`,
 * `splice`, …) is array-only, so reach for the implementation type instead.
 * Implementations are free to narrow this (`ServerNode[]`).
 */
export type NodeList = ArrayLike<Node> &
  Iterable<Node> & {
    forEach(cb: (n: Node, i: number) => void): void;
  };

export interface Node {
  /** whether this node is in the document; false server-side, where the
   * lifecycle callbacks that ask do not run at all */
  isConnected?: boolean;
  ownerDocument: Document | null;
  parentElement: Element | null;
  nodeType: unknown;
  /** source location; server-side only, absent on real DOM nodes */
  loc?: unknown;
  nextSibling: Node | null;
  previousSibling: Node | null;

  /** server-side only: real DOM nodes are detached via their parent */
  unlink?(): void;
  cloneNode(deep?: boolean): Node;
}

export interface Text extends Node {
  textContent: unknown;
}

export interface Comment extends Node {
  textContent: string;
}

export interface Element extends Node {
  tagName: string;
  childNodes: NodeList;
  classList: ClassProp;
  className: string;

  get style(): StyleProp;
  set style(s: any);

  appendChild(n: Node): Node;
  insertBefore(n: Node, ref: Node | null): Node;
  removeChild(n: Node): Node;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  getAttributeNames(): string[];
  removeAttribute(name: string): void;
  addEventListener(evname: string, listener: unknown): void;
  removeEventListener(evname: string, listener: unknown): void;
}

export interface TemplateElement extends Element {
  content: DocumentFragment;
}

export interface ClassProp {
  length: number;
  add(key: string): void;
  remove(key: string): void;
}

export interface StyleProp {
  setProperty(key: string, val: string | null | undefined): void;
  getPropertyValue(key: string): string;
  cssText: string;
}

export interface Attribute extends Node {
  name: string;
  value: unknown;
  valueLoc?: unknown;
}

/**
 * Deliberately extends `Node` rather than `Element`: in the browser a
 * `Document` isn't an element either — `documentElement` is.
 */
export interface Document extends Node {
  childNodes: NodeList;
  documentElement: Element | null;

  createTextNode(text: string): Text;
  createElement(tagName: string): Element;
  appendChild(n: Node): Node;
  insertBefore(n: Node, ref: Node | null): Node;
  removeChild(n: Node): Node;
}

export interface DocumentFragment extends Node {
  childNodes: NodeList;
  appendChild(n: Node): Node;
  insertBefore(n: Node, ref: Node | null): Node;
  removeChild(n: Node): Node;
}
