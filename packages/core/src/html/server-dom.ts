import * as acorn from 'acorn';
import { parseDeclarations } from './css';
// the HTML5 character-reference table, for the same reason acorn parses the
// JS: it is spec data, and a hand-kept subset of it is a standing bug
import { decodeHTML, decodeHTMLAttribute } from 'entities';
import {
  Attribute,
  ClassProp,
  Comment,
  DIRECTIVE_TAG_PREFIX,
  Document,
  Element,
  Node,
  NodeType,
  StyleProp,
  TemplateElement,
  Text,
  DocumentFragment,
} from './dom';

export const VOID_ELEMENTS = new Set([
  'AREA',
  'BASE',
  'BR',
  'COL',
  'EMBED',
  'HR',
  'IMG',
  'INPUT',
  'LINK',
  'META',
  'PARAM',
  'SOURCE',
  'TRACK',
  'WBR',
  'COMMAND',
  'KEYGEN',
  'MENUITEM',
]);

export interface SourceLocation extends acorn.SourceLocation {
  i1: number;
  i2: number;
}

export abstract class ServerNode implements Node {
  ownerDocument: ServerDocument | null;
  parentElement: ServerElement | null;
  /**
   * Whatever currently holds this node, element or DocumentFragment.
   *
   * `parentElement` cannot answer that: a `<template>`'s children live in a
   * fragment, and a fragment is not an element, so theirs is null -- in the
   * browser as much as here, which is why ServerTemplateElement goes out of
   * its way to match. Compiler code that has to move a node still needs the
   * container it is actually in, and this is it. Kept server-side rather
   * than added to the shared DOM interface: only the compiler relocates
   * nodes. Named as the browser names it, so runtime code that has to reach
   * a node's container reads the same way against either DOM.
   */
  parentNode: ServerContainerNode | null;
  nodeType: number;
  loc: SourceLocation;

  constructor(doc: ServerDocument | null, type: number, loc: SourceLocation) {
    this.ownerDocument = doc;
    this.parentElement = null;
    this.parentNode = null;
    this.nodeType = type;
    this.loc = loc;
  }

  unlink(): this {
    this.parentNode?.removeChild(this);
    return this;
  }

  // no sibling pointers of our own -- derived from the parent's childNodes,
  // the same source of truth insertBefore()/removeChild() already maintain
  get nextSibling(): Node | null {
    const siblings = this.parentNode?.childNodes;
    if (!siblings) return null;
    const i = siblings.indexOf(this);
    return i < 0 ? null : siblings[i + 1] ?? null;
  }

  get previousSibling(): Node | null {
    const siblings = this.parentNode?.childNodes;
    if (!siblings) return null;
    const i = siblings.indexOf(this);
    return i <= 0 ? null : siblings[i - 1];
  }

  /**
   * Whether this node is in the document, as the browser means it.
   *
   * The parent chain ends at the document for anything rendered, and at a
   * `<template>`'s content fragment for anything held in a stencil -- which
   * is not connected, exactly as it is not in a browser. The lifecycle
   * callbacks that ask this are browser-only, but the runtime that drives
   * them is the same code either way, so it has to be able to ask here too.
   */
  get isConnected(): boolean {
    let n: ServerNode = this;
    while (n.parentNode) {
      n = n.parentNode as unknown as ServerNode;
    }
    return n.nodeType === NodeType.DOCUMENT;
  }

  toString(): string {
    const sb = new Array<string>();
    this.toMarkup(sb);
    return sb.join('');
  }

  addEventListener(_: string, __: unknown): void {}
  removeEventListener(_: string, __: unknown): void {}

  abstract toMarkup(ret: string[]): void;
  abstract clone(
    doc: ServerDocument | null,
    parent: ServerContainerNode | null
  ): ServerNode;

  cloneNode() {
    return this.clone(null, null);
  }
}

export class ServerText extends ServerNode implements Text {
  textContent: string | acorn.Expression;
  escaping: boolean;

  constructor(
    doc: ServerDocument | null,
    value: string | acorn.Expression,
    loc: SourceLocation,
    escaping = true
  ) {
    super(doc, NodeType.TEXT, loc);
    this.textContent =
      typeof value === 'string' && escaping ? unescapeText(value) : value;
    this.escaping = escaping;
  }

