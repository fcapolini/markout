import type { Kit } from '../kits';
import { normalizeSeparators, Resolver } from '../paths';
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


/**
 * How a file's text is obtained, given its absolute path.
 *
 * Defaults to reading the disk, which is what a server and a build both
 * want. It is a parameter because an editor does not: a language server
 * holds the buffer the author is typing into, which is not what is on disk
 * and is exactly the version they want told about their mistakes. Returning
 * `undefined` means "not there", and reads as a missing file would.
 *
 * The docroot and the kit table already parameterize WHERE a pathname is
 * allowed to land; this parameterizes how the file it landed on is read.
 * Nothing about resolution moves: a reader is handed a path the resolver
 * already approved, so it cannot widen what a page may reach.
 */
export type ReadFile = (filePath: string) => Promise<string | undefined>;

const readFromDisk: ReadFile = async filePath => {
  try {
    return await fs.promises.readFile(filePath, { encoding: 'utf8' });
  } catch {
    return undefined;
  }
};

/*
  Adds support for:
  - <:include>
  - <:group>
  - <!--- (triple) comments removal
*/
export class Preprocessor {
  docroot: string;
  /** where a pathname is allowed to land, and what it maps to; see ../paths */
  protected resolver: Resolver;
  /** see ReadFile: the disk unless a caller has something better */
  protected readFile: ReadFile;

  /**
   * Pathnames every page is handed, ahead of what its author wrote.
   *
   * What they MEAN is not this layer's business. Something above decides
   * that a page should be given a file it never named -- the standard kit is
   * the case, see the compiler -- and this splices `<:import>` for it,
   * exactly as though the page had written one. A fragment gets none: it has
   * no head to put an import in, and takes what the page importing it has.
   */
  protected autoImports: string[];

  constructor(
    docroot: string,
    kits?: Kit[],
    readFile?: ReadFile,
    autoImports: string[] = []
  ) {
    this.resolver = new Resolver(docroot, kits);
    this.docroot = this.resolver.docroot.dir;
    this.readFile = readFile ?? readFromDisk;
    this.autoImports = autoImports;
  }

  async load(fname: string): Promise<Source> {
    const normalizedFname = normalizeSeparators(fname);
    // Every file read is recorded on THIS one, the page itself included: it
    // has to exist before anything can be parsed, so it is the only Source
    // that can be handed down to the loads that follow.
    const main = new Source('', normalizedFname);
    const source = await this.loadSource(normalizedFname, '.', main, 0);
    if (!source) {
      return main;
    }
    // ...and then carried across, which is the part that was missing. The
    // list was complete all along on an object only a FAILED load ever
    // returned, so every page that compiled reported having read nothing.
    // Nothing read it, which is how that went unnoticed -- except
    // `<:import>`'s once-only rule, which consults it during preprocessing
    // and was never affected.
    source.files.push(...main.files);
    return source;
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
      for (let i = 0; i < p.childNodes.length;) {
        if (p.childNodes[i].nodeType === NodeType.ELEMENT) {
          const e = p.childNodes[i] as dom.ServerElement;
          if (e.tagName === GROUP_DIRECTIVE_TAG) {
            // copied first: retargeting below must not read a list that the
            // splice is about to consume
            const kids = [...e.childNodes];
            kids.forEach(n => {
              n.parentElement = p;
              (n as dom.ServerNode).parentNode = p;
            });
            p.childNodes.splice(i, 1, ...kids);
            continue;
          }
          flattenGroups(e);
        }
        i++;
      }
    }
    flattenGroups(source.doc.documentElement!);

