import { Compiler, discoverKits, type ReadFile } from '@markout/core';
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
export async function diagnose(props: DiagnoseProps): Promise<MarkoutDiagnostic[]> {
  const { docroot, pathname, open } = props;
  const readFile: ReadFile | undefined = open
    ? async filePath => {
        const buffer = open(filePath);
        return buffer !== undefined ? buffer : await readFromDisk(filePath);
      }
    : undefined;

  const { kits } = discoverKits(docroot);
  let errors;
  try {
    const page = await new Compiler({ docroot, kits, readFile }).compile(pathname);
    errors = page.errors;
  } catch (e) {
    // A compiler crash is a bug, and an editor is where it will be seen
    // first. Reported at the top of the file rather than swallowed: silence
    // here reads as "your page is fine", which is the one thing it is not.
    return [
      {
        range: at(1, 0),
        message: `markout: ${e instanceof Error ? e.message : e}`,
        severity: 'error',
        pathname,
      },
    ];
  }

  return errors.map(error => {
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
 * The docroot a file belongs to: the nearest ancestor holding a
 * `package.json`, and the workspace folder otherwise.
 *
 * A guess, and it has to be: a docroot is a serving decision that a
 * directory of HTML does not record. It is the right guess for every layout
 * in this repository and for the shape the docs describe, and a page that
 * disagrees can say so -- which is what the `markout.docroot` setting is
 * for, and why this returns a guess rather than pretending to know.
 */
export function guessDocroot(filePath: string, workspaceFolder?: string): string {
  let dir = path.dirname(filePath);
  const stop = workspaceFolder ? path.resolve(workspaceFolder) : path.parse(dir).root;
  for (;;) {
    if (existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    if (dir === stop || dir === path.dirname(dir)) {
      return workspaceFolder ? path.resolve(workspaceFolder) : dir;
    }
    dir = path.dirname(dir);
  }
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

/** the pathname a docroot would serve a file at */
export function pathnameOf(filePath: string, docroot: string): string {
  const rel = path.relative(path.resolve(docroot), path.resolve(filePath));
  return '/' + rel.split(path.sep).join('/');
}
