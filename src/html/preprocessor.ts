import { DIRECTIVE_TAG_PREFIX, NodeType } from './dom';
import { parse, Source } from './parser';
import * as dom from './server-dom';
import fs from 'fs';
import path from 'path';

export const INCLUDE_DIRECTIVE_TAG = DIRECTIVE_TAG_PREFIX + 'INCLUDE';
export const IMPORT_DIRECTIVE_TAG = DIRECTIVE_TAG_PREFIX + 'IMPORT';
export const INCLUDE_SRC_ATTR = 'src';
export const INCLUDE_AS_ATTR = 'as';
export const GROUP_DIRECTIVE_TAG = DIRECTIVE_TAG_PREFIX + 'GROUP';

export const MAX_NESTING = 100;

/*
  Adds support for:
  - <:include>
  - <:group>
  - <!--- (triple) comments removal
*/
export class Preprocessor {
  docroot: string;

  constructor(docroot: string) {
    this.docroot = docroot;
  }

  async load(fname: string): Promise<Source> {
    const dummy = new Source('', fname);
    const source = await this.loadSource(fname, '.', dummy, 0);
    return source ?? dummy;
  }

  protected async loadSource(
    fname: string,
    currDir: string,
    main: Source,
    nesting: number,
    once = false,
    from?: dom.ServerElement
  ): Promise<Source | undefined> {
    if (nesting >= MAX_NESTING) {
      main.addError('error', 'Too many nested inclusions', from?.loc);
      return;
    }
    const loaded = await this.loadText(fname, currDir, main, once, from);
    if (!loaded) {
      return;
    }
    const source = parse(loaded.text, loaded.relPath, undefined, nesting === 0);
    if (source.errors.length) {
      main.errors.push(...source.errors);
      return;
    }
    const dir = path.dirname(loaded.relPath);

    function flattenGroups(p: dom.ServerElement) {
      for (let i = 0; i < p.childNodes.length; ) {
        if (p.childNodes[i].nodeType === NodeType.ELEMENT) {
          const e = p.childNodes[i] as dom.ServerElement;
          if (e.tagName === GROUP_DIRECTIVE_TAG) {
            p.childNodes.splice(i, 1, ...e.childNodes);
            continue;
          }
          flattenGroups(e);
        }
        i++;
      }
    }
    flattenGroups(source.doc.documentElement!);

    function removeTripleComments(p: dom.ServerElement) {
      for (let i = 0; i < p.childNodes.length; ) {
        if (
          p.childNodes[i].nodeType !== NodeType.COMMENT ||
          !(p.childNodes[i] as dom.ServerComment).textContent.startsWith('-')
        ) {
          if (p.childNodes[i].nodeType === NodeType.ELEMENT) {
            removeTripleComments(p.childNodes[i] as dom.ServerElement);
          }
          i++;
          continue;
        }
        p.childNodes.splice(i, 1);
      }
    }
    removeTripleComments(source.doc.documentElement!);

    await this.processIncludes(source.doc, dir, main, nesting);
    if (main.errors.length) {
      source.errors.push(...main.errors);
    }
    return source;
  }

  protected async loadText(
    fname: string,
    currDir: string,
    main: Source,
    once = false,
    from?: dom.ServerElement
  ): Promise<{ text: string; relPath: string } | undefined> {
    if (fname.startsWith('/')) {
      currDir = '';
    }
    const pname = path.normalize(path.join(this.docroot, currDir, fname));
    if (!pname.startsWith(this.docroot)) {
      const s = path.relative(this.docroot, pname);
      main.addError('error', `Forbidden pathname "${s}"`, from?.loc);
      return;
    }
    const relPath = pname.substring(this.docroot.length);
    if (main.files.indexOf(relPath) < 0) {
      main.files.push(relPath);
    } else if (once) {
      return;
    }
    let text = '';
    try {
      text = await fs.promises.readFile(pname, { encoding: 'utf8' });
    } catch (error) {
      main.addError('error', `Failed to read "${relPath}"`, from?.loc);
      return;
    }
    return { text, relPath };
  }