  toMarkup(ret: string[]): void {
    if (typeof this.textContent === 'string') {
      ret.push(
        this.escaping ? escape(this.textContent, '&<>') : this.textContent
      );
    }
  }

  override clone(
    doc: ServerDocument | null,
    parent: ServerContainerNode | null
  ): ServerText {
    const ret = new ServerText(doc, this.textContent, this.loc, this.escaping);
    parent?.appendChild(ret);
    return ret;
  }
}

export class ServerComment extends ServerNode implements Comment {
  textContent: string;

  constructor(doc: ServerDocument | null, value: string, loc: SourceLocation) {
    super(doc, NodeType.COMMENT, loc);
    this.textContent = value;
  }

  toMarkup(ret: string[]): void {
    ret.push('<!--');
    ret.push(this.textContent);
    ret.push('-->');
  }

  override clone(
    doc: ServerDocument | null,
    parent: ServerContainerNode | null
  ): ServerComment {
    const ret = new ServerComment(doc, this.textContent, this.loc);
    parent?.appendChild(ret);
    return ret;
  }
}

export class ServerAttribute extends ServerNode implements Attribute {
  name: string;
  value: string | acorn.Expression | null;
  valueLoc?: SourceLocation;
  quote?: string;

  constructor(
    doc: ServerDocument | null,
    parent: ServerElement | null,
    name: string,
    value: string | acorn.Expression | null,
    loc: SourceLocation
  ) {
    super(doc, NodeType.ATTRIBUTE, loc);
    this.name = name;
    this.value = value;
    parent && parent.attributes.push(this);
  }

  toMarkup(_ret: string[]): void {
    // attributes are serialized by ServerElement.toMarkup2(), which also has
    // to emit `class` and `style` — those are kept as element properties
    // rather than attribute nodes, so they'd be missed by iterating attributes
  }

  override clone(
    doc: ServerDocument | null,
    parent: ServerContainerNode | null
  ): ServerAttribute {
    const ret = new ServerAttribute(
      doc,
      parent as ServerElement,
      this.name,
      this.value,
      this.loc
    );
    ret.valueLoc = this.valueLoc;
    ret.quote = this.quote;
    return ret;
  }
}

class ServerClassProp implements ClassProp {
  list = new Set<string>();

  get length(): number {
    return this.list.size;
  }

  add(key: string): void {
    this.list.add(key);
  }

  remove(key: string): void {
    this.list.delete(key);
  }

  toString(): string {
    return [...this.list].join(' ');
  }

  fromString(s: string): this {
    // filtered: an empty or blank value used to leave an empty-string member
    // behind, which serializes as a leading space and, now that classes are
    // composed rather than assigned, survives every later add
    this.list = new Set(s.split(/\s+/).filter(t => t.length > 0));
    return this;
  }
}

class ServerStyleProp implements StyleProp {
  list = new Map<string, string>();

  setProperty(key: string, val: string | null | undefined): void {
    val ? this.list.set(key, val) : this.list.delete(key);
  }

  getPropertyValue(key: string): string {
    return this.list.get(key) ?? '';
  }

  get cssText(): string {
    const ret: string[] = [];
    this.list.forEach((val, key) => ret.push(`${key}: ${val};`));
    return ret.join(' ');
  }

  set cssText(s: string) {
    this.list.clear();
    parseDeclarations(s).forEach(([k, v]) => this.list.set(k, v));
  }
}


// Base class for nodes that can contain children
export abstract class ServerContainerNode extends ServerNode {
  childNodes: Node[];

  constructor(doc: ServerDocument | null, type: number, loc: SourceLocation) {
    super(doc, type, loc);
    this.childNodes = [];
  }

  appendChild(n: Node): Node {
    return this.insertBefore(n, null);
  }

