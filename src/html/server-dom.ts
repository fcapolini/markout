import * as acorn from 'acorn';
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
  nodeType: number;
  loc: SourceLocation;

  constructor(doc: ServerDocument | null, type: number, loc: SourceLocation) {
    this.ownerDocument = doc;
    this.parentElement = null;
    this.nodeType = type;
    this.loc = loc;
  }

  unlink(): this {
    this.parentElement?.removeChild(this);
    return this;
  }

  // get nextSibling(): Node | null {
  //   const nn = this.parentElement?.childNodes;
  //   const i = nn ? nn.indexOf(this) : -1;
  //   if (i >= 0 && (i + 1) < (nn ? nn.length : 0)) {
  //     return nn![i + 1];
  //   }
  //   return null;
  // }

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
        this.escaping ? escape(this.textContent, '<>') : this.textContent
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

  toMarkup(ret: string[]): void {
    if (this.value !== null && typeof this.value !== 'string') {
      return;
    }
    const q = this.quote ?? '"';
    ret.push(' ');
    ret.push(this.name);
    if (this.value === null) {
      return;
    }
    ret.push('=');
    ret.push(q);
    ret.push(escape(this.value as string, '&<' + q));
    ret.push(q);
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
    this.list = new Set(s.split(/\s+/));
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
    // const parts = s.split(/\s*;\s*/);
    this.list.clear();
    s.split(/\s*;\s*/).forEach(s => {
      const parts = s.split(/\s*:\s*/);
      parts.length === 2 && this.list.set(parts[0], parts[1]);
    });
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
      (n as ServerContainerNode).childNodes.forEach(n => this.insertBefore(n, ref));
      return n;
    }
    this.removeChild(n);
    let i = ref ? this.childNodes.indexOf(ref) : -1;
    i = i < 0 ? this.childNodes.length : i;
    this.childNodes.splice(i, 0, n);
    n.parentElement = this as any;
    return n;
  }

  removeChild(n: Node): Node {
    const i = this.childNodes.indexOf(n);
    i >= 0 && this.childNodes.splice(i, 1);
    n.parentElement = null;
    return n;
  }

  protected cloneChildNodes(doc: ServerDocument | null, target: ServerContainerNode): void {
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
      // const classes = new Set([...attrVal?.split(/\s+/) ?? []]);
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

  setAttribute(name: string, value: string | null) {
    if (name === 'class') {
      this.className = value ?? '';
      return;
    }

    let a = this.getAttributeNode(name);
    if (a) {
      a.value = value;
      return;
    }
    a = new ServerAttribute(this.ownerDocument, this, name, value, this.loc);
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
    // if (this._classList) {
    //   // either className/classList or setAttribute('class') should be used,
    //   // not both
    //   ret.push(` class="${this.className}"`);
    // }
    // if (this._style) {
    //   // either the style property or setAttribute('style') should be used,
    //   // not both
    //   ret.push(` style="${this.style.cssText}"`);
    // }
    // this.attributes.forEach(a => {
    //   (a as ServerAttribute).toMarkup(ret);
    // });
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
    ret.parentElement = null;
    return ret;
  }

  toMarkup(ret: string[]): void {
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
    this.nodeType = NodeType.DOCUMENT;  // Override the nodeType after construction
  }

  createTextNode(text: string): ServerText {
    return new ServerText(this, text, this.loc, false);
  }

  createElement(tagName: string): ServerElement {
    return new ServerElement(this, tagName, this.loc);
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

  toMarkup(ret: string[]): void {
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

function escape(text: string, chars = ''): string {
  let r = text;
  if (chars.indexOf('&') >= 0) r = r.split('&').join('&amp;');
  if (chars.indexOf('<') >= 0) r = r.split('<').join('&lt;');
  if (chars.indexOf('>') >= 0) r = r.split('>').join('&gt;');
  if (chars.indexOf('{') >= 0) r = r.split('{').join('&lbrace;');
  if (chars.indexOf('}') >= 0) r = r.split('}').join('&rbrace;');
  if (chars.indexOf('"') >= 0) r = r.split('"').join('&quot;');
  if (chars.indexOf("'") >= 0) r = r.split("'").join('&apos;');
  if (chars.indexOf(' ') >= 0) r = r.split(' ').join('&nbsp;');
  if (chars.indexOf('\n') >= 0) r = r.split('\n').join('&#xA;');
  if (chars.indexOf('\r') >= 0) r = r.split('\r').join('&#xD;');
  return r;
}

export function unescapeText(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