    function removeTripleComments(p: dom.ServerElement) {
      for (let i = 0; i < p.childNodes.length;) {
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

    if (nesting === 0) {
      this.addAutoImports(source.doc);
    }
    await this.processIncludes(source.doc, dir, main, nesting);
    if (main.errors.length) {
      source.errors.push(...main.errors);
    }
    return source;
  }

  /**
   * Put the auto imports at the top of a page's `<head>`, in order.
   *
   * Synthesized nodes rather than text prepended to the source: every
   * location in this file has already been measured against what the author
   * actually wrote, and inserting a line of anything would move all of them.
   *
   * First, so that whatever the page says next has the last word -- a page
   * defining a name an implicit import also defines takes it back, because
   * everything downstream reads document order. And by ordinary `<:import>`,
   * so the once-only rule applies: a page that imports the same file
   * explicitly gets it once, not twice.
   */
  protected addAutoImports(doc: dom.ServerDocument) {
    const head = doc.head;
    if (!head || !this.autoImports.length) {
      return;
    }
    // the page's own first position, so an error about a file the page never
    // named points at the page that got it rather than at nothing
    const loc = head.loc;
    for (const src of [...this.autoImports].reverse()) {
      const e = new dom.ServerElement(doc, IMPORT_DIRECTIVE_TAG, loc);
      e.setAttribute(INCLUDE_SRC_ATTR, src);
      e.parentElement = head;
      (e as dom.ServerNode).parentNode = head;
      head.childNodes.unshift(e);
    }
  }

  protected async loadText(
    fname: string,
    currDir: string,
    main: Source,
    once = false,
    from?: dom.ServerElement
  ): Promise<{ text: string; relPath: string } | undefined> {
    const resolved = this.resolver.resolve(fname, currDir);
    if (!resolved.ok) {
      // a path that left its root reads differently from a package that is
      // not there: the first is about what the author wrote, the second
      // about what is installed
      main.addError(
        'error',
        resolved.kind === 'forbidden'
          ? `Forbidden pathname "${resolved.escaped}"`
          : resolved.message,
        from?.loc
      );
      return;
    }
    const { filePath: pname, pathname: relPath } = resolved;
    if (main.files.indexOf(relPath) < 0) {
      main.files.push(relPath);
    } else if (once) {
      return;
    }
    const text = await this.readFile(pname);
    if (text === undefined) {
      main.addError('error', `File not found "${relPath}"`, from?.loc);
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
    // a page (nesting 0) confines <:import> to <head>, so a fragment's root
    // attributes always land in the same, well-known scope; a fragment has
    // no <head>, so its own root element plays that role instead
    const expectedImportParent = nesting === 0 ? doc.head : doc.documentElement;
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
      await this.processInclude(
        d,
        i,
        currDir,
        main,
        nesting,
        expectedImportParent
      );
    }
  }

  protected async processInclude(
    d: Include,
    i: number,
    currDir: string,
    main: Source,
    nesting: number,
    expectedImportParent: dom.ServerElement | null
  ) {
    if (d.name === IMPORT_DIRECTIVE_TAG && d.parent !== expectedImportParent) {
      main.addError(
        'error',
        nesting === 0
          ? `<${IMPORT_DIRECTIVE_TAG}> is only allowed directly in <head>`
          : `<${IMPORT_DIRECTIVE_TAG}> is only allowed at the top level of a fragment`,
        d.node.loc
      );
      return;
    }
    const src = d.node.getAttribute(INCLUDE_SRC_ATTR);
    if (!src?.trim()) {
      main.addError(
        'error',
        `Missing "${INCLUDE_SRC_ATTR}" attribute`,
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
    e.parentElement = d.parent;
    (e as dom.ServerNode).parentNode = d.parent;
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
    // BOTH pointers, and that is the whole of this fix.
    //
    // `parentNode` is what insertBefore/removeChild read, and what a node's
    // membership actually is; `parentElement` only answers "which element
    // contains me". Setting one and splicing by hand left every included
    // node listed by the page's body while still claiming the included
    // file's root as its parent -- so anything that later tried to replace
    // one operated on a document nobody serves. Custom-tag usages written
    // in an included file were never expanded for exactly that reason:
    // stage1 removed the tag from the fragment it came from and left the
    // copy in the page, which then rendered as an unknown element with a
    // scope and no instance behind it, in silence.
    nn.forEach(n => {
      n.parentElement = d.parent;
      (n as dom.ServerNode).parentNode = d.parent;
    });
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