  // ===========================================================================
  // inclusion
  // ===========================================================================

  protected async processIncludes(
    doc: dom.ServerDocument,
    currDir: string,
    main: Source,
    nesting: number
  ) {
    const includes = new Array<Include>();
    const collectIncludes = (p: dom.ServerElement) => {
      for (const n of p.childNodes) {
        if (n.nodeType === NodeType.ELEMENT) {
          const e = n as dom.ServerElement;
          if (
            e.tagName === IMPORT_DIRECTIVE_TAG ||
            e.tagName === INCLUDE_DIRECTIVE_TAG
          ) {
            includes.push({ name: e.tagName, parent: p, node: e });
          } else {
            collectIncludes(e);
          }
        }
      }
    };
    collectIncludes(doc);
    for (const d of includes) {
      const i = d.parent.childNodes.indexOf(d.node);
      d.parent.childNodes.splice(i, 1);
      await this.processInclude(d, i, currDir, main, nesting);
    }
  }

  protected async processInclude(
    d: Include,
    i: number,
    currDir: string,
    main: Source,
    nesting: number
  ) {
    const src = d.node.getAttribute(INCLUDE_SRC_ATTR);
    if (!src?.trim()) {
      main.addError(
        'error',
        `Missing ${INCLUDE_SRC_ATTR} attribute`,
        d.node.loc
      );
      return;
    }
    const as = d.node
      .getAttribute(INCLUDE_AS_ATTR)
      ?.trim()
      ?.toLocaleLowerCase();
    if (as) {
      if (!/^[\w-]+$/.test(as)) {
        main.addError(
          'error',
          `Invalid "${INCLUDE_AS_ATTR}" attribute`,
          d.node.loc
        );
        return;
      }
      return this.processLiteralInclude(d, i, src, as, currDir, main);
    }
    return this.processCodeInclude(d, i, src, currDir, main, nesting);
  }

  protected async processLiteralInclude(
    d: Include,
    i: number,
    fname: string,
    as: string,
    currDir: string,
    source: Source
  ) {
    const loaded = await this.loadText(fname, currDir, source, false, d.node);
    if (!loaded) {
      return;
    }
    const e = new dom.ServerElement(d.node.ownerDocument, as, d.node.loc);
    e.appendChild(
      new dom.ServerText(e.ownerDocument, loaded.text, d.node.loc, false)
    );
    d.parent.childNodes.splice(i, 0, e);
  }

  protected async processCodeInclude(
    d: Include,
    i: number,
    src: string,
    currDir: string,
    source: Source,
    nesting: number
  ) {
    const once = d.name === IMPORT_DIRECTIVE_TAG;
    const s = await this.loadSource(
      src,
      currDir,
      source,
      nesting + 1,
      once,
      d.node
    );
    const rootElement = s?.doc?.documentElement;
    if (!rootElement) {
      return;
    }
    // apply root attributes
    this.applyIncludedAttributes(d, rootElement);
    // include contents
    const nn = [...rootElement.childNodes];
    if (nn.length > 0) {
      const n = nn[0] as dom.ServerText;
      if (
        n.nodeType === NodeType.TEXT &&
        typeof n.textContent === 'string' &&
        /^\s*$/.test(n.textContent)
      ) {
        nn.shift();
      }
    }
    if (nn.length > 0) {
      const n = nn[nn.length - 1] as dom.ServerText;
      if (
        n.nodeType === NodeType.TEXT &&
        typeof n.textContent === 'string' &&
        /^\s*$/.test(n.textContent)
      ) {
        nn.pop();
      }
    }
    d.parent.childNodes.splice(i, 0, ...nn);
  }

  protected applyIncludedAttributes(
    directive: Include,
    rootElement: dom.ServerElement
  ) {
    const existing = directive.parent.getAttributeNames();
    for (const attr of rootElement.attributes) {
      const name = attr.name;
      if (!existing.includes(name)) {
        directive.parent.attributes.push(rootElement.getAttributeNode(name)!);
      }
    }
  }
}

export type Include = {
  name: string;
  node: dom.ServerElement;
  parent: dom.ServerElement;
};