  insertBefore(n: Node, ref: Node | null): Node {
    if (n.nodeType === NodeType.DOCUMENT_FRAGMENT) {
      // snapshot: inserting a fragment moves its children out of it, as in
      // the browser, so iterating the live array would skip every other one
      [...(n as ServerContainerNode).childNodes].forEach(n =>
        this.insertBefore(n, ref)
      );
      return n;
    }
    // a move, as in the browser: a node has one parent, so putting it here
    // takes it out of wherever it was. Without this, relocating a node
    // between containers left it in both -- the same element, with the same
    // id, in two places at once
    const previous = (n as ServerNode).parentNode as ServerContainerNode | null;
    previous && previous !== (this as unknown as ServerContainerNode) && previous.removeChild(n);
    this.removeChild(n);
    let i = ref ? this.childNodes.indexOf(ref) : -1;
    i = i < 0 ? this.childNodes.length : i;
    this.childNodes.splice(i, 0, n);
    n.parentElement = this as any;
    (n as ServerNode).parentNode = this;
    return n;
  }

  removeChild(n: Node): Node {
    const i = this.childNodes.indexOf(n);
    i >= 0 && this.childNodes.splice(i, 1);
    n.parentElement = null;
    (n as ServerNode).parentNode = null;
    return n;
  }

  protected cloneChildNodes(
    doc: ServerDocument | null,
    target: ServerContainerNode
  ): void {
    this.childNodes.forEach(n => {
      (n as ServerNode).clone(doc, target);
    });
  }
}

export class ServerElement extends ServerContainerNode implements Element {
  tagName: string;
  attributes: Attribute[];
  protected _classList?: ClassProp;
  protected _style?: StyleProp;

  constructor(doc: ServerDocument | null, name: string, loc: SourceLocation) {
    super(doc, NodeType.ELEMENT, loc);
    this.tagName = name.toUpperCase();
    this.attributes = [];
  }

  get classList(): ClassProp {
    return this._classList ?? (this._classList = new ServerClassProp());
  }

  get className(): string {
    return (this.classList as ServerClassProp).toString();
  }

  set className(name: string) {
    (this.classList as ServerClassProp).fromString(name);
  }

  get style(): StyleProp {
    return this._style ?? (this._style = new ServerStyleProp());
  }

  set style(s: any) {
    (this.style as ServerStyleProp).cssText = `${s}`;
  }

  getAttributeNames(): string[] {
    const ret: string[] = [];
    this.attributes.forEach(a => ret.includes(a.name) || ret.push(a.name));
    if (this._style && !ret.includes('style')) {
      ret.unshift('style');
    }
    if (this._classList && !ret.includes('class')) {
      ret.unshift('class');
    }
    return ret;
  }

  getAttribute(name: string): string | null {
    if (name === 'class') {
      const attr = this.attributes.find(a => (a.name === name ? a : null));
      const attrVal = typeof attr?.value === 'string' ? attr.value : null;
      const classes = new Set([...(attrVal?.split(/\s+/) ?? [])]);
      if (this._classList?.length) {
        (this._classList as ServerClassProp).list.forEach(v => classes.add(v));
      }
      return attr || this._classList ? [...classes].join(' ') : null;
    }

    if (name === 'style') {
      const attr = this.attributes.find(a => (a.name === name ? a : null));
      const attrVal = typeof attr?.value === 'string' ? attr.value : null;
      const styles = new ServerStyleProp();
      attrVal && (styles.cssText = attrVal);
      if (this._style) {
        (this._style as ServerStyleProp).list.forEach((v, k) =>
          styles.list.set(k, v)
        );
      }
      return attr || this._style ? styles.cssText : null;
    }

    let ret: string | null = null;
    for (const a of this.attributes) {
      if (a.name === name) {
        if (typeof a.value === 'string') {
          ret = a.value;
        }
        break;
      }
    }
    return ret;
  }

  getAttributeNode(name: string): Attribute | null {
    for (const a of this.attributes) {
      if (a.name === name) {
        return a;
      }
    }
    return null;
  }

  delAttributeNode(attr: Attribute) {
    const i = this.attributes.indexOf(attr);
    i >= 0 && this.attributes.splice(i, 1);
  }

  setAttribute(name: string, value: string | null, loc?: SourceLocation) {
    if (name === 'class') {
      this.className = value ?? '';
      return;
    }

    let a = this.getAttributeNode(name);
    if (a) {
      a.value = value;
      return;
    }
    new ServerAttribute(this.ownerDocument, this, name, value, loc ?? this.loc);
  }

  removeAttribute(name: string) {
    const attr = this.getAttributeNode(name);
    attr && this.delAttributeNode(attr);
  }

  toMarkup(ret: string[]): void {
    this.toMarkup2(ret);
  }

