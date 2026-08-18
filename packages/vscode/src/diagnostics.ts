import { Resolver, type ReadFile } from '@markout/core';
import { compilePage, hostPageFor, kitsFor, probeFor, PROBE_PAGE } from './pages';
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

  // A FRAGMENT is not a page and cannot be compiled as one. It is compiled
  // through a page that imports it -- a real one where the docroot has one,
  // since a fragment written to be included reads names from its host, and
  // otherwise a page whose only job is to import it. See ./pages.
  const fragment = pathname.toLowerCase().endsWith('.htm');
  const host = fragment ? hostPageFor(docroot, pathname) : undefined;
  const compiled = fragment ? host ?? PROBE_PAGE : pathname;
  const self = path.join(docroot, pathname);
  const readFile = openReader(filePath =>
    filePath.endsWith(PROBE_PAGE)
      ? probeFor(pathname)
      : filePath === self
        ? props.text
        : open?.(filePath)
  );

  const page = await compilePage({ docroot, pathname: compiled, text: props.text, readFile });
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

/** the one directory name that means "pages are served from here" */
export const DOCROOT_DIR_NAME = 'markout';

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
/** `:count=${`, `::bsRadius=${` -- the `=${` is what makes it ours */
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
  const manifest = path.join(docroot, 'package.json');
  let text: string;
  try {
    text = require('fs').readFileSync(manifest, 'utf8');
  } catch {
    return false;
  }
  try {
    const json = JSON.parse(text);
    const named = [
      ...Object.keys(json.dependencies ?? {}),
      ...Object.keys(json.devDependencies ?? {}),
      ...Object.keys(json.peerDependencies ?? {}),
      json.name,
    ];
    return named.some(
      name => name === 'markout' || (typeof name === 'string' && name.startsWith('@markout/'))
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
 * that works until it matters. `/npm/@markout/bootstrap-kit/all.htm` has to
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
