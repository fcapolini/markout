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

export interface Node {
  ownerDocument: Document | null;
  parentElement: Element | null;
  nodeType: unknown;
  loc: unknown;

  unlink(): void;
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
  childNodes: Node[];
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

export interface Document {
  childNodes: Node[];
  documentElement: Element | null;
  createTextNode(text: string): Text;
  createElement(tagName: string): Element;
}

export interface DocumentFragment extends Document {
  // cloneNode(deep: true): Node;
  firstElementChild: Element | null;
}