  toMarkup2(ret: string[], cb?: (ret: string[]) => void): void {
    if (this.tagName.startsWith(DIRECTIVE_TAG_PREFIX)) {
      return;
    }
    ret.push('<');
    ret.push(this.tagName.toLowerCase());
    // getAttributeNames() is used rather than the attributes array because
    // `class` and `style` are kept as element properties, not attribute nodes
    this.getAttributeNames().forEach(key => {
      const val = this.getAttribute(key);
      const q = '"';
      ret.push(' ');
      ret.push(key);
      if (val !== null) {
        ret.push('=');
        ret.push(q);
        ret.push(escape(val as string, '&<' + q));
        ret.push(q);
      }
    });
    ret.push('>');
    if (VOID_ELEMENTS.has(this.tagName)) {
      return;
    }
    cb
      ? cb(ret)
      : this.childNodes.forEach(n => (n as ServerNode).toMarkup(ret));
    ret.push('</');
    ret.push(this.tagName.toLowerCase());
    ret.push('>');
  }

  override clone(
    doc: ServerDocument | null,
    parent: ServerContainerNode | null
  ): ServerElement {
    const ret = new ServerElement(doc, this.tagName, this.loc);
    parent?.appendChild(ret);
    if (this._classList) {
      ret._classList = new ServerClassProp().fromString(
        (this._classList as ServerClassProp).toString()
      );
    }
    if (this._style) {
      ret._style = new ServerStyleProp();
      ret._style.cssText = this._style.cssText;
    }
    this.attributes.forEach(a => {
      (a as ServerAttribute).clone(doc, ret);
    });
    this.childNodes.forEach(n => {
      (n as ServerNode).clone(doc, ret);
    });
    return ret;
  }
}

export class ServerTemplateElement
  extends ServerElement
  implements TemplateElement
{
  content: ServerDocumentFragment;

  constructor(doc: ServerDocument | null, loc: SourceLocation) {
    super(doc, 'template', loc);
    this.content = new ServerDocumentFragment(loc);
  }

  override appendChild(n: Node): Node {
    const ret = this.content.insertBefore(n, null);
    // as in the browser: a template's children hang off its content
    // fragment, and a fragment is not an element. `parentNode` keeps pointing at
    // that fragment, so a node in here can still be found and relocated
    ret.parentElement = null;
    return ret;
  }

  override toMarkup(ret: string[]): void {
    super.toMarkup2(ret, () => {
      // Render template content children directly without DocumentFragment wrapper
      for (const n of this.content.childNodes) {
        (n as ServerNode).toMarkup(ret);
      }
    });
  }

  override clone(
    doc: ServerDocument | null,
    parent: ServerContainerNode | null
  ): ServerElement {
    const ret = new ServerTemplateElement(doc, this.loc);
    parent?.appendChild(ret);
    this.attributes.forEach(a => {
      (a as ServerAttribute).clone(doc, ret);
    });
    this.content.childNodes.forEach(n => {
      (n as ServerNode).clone(doc, ret.content);
    });
    return ret;
  }
}

export class ServerDocument extends ServerElement implements Document {
  jsonLoc = true;

  constructor(loc: string | SourceLocation) {
    super(
      null,
      '#document',
      typeof loc === 'string'
        ? {
            source: loc,
            start: { line: 1, column: 0 },
            end: { line: 1, column: 0 },
            i1: 0,
            i2: 0,
          }
        : loc
    );
    this.ownerDocument = this;
    this.nodeType = NodeType.DOCUMENT; // Override the nodeType after construction
  }

  createTextNode(text: string): ServerText {
    return new ServerText(this, text, this.loc, false);
  }

  /**
   * `<template>` gets the class that has a content fragment, as in a
   * browser: one created here is otherwise an ordinary element whose
   * `content` is undefined, and anything walking the document by the rules
   * a template asks for -- the runtime's own lookups, most of all -- reads
   * that as a crash rather than as an empty stencil.
   */
  createElement(tagName: string): ServerElement {
    return tagName.toLowerCase() === 'template'
      ? new ServerTemplateElement(this, this.loc)
      : new ServerElement(this, tagName, this.loc);
  }

  get documentElement(): ServerElement | null {
    for (const e of this.childNodes) {
      if (e.nodeType === NodeType.ELEMENT) {
        return e as ServerElement;
      }
    }
    return null;
  }

