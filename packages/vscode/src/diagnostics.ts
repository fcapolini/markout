import { Resolver, type ReadFile } from '@markout-lang/core';
import { compileFileFor, kitsFor } from './pages';
import * as path from 'path';

/**
 * The compiler's own errors, as editor diagnostics.
 *
 * Nothing here re-implements a rule. The `Compiler` this runs is the one the
 * dev server and `build` run, given the buffer instead of the file -- so
 * every mistake markout can name, it names here too, in the place the author
 * is looking, before a save. That is the whole point of the extension and
 * the reason `readFile` became a parameter of the compiler; see
 * docs/design/editor-support.md.
 *
 * Kept free of any Volar or VS Code type on purpose: what is hard about this
 * is the compiler contract and the coordinates, and neither is easier to
 * test through a language server.
 */

/** an LSP range, in LSP's coordinates: 0-based line, 0-based character */
export interface Range {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface MarkoutDiagnostic {
  range: Range;
  message: string;
  severity: 'error' | 'warning';
  /**
   * The file the compiler blamed, as a pathname under the docroot.
   *
   * Usually the page itself, but an error inside an imported fragment
   * belongs to that fragment -- and a page importing a broken library must
   * still say so somewhere the author can see, so a diagnostic for another
   * file is reported against the import, not dropped.
   */
  pathname: string;
}

export interface DiagnoseProps {
  /** the docroot pages are resolved against */
  docroot: string;
  /** the page to compile, as a pathname under the docroot */
  pathname: string;
  /**
   * Its text: what the author is looking at.
   *
   * Both the content compiled for this file and the key a compile is cached
   * on, which are deliberately the same thing -- passing one without the
   * other allows them to disagree, and a cache keyed on text that is not the
   * text compiled is a cache that answers about a file nobody has.
   *
   * Required rather than defaulted for the same reason: a caller that omits
   * it would get somebody else's answer, which looks exactly like a feature
   * that has stopped noticing edits.
   */
  text: string;
  /** the editor's unsaved buffers, by absolute path; the disk answers the rest */
  open?: (filePath: string) => string | undefined;
}

/**
 * Compile one page and report what the compiler said about it.
 *
 * The kits are discovered per call rather than cached, which is the slow and
 * correct order to do it in: an `npm install` while the editor is open
 * changes what a page may import, and a stale table would report an error
 * that no longer exists. If it shows up in a profile, cache it against the
 * docroot and invalidate on package.json -- not before.
 */
/**
 * A reader over the editor's unsaved buffers, with the disk behind it.
 *
 * The whole reason `readFile` is a parameter of the compiler: what the author
 * is looking at is not what is saved, and it is the former they want told
 * about.
 */
export function openReader(
  open?: (filePath: string) => string | undefined
): ReadFile | undefined {
  return open
    ? async filePath => {
        const buffer = open(filePath);
        return buffer !== undefined ? buffer : await readFromDisk(filePath);
      }
    : undefined;
}

export async function diagnose(props: DiagnoseProps): Promise<MarkoutDiagnostic[]> {
  const { docroot, pathname, open } = props;

  // A FRAGMENT is not a page and cannot be compiled as one -- see
  // compileFileFor, which is where that decision lives for everything that
  // has to look at one file.
  const found = await compileFileFor({ docroot, pathname, text: props.text, open });
  const page = found?.page;
  const compiled = found?.compiled;
  if (!page) {
    // A compiler crash is a bug, and an editor is where it will be seen
    // first. Reported at the top of the file rather than swallowed: silence
    // here reads as "your page is fine", which is the one thing it is not.
    return [
      { range: at(1, 0), message: 'markout: the compiler failed', severity: 'error', pathname },
    ];
  }

  // A fragment was compiled through something else -- a page that imports it,
  // or a probe -- and that page's own mistakes are its own. Reporting them
  // here puts `broken.html`'s typo on `lib.htm`, which names a file the
  // author is not looking at and blames one they are.
  const viaAnother = compiled !== pathname;

  return page.errors
    .filter(error => !viaAnother || (error.loc?.source ?? pathname) === pathname)
    .map(error => {
    const loc = error.loc;
    return {
      // the compiler counts lines from 1 and columns from 0; LSP counts both
      // from 0, and getting this wrong is off-by-one in the only direction
      // anyone would notice
      range: loc
        ? {
            start: { line: loc.start.line - 1, character: loc.start.column },
            end: { line: loc.end.line - 1, character: loc.end.column },
          }
        : at(1, 0),
      message: error.msg,
      severity: error.type,
      pathname: loc?.source ?? pathname,
    };
  });
}

/** a zero-width range at a 1-based line and 0-based column */
function at(line: number, column: number): Range {
  const position = { line: line - 1, character: column };
  return { start: position, end: position };
}

async function readFromDisk(filePath: string): Promise<string | undefined> {
  const fs = await import('fs');
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * The docroot a file belongs to: the nearest ancestor that says it is one.
 *
 * This matters more than it looks. A docroot is what an absolute path is
 * resolved against, so guessing it wrong does not merely lose a feature --
 * `<:import src="/lib.htm" />` stops resolving and the extension reports a
 * missing file that is sitting right there. A false error is worse than
 * silence, so the guess has to be one an author can PREDICT and correct.
 *
 * Nearest ancestor wins, and two things count as saying so:
 *
 * - **a directory named `markout`**. For the delivery mode with no install
 *   at all -- write the pages, `npx markout ./markout`, done -- there is no
 *   package.json to find, and the folder name is the only thing an author
 *   can say it with. Distinctive on purpose: `public`, `www` and `static`
 *   belong to every static-site tool there is, and claiming one would mean
 *   guessing at a Rails app's docroot.
 * - **a package.json**, which is where a project that installs anything
 *   keeps its identity anyway.
 *
 * And `markout.docroot` overrides both, because neither is evidence, only a
 * good guess.
 */
export function guessDocroot(filePath: string, workspaceFolder?: string): string {
  let dir = path.dirname(filePath);
  const stop = workspaceFolder ? path.resolve(workspaceFolder) : path.parse(dir).root;
  for (;;) {
    if (path.basename(dir) === DOCROOT_DIR_NAME || existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    if (dir === stop || dir === path.dirname(dir)) {
      return workspaceFolder ? path.resolve(workspaceFolder) : dir;
    }
    dir = path.dirname(dir);
  }
}

/**
 * The workspace folder a file is in, out of several.
 *
 * A window can hold more than one folder, and they are not variations on one
 * project: each has its own docroot, its own package.json, its own answer to
 * whether it is markout's at all. So the ceiling for the docroot guess is the
 * folder the file is actually IN -- the longest that contains it, since a
 * workspace is allowed to nest them -- and nothing at all for a file in none
 * of them, which is what an editor sends when a page is opened from outside
 * the workspace.
 */
export function folderOf(filePath: string, folders: string[] = []): string | undefined {
  const file = path.resolve(filePath);
  let found: string | undefined;
  for (const folder of folders) {
    const root = path.resolve(folder);
    const within = file === root || file.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
    if (within && (!found || root.length > found.length)) {
      found = root;
    }
  }
  return found;
}

/** the one directory name that means "pages are served from here" */
export const DOCROOT_DIR_NAME = 'markout';

/**
 * The `package.json` section a project configures markout in.
 *
 * The same key a kit declares its logical root under (`markout.root`, see
 * core's `KIT_KEY`), and deliberately so: one section, one spelling, two
 * things a package can say about itself -- a KIT says where its files are
 * addressed from, an APPLICATION says where its pages are. Nothing reads
 * both keys off one manifest, so they cannot be confused for each other.
 */
export const MANIFEST_KEY = 'markout';

/**
 * `markout.docroot`, normalized: one docroot or several, as absolute paths.
 *
 * Several, because a window is routinely open on a project that serves more
 * than one -- a monorepo of sites, or a site with a demo beside it -- and
 * because a single value applied to every file is the failure the setting
 * was supposed to fix. A string stays a string at the point of writing; the
 * plural is what happens to it here.
 *
 * Relative entries resolve against `from`: the manifest's own directory for
 * a package.json, and each workspace folder for a setting, which is the only
 * base a window-scoped value could sensibly have. Anything that is not a
 * non-empty string is dropped rather than refused -- a half-edited setting
 * is a normal state for a file somebody is typing in, and the guess below it
 * is a working answer.
 */
export function docrootsOf(value: unknown, from: string): string[] {
  const given = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  const found: string[] = [];
  for (const entry of given) {
    if (typeof entry !== 'string' || !entry.trim()) {
      continue;
    }
    const full = path.resolve(from, entry);
    found.includes(full) || found.push(full);
  }
  return found;
}

/**
 * The docroots a project declares in its `package.json`, nearest manifest
 * first-and-only.
 *
 * Nearest that SAYS SO, rather than nearest at all: a monorepo's root
 * manifest is where "these are my sites" belongs, and a package in between
 * that says nothing about markout should not silence it. Reading only the
 * first manifest that carries the key keeps the rule the same one
 * guessDocroot already uses -- nearest ancestor wins -- so an author who can
 * predict one can predict the other.
 *
 * Bounded by the workspace folder for the same reason the guess is: above it
 * is somebody else's project, and a `markout` section up there is not this
 * window's business.
 *
 * Read per call rather than cached, on the same terms as `kitsFor`'s note in
 * this file: editing `markout.docroot` in a package.json changes what every
 * absolute path in the project means, and a stale answer to that reports
 * missing files that are sitting right there. It is a handful of small reads
 * up the same tree the guess already walks with `existsSync`. If it shows up
 * in a profile, cache it and invalidate on package.json -- not before.
 */
export function manifestDocroots(filePath: string, workspaceFolder?: string): string[] {
  let dir = path.dirname(path.resolve(filePath));
  const stop = workspaceFolder ? path.resolve(workspaceFolder) : path.parse(dir).root;
  for (;;) {
    const declared = readManifestDocroot(path.join(dir, 'package.json'));
    if (declared !== undefined) {
      return docrootsOf(declared, dir);
    }
    if (dir === stop || dir === path.dirname(dir)) {
      return [];
    }
    dir = path.dirname(dir);
  }
}

/** `markout.docroot` out of one manifest, or nothing if it does not say */
function readManifestDocroot(manifest: string): unknown {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(require('fs').readFileSync(manifest, 'utf8'));
  } catch {
    // unreadable or unparseable is not evidence either way -- the same
    // reading isMarkoutProject takes of a manifest it cannot understand
    return undefined;
  }
  const section = json[MANIFEST_KEY] as { docroot?: unknown } | undefined;
  return section && typeof section === 'object' ? section.docroot : undefined;
}

/**
 * The docroot one file is read against: what was configured, else the guess.
 *
 * Three sources, in the order an author would expect to override them:
 *
 * 1. **the `markout.docroot` setting** -- this window, this person, right
 *    now, and the thing they reach for when the other two are wrong;
 * 2. **`markout.docroot` in the nearest `package.json`** -- the project's
 *    own answer, checked in, shared by everyone who opens it, and the only
 *    one of the three that a build could ever be made to agree with;
 * 3. **the guess** -- guessDocroot, unchanged.
 *
 * Configured docroots are candidates rather than an answer: the one CHOSEN
 * is the innermost that actually contains the file, by exactly the rule
 * folderOf uses for workspace folders, since docroots may nest as freely as
 * folders do. A file under none of them falls through to the next source
 * rather than being forced under one it is not in -- which is what the
 * single-value setting did, and what made it unusable in a window holding
 * more than one project.
 *
 * A file under exactly one configured docroot therefore behaves as it always
 * did, which is the case nearly every project is.
 */
export function docrootFor(
  filePath: string,
  props: {
    /** `markout.docroot`, as configured: one, several, or none */
    docroot?: string | string[];
    workspaceFolders?: string[];
  }
): string {
  // read once: these arrive as GETTERS over live settings -- see the props
  // server.ts passes -- so each mention is a call, and two of them within
  // one answer could disagree
  const setting = props.docroot;
  const folders = props.workspaceFolders;
  const folder = folderOf(filePath, folders);
  // a relative setting has no base of its own, so every folder is offered
  // one; an absolute one resolves to itself whichever base it is given
  const bases = folders?.length ? folders : [process.cwd()];
  const configured = bases.flatMap(base => docrootsOf(setting, base));
  return (
    folderOf(filePath, configured) ??
    folderOf(filePath, manifestDocroots(filePath, folder)) ??
    guessDocroot(filePath, folder)
  );
}

function existsSync(p: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('fs').existsSync(p);
  } catch {
    return false;
  }
}

/**
 * Whether a page's own text is unmistakably markout.
 *
 * The other half of the gate, and the half that matters most, because
 * markout's whole delivery story is that you need install nothing: write the
 * pages, run `npx markout ./site`, done. Such a project has no package.json
 * to depend on markout, so a project-only gate would be silent for exactly
 * the audience the language is pitched at.
 *
 * Two markers, and what is NOT one is the point:
 *
 * - a `<:…>` directive tag -- `<:import>`, `<:define>`, `<:include>`,
 *   `<:slot>`. No other templating language spells a tag that way.
 * - a colon attribute whose value is an expression: `:count=${…}`. The
 *   colon alone would not do -- Alpine writes `:class="open ? 'a' : 'b'"`
 *   and Vue writes `:prop="x"`, both quoted, and Thymeleaf's `th:text` and
 *   an `xmlns:th` do not start with one. It is the `=${` that no one else
 *   writes.
 *
 * `${…}` on its own is deliberately NOT a marker, though it is markout's one
 * interpolation syntax. It is also JSP EL, Thymeleaf and Underscore, all of
 * which live in `.html` files, and a page holding nothing else is a page
 * this extension cannot tell apart from theirs.
 */
export function looksLikeMarkout(text: string): boolean {
  return DIRECTIVE_TAG.test(text) || EXPRESSION_ATTRIBUTE.test(text);
}

/** `<:import`, `</:define`, and the rest */
const DIRECTIVE_TAG = /<\/?:[a-zA-Z]/;
/** `:count=${`, `:const-bsRadius=${` -- the `=${` is what makes it ours */
const EXPRESSION_ATTRIBUTE = /[\s"']::?[A-Za-z_$][\w:$-]*=\$\{/;

/**
 * Whether a docroot belongs to a project that uses markout.
 *
 * The gate that keeps this extension from being a nuisance. Markout is an
 * extension to HTML, so it claims no file suffix of its own and every page it
 * compiles is a `.html` file like any other -- which means the question
 * "should I report on this file" cannot be answered by looking at the file.
 *
 * Almost all plain HTML compiles clean as markout, since markout is a
 * superset: script contents are not interpolated, and `{{…}}`, `{%…%}` and
 * `<?php … ?>` mean nothing to it. The exception is `${…}` outside a script,
 * which is exactly what JSP EL, Thymeleaf and Underscore templates put in
 * `.html` files -- so in one of those projects, reporting per file would
 * produce an error on every line of every page.
 *
 * A project that depends on markout is asking for markout. One that does not
 * gets silence, and the `markout.enable` setting for when the guess is wrong.
 */
export function isMarkoutProject(docroot: string): boolean {
  // The docroot is a directory called `markout`, which is the ONLY way the
  // no-install mode has of saying so. There is no package.json to depend on
  // markout in a project whose whole story is that you install nothing --
  // write the pages, `npx markout ./markout`, done -- so a gate that only
  // read manifests was silent for exactly the audience the convention was
  // invented for. The name is distinctive on purpose (see DOCROOT_DIR_NAME);
  // that it can be trusted as evidence is what it was chosen distinctive FOR.
  if (path.basename(path.resolve(docroot)) === DOCROOT_DIR_NAME) {
    return true;
  }
  const manifest = path.join(docroot, 'package.json');
  let text: string;
  try {
    text = require('fs').readFileSync(manifest, 'utf8');
  } catch {
    return false;
  }
  try {
    const json = JSON.parse(text);
    // a `markout` section is the project configuring markout -- a docroot,
    // or a kit's own root. Nobody writes one by accident, and a project that
    // says where its pages are has said which tool is meant to read them
    if (json[MANIFEST_KEY] && typeof json[MANIFEST_KEY] === 'object') {
      return true;
    }
    const named = [
      ...Object.keys(json.dependencies ?? {}),
      ...Object.keys(json.devDependencies ?? {}),
      ...Object.keys(json.peerDependencies ?? {}),
      json.name,
    ];
    // `markout` unscoped is somebody else's package on npm today, and is
    // kept here anyway: it is the name this project would use if that ever
    // changes, and a project depending on a dead 0.0.1 from 2018 is not a
    // false positive worth designing around
    return named.some(
      name =>
        name === 'markout' ||
        (typeof name === 'string' && name.startsWith('@markout-lang/'))
    );
  } catch {
    // a package.json that does not parse is not evidence either way, and
    // guessing yes would put errors on a project that never asked
    return false;
  }
}

/**
 * The file a directive's `src` names, as an absolute path.
 *
 * Answered by the compiler's own `Resolver` rather than by joining paths
 * here, which is the difference between go-to-definition that works and one
 * that works until it matters. `/npm/@markout-lang/bootstrap-kit/all.htm` has to
 * land inside an installed package, a relative path has to resolve against
 * the file that wrote it, and a path leaving the docroot has to resolve to
 * nothing at all -- three rules the editor has no business having a second
 * copy of.
 */
export function resolveReference(props: {
  docroot: string;
  /** the file doing the importing, so a relative path has something to be relative to */
  fromPathname: string;
  /** the `src` as written */
  spec: string;
}): string | undefined {
  const { docroot, fromPathname, spec } = props;
  const currDir = path.posix.dirname(fromPathname);
  const resolved = new Resolver(docroot, kitsFor(docroot)).resolve(spec, currDir);
  return resolved.ok ? resolved.filePath : undefined;
}

/** the pathname a docroot would serve a file at */
export function pathnameOf(filePath: string, docroot: string): string {
  const rel = path.relative(path.resolve(docroot), path.resolve(filePath));
  return '/' + rel.split(path.sep).join('/');
}