  get head(): ServerElement | null {
    const root = this.documentElement;
    if (root) {
      for (const e of root.childNodes ?? []) {
        if (
          e.nodeType === NodeType.ELEMENT &&
          (e as ServerElement).tagName === 'HEAD'
        ) {
          return e as ServerElement;
        }
      }
    }
    return null;
  }

  get body(): ServerElement | null {
    const root = this.documentElement;
    if (root) {
      for (const e of root.childNodes ?? []) {
        if (
          e.nodeType === NodeType.ELEMENT &&
          (e as ServerElement).tagName === 'BODY'
        ) {
          return e as ServerElement;
        }
      }
    }
    return null;
  }

  override toMarkup(ret: string[]): void {
    for (const n of this.childNodes) {
      if (n.nodeType === NodeType.ELEMENT) {
        (n as ServerNode).toMarkup(ret);
        break;
      }
    }
  }

  override clone(
    doc: ServerDocument | null,
    parent: ServerContainerNode | null
  ): ServerDocument {
    const ret = new ServerDocument(this.loc);
    parent?.appendChild(ret);
    this.cloneChildNodes(doc, ret);
    return ret;
  }
}

export class ServerDocumentFragment
  extends ServerContainerNode
  implements DocumentFragment
{
  constructor(loc: string | SourceLocation) {
    super(
      null,
      NodeType.DOCUMENT_FRAGMENT,
      typeof loc === 'string'
        ? {
            source: loc,
            start: { line: 1, column: 0 },
            end: { line: 1, column: 0 },
            i1: 0,
            i2: 0,
          }
        : loc
    );
  }

  get firstElementChild(): ServerElement | null {
    for (const e of this.childNodes) {
      if (e.nodeType === NodeType.ELEMENT) {
        return e as ServerElement;
      }
    }
    return null;
  }

  toMarkup(ret: string[]): void {
    // DocumentFragment renders its children directly without wrapper tags
    // as per DOM specification - it's a lightweight container
    for (const n of this.childNodes) {
      (n as ServerNode).toMarkup(ret);
    }
  }

  override clone(
    doc: ServerDocument | null,
    parent: ServerContainerNode | null
  ): ServerDocumentFragment {
    const ret = new ServerDocumentFragment(this.loc);
    parent?.appendChild(ret);
    this.cloneChildNodes(doc, ret);
    return ret;
  }
}

/**
 * Escapes `chars` in `text`. Only the characters actually needed by the
 * serializer are supported: `&<>` for text nodes and `&<"` for attribute
 * values (see unescapeText() for the reverse, which accepts more entities).
 */
function escape(text: string, chars = ''): string {
  let r = text;
  if (chars.indexOf('&') >= 0) r = r.split('&').join('&amp;');
  if (chars.indexOf('<') >= 0) r = r.split('<').join('&lt;');
  if (chars.indexOf('>') >= 0) r = r.split('>').join('&gt;');
  if (chars.indexOf('"') >= 0) r = r.split('"').join('&quot;');
  return r;
}

/**
 * Decodes character references in text content, the whole HTML5 set of them.
 *
 * A parsed text node holds CHARACTERS, never references: interpolation
 * splices computed strings into these same nodes, and the runtime writes
 * `textContent` directly, so anything left encoded here would be a stray
 * `&amp;nbsp;` on the page rather than the character it names.
 *
 * Escaped literals survive as themselves -- `&amp;#8203;` decodes to the
 * text `&#8203;`, not to a zero-width space -- because decoding is a single
 * left-to-right pass rather than a sequence of replacements that could
 * re-read their own output.
 */
export function unescapeText(str: string): string {
  return decodeHTML(str);
}

/**
 * The same, for an attribute value, where HTML5 deliberately decodes LESS.
 *
 * A reference missing its semicolon is left alone here, which is what keeps
 * query strings working: `href="?a=1&copy=2"` has to stay `&copy=2` rather
 * than becoming `©=2`. In text the very same characters do decode, because
 * there is no URL to protect there -- so the two contexts genuinely need
 * different functions, not one with a flag defaulted the convenient way.
 */
export function unescapeAttribute(str: string): string {
  return decodeHTMLAttribute(str);
}
